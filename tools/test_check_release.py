"""Negative controls for the local release gate, using synthetic repositories."""
from pathlib import Path
import subprocess
import tempfile
import unittest

from check_release import validate


class ReleaseChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        self.write('VERSION.txt', '0.1.0\n')
        for name in ('README.md', 'README.zh-CN.md'):
            self.write(name, '# Example\n\n**0.1.0**\ngit checkout v0.1.0\n')
        self.write('docs/CHANGELOG.md', '## [Unreleased]\n\n## [0.1.0] - 2026-11-09\n')
        for suffix in ('.md', '.zh-CN.md'):
            self.write('docs/releases/0.1.0' + suffix, '# LocalGPT 0.1.0\n')
        subprocess.run(['git', 'add', '.'], cwd=self.root, check=True)

    def write(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def test_valid_release_and_tag(self):
        self.assertEqual(validate(self.root, 'v0.1.0'), [])

    def test_wrong_tag_and_stale_translation_fail(self):
        self.write('README.zh-CN.md', '**0.0.9**\n')
        errors = validate(self.root, 'v0.1.1')
        self.assertTrue(any('Tag must' in error for error in errors))
        self.assertTrue(any('README.zh-CN' in error for error in errors))

    def test_malformed_version_fails(self):
        self.write('VERSION.txt', '01.1.0\n')
        self.assertTrue(validate(self.root))

    def test_broken_and_escaping_links_fail(self):
        self.write('README.md', '**0.1.0**\ngit checkout v0.1.0\n[missing](absent.md)\n[escape](../outside.md)\n')
        errors = validate(self.root)
        self.assertTrue(any('missing local link' in error for error in errors))
        self.assertTrue(any('escapes' in error for error in errors))

    def test_fragments_checked_but_remote_links_not_fetched(self):
        self.write('README.md', '# Example\n\n**0.1.0**\ngit checkout v0.1.0\n[ok](#example)\n[bad](#absent)\n[remote](https://example.invalid/)\n')
        errors = validate(self.root)
        self.assertEqual(len(errors), 1, errors)
        self.assertIn('missing heading', errors[0])

    def test_missing_release_translation_fails(self):
        (self.root / 'docs/releases/0.1.0.zh-CN.md').unlink()
        self.assertTrue(any('matching release heading' in error for error in validate(self.root)))


if __name__ == '__main__':
    unittest.main()
