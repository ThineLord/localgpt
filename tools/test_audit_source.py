"""Exercise publication gates in disposable Git repositories, without network access."""
import pathlib
import subprocess
import sys
import tempfile
import unittest

AUDIT = pathlib.Path(__file__).with_name("audit_source.py")


class SourceAuditTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.git("init", "-q")
        self.git("config", "user.name", "Synthetic Test")
        self.git("config", "user.email", "test@example.invalid")

    def git(self, *args, input=None):
        return subprocess.check_output(
            ["git", *args], cwd=self.root, input=input, stderr=subprocess.STDOUT
        ).decode().strip()

    def audit(self):
        return subprocess.run(
            [sys.executable, str(AUDIT)], cwd=self.root,
            text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT
        )

    def test_regular_index_blob_passes_even_if_worktree_differs(self):
        source = self.root / "app.py"
        source.write_text("print('synthetic source')\n")
        self.git("add", "app.py")
        source.write_text("not the staged contents")
        result = self.audit()
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("Reviewed unique path/blob pairs: 1", result.stdout)

    def test_only_named_launcher_is_allowed_and_still_scanned(self):
        launcher = self.root / "Start LocalGPT.command"
        launcher.write_text("#!/bin/zsh\nexec python3 work/chat-sidebar/launch.py\n")
        self.git("add", launcher.name)
        self.assertEqual(self.audit().returncode, 0)
        marker = "SYNTHETIC" + "_LAUNCHER_CREDENTIAL"
        launcher.write_text("password = " + repr(marker))
        self.git("add", launcher.name)
        result = self.audit()
        self.assertEqual(result.returncode, 1)
        self.assertNotIn(marker, result.stdout)
        (self.root / "other.command").write_text("#!/bin/zsh")
        self.git("add", "other.command")
        self.assertIn("other.command not approved", self.audit().stdout)

    def test_symlink_is_rejected_without_reading_its_target(self):
        marker = "SYNTHETIC_PRIVATE_RUNTIME_CONTENT"
        (self.root / "runtime.py").write_text(marker)
        (self.root / "link.py").symlink_to("runtime.py")
        self.git("add", "link.py")
        result = self.audit()
        self.assertEqual(result.returncode, 1)
        self.assertIn("symlink/submodule", result.stdout)
        self.assertNotIn(marker, result.stdout)

    def test_gitlink_is_rejected(self):
        (self.root / "README.md").write_text("Synthetic fixture\n")
        self.git("add", "README.md")
        self.git("commit", "-qm", "fixture")
        commit = self.git("rev-parse", "HEAD")
        self.git("update-index", "--add", "--cacheinfo",
                 f"160000,{commit},vendor/dependency")
        result = self.audit()
        self.assertEqual(result.returncode, 1)
        self.assertIn("vendor/dependency symlink/submodule", result.stdout)

    def test_unmerged_index_is_rejected(self):
        one = self.git("hash-object", "-w", "--stdin", input=b"one\n")
        two = self.git("hash-object", "-w", "--stdin", input=b"two\n")
        entries = f"100644 {one} 2\tconflict.py\n100644 {two} 3\tconflict.py\n"
        self.git("update-index", "--index-info", input=entries.encode())
        result = self.audit()
        self.assertEqual(result.returncode, 1)
        self.assertIn("unmerged index entry", result.stdout)

    def test_secret_value_is_never_printed(self):
        marker = "SYNTHETIC" + "_CREDENTIAL_FOR_TEST"
        (self.root / "config.py").write_text("password = " + repr(marker) + "\n")
        self.git("add", "config.py")
        result = self.audit()
        self.assertEqual(result.returncode, 1)
        self.assertIn("secret_assignment", result.stdout)
        self.assertNotIn(marker, result.stdout)


if __name__ == "__main__":
    unittest.main()
