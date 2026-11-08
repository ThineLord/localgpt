"""Disposable gallery and conversation fixtures. No production DB, uploads or model calls.
Run after building: python tools/gallery_demo.py --port 8194
"""
import argparse
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'work' / 'chat-sidebar'))
import demo
from aiohttp import web

original_install = demo.install
ANSWER = demo.ANSWER

def fixture_install(*args, **kwargs):
    core = original_install(*args, **kwargs)
    root = Path(args[4]).parent

    sample=core.STORE.create('Synthetic long conversation')
    for n in range(8):
        msg,_=core.STORE.reserve(sample['id'],f'Synthetic message {n+1}: explain the layout.',None,512,512,15,'r5-fixture',f'r5-long-{n}',kind='chat',model='qwen3-8b')
        core.STORE.update(msg['id'],answer=ANSWER,status='completed',finished=time.time())
    gallery=core.STORE.create('Synthetic image collection')
    for n,(w,h) in enumerate([(900,600),(600,900),(768,768),(1200,500),(600,800),(900,600)]*3):
        color=['#a8b8aa','#d6b39b','#b5b5d0','#92b6c5','#e0c483','#b1c7ae'][n%6]
        name=f'r5-art-{n}.png'
        demo.write_png(root/'output'/name,w,h,color,f'Synthetic {n+1:02d} - not model output')
        msg,_=core.STORE.reserve(gallery['id'],f'Synthetic landscape {n+1:02d}',None,w,h,15,'r5-fixture',f'r5-art-{n}',kind='image',model='demo')
        core.STORE.update(msg['id'],image_json=json.dumps({'filename':name,'subfolder':'','type':'output','metadata':{'width':w,'height':h}}),status='completed',finished=time.time())
    return core


def create_preview():
    """README-only presentation data in a new disposable demo, never real services."""
    captured = {}

    def capture_install(*args, **kwargs):
        core = original_install(*args, **kwargs)
        captured['core'] = core
        return core

    previous = demo.install
    demo.install = capture_install
    try:
        app = demo.create_demo()
    finally:
        demo.install = previous
    core = captured['core']
    root = core.STORE.path.parent
    # These are the two stock records just created by create_demo(), not user data.
    for chat in core.STORE.chats():
        core.STORE.trash(chat['id'])
    for name, icon, color in [('Weekend plans', 'plane', 'blue'),
                              ('Reading notes', 'book', 'green'),
                              ('Creative ideas', 'lightbulb', 'orange')]:
        core.PROJECTS.create({'name': name, 'icon': icon, 'color': color})
    for title in ['A reading list for rainy days', 'Ideas for a small garden', 'A calmer morning routine']:
        core.STORE.create(title)
    gallery = core.STORE.create('A collection of quiet landscapes')
    for n, (width, height) in enumerate([(900,600), (600,800), (768,768), (900,600), (600,800), (768,768)]):
        name = f'preview-{n}.png'
        demo.write_png(root/'output'/name, width, height,
                       ['#a8b8aa', '#d6b39b', '#b5b5d0', '#92b6c5', '#e0c483', '#b1c7ae'][n],
                       'Synthetic demo - not model output')
        message, _ = core.STORE.reserve(gallery['id'], f'Quiet landscape {n+1}', None,
                                        width, height, 15, 'readme-demo', f'preview-image-{n}',
                                        kind='image', model='demo')
        core.STORE.update(message['id'], status='completed', finished=time.time(),
                          image_json=json.dumps({'filename': name, 'subfolder': '', 'type': 'output'}))
    chat = core.STORE.create('A weekend with room to wander')
    message, _ = core.STORE.reserve(chat['id'], 'Help me turn a few weekend ideas into a simple plan.',
                                    None, 512, 512, 15, 'readme-demo', 'preview-chat', kind='chat', model='qwen3-8b')
    core.STORE.update(message['id'], status='completed', finished=time.time(), answer='''## Keep one anchor for each day

Choose a few things you would enjoy, then leave space between them.

### Saturday · Explore a little
- Start with coffee and a neighborhood walk.
- Visit a small museum, then try a new recipe at home.

### Sunday · Leave some space
- Take a book to a quiet café or browse a local market.
- Gather a few notes for the week ahead.

### Make it easy to return to
- Keep places and ideas together in a **project**.
- Save useful notes as local sources.
- Leave the rest of the weekend open.

*Synthetic demo response — no model was called.*''')
    print('README workspace chat: ' + chat['id'], flush=True)
    return app

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8194)
    parser.add_argument('--preview', action='store_true', help='Seed a small synthetic workspace for README screenshots')
    args = parser.parse_args()
    if args.preview:
        app = create_preview()
    else:
        demo.install = fixture_install
        app = demo.create_demo()
    web.run_app(app, host='127.0.0.1', port=args.port)
