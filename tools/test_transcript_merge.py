"""Refresh merge keeps partial text only for a still-running snapshot."""
import pathlib
import subprocess
import unittest

APP = pathlib.Path(__file__).resolve().parents[1] / "work" / "chat-sidebar" / "app.js"


def merge_source():
    source = APP.read_text()
    start = source.index("function mergeTranscript(")
    depth = 0
    for index in range(start, len(source)):
        char = source[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[start:index + 1]
    raise AssertionError("mergeTranscript was not found")


class TranscriptMergeTests(unittest.TestCase):
    def merge(self, local, fresh):
        script = merge_source() + """
const cases = JSON.parse(process.argv[1]);
const merged = mergeTranscript(cases.local, cases.fresh);
process.stdout.write(JSON.stringify(merged));
"""
        payload = subprocess.check_output(
            ["node", "-e", script, __import__("json").dumps({"local": local, "fresh": fresh})],
            text=True,
        )
        return __import__("json").loads(payload)

    def test_finished_snapshot_replaces_longer_think_tag_text(self):
        raw = {
            "id": "m",
            "status": "running",
            "answer": "<think>private reasoning</think>Final answer",
            "reasoning": "",
        }
        cleaned = {
            "id": "m",
            "status": "completed",
            "answer": "Final answer",
            "reasoning": "private reasoning",
            "phase": "已完成",
        }
        once = self.merge([raw], [cleaned])
        self.assertEqual(once, [cleaned])
        again = self.merge(once, [cleaned])
        self.assertEqual(again, [cleaned])
        self.assertNotIn("<think>", again[0]["answer"])

    def test_later_running_snapshot_cannot_restore_raw_text(self):
        cleaned = {
            "id": "m",
            "status": "completed",
            "answer": "Final answer",
            "reasoning": "private reasoning",
        }
        raw = {
            "id": "m",
            "status": "running",
            "answer": "<think>private reasoning</think>Final answer",
            "reasoning": "",
        }
        self.assertEqual(self.merge([cleaned], [raw]), [cleaned])

    def test_shorter_running_snapshot_keeps_the_longer_partial(self):
        local = {"id": "m", "status": "running", "answer": "partial text that is longer", "reasoning": "seen"}
        stale = {"id": "m", "status": "submitting", "answer": "partial", "reasoning": ""}
        merged = self.merge([local], [stale])[0]
        self.assertEqual(merged["answer"], "partial text that is longer")
        self.assertEqual(merged["reasoning"], "seen")
        self.assertEqual(merged["status"], "submitting")

    def test_running_snapshot_does_not_revive_a_stopped_reply(self):
        stopped = {"id": "m", "status": "stopped", "prompt": "SECOND", "answer": "这", "phase": "已停止"}
        running = {"id": "m", "status": "running", "prompt": "SECOND", "answer": "", "phase": "正在回答"}
        self.assertEqual(self.merge([stopped], [running]), [stopped])
