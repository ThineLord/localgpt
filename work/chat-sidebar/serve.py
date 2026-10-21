"""Serve workspace UI and forward its API to the existing local LocalGPT backend.
No installation files, model processes, or existing database are replaced.
"""
import argparse
import json
import os
from pathlib import Path
from urllib.parse import urlsplit
import aiohttp
from runtime import install, errors, backup_before_migration
from aiohttp import web

ROOT = Path(__file__).resolve().parent
CLIENT = web.AppKey('client', aiohttp.ClientSession)
HOP = {'connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length', 'host'}

def create_app(backend='http://127.0.0.1:8188', *, database=None, input_root=None, output_root=None):
    @web.middleware
    async def local_only(request, handler):
        if request.host.split(':')[0] not in ('127.0.0.1', 'localhost'):
            raise web.HTTPForbidden(text='Local host required')
        origin = request.headers.get('Origin')
        if origin and urlsplit(origin).netloc != request.host:
            raise web.HTTPForbidden(text='Same origin required')
        if request.headers.get('Sec-Fetch-Site') == 'cross-site':
            raise web.HTTPForbidden(text='Same origin required')
        return await handler(request)

    app = web.Application(middlewares=[local_only, errors], client_max_size=21 * 1024**2)
    async def session(app):
        app[CLIENT] = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=None, sock_connect=5, sock_read=180))
        yield
        await app[CLIENT].close()
    app.cleanup_ctx.append(session)

    async def index(request):
        return web.FileResponse(ROOT/'index.html', headers={'Cache-Control': 'no-store'})

    async def proxy(request):
        headers = {k:v for k,v in request.headers.items() if k.lower() not in HOP | {'origin', 'referer', 'cookie'}}
        if request.headers.get('Origin'):
            headers['Origin'] = backend
        try:
            async with app[CLIENT].request(request.method, backend + request.path_qs, headers=headers,
                                             data=await request.read(), allow_redirects=False) as upstream:
                response = web.StreamResponse(status=upstream.status, headers={k:v for k,v in upstream.headers.items() if k.lower() not in HOP})
                response.headers['Cache-Control'] = 'no-store'
                await response.prepare(request)
                async for chunk in upstream.content.iter_any():
                    await response.write(chunk)
                return response
        except (aiohttp.ClientError, TimeoutError):
            return web.json_response({'error':'本地服务暂时不可用，请确认 LocalGPT 后端已启动。'}, status=502)

    if database is not None:
        install(app, backend, database, input_root, output_root)

    app.router.add_get('/', index)
    app.router.add_get('/qwen-cn/', index)
    app.router.add_route('*', '/qwen-cn/{tail:.*}', proxy)
    app.router.add_get('/view', proxy)
    app.router.add_post('/upload/image', proxy)
    return app

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8190)
    args = parser.parse_args()
    async def local_app():
        backend='http://127.0.0.1:8188'
        config = Path.home() / 'Library' / 'Application Support' / 'HanzAgent' / 'runtime.json'
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=8)) as session:
                async with session.get(backend+'/qwen-cn/health') as response:
                    response.raise_for_status(); health=await response.json()
            output=Path(health['output_directory']).resolve()
            settings={'database':health['database'],'output_root':str(output),'input_root':str(output.parent/'input')}
            # A local path cache lets history work even while ComfyUI is offline.
            if not Path(settings['database']).is_file():
                raise RuntimeError('Existing database missing; refusing to create an empty replacement.')
            config.parent.mkdir(parents=True,exist_ok=True)
            temporary=config.with_suffix('.tmp')
            temporary.write_text(json.dumps(settings));temporary.chmod(0o600);temporary.replace(config)
        except (aiohttp.ClientError, TimeoutError):
            if not config.exists():
                raise RuntimeError('Start ComfyUI once to discover the existing database. No database was created.')
            settings=json.loads(config.read_text())
        if not Path(settings['database']).is_file():
            raise RuntimeError('Existing database unavailable; refusing to create a replacement.')
        backup_before_migration(settings['database'])
        return create_app(backend,**settings)
    web.run_app(local_app(), host='127.0.0.1', port=args.port)
