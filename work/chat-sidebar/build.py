"""Build the dependency-free single-file page used by the ComfyUI extension."""
from pathlib import Path
import argparse

ROOT = Path(__file__).resolve().parent

def build(check=False):
    template = (ROOT / 'template.html').read_text()
    styles = '\n'.join((ROOT / name).read_text() for name in ('studio.css', 'atelier.css', 'liquid-layers.css'))
    result = template.replace('/* STUDIO_STYLES */', styles)
    result = result.replace('/* STUDIO_APP */', (ROOT / 'app.js').read_text())
    result = result.replace('/* LIQUID_LAYERS */', (ROOT / 'liquid-layers.js').read_text())
    result = result.replace('/* ATELIER_MOTION */', (ROOT / 'atelier.js').read_text())
    result = result.replace('/* WORKSPACE_FEATURES */', (ROOT / 'workspace.js').read_text())
    assert '/* STUDIO_' not in result
    assert '/* LIQUID_' not in result
    assert '/* ATELIER_' not in result
    assert '/* WORKSPACE_' not in result
    if check:
        assert (ROOT / 'index.html').read_text() == result, 'Run python3 work/chat-sidebar/build.py'
    else:
        temporary = ROOT / '.index.html.tmp'
        temporary.write_text(result)
        temporary.replace(ROOT / 'index.html')
    print(f'UI build {"verified" if check else "complete"}: {len(result.encode()):,} bytes')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    build(parser.parse_args().check)
