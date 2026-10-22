"""Disposable Projects UI fixture using production routes and a fake local model.

No production database or real model is touched. The model response is explicitly
synthetic; project retrieval, streaming, persistence and request composition run
through the production code. --root may point at an existing *fixture* directory.
"""
import argparse
import asyncio
import json
from pathlib import Path
import sys
import tempfile

from aiohttp import web

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'work' / 'chat-sidebar'))
import lm_chat
from serve import create_app
from storage import Store
from project_store import ProjectStore


async def main(args):
    root = Path(args.root) if args.root else Path(tempfile.mkdtemp(prefix='localgpt-projects-demo-'))
    root.mkdir(exist_ok=True)
    (root / 'input').mkdir(exist_ok=True); (root / 'output').mkdir(exist_ok=True)
    upstream = web.Application()
    async def models(r):
        return web.json_response({'models':[{'key':'qwen3-8b','type':'llm','display_name':'Qwen3 8B · Synthetic fixture','architecture':'qwen3','capabilities':{},'loaded_instances':[{'id':'hanzagent-qwen3-8b'}]}]})
    async def queue(r): return web.json_response({'queue_running':[], 'queue_pending':[]})
    async def free(r): return web.Response()
    async def answer(r):
        payload = await r.json()
        (root / 'last-model-request.json').write_text(json.dumps(payload, indent=2, ensure_ascii=False))
        if payload.get('response_format'):
            return web.json_response({'choices':[{'message':{'content':'{"action":"chat","use_previous_image":false}'}}]})
        body = 'Synthetic UI fixture — not a model-generated answer.\n\nThe production chat pipeline received the project context and streamed this fixture response.'
        response = web.StreamResponse(headers={'Content-Type':'text/event-stream'})
        await response.prepare(r)
        try:
            for start in range(0,len(body),12):
                await response.write(('data: '+json.dumps({'choices':[{'delta':{'content':body[start:start+12]}}]})+'\n\n').encode())
                await asyncio.sleep(.04)
            await response.write(b'data: [DONE]\n\n')
        except ConnectionResetError:
            pass
        return response
    upstream.router.add_get('/api/v1/models',models)
    upstream.router.add_get('/queue',queue);upstream.router.add_post('/free',free)
    upstream.router.add_post('/v1/chat/completions',answer)
    upstream_runner=web.AppRunner(upstream);await upstream_runner.setup()
    site=web.TCPSite(upstream_runner,'127.0.0.1',0);await site.start()
    port=site._server.sockets[0].getsockname()[1]
    lm_chat.LM_URL='http://127.0.0.1:'+str(port)
    app=create_app(lm_chat.LM_URL,database=root/'fixture.sqlite3',input_root=root/'input',output_root=root/'output')
    store=Store(root/'fixture.sqlite3');projects=ProjectStore(store)
    if not store.chats():
        store.create('A chat to move into a project')
    runner=web.AppRunner(app);await runner.setup();await web.TCPSite(runner,'127.0.0.1',args.port).start()
    print('Synthetic Projects fixture: '+str(root),flush=True)
    try:
        await asyncio.Event().wait()
    finally:
        await runner.cleanup();await upstream_runner.cleanup()


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8194);parser.add_argument('--root')
    try:asyncio.run(main(parser.parse_args()))
    except KeyboardInterrupt:pass
