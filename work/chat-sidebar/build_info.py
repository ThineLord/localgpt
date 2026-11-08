"""Immutable process-start build identity; runtime never shells out to Git."""
from html.parser import HTMLParser
from pathlib import Path
import re


class BuildMeta(HTMLParser):
    def __init__(self):
        super().__init__()
        self.values = {}

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == 'meta' and values.get('name', '').startswith('localgpt-'):
            self.values[values['name'][9:]] = values.get('content', '')


def read_build(path):
    parser = BuildMeta()
    try:
        parser.feed(Path(path).read_text(encoding='utf-8').split('</head>', 1)[0])
    except (OSError, UnicodeError):
        pass
    values = parser.values
    version = values.get('version', '')
    sha = values.get('build-sha', '')
    return {'version': version if re.fullmatch(r'\d+\.\d+\.\d+', version) else 'unknown',
            'build_sha': sha if re.fullmatch(r'[0-9a-f]{40}', sha) else 'unknown',
            'build_dirty': {'true': True, 'false': False}.get(values.get('build-dirty'))}


# Replacing the build on disk cannot relabel an already-running backend.
_STARTUP_BUILD = read_build(Path(__file__).with_name('index.html'))


def build_identity():
    return dict(_STARTUP_BUILD)
