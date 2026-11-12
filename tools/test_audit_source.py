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

    def audit(self, *args):
        return subprocess.run(
            [sys.executable, str(AUDIT), *args], cwd=self.root,
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

    def test_root_license_is_allowed_and_still_scanned(self):
        license_file = self.root / "LICENSE"
        license_file.write_text("MIT License\nCopyright (c) 2026 Synthetic\n")
        self.git("add", "LICENSE")
        self.assertEqual(self.audit().returncode, 0)
        marker = "SYNTHETIC" + "_LICENSE_CREDENTIAL"
        license_file.write_text("password = " + repr(marker) + "\n")
        self.git("add", "LICENSE")
        result = self.audit()
        self.assertEqual(result.returncode, 1)
        self.assertIn("secret_assignment", result.stdout)
        self.assertNotIn(marker, result.stdout)
        nested = self.root / "docs"
        nested.mkdir()
        (nested / "LICENSE").write_text("MIT License\n")
        self.git("add", "docs/LICENSE")
        self.assertIn("docs/LICENSE not approved", self.audit().stdout)

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

    def test_only_browser_manifests_allow_json_and_still_scan_credentials(self):
        folder = self.root / 'tools' / 'browser'
        folder.mkdir(parents=True)
        manifest = folder / 'package.json'
        manifest.write_text('{"private":true}')
        self.git('add', '.')
        self.assertEqual(self.audit().returncode, 0)
        manifest.write_text('password = ' + repr('SYNTHETIC' + '_MANIFEST_CREDENTIAL'))
        self.git('add', '.')
        self.assertEqual(self.audit().returncode, 1)
        manifest.write_text('{"private":true}')
        (folder / 'private.json').write_text('{}')
        self.git('add', '.')
        self.assertIn('private.json not approved', self.audit().stdout)

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

    def screenshot(self, name='workspace.png'):
        source = AUDIT.parent.parent / 'docs' / 'images' / name
        target = self.root / 'docs' / 'images' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(source.read_bytes())
        return target

    def test_approved_screenshots_require_exact_reviewed_bytes(self):
        image = self.screenshot()
        self.screenshot('gallery.png')
        self.git('add', '.')
        self.assertEqual(self.audit().returncode, 0)
        image.write_bytes(image.read_bytes() + b'SYNTHETIC_UNREVIEWED_DATA')
        self.git('add', '.')
        result = self.audit()
        self.assertEqual(result.returncode, 1)
        self.assertIn('unreviewed screenshot bytes', result.stdout)
        self.assertNotIn('SYNTHETIC_UNREVIEWED_DATA', result.stdout)

    def test_approved_image_bytes_at_another_path_are_rejected(self):
        image = self.screenshot()
        image.rename(image.with_name('personal.png'))
        self.git('add', '.')
        result = self.audit()
        self.assertEqual(result.returncode, 1)
        self.assertIn('personal.png not approved source format', result.stdout)

    def test_screenshot_path_cannot_be_a_symlink(self):
        image = self.screenshot()
        target = image.with_name('synthetic-target.png')
        image.rename(target)
        image.symlink_to(target.name)
        self.git('add', str(image.relative_to(self.root)))
        self.assertIn('symlink/submodule', self.audit().stdout)

    def test_old_unreviewed_screenshot_is_not_hidden_by_clean_current_image(self):
        image = self.screenshot()
        reviewed = image.read_bytes()
        image.write_bytes(reviewed + b'SYNTHETIC_UNREVIEWED_HISTORY')
        self.git('add', '.')
        self.git('commit', '-qm', 'unreviewed synthetic fixture')
        image.write_bytes(reviewed)
        self.git('add', '.')
        self.git('commit', '-qm', 'reviewed synthetic fixture')
        self.assertEqual(self.audit().returncode, 0)
        self.assertIn('unreviewed screenshot bytes', self.audit('--history').stdout)


if __name__ == "__main__":
    unittest.main()
