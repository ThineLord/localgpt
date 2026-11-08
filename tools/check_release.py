"""Validate source release metadata and local Markdown links without network access."""
import argparse
from collections import Counter
from pathlib import Path
import re
import subprocess
import sys
import unicodedata
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
VERSION_RE = r'(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)'


def anchors(text):
    result = set()
    counts = Counter()
    # Only real ATX headings, not example headings inside fenced code.
    in_fence = False
    for line in text.splitlines():
        if re.match(r'^\s*(```|~~~)', line):
            in_fence = not in_fence
        if in_fence or not re.match(r'^#{1,6}\s+', line):
            continue
        heading = re.sub(r'^#{1,6}\s+|\s+#+\s*$', '', line).strip().lower()
        slug = ''.join(c for c in heading if c in '-_ ' or unicodedata.category(c)[0] not in 'PS').replace(' ', '-')
        n = counts[slug]
        counts[slug] += 1
        result.add(slug if n == 0 else f'{slug}-{n}')
    return result


def validate(root, tag=None):
    errors = []
    version_path = root / 'VERSION.txt'
    if not version_path.is_file():
        return ['Missing VERSION.txt']
    raw = version_path.read_text()
    version = raw.strip()
    if not re.fullmatch(VERSION_RE, version) or raw != version + '\n':
        return ['VERSION.txt must contain one MAJOR.MINOR.PATCH version and a newline']
    if tag is not None and tag != 'v' + version:
        errors.append(f'Tag must be v{version}')
    for name in ('README.md', 'README.zh-CN.md'):
        path = root / name
        if not path.is_file() or f'**{version}**' not in path.read_text():
            errors.append(f'{name}: current version missing or inconsistent')
        elif f'git checkout v{version}' not in path.read_text():
            errors.append(f'{name}: quick start must select v{version}')
    changelog = root / 'docs' / 'CHANGELOG.md'
    if not changelog.is_file():
        errors.append('Missing docs/CHANGELOG.md')
    else:
        text = changelog.read_text()
        if '## [Unreleased]' not in text or not re.search(r'^## \[' + re.escape(version) + r'\] - \d{4}-\d{2}-\d{2}$', text, re.M):
            errors.append('CHANGELOG.md: missing Unreleased or dated version heading')
    for suffix in ('.md', '.zh-CN.md'):
        path = root / 'docs' / 'releases' / (version + suffix)
        if not path.is_file() or not path.read_text().startswith(f'# LocalGPT {version}\n'):
            errors.append(f'{path.relative_to(root)}: missing matching release heading')
    # Restrict inspection to source tracked by Git (including newly staged files).
    names = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
    for name in names:
        path = root / name
        if not name.endswith('.md') or not path.is_file():
            continue
        content = path.read_text()
        links = re.findall(r'\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)', content)
        links += re.findall(r'^\s*\[[^\]]+\]:\s*(\S+)', content, re.M)
        for href in links:
            href = href.strip('<>')
            url = urlsplit(href)
            if url.scheme or url.netloc:
                continue
            target = (path.parent / unquote(url.path)).resolve() if url.path else path.resolve()
            try:
                target.relative_to(root.resolve())
            except ValueError:
                errors.append(f'{name}: link escapes source repository: {href}')
                continue
            if not target.exists():
                errors.append(f'{name}: missing local link: {href}')
            elif url.fragment and target.suffix == '.md' and unquote(url.fragment) not in anchors(target.read_text()):
                errors.append(f'{name}: missing heading: {href}')
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tag', help='Expected release tag, e.g. v0.1.0')
    args = parser.parse_args()
    errors = validate(ROOT, args.tag)
    for error in errors:
        print(error)
    if errors:
        return 1
    print(f'Release {ROOT.joinpath("VERSION.txt").read_text().strip()}: version metadata and local Markdown links passed.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
