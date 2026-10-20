"""Build the dependency-free single-file page used by the ComfyUI extension."""
from pathlib import Path
import argparse
import base64

ROOT = Path(__file__).resolve().parent

def build(check=False):
    template = (ROOT / 'template.html').read_text()
    result = template.replace('/* STUDIO_STYLES */', (ROOT / 'studio.css').read_text() + '\n' + (ROOT / 'atelier.css').read_text() + '\n' + (ROOT / 'liquid-layers.css').read_text()).replace('/* STUDIO_APP */', (ROOT / 'app.js').read_text())
    result = result.replace('/* LIQUID_LAYERS */', (ROOT / 'liquid-layers.js').read_text())
    result = result.replace('/* ATELIER_MOTION */', (ROOT / 'atelier.js').read_text())
    result = result.replace('/* WORKSPACE_FEATURES */', (ROOT / 'workspace.js').read_text())
    # Personal/generated images are deliberately excluded from the repository.
    texture='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%224%22 height=%224%22%3E%3Cpath fill=%22%23dce5dc%22 d=%22M0 0h4v4H0z%22/%3E%3C/svg%3E'
    result=result.replace('/* LIQUID_TEXTURE */',texture)
    assert '/* STUDIO_' not in result
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
