import importlib.util
import pathlib
import sys
from pathlib import Path
import tempfile
import unittest

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

ROOT = pathlib.Path(__file__).parent
for name in ("storage", "runtime"):
    spec = importlib.util.spec_from_file_location(name, ROOT / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
Store = sys.modules["storage"].Store
Conflict = sys.modules["storage"].Conflict
install = sys.modules["runtime"].install
errors = sys.modules["runtime"].errors


class PinMetadataTests(unittest.TestCase):
    def test_old_database_defaults_unpinned_without_chat_mutation(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "legacy.sqlite3"
            store = Store(path)
            chat = store.create("Legacy chat")
            with store.connect() as db:
                version = db.execute(
                    "SELECT version, draft_version FROM chats WHERE id=?", (chat["id"],)
                ).fetchone()
            listed = store.chats()[0]
            self.assertFalse(listed["pinned"])
            self.assertEqual(listed["pin_version"], 0)
            full = store.chat(chat["id"])
            self.assertFalse(full["pinned"])
            with store.connect() as db:
                after = db.execute(
                    "SELECT version, draft_version FROM chats WHERE id=?", (chat["id"],)
                ).fetchone()
            self.assertEqual(after["version"], version["version"])
            self.assertEqual(after["draft_version"], version["draft_version"])


class PinAPITests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.input, self.output = self.root / "input", self.root / "output"
        self.input.mkdir()
        self.output.mkdir()
        upstream = web.Application()
        self.backend = TestServer(upstream)
        await self.backend.start_server()
        app = web.Application(middlewares=[errors])
        self.core = install(
            app,
            str(self.backend.make_url("")).rstrip("/"),
            self.root / "data.sqlite3",
            self.input,
            self.output,
        )
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        await self.backend.close()
        self.tmp.cleanup()

    async def create(self, title="Pin test"):
        r = await self.client.post("/qwen-cn/chats", json={"title": title})
        self.assertEqual(r.status, 201)
        return await r.json()

    async def test_pin_rename_trash_restore_and_stale_conflict(self):
        chat = await self.create()
        url = f"/qwen-cn/chats/{chat['id']}"
        before = self.core.STORE.chat(chat["id"])
        pinned = await self.client.patch(
            url + "/pin", json={"pinned": True, "pin_version": 0}
        )
        self.assertEqual(pinned.status, 200)
        body = await pinned.json()
        self.assertTrue(body["pinned"])
        self.assertEqual(body["pin_version"], 1)
        after = self.core.STORE.chat(chat["id"])
        self.assertEqual(after["version"], before["version"])
        self.assertEqual(after["draft_version"], before["draft_version"])
        renamed = await self.client.patch(
            url, json={"version": after["version"], "title": "Pinned title"}
        )
        self.assertEqual(renamed.status, 200)
        listed = await (await self.client.get("/qwen-cn/chats")).json()
        self.assertTrue(listed[0]["pinned"])
        stale = await self.client.patch(
            url + "/pin", json={"pinned": False, "pin_version": 0}
        )
        self.assertEqual(stale.status, 409)
        trashed = await self.client.delete(url, json={})
        self.assertEqual(trashed.status, 200)
        self.assertEqual(await (await self.client.get("/qwen-cn/chats")).json(), [])
        restored = await self.client.post(url + "/restore", json={})
        self.assertEqual(restored.status, 200)
        again = await (await self.client.get("/qwen-cn/chats")).json()
        self.assertTrue(again[0]["pinned"])

    async def test_purge_removes_pin_metadata(self):
        chat = await self.create()
        url = f"/qwen-cn/chats/{chat['id']}"
        await self.client.patch(url + "/pin", json={"pinned": True, "pin_version": 0})
        await self.client.delete(url, json={})
        await self.client.delete(
            "/qwen-cn/trash/" + chat["id"],
            json={"confirm": True, "include_media": False},
        )
        with self.core.STORE.connect() as db:
            self.assertIsNone(
                db.execute(
                    "SELECT 1 FROM chat_pin WHERE chat_id=?", (chat["id"],)
                ).fetchone()
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
