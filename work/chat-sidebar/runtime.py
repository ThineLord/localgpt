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
from urllib.parse import quote
from aiohttp import web
import aiohttp
from storage import Store, Conflict
from memory_store import MemoryStore, MemoryConflict
from media_lifecycle import MediaLifecycle
from local_profile import install_profile
from generation import image_path, clean_draft, graph
import lm_chat
from history_metadata import install as install_history_metadata
from projects import install as install_projects


MANAGED_IMAGE_TYPES = ('input', 'output')
MANAGED_IMAGE_MIME = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
    '.avif': 'image/avif', '.tif': 'image/tiff', '.tiff': 'image/tiff',
}


def _attachment_disposition(filename):
    """Content-Disposition for a basename image_path has already accepted."""
    cleaned = ''.join(ch for ch in filename if ch not in '\r\n"\\')
    encoded = quote(cleaned, safe='')
    ascii_name = ''.join(ch if ch.isascii() and 32 < ord(ch) < 127 and ch not in '"\\' else '_' for ch in cleaned) or 'download'
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{encoded}"


def serve_managed_image(request, input_root, output_root, *, download=False):
    """Serve a managed image from the existing input/output roots.

    `/view` and `/qwen-cn/download` share this resolver. `type` defaults to
    output. `temp` and any other type are rejected before a path is joined.
    Resolution stays inside ``image_path``: traversal and symlink escapes never
    become a file response, and this does not open a temp directory.
    """
    filename = request.query.get('filename', '')
    subfolder = request.query.get('subfolder', '')
    kind = request.query.get('type') or 'output'
    headers = {'Cache-Control': 'no-store'}
    if kind not in MANAGED_IMAGE_TYPES:
        return web.json_response({'error': 'Unsupported image type', 'type': kind}, status=400, headers=headers)
    try:
        target = image_path(
            {'filename': filename, 'subfolder': subfolder, 'type': kind},
            input_root, output_root,
        )
    except ValueError as error:
        status = 404 if str(error) == 'Image file is missing' else 400
        return web.json_response({'error': str(error)}, status=status, headers=headers)
    # A managed directory can also contain non-image files. Never expose active
    # documents (including SVG/HTML) on the application's own origin.
    mime = MANAGED_IMAGE_MIME.get(target.suffix.lower())
    if mime is None:
        return web.json_response({'error': 'Unsupported image format'}, status=415, headers=headers)
    headers.update({'Content-Type': mime, 'X-Content-Type-Options': 'nosniff'})
    if download:
        headers['Content-Disposition'] = _attachment_disposition(target.name)
    return web.FileResponse(target, headers=headers)


def backup_before_migration(database):
    path=Path(database)
    if path.exists():
        with sqlite3.connect(path) as db:
            if not db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='user_memory'").fetchone():
                backups=Path(__file__).parent.parent/'liquid-memory'/'backups';backups.mkdir(parents=True,exist_ok=True)
                with sqlite3.connect(backups/f'before-memory-{time.time_ns()}.sqlite3') as copy:db.backup(copy)


def install(app, backend, database, input_root, output_root):
    path=Path(database)
    install_profile(app, path.parent / '.localgpt-profile')
    store=Store(path);memory=MemoryStore(path);media=MediaLifecycle(store,input_root,output_root);routes=web.RouteTableDef()
    active_uploads=set()
    def reply(data,status=200):return web.json_response(data,status=status,headers={'Cache-Control':'no-store'})
    def mutate(request):
        if request.content_type!='application/json':raise web.HTTPUnsupportedMediaType()
    async def comfy(session,route,payload=None):
        async with session.request('GET' if payload is None else 'POST',backend+route,json=payload,timeout=aiohttp.ClientTimeout(total=20)) as r:
            raw=await r.text()
            data=json.loads(raw) if raw.strip() else {}
            if r.status>=400:raise ValueError(str(data.get('error',data)))
            return data
    core=SimpleNamespace(STORE=store,MEMORY=memory,MEDIA=media,reply=reply,mutate=mutate,Conflict=Conflict,SUBMIT_LOCK=asyncio.Lock(),
        clean_draft=lambda d:clean_draft(d,input_root,output_root),image_path=lambda i:image_path(i,input_root,output_root),
        graph=graph,comfy=comfy,shutil=shutil,folder_paths=SimpleNamespace(get_output_directory=lambda:output_root),
        PromptServer=SimpleNamespace(instance=SimpleNamespace(routes=routes)))
    install_projects(core)
    # Genuine local chat execution, with existing routing, streaming, cancellation.
    lm_chat.install(core)

    @routes.get('/view')
    async def view_managed(r):
        return serve_managed_image(r, input_root, output_root)

    @routes.get('/qwen-cn/download')
    async def download_managed(r):
        return serve_managed_image(r, input_root, output_root, download=True)

    @routes.get('/qwen-cn/health')
    async def health(r):
        # Probe this process's actual database, independently of model servers.
        with store.connect() as db:
            db.execute('SELECT count(*) FROM chats').fetchone()
        return reply({'ready': True, 'service': 'hanzagent', 'database_ready': True,
                      'database': str(path), 'output_directory': str(output_root)})

    @routes.get('/qwen-cn/chats')
    async def chats(r):return reply(store.chats())
    @routes.get('/qwen-cn/trash')
    async def trash(r):return reply(store.chats(deleted=True))
    @routes.post('/qwen-cn/chats')
    async def create(r):
        mutate(r);data=await r.json();title=data.get('title','新对话')
        if not isinstance(title,str) or not 1<=len(title.strip())<=100:raise ValueError('Invalid title')
        project_id = data.get('project_id')
        return reply(core.PROJECTS.create_chat(title.strip(), project_id) if project_id else store.create(title.strip()),201)
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
        mutate(r)
        membership = core.PROJECTS.membership(r.match_info['chat_id'])
        if membership['project_id']:
            try: core.PROJECTS.get(membership['project_id'])
            except KeyError: raise Conflict('请先在「项目 → 已删除项目」恢复所属项目。 / Restore the project from Projects → Deleted projects first.')
        return reply(store.restore(r.match_info['chat_id']))
    @routes.delete('/qwen-cn/trash/{chat_id}')
    async def purge(r):
        mutate(r);data=await r.json()
        if data.get('confirm') is not True:raise ValueError('需要确认永久删除。')
        return reply(media.purge_chat(r.match_info['chat_id'],data.get('include_media',False)))
    @routes.get('/qwen-cn/gallery')
    async def gallery(r):return reply(store.gallery(r.query.get('q','')[:200],max(0,int(r.query.get('offset',0))),max(1,min(100,int(r.query.get('limit',60))))))
    @routes.delete('/qwen-cn/gallery/{message_id}')
    async def delete_image(r):
        mutate(r);data=await r.json()
        if data.get('confirm') is not True:raise ValueError('需要确认删除图片。')
        return reply(media.trash_image(r.match_info['message_id']))
    @routes.get('/qwen-cn/media/trash')
    async def media_trash(r):return reply(media.trash_list())
    @routes.post('/qwen-cn/media/trash/{message_id}/restore')
    async def media_restore(r):
        mutate(r);return reply(media.restore_image(r.match_info['message_id']))
    @routes.delete('/qwen-cn/media/trash/{message_id}')
    async def media_purge(r):
        mutate(r);data=await r.json()
        if data.get('confirm') is not True:raise ValueError('需要确认永久删除。')
        return reply(media.purge_image(r.match_info['message_id'],True))

    @routes.get('/qwen-cn/uploads')
    async def uploads(r):return reply(media.list_uploads())
    @routes.post('/qwen-cn/uploads')
    async def upload(r):
        if not r.content_type.startswith('multipart/'):
            raise web.HTTPUnsupportedMediaType()
        reader=await r.multipart();part=await reader.next()
        while part and part.name!='image':part=await reader.next()
        if part is None:raise ValueError('缺少参考图片。')
        ext=Path(part.filename or '').suffix.lower()
        if ext not in ('.png','.jpg','.jpeg','.webp'):raise ValueError('仅支持 PNG、JPEG、WebP 参考图。')
        content=await part.read()
        if len(content)>20*1024**2:raise ValueError('图片不能超过 20 MB。')
        receipt=media.begin_upload(ext)
        form=aiohttp.FormData();form.add_field('image',content,filename=receipt['image']['filename'],content_type=part.headers.get('Content-Type','application/octet-stream'))
        form.add_field('type','input');form.add_field('subfolder','hanzagent');form.add_field('overwrite','false')
        active_uploads.add(receipt['id'])
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60)) as session:
                async with session.post(backend+'/upload/image',data=form) as upstream:
                    if upstream.status>=400:raise ValueError('上传服务未确认成功。')
                    result=await upstream.json()
            image={'filename':result['name'],'subfolder':result.get('subfolder',''),'type':'input'}
            media.confirm_upload(receipt['id'],image)
        except (aiohttp.ClientError, TimeoutError, OSError, ValueError, KeyError, TypeError, Conflict):
            media.note_upload_failure(receipt['id'],'uncertain')
            return reply({'error':'上传结果未确认，原文件可能已保留。请在设置的上传文件管理中重试登记；不要重复上传。',
                          'code':'upload_recovery_required','recovery_id':receipt['id'],'file_retained':None},503)
        finally:
            active_uploads.discard(receipt['id'])
        try:
            registered=media.recover_upload(receipt['id'])
        except (sqlite3.Error, OSError, ValueError, KeyError, Conflict):
            try:
                media.rollback_upload(receipt['id'])
            except (sqlite3.Error, OSError, ValueError, KeyError, Conflict):
                media.note_upload_failure(receipt['id'],'retained')
                return reply({'error':'上传登记失败，未能安全清理原文件。恢复收据已保留，请在设置的上传文件管理中重试登记。',
                              'code':'upload_recovery_required','recovery_id':receipt['id'],'file_retained':True},503)
            return reply({'error':'上传登记失败；本次新文件已安全回滚，未留下未登记原文件。请重试上传。',
                          'code':'upload_registration_failed','rolled_back':True},503)
        return reply({**result,'upload_id':registered['id']})
    @routes.get('/qwen-cn/uploads/recovery')
    async def upload_recovery(r):return reply(media.upload_recovery_list())
    @routes.post('/qwen-cn/uploads/recovery/{receipt_id}/register')
    async def recover_upload(r):
        mutate(r)
        if r.match_info['receipt_id'] in active_uploads:raise Conflict('此上传请求仍在执行，请等待结果后重试。')
        registered=media.recover_upload(r.match_info['receipt_id'])
        return reply({'registered':True,'upload_id':registered['id'],'image':registered['image'],
                      'receipt_retained':registered['receipt_retained']})
    @routes.delete('/qwen-cn/uploads/{upload_id}')
    async def purge_upload(r):
        mutate(r);data=await r.json()
        if data.get('confirm') is not True:raise ValueError('需要确认永久删除上传文件。')
        return reply(media.purge_upload(r.match_info['upload_id'],True))
    @routes.get('/qwen-cn/storage/retained-copies')
    async def retained_copies(r):
        # Metadata only; no backup or legacy content is read or silently removed.
        migration=Path(__file__).parent.parent/'liquid-memory'/'backups'
        safety=Path(__file__).parent.parent.parent/'output'/'acceptance'
        legacy=path.parent/'qwen-studio-history.json'
        return reply({'legacy_migration':str(legacy) if legacy.is_file() else None,
                      'backup_directories':[{'path':str(folder),'count':sum(1 for _ in folder.rglob('*.sqlite3')) if folder.exists() else 0} for folder in (migration,safety)],
                      'policy':'explicit_retention_no_automatic_cleanup'})

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
    async def get_memory(r):return reply(memory.snapshot())
    @routes.patch('/qwen-cn/memory/preferences')
    async def preferences(r):
        mutate(r);data=await r.json()
        version=data.get('preferences_version')
        patch={k:data[k] for k in ('enabled','auto_capture') if k in data}
        if not patch:raise ValueError('Invalid memory preferences')
        return reply(memory.configure(patch,preferences_version=version))
    @routes.post('/qwen-cn/memory')
    async def add_memory(r):
        mutate(r);data=await r.json();return reply(memory.put(data.get('content'),data.get('category','preference')),201)
    @routes.patch('/qwen-cn/memory/{memory_id}')
    async def edit_memory(r):
        mutate(r);data=await r.json();memory_id=r.match_info['memory_id']
        if 'active' in data and 'content' not in data and 'category' not in data:
            if type(data.get('active')) is not bool:raise ValueError('Invalid active flag')
            return reply(memory.set_active(memory_id,data['active'],version=data.get('version')))
        if 'content' not in data or not isinstance(data.get('content'),str):
            raise ValueError('Invalid memory edit')
        if 'active' in data and type(data.get('active')) is not bool:
            raise ValueError('Invalid active flag')
        return reply(memory.put(
            data.get('content'),
            data['category'] if 'category' in data else None,
            memory_id=memory_id,
            version=data.get('version'),
            active=data['active'] if 'active' in data else None,
            allow_slot_replace=True,
        ))
    @routes.delete('/qwen-cn/memory/{memory_id}')
    async def forget(r):
        mutate(r);data=await r.json();memory.delete(r.match_info['memory_id'],version=data.get('version'));return reply({'deleted':True})
    @routes.delete('/qwen-cn/memory')
    async def clear(r):
        mutate(r);data=await r.json()
        memory.clear(confirm=data.get('confirm') is True,collection_revision=data.get('collection_revision'));return reply({'deleted':True})

    install_history_metadata(store, routes, mutate, reply)
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
    except sqlite3.Error:
        return web.json_response({'error':'本地数据库暂时不可用。数据未被重建，请重试或检查存储权限。', 'code':'database_unavailable'},status=503)
    except OSError:
        return web.json_response({'error':'本地文件操作未完成。记录已保留，请检查权限后重试。', 'code':'file_operation_failed'},status=503)
    except KeyError:return web.json_response({'error':'记录不存在或已删除。'},status=404)
    except (ValueError,TypeError) as e:return web.json_response({'error':str(e)},status=400)
