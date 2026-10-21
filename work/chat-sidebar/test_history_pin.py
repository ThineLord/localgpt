import pathlib
import sys
import threading
from contextlib import contextmanager
from pathlib import Path
import tempfile
import unittest

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

ROOT = pathlib.Path(__file__).parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import runtime
import storage
from history_metadata import set_pin
from runtime import errors, install
from storage import Conflict, Store


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

    def test_reads_do_not_initialize_pin_schema(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = Store(Path(tmp) / "ready.sqlite3")
            chat = store.create("Ready")
            def forbidden(_db):
                raise AssertionError("pin schema init does not belong on read")
            original = storage._ensure_pin_schema
            storage._ensure_pin_schema = forbidden
            try:
                listed = store.chats()
                full = store.chat(chat["id"])
            finally:
                storage._ensure_pin_schema = original
            self.assertIs(listed[0]["pinned"], False)
            self.assertIs(full["pinned"], False)
            self.assertEqual(full["pin_version"], 0)

    def test_set_pin_does_not_initialize_schema_inside_the_transaction(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = Store(Path(tmp) / "atomic.sqlite3")
            chat = store.create("Atomic")

            class Guard:
                def __init__(self, db):
                    self._db = db

                def executescript(self, *_args, **_kwargs):
                    raise AssertionError("schema script must not run inside pin mutation")

                def __getattr__(self, name):
                    return getattr(self._db, name)

            real_connect = store.connect

            @contextmanager
            def guarded_connect(*args, **kwargs):
                with real_connect(*args, **kwargs) as db:
                    yield Guard(db)

            store.connect = guarded_connect
            try:
                pinned = set_pin(store, chat["id"], True, 0)
            finally:
                store.connect = real_connect
            self.assertTrue(pinned["pinned"])
            self.assertEqual(pinned["pin_version"], 1)

    def _race_pin(self, store, chat_id, pinned, expected):
        barrier = threading.Barrier(2, timeout=5)
        outcomes = []

        def writer():
            barrier.wait()
            try:
                outcomes.append(("ok", set_pin(store, chat_id, pinned, expected)))
            except Conflict:
                outcomes.append(("conflict", None))
            except Exception as exc:
                outcomes.append(("error", exc))

        threads = [threading.Thread(target=writer) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(10)
            self.assertFalse(thread.is_alive(), "pin writer did not finish")
        kinds = [kind for kind, _ in outcomes]
        self.assertEqual(sorted(kinds), ["conflict", "ok"], outcomes)
        with store.connect() as db:
            row = db.execute(
                "SELECT pinned, pin_version FROM chat_pin WHERE chat_id=?", (chat_id,)
            ).fetchone()
        self.assertIsNotNone(row)
        self.assertEqual(int(row["pin_version"]), expected + 1)
        self.assertEqual(bool(row["pinned"]), pinned)
        return row

    def test_simultaneous_writers_one_success_one_conflict(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = Store(Path(tmp) / "race.sqlite3")
            for _ in range(8):
                chat = store.create("Initial pin race")
                self._race_pin(store, chat["id"], True, 0)
            existing = store.create("Existing pin race")
            self.assertEqual(set_pin(store, existing["id"], True, 0)["pin_version"], 1)
            for _ in range(8):
                current = store.chat(existing["id"])["pin_version"]
                self._race_pin(store, existing["id"], False, current)
                current = store.chat(existing["id"])["pin_version"]
                self._race_pin(store, existing["id"], True, current)


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
        self.assertIs(again[0]["pinned"], True)
        self.assertEqual(again[0]["pin_version"], 1)
        detail = await (await self.client.get(url)).json()
        self.assertIs(detail["pinned"], True)
        self.assertEqual(detail["pin_version"], 1)

    async def test_pin_rejects_non_boolean_and_bad_version(self):
        chat = await self.create()
        url = f"/qwen-cn/chats/{chat['id']}/pin"
        for body in (
            {"pinned": 1, "pin_version": 0},
            {"pinned": "true", "pin_version": 0},
            {"pinned": False, "pin_version": True},
            {"pinned": False, "pin_version": 1.5},
            {"pinned": False, "pin_version": -1},
        ):
            response = await self.client.patch(url, json=body)
            self.assertEqual(response.status, 400, body)
        missing = await self.client.patch(url, json={"pinned": True})
        self.assertEqual(missing.status, 400)

    async def test_deleted_chat_cannot_be_pinned_and_restore_keeps_pin(self):
        chat = await self.create()
        url = f"/qwen-cn/chats/{chat['id']}"
        before = self.core.STORE.chat(chat["id"])
        await self.client.patch(url, json={"version": before["draft_version"], "draft": {"prompt": "keep"}})
        drafted = self.core.STORE.chat(chat["id"])
        pinned = await self.client.patch(url + "/pin", json={"pinned": True, "pin_version": 0})
        self.assertEqual(pinned.status, 200)
        after_pin = self.core.STORE.chat(chat["id"])
        self.assertEqual(after_pin["draft"]["prompt"], "keep")
        self.assertEqual(after_pin["draft"], drafted["draft"])
        self.assertEqual(after_pin["draft_version"], drafted["draft_version"])
        self.assertEqual(after_pin["version"], drafted["version"])
        await self.client.delete(url, json={})
        denied = await self.client.patch(url + "/pin", json={"pinned": False, "pin_version": 1})
        self.assertEqual(denied.status, 400)
        restored = await self.client.post(url + "/restore", json={})
        self.assertEqual(restored.status, 200)
        body = await restored.json()
        self.assertIs(body["pinned"], True)
        self.assertEqual(body["pin_version"], 1)

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
