"""Workspace-owned chat/memory routes sharing the existing local SQLite store.
ComfyUI continues to own image execution/monitoring; no installation is replaced.
"""
import asyncio
import json
import shutil
import sqlite3
import time
from pathlib import Path
from types import SimpleNamespace
from aiohttp import web
import aiohttp
from storage import Store, Conflict
from memory_store import MemoryStore, MemoryConflict
from generation import image_path, clean_draft, graph
import lm_chat


def backup_before_migration(database):
    path=Path(database)
    if path.exists():
        with sqlite3.connect(path) as db:
            if not db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='user_memory'").fetchone():
                backups=Path(__file__).parent.parent/'liquid-memory'/'backups';backups.mkdir(parents=True,exist_ok=True)
                with sqlite3.connect(backups/f'before-memory-{time.time_ns()}.sqlite3') as copy:db.backup(copy)


def install(app, backend, database, input_root, output_root):
    path=Path(database)
    store=Store(path);memory=MemoryStore(path);routes=web.RouteTableDef()
    def reply(data,status=200):return web.json_response(data,status=status,headers={'Cache-Control':'no-store'})
    def mutate(request):
        if request.content_type!='application/json':raise web.HTTPUnsupportedMediaType()
    async def comfy(session,route,payload=None):
        async with session.request('GET' if payload is None else 'POST',backend+route,json=payload,timeout=aiohttp.ClientTimeout(total=20)) as r:
            raw=await r.text()
            data=json.loads(raw) if raw.strip() else {}
            if r.status>=400:raise ValueError(str(data.get('error',data)))
            return data
    core=SimpleNamespace(STORE=store,MEMORY=memory,reply=reply,mutate=mutate,Conflict=Conflict,SUBMIT_LOCK=asyncio.Lock(),
        clean_draft=lambda d:clean_draft(d,input_root,output_root),image_path=lambda i:image_path(i,input_root,output_root),
        graph=graph,comfy=comfy,shutil=shutil,folder_paths=SimpleNamespace(get_output_directory=lambda:output_root),
        PromptServer=SimpleNamespace(instance=SimpleNamespace(routes=routes)))
    # Genuine local chat execution, with existing routing, streaming, cancellation.
    lm_chat.install(core)

    @routes.get('/qwen-cn/chats')
    async def chats(r):return reply(store.chats())
    @routes.get('/qwen-cn/trash')
    async def trash(r):return reply(store.chats(deleted=True))
    @routes.post('/qwen-cn/chats')
    async def create(r):
        mutate(r);data=await r.json();title=data.get('title','新对话')
        if not isinstance(title,str) or not 1<=len(title.strip())<=100:raise ValueError('Invalid title')
        return reply(store.create(title.strip()),201)
    @routes.get('/qwen-cn/chats/{chat_id}')
    async def get(r):return reply(store.chat(r.match_info['chat_id']))
    @routes.patch('/qwen-cn/chats/{chat_id}')
    @routes.post('/qwen-cn/chats/{chat_id}/draft')
    async def patch(r):
        mutate(r);data=await r.json();title=data.get('title')
        if title is not None and (not isinstance(title,str) or not 1<=len(title.strip())<=100):raise ValueError('Invalid title')
        return reply(store.patch(r.match_info['chat_id'],int(data['version']),title=title.strip() if title else None,draft=core.clean_draft(data['draft']) if 'draft' in data else None))
    @routes.delete('/qwen-cn/chats/{chat_id}')
    async def delete(r):
        mutate(r);store.trash(r.match_info['chat_id']);return reply({'deleted':True,'recoverable':True})
    @routes.post('/qwen-cn/chats/{chat_id}/restore')
    async def restore(r):
        mutate(r);return reply(store.restore(r.match_info['chat_id']))
    @routes.delete('/qwen-cn/trash/{chat_id}')
    async def purge(r):
        mutate(r);data=await r.json()
        if data.get('confirm') is not True:raise ValueError('需要确认永久删除。')
        return reply(store.purge(r.match_info['chat_id']))
    @routes.get('/qwen-cn/gallery')
    async def gallery(r):return reply(store.gallery(r.query.get('q','')[:200],max(0,int(r.query.get('offset',0))),max(1,min(100,int(r.query.get('limit',60))))))
    @routes.delete('/qwen-cn/gallery/{message_id}')
    async def delete_image(r):
        mutate(r);data=await r.json()
        if data.get('confirm') is not True:raise ValueError('需要确认删除图片。')
        return reply(store.delete_gallery(r.match_info['message_id']))
    @routes.post('/qwen-cn/messages/{message_id}/stop')
    async def stop(r):
        mutate(r);mid=r.match_info['message_id'];message=store.message(mid)
        task=lm_chat.CHAT_TASKS.get(mid)
        if task:
            task.cancel();await asyncio.gather(task,return_exceptions=True)
        elif message['status'] in ('running','submitting'):
            # The existing backend owns image tasks and any older in-flight chat.
            async with aiohttp.ClientSession() as session:
                async with session.post(backend+f'/qwen-cn/messages/{mid}/stop',json={}) as response:
                    if response.status>=400:raise ValueError('停止失败，请重试。')
        return reply({'requested':True})
    @routes.get('/qwen-cn/memory')
    async def get_memory(r):return reply({'items':memory.list(),'preferences':memory.preferences()})
    @routes.patch('/qwen-cn/memory/preferences')
    async def preferences(r):mutate(r);return reply(memory.configure(await r.json()))
    @routes.post('/qwen-cn/memory')
    async def add_memory(r):
        mutate(r);data=await r.json();return reply(memory.put(data.get('content'),data.get('category','preference')),201)
    @routes.patch('/qwen-cn/memory/{memory_id}')
    async def edit_memory(r):
        mutate(r);data=await r.json();return reply(memory.put(data.get('content'),data.get('category','preference'),memory_id=r.match_info['memory_id'],version=data.get('version')))
    @routes.delete('/qwen-cn/memory/{memory_id}')
    async def forget(r):mutate(r);memory.delete(r.match_info['memory_id']);return reply({'deleted':True})
    @routes.delete('/qwen-cn/memory')
    async def clear(r):
        mutate(r);data=await r.json()
        if data.get('confirm') is not True:raise ValueError('需要确认清空记忆。')
        memory.clear();return reply({'deleted':True})

    app.add_routes(routes)
    async def cleanup(app):
        yield
        tasks=list(lm_chat.CHAT_TASKS.values())
        for task in tasks:task.cancel()
        await asyncio.gather(*tasks,return_exceptions=True)
    app.cleanup_ctx.append(cleanup)
    return core


@web.middleware
async def errors(request,handler):
    try:return await handler(request)
    except (Conflict,MemoryConflict) as e:return web.json_response({'error':str(e)},status=409)
    except KeyError:return web.json_response({'error':'记录不存在或已删除。'},status=404)
    except (ValueError,TypeError) as e:return web.json_response({'error':str(e)},status=400)
