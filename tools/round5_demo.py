"""Round5 disposable visual fixtures. No production DB, uploads or model calls.
Run after building: python tools/round5_demo.py --port 8194
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

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8194)
    args = parser.parse_args()
    demo.install = fixture_install
    web.run_app(demo.create_demo(), host='127.0.0.1', port=args.port)
