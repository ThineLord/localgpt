"""Regenerate keeps the same prompt row and replaces only its answer."""
import tempfile
import time
import unittest
from pathlib import Path

from generation_ownership import GenerationLock
from storage import Conflict, Store


class RestartAnswerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="localgpt-regenerate-")
        self.path = Path(self.tmp.name) / "synthetic.sqlite3"
        self.store = Store(self.path)
        self.chat = self.store.create()["id"]
        self.owners = []

    def tearDown(self):
        for owner in self.owners:
            owner.close()
        self.tmp.cleanup()

    def owner(self):
        lock = GenerationLock(self.path)
        self.owners.append(lock)
        self.assertTrue(lock.acquire())
        return lock

    def completed(self, lock, kind="chat", answer="old answer", key="send-key-001"):
        message, _created = self.store.reserve(
            self.chat, "same prompt", None, 512, 512, 25, "synthetic", key,
            kind=kind, model="synthetic", settings={"mode": "chat"}, owner=lock,
        )
        return self.store.update(message["id"], status="completed", answer=answer, finished=time.time())

    def test_restart_replaces_the_answer_without_a_second_turn(self):
        lock = self.owner()
        message = self.completed(lock)
        draft = self.store.chat(self.chat)["draft"]
        restarted, created = self.store.restart_answer(message["id"], "regen-key-001", lock)
        chat = self.store.chat(self.chat)
        self.assertTrue(created)
        self.assertEqual(len(chat["messages"]), 1)
        self.assertEqual(chat["messages"][0]["id"], message["id"])
        self.assertEqual(chat["messages"][0]["prompt"], "same prompt")
        self.assertEqual(chat["messages"][0]["answer"], "")
        self.assertEqual(chat["messages"][0]["status"], "submitting")
        self.assertEqual(chat["messages"][0]["attempt"], 2)
        self.assertEqual(chat["draft"], draft)
        self.assertEqual(restarted["regenerate_key"], "regen-key-001")

    def test_same_key_does_not_start_another_attempt(self):
        lock = self.owner()
        message = self.completed(lock)
        self.store.restart_answer(message["id"], "regen-key-001", lock)
        self.store.update(message["id"], status="completed", answer="replacement", finished=time.time())
        again, created = self.store.restart_answer(message["id"], "regen-key-001", lock)
        self.assertFalse(created)
        self.assertEqual(again["attempt"], 2)
        self.assertEqual(again["answer"], "replacement")
        self.assertEqual(len(self.store.chat(self.chat)["messages"]), 1)

    def test_active_turn_and_image_rows_are_refused(self):
        lock = self.owner()
        message = self.completed(lock)
        self.store.restart_answer(message["id"], "regen-key-001", lock)
        with self.assertRaises(Conflict):
            self.store.restart_answer(message["id"], "regen-key-002", lock)
        self.store.update(message["id"], status="completed", answer="done", finished=time.time())
        image = self.completed(lock, kind="image", answer="", key="send-key-002")
        with self.assertRaises(ValueError):
            self.store.restart_answer(image["id"], "regen-key-003", lock)


if __name__ == "__main__":
    unittest.main()
