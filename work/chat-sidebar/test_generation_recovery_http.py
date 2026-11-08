"""APP-03 acceptance against real runtime processes and synthetic mock services.

Run with ``python -m unittest test_generation_recovery_http -v`` from this
directory. APP03_SOURCE can point at a historical source checkout: the strict
crash-recovery assertions must fail there, rather than counting the bug as PASS.
APP03_RECEIPTS optionally retains metadata-only fixture receipts (no real data).
"""
import asyncio
import json
import os
from pathlib import Path
import signal
import sqlite3
import sys
import tempfile
import time
import unittest

import aiohttp
from aiohttp import web


SOURCE = Path(os.environ.get("APP03_SOURCE", Path(__file__).parent)).resolve()
WORKER = Path(__file__).resolve().parents[2] / "tools" / "app03_test_worker.py"
ACTIVE = ("submitting", "running")


class RuntimeWorker:
    def __init__(self, case, root, timeout=False, backend=False):
        self.case, self.root, self.timeout, self.backend = case, root, timeout, backend
        self.process = None
        self.starts = 0
        self.receipts = []
        case.workers.append(self)

    async def start(self):
        self.root.mkdir(parents=True, exist_ok=True)
        self.starts += 1
        self.name = "worker-%s-%s" % (self.case.workers.index(self), self.starts)
        self.ready = self.root / (self.name + "-ready.json")
        self.log_path = self.root / (self.name + ".log")
        self.log = self.log_path.open("w")
        cmd = [sys.executable, "-B", str(WORKER), "--root", str(self.root),
               "--source", str(SOURCE), "--mock", self.case.mock_url, "--name", self.name]
        if self.timeout:
            cmd.append("--timeout")
        if self.backend:
            cmd.append("--backend")
        self.process = await asyncio.create_subprocess_exec(
            *cmd, cwd=self.root,
            env={"PATH": "/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1",
                 "PYTHONUNBUFFERED": "1", "TMPDIR": str(self.root)},
            stdout=self.log, stderr=self.log,
        )
        for _ in range(160):
            if self.ready.exists():
                break
            if self.process.returncode is not None:
                raise AssertionError("Fixture worker exited: " + self.log_path.read_text())
            await asyncio.sleep(.025)
        else:
            raise AssertionError("Fixture readiness timed out: " + self.log_path.read_text())
        self.port = json.loads(self.ready.read_text())["port"]
        self.case.assertNotIn(self.port, (8190, 8188, 1234))
        self.url = "http://127.0.0.1:" + str(self.port)
        return self

    async def stop(self, kill=False):
        if self.process is None:
            return
        guard_snapshot = None
        if self.process.returncode is None:
            if kill and hasattr(self, "url"):
                status, state = await self.request("GET", "/__fixture/tasks")
                self.case.assertEqual(status, 200)
                guard_snapshot = state["guard"]
                self.case.assertEqual(guard_snapshot["denied"], [])
            self.process.send_signal(signal.SIGKILL if kill else signal.SIGTERM)
            try:
                await asyncio.wait_for(self.process.wait(), 5)
            except asyncio.TimeoutError:
                self.process.kill()
                await self.process.wait()
                raise AssertionError("Fixture failed bounded cleanup")
        if not self.log.closed:
            self.log.close()
            receipt = {"pid": self.process.pid, "exit_code": self.process.returncode,
                       "port": getattr(self, "port", None), "name": self.name}
            if kill and guard_snapshot is not None:
                receipt["guard_before_sigkill"] = guard_snapshot
            guard_path = self.root / (self.name + "-guard.json")
            if guard_path.exists():
                receipt["guard"] = json.loads(guard_path.read_text())
                self.case.assertEqual(receipt["guard"]["denied"], [])
            self.receipts.append(receipt)

    async def request(self, method, path, body=None):
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=4)) as client:
            async with client.request(method, self.url + path, json=body) as response:
                return response.status, await response.json()

    async def chat(self, project_id=None):
        data = {"title": "Synthetic APP-03 fixture"}
        if project_id:
            data["project_id"] = project_id
        status, body = await self.request("POST", "/qwen-cn/chats", data)
        self.case.assertEqual(status, 201, body)
        return body["id"]

    def payload(self, prompt, key, mode="chat"):
        return {"prompt": prompt, "request_key": key, "mode": mode,
                "model": "synthetic-model", "thinking": "on"}

    async def send(self, chat, prompt, key, mode="chat"):
        return await self.request("POST", "/qwen-cn/chats/" + chat + "/send",
                                  self.payload(prompt, key, mode))

    def sql(self, query, params=()):
        database = self.root / "synthetic.sqlite3"
        self.case.assertTrue(database.is_file())
        with sqlite3.connect(database, timeout=2) as db:
            db.row_factory = sqlite3.Row
            return [dict(row) for row in db.execute(query, params)]

    def row(self, mid):
        return self.sql("SELECT * FROM messages WHERE id=?", (mid,))[0]

    async def wait(self, mid, predicate):
        for _ in range(160):
            row = self.row(mid)
            if predicate(row):
                return row
            await asyncio.sleep(.025)
        raise AssertionError("State wait timed out: " + repr(self.row(mid)))

    async def terminal(self, mid):
        return await self.wait(mid, lambda row: row["status"] not in ACTIVE)

    async def idle(self):
        for _ in range(160):
            status, state = await self.request("GET", "/__fixture/tasks")
            self.case.assertEqual(status, 200)
            self.case.assertEqual(state["guard"]["denied"], [])
            if not state["tasks"]:
                return
            await asyncio.sleep(.025)
        raise AssertionError("Task did not release ownership")


class GenerationRecoveryHTTPTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="localgpt-app03-")
        self.root = Path(self.tmp.name)
        self.workers = []
        self.calls = []
        self.catalog_hold = False
        self.catalog_seen = asyncio.Event()
        self.prompt_hold = False
        self.prompt_seen = asyncio.Event()
        self.release = asyncio.Event()
        app = web.Application()
        app.router.add_route("*", "/{tail:.*}", self.mock)
        self.runner = web.AppRunner(app, shutdown_timeout=.1, access_log=None)
        await self.runner.setup()
        await web.TCPSite(self.runner, "127.0.0.1", 0).start()
        port = self.runner.addresses[0][1]
        self.assertNotIn(port, (8190, 8188, 1234))
        self.mock_url = "http://127.0.0.1:" + str(port)

    async def asyncTearDown(self):
        try:
            for worker in self.workers:
                await worker.stop()
            self.release.set()
            await self.runner.cleanup()
            receipts = {"test": self._testMethodName, "source": str(SOURCE),
                        "workers": [r for w in self.workers for r in w.receipts],
                        "mock_paths": [path for path, _ in self.calls]}
            receipts["databases"] = []
            for root in {w.root for w in self.workers}:
                with sqlite3.connect(root / "synthetic.sqlite3") as db:
                    self.assertEqual(db.execute("PRAGMA journal_mode").fetchone()[0], "wal")
                    self.assertEqual(db.execute("PRAGMA quick_check").fetchall(), [("ok",)])
                    self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
                    db.row_factory = sqlite3.Row
                    rows = [dict(row) for row in db.execute(
                        "SELECT id,chat_id,status,kind,request_key FROM messages ORDER BY created,id")]
                    receipts["databases"].append({"name": root.name, "rows": rows})
            receipts["sqlite_integrity"] = "ok"
            if os.environ.get("APP03_RECEIPTS"):
                destination = Path(os.environ["APP03_RECEIPTS"])
                destination.mkdir(parents=True, exist_ok=True)
                (destination / (self._testMethodName + ".json")).write_text(
                    json.dumps(receipts, indent=2) + "\n")
        finally:
            self.tmp.cleanup()

    async def mock(self, request):
        body = await request.json() if request.can_read_body else None
        self.calls.append((request.path, body))
        if request.path == "/api/v1/models":
            self.catalog_seen.set()
            while self.catalog_hold and request.transport and not request.transport.is_closing():
                await asyncio.sleep(.025)
            return web.json_response({"models": [{"type": "llm", "key": "synthetic-model",
                "architecture": "synthetic", "loaded_instances": [{"id": "fixture-loaded"}],
                "capabilities": {}}]})
        if request.path == "/queue":
            return web.json_response({"queue_running": [], "queue_pending": []})
        if request.path in ("/free", "/interrupt"):
            return web.json_response({"requested": True})
        if request.path == "/prompt":
            self.prompt_seen.set()
            while self.prompt_hold and request.transport and not request.transport.is_closing():
                await asyncio.sleep(.025)
            return web.json_response({"prompt_id": "synthetic-image-id"})
        if request.path.endswith("/stop"):
            return web.json_response({"error": "fixture Comfy extension offline"}, status=503)
        if request.path != "/v1/chat/completions":
            return web.json_response({"error": "unexpected mock endpoint"}, status=500)
        mode = body["messages"][-1]["content"].split(":")[0]
        if mode == "httpfail":
            return web.json_response({"error": "fixture upstream failure"}, status=503)
        response = web.StreamResponse(headers={"Content-Type": "text/event-stream"})
        await response.prepare(request)
        try:
            await response.write(b'data: {"choices":[{"delta":{"content":"synthetic partial ","reasoning_content":"synthetic thought "}}]}\n\n')
            if mode in ("hold", "timeout"):
                while not self.release.is_set() and request.transport and not request.transport.is_closing():
                    await asyncio.sleep(.025)
            if mode == "total_timeout":
                # Keep socket reads active; only the overall timeout can fire.
                while request.transport and not request.transport.is_closing():
                    await asyncio.sleep(.025)
                    await response.write(b'data: {"choices":[{"delta":{"content":"."}}]}\n\n')
            if mode == "truncated":
                return response
            if mode == "malformed":
                await response.write(b"data: {bad-json}\n\n")
                return response
            if mode == "eventerror":
                await response.write(b'data: {"error":"fixture stream error"}\n\n')
                return response
            await asyncio.sleep(.15)
            await response.write(b'data: {"choices":[{"delta":{"content":"finished"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
        except (ConnectionError, RuntimeError):
            pass
        return response

    async def worker(self, *, root=None, timeout=False, backend=False):
        return await RuntimeWorker(self, root or self.root / "db", timeout, backend).start()

    async def accepted(self, worker, chat, prompt, key, **kwargs):
        status, message = await worker.send(chat, prompt, key, **kwargs)
        self.assertEqual(status, 202, message)
        return message

    def completions(self):
        return sum(path == "/v1/chat/completions" for path, _ in self.calls)

    async def test_normal_idempotency_conflict_and_explicit_retry(self):
        """R01/R16: same key never makes another task; explicit retry does."""
        worker = await self.worker()
        chat = await worker.chat()
        message = await self.accepted(worker, chat, "normal:first", "normal-first-001")
        self.assertEqual((await worker.terminal(message["id"]))["status"], "completed")
        status, duplicate = await worker.send(chat, "normal:first", "normal-first-001")
        self.assertEqual((status, duplicate["id"]), (200, message["id"]))
        self.assertEqual(self.completions(), 1)
        status, _ = await worker.send(chat, "normal:conflict", "normal-first-001")
        self.assertEqual(status, 409)
        failed = await self.accepted(worker, chat, "httpfail:retry", "failed-first-001")
        self.assertEqual((await worker.terminal(failed["id"]))["status"], "failed")
        before_calls = self.completions()
        status, duplicate = await worker.send(chat, "httpfail:retry", "failed-first-001")
        self.assertEqual((status, duplicate["status"]), (200, "failed"))
        self.assertEqual(self.completions(), before_calls)
        retry = await self.accepted(worker, chat, "normal:retry", "explicit-retry-002")
        self.assertNotEqual(retry["id"], failed["id"])
        self.assertEqual((await worker.terminal(retry["id"]))["status"], "completed")
        self.assertEqual(worker.row(failed["id"])["status"], "failed")
        self.assertEqual(len(worker.sql("SELECT id FROM messages")), 3)
        history = [body for path, body in self.calls if path == "/v1/chat/completions"][-1]["messages"]
        self.assertIn({"role": "user", "content": "normal:first"}, history)
        self.assertIn({"role": "assistant", "content": "synthetic partial finished"}, history)

    async def test_cancel_loading_stream_and_sse_disconnect(self):
        """R02/R03: cancellation owns lifetime; observer disconnection does not."""
        worker = await self.worker()
        chat = await worker.chat()
        self.catalog_hold = True
        message = await self.accepted(worker, chat, "normal:cancel load", "cancel-load-001")
        await asyncio.wait_for(self.catalog_seen.wait(), 3)
        status, _ = await worker.request("POST", "/qwen-cn/messages/" + message["id"] + "/stop", {})
        self.assertEqual(status, 200)
        self.assertEqual((await worker.terminal(message["id"]))["status"], "stopped")
        self.catalog_hold = False
        message = await self.accepted(worker, chat, "hold:cancel stream", "cancel-stream-001")
        partial = await worker.wait(message["id"], lambda row: bool(row["answer"]))
        for _ in range(2):
            status, _ = await worker.request("POST", "/qwen-cn/messages/" + message["id"] + "/stop", {})
            self.assertEqual(status, 200)
        stopped = await worker.terminal(message["id"])
        self.assertEqual(stopped["status"], "stopped")
        self.assertEqual(stopped["answer"], partial["answer"])
        observed = await self.accepted(worker, chat, "normal:observer", "observer-001")
        async with aiohttp.ClientSession() as client:
            response = await client.get(worker.url + "/qwen-cn/messages/" + observed["id"] + "/events")
            self.assertTrue((await response.content.readline()).startswith(b"data:"))
            response.close()
        self.assertEqual((await worker.terminal(observed["id"]))["status"], "completed")

    async def test_lost_post_response_reuses_attempt(self):
        """R03: close transport without reading response, then repeat same key."""
        worker = await self.worker()
        chat = await worker.chat()
        payload = json.dumps(worker.payload("hold:lost response", "lost-response-001")).encode()
        _, writer = await asyncio.open_connection("127.0.0.1", worker.port)
        writer.write(("POST /qwen-cn/chats/" + chat + "/send HTTP/1.1\r\nHost: 127.0.0.1:" +
            str(worker.port) + "\r\nContent-Type: application/json\r\nContent-Length: " +
            str(len(payload)) + "\r\nConnection: close\r\n\r\n").encode() + payload)
        await writer.drain()
        writer.close()
        await writer.wait_closed()
        for _ in range(120):
            rows = worker.sql("SELECT * FROM messages WHERE request_key='lost-response-001'")
            if rows and rows[0]["answer"]:
                break
            await asyncio.sleep(.025)
        self.assertEqual(len(rows), 1)
        status, duplicate = await worker.send(chat, "hold:lost response", "lost-response-001")
        self.assertEqual((status, duplicate["id"]), (200, rows[0]["id"]))
        self.assertEqual(self.completions(), 1)
        self.release.set()
        self.assertEqual((await worker.terminal(duplicate["id"]))["status"], "completed")

    async def test_model_failures_and_timeout_release_active(self):
        """R04: real parser/network error paths use an ephemeral mock only."""
        worker = await self.worker(timeout=True)
        chat = await worker.chat()
        for mode in ("httpfail", "truncated", "malformed", "eventerror", "timeout", "total_timeout"):
            with self.subTest(mode=mode):
                message = await self.accepted(worker, chat, mode + ":fixture", mode + "-failure-001")
                failed = await worker.terminal(message["id"])
                self.assertEqual(failed["status"], "failed")
                if mode != "httpfail":
                    self.assertTrue(failed["answer"].startswith("synthetic partial "))
        message = await self.accepted(worker, chat, "normal:after failures", "after-failures-001")
        self.assertEqual((await worker.terminal(message["id"]))["status"], "completed")

    async def test_sigkill_running_restart_recovers_same_and_cross_session(self):
        """R05/R06/R15/R17: strict bug-fix assertion also run against old SHA."""
        worker = await self.worker()
        chat, other = await worker.chat(), await worker.chat()
        status, project = await worker.request("POST", "/qwen-cn/projects", {"name": "Synthetic recovery project"})
        self.assertEqual(status, 201)
        project_chat = await worker.chat(project["id"])
        sentinel = await self.accepted(worker, chat, "normal:sentinel", "sentinel-001")
        saved = await worker.terminal(sentinel["id"])
        message = await self.accepted(worker, chat, "hold:SIGKILL", "crash-running-001")
        partial = await worker.wait(message["id"], lambda row: bool(row["answer"]))
        await worker.stop(kill=True)
        self.assertEqual(worker.process.returncode, -signal.SIGKILL)
        self.assertEqual(worker.row(message["id"])["status"], "running")
        await worker.start()
        recovered = worker.row(message["id"])
        self.assertEqual(recovered["status"], "failed", "APP-03: restart left persistent active row")
        for field in ("answer", "reasoning", "settings_json", "memory_json", "request_key", "prompt"):
            self.assertEqual(recovered[field], partial[field], field)
        self.assertEqual(worker.row(sentinel["id"]), saved)
        self.assertEqual(self.completions(), 2, "Recovery must not replay the model")
        status, duplicate = await worker.send(chat, "hold:SIGKILL", "crash-running-001")
        self.assertEqual((status, duplicate["id"], duplicate["status"]), (200, message["id"], "failed"))
        for chat_id, key in ((chat, "after-same-001"), (other, "after-cross-001"),
                             (project_chat, "after-project-001")):
            followup = await self.accepted(worker, chat_id, "normal:after crash", key)
            self.assertEqual((await worker.terminal(followup["id"]))["status"], "completed")
        once = worker.row(message["id"])
        await worker.stop()
        await worker.start()
        self.assertEqual(worker.row(message["id"]), once, "Repeated startup must be idempotent")
        status, health = await worker.request("GET", "/qwen-cn/health")
        self.assertEqual(status, 200)
        self.assertTrue(health["database_ready"])
        self.assertTrue(health["generation_recovery_ready"])

    async def test_sigkill_loading_and_completed_commit(self):
        """R05: submitting recovers; a completed commit is never downgraded."""
        worker = await self.worker()
        chat = await worker.chat()
        self.catalog_hold = True
        message = await self.accepted(worker, chat, "normal:kill load", "kill-loading-001")
        await asyncio.wait_for(self.catalog_seen.wait(), 3)
        self.assertEqual(worker.row(message["id"])["status"], "submitting")
        await worker.stop(kill=True)
        self.catalog_hold = False
        await worker.start()
        self.assertEqual(worker.row(message["id"])["status"], "failed")
        self.assertEqual(self.completions(), 0)
        message = await self.accepted(worker, chat, "normal:committed", "completed-kill-001")
        saved = await worker.terminal(message["id"])
        await worker.stop(kill=True)
        await worker.start()
        self.assertEqual(worker.row(message["id"]), saved)

    async def test_live_owner_protection_then_pre_send_recovery(self):
        """R08/R09: two real processes share one database and lock lifetime."""
        first = await self.worker()
        chat, other = await first.chat(), await first.chat()
        message = await self.accepted(first, chat, "hold:live owner", "live-owner-001")
        partial = await first.wait(message["id"], lambda row: bool(row["answer"]))
        second = await self.worker(root=first.root)
        self.assertEqual(second.row(message["id"]), partial)
        status, health = await second.request("GET", "/qwen-cn/health")
        self.assertEqual(status, 200)
        self.assertTrue(health["database_ready"])
        self.assertFalse(health["generation_recovery_ready"])
        self.assertEqual(health["generation_recovery_state"], "busy")
        status, _ = await second.send(other, "normal:blocked live", "blocked-live-001")
        self.assertEqual(status, 409)
        self.assertEqual(self.completions(), 1)
        await first.stop(kill=True)
        followup = await self.accepted(second, other, "normal:send recovers", "send-recovers-001")
        self.assertEqual((await second.terminal(followup["id"]))["status"], "completed")
        self.assertEqual(second.row(message["id"])["status"], "failed")
        self.assertEqual(second.row(message["id"])["answer"], partial["answer"])

    async def test_concurrent_process_writers_choose_one_live_task(self):
        """R08: actual simultaneous processes, not a mocked in-process task map."""
        first = await self.worker()
        chat = await first.chat()
        second = await self.worker(root=first.root)
        results = await asyncio.gather(first.send(chat, "hold:one", "concurrent-one-001"),
                                       second.send(chat, "hold:two", "concurrent-two-001"))
        self.assertEqual(sorted(status for status, _ in results), [202, 409])
        message = next(body for status, body in results if status == 202)
        await first.wait(message["id"], lambda row: bool(row["answer"]))
        self.assertEqual(len(first.sql("SELECT id FROM messages")), 1)
        self.assertEqual(self.completions(), 1)
        self.release.set()
        self.assertEqual((await first.terminal(message["id"]))["status"], "completed")

    async def test_terminal_and_memory_sqlite_failures_recover_on_next_send(self):
        """R13/R14: orphan after persistent SQL failure is recoverable without restart."""
        worker = await self.worker()
        chat = await worker.chat()
        worker.sql("CREATE TRIGGER reject_memory BEFORE UPDATE OF memory_json ON messages BEGIN SELECT RAISE(ABORT,'synthetic memory failure'); END")
        memory_prompt = "remember: I prefer synthetic test fixtures"
        status, _ = await worker.send(chat, memory_prompt, "memory-failure-001")
        self.assertEqual(status, 503)
        await worker.idle()
        memory_saved = worker.sql("SELECT * FROM user_memory ORDER BY id")
        self.assertEqual(len(memory_saved), 1)
        worker.sql("DROP TRIGGER reject_memory")
        followup = await self.accepted(worker, chat, "normal:after memory failure", "memory-recovery-001")
        self.assertEqual((await worker.terminal(followup["id"]))["status"], "completed")
        failed = worker.sql("SELECT * FROM messages WHERE request_key='memory-failure-001'")[0]
        self.assertEqual(failed["status"], "failed")
        status, duplicate = await worker.send(chat, memory_prompt, "memory-failure-001")
        self.assertEqual((status, duplicate["id"]), (200, failed["id"]))
        self.assertEqual(worker.sql("SELECT * FROM user_memory ORDER BY id"), memory_saved)
        self.assertEqual(self.completions(), 1)
        worker.sql("CREATE TRIGGER reject_terminal BEFORE UPDATE OF status ON messages WHEN NEW.status IN ('completed','failed','stopped') BEGIN SELECT RAISE(ABORT,'synthetic terminal failure'); END")
        message = await self.accepted(worker, chat, "normal:terminal persistence failure", "terminal-failure-001")
        await worker.wait(message["id"], lambda row: bool(row["answer"]))
        await worker.idle()
        self.assertIn(worker.row(message["id"])["status"], ACTIVE)
        status, health = await worker.request("GET", "/qwen-cn/health")
        self.assertFalse(health.get("generation_recovery_ready", True))
        worker.sql("DROP TRIGGER reject_terminal")
        partial = worker.row(message["id"])
        followup = await self.accepted(worker, chat, "normal:after terminal failure", "terminal-recovery-001")
        self.assertEqual((await worker.terminal(followup["id"]))["status"], "completed")
        self.assertEqual(worker.row(message["id"])["status"], "failed")
        self.assertEqual(worker.row(message["id"])["answer"], partial["answer"])
        worker.sql("CREATE TRIGGER reject_completed BEFORE UPDATE OF status ON messages WHEN NEW.status='completed' BEGIN SELECT RAISE(ABORT,'synthetic completed failure'); END")
        message = await self.accepted(worker, chat, "normal:completion fallback", "completion-fallback-001")
        self.assertEqual((await worker.terminal(message["id"]))["status"], "failed")
        worker.sql("DROP TRIGGER reject_completed")
        followup = await self.accepted(worker, chat, "normal:after fallback", "after-fallback-001")
        self.assertEqual((await worker.terminal(followup["id"]))["status"], "completed")

    async def test_unknown_legacy_owner_is_not_recovered(self):
        """R18/R19/R20: missing owner is unknown, never proof that writer died."""
        worker = await self.worker()
        chat = await worker.chat()
        await worker.stop()
        worker.sql("INSERT INTO messages(id,chat_id,prompt,status,created,kind,request_key,answer) VALUES(?,?,?,'running',?,'chat',?,?)",
                   ("legacy-message", chat, "Synthetic legacy", time.time() - 10**8,
                    "legacy-key-001", "saved synthetic legacy partial"))
        before = worker.row("legacy-message")
        await worker.start()
        self.assertEqual(worker.row("legacy-message"), before)
        status, _ = await worker.send(chat, "normal:unknown blocked", "legacy-blocked-001")
        self.assertEqual(status, 409)
        status, health = await worker.request("GET", "/qwen-cn/health")
        self.assertTrue(health["database_ready"])
        self.assertFalse(health["generation_recovery_ready"])
        status, _ = await worker.request("POST", "/qwen-cn/messages/legacy-message/stop", {})
        self.assertEqual(status, 409)
        self.assertEqual(worker.row("legacy-message"), before)
        self.assertEqual(self.completions(), 0)

    async def test_orphan_stop_without_live_task_or_comfy(self):
        """R19: runtime Stop safely reconciles proven orphan without Comfy."""
        first = await self.worker()
        chat = await first.chat()
        message = await self.accepted(first, chat, "hold:orphan stop", "orphan-stop-001")
        partial = await first.wait(message["id"], lambda row: bool(row["answer"]))
        second = await self.worker(root=first.root)
        await first.stop(kill=True)
        status, _ = await second.request("POST", "/qwen-cn/messages/" + message["id"] + "/stop", {})
        self.assertEqual(status, 200)
        recovered = second.row(message["id"])
        self.assertEqual(recovered["status"], "failed")
        self.assertEqual(recovered["answer"], partial["answer"])
        self.assertFalse(any(path.endswith("/stop") for path, _ in self.calls))

    async def test_image_handoff_and_uncertain_prompt_are_preserved(self):
        """R11: no chat recovery crosses the persistent kind=image boundary."""
        worker = await self.worker()
        chat = await worker.chat()
        self.prompt_hold = True
        message = await self.accepted(worker, chat, "Synthetic image fixture", "image-handoff-001", mode="image")
        await asyncio.wait_for(self.prompt_seen.wait(), 3)
        before = worker.row(message["id"])
        self.assertEqual((before["kind"], before["status"], before["prompt_id"]), ("image", "submitting", None))
        await worker.stop(kill=True)
        self.prompt_hold = False
        await worker.start()
        self.assertEqual(worker.row(message["id"]), before)
        status, _ = await worker.send(chat, "normal:image still active", "image-blocked-001")
        self.assertEqual(status, 409)
        self.assertEqual(sum(path == "/prompt" for path, _ in self.calls), 1)
        await worker.stop()
        acknowledged = await self.worker(root=self.root / "image-acknowledged")
        chat = await acknowledged.chat()
        message = await self.accepted(acknowledged, chat, "Synthetic acknowledged image", "image-ack-001", mode="image")
        before = await acknowledged.wait(message["id"], lambda row: row["status"] == "running")
        self.assertEqual(before["prompt_id"], "synthetic-image-id")
        await acknowledged.stop(kill=True)
        await acknowledged.start()
        self.assertEqual(acknowledged.row(message["id"]), before)
        self.assertEqual(sum(path == "/prompt" for path, _ in self.calls), 2)

    async def test_backend_lifecycle_and_stop_share_runtime_ownership(self):
        """R08/R09/R19: exact extension bodies, inert image monitor, separate PID."""
        runtime = await self.worker()
        chat = await runtime.chat()
        message = await self.accepted(runtime, chat, "hold:runtime owner", "runtime-owner-001")
        partial = await runtime.wait(message["id"], lambda row: bool(row["answer"]))
        backend = await self.worker(root=runtime.root, backend=True)
        self.assertEqual(backend.row(message["id"]), partial)
        status, result = await backend.request("POST", "/qwen-cn/messages/" + message["id"] + "/stop", {})
        self.assertEqual(status, 409, result)
        self.assertEqual(backend.row(message["id"]), partial)
        await runtime.stop(kill=True)
        status, _ = await backend.request("POST", "/qwen-cn/messages/" + message["id"] + "/stop", {})
        self.assertEqual(status, 200)
        self.assertEqual(backend.row(message["id"])["status"], "failed")
        self.assertEqual(backend.row(message["id"])["answer"], partial["answer"])
        owned = await self.accepted(backend, chat, "hold:backend owner", "backend-owner-001")
        partial = await backend.wait(owned["id"], lambda row: bool(row["answer"]))
        await runtime.start()
        self.assertEqual(runtime.row(owned["id"]), partial)
        status, _ = await runtime.send(chat, "normal:blocked backend", "backend-busy-001")
        self.assertEqual(status, 409)
        await backend.stop(kill=True)
        # Extension startup itself, without a runtime startup first, recovers.
        await backend.start()
        self.assertEqual(backend.row(owned["id"])["status"], "failed")
        self.assertEqual(backend.row(owned["id"])["answer"], partial["answer"])
        message = await self.accepted(runtime, chat, "normal:after backend crash", "backend-after-001")
        self.assertEqual((await runtime.terminal(message["id"]))["status"], "completed")


if __name__ == "__main__":
    unittest.main()
