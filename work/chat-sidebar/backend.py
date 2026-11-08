from pathlib import Path
import asyncio
import contextlib
import json
import secrets
import shutil
import sqlite3
import subprocess
import time
from urllib.parse import quote, urlsplit

import aiohttp
from aiohttp import web
from server import PromptServer
import folder_paths
from .storage import Store, Conflict
from . import generation_ownership
from .build_info import build_identity
from .diagnostics import service_diagnostics

ROOT = Path(__file__).parent
USER = Path(folder_paths.get_user_directory()) / 'default'
RECORDS = USER / 'qwen-studio-history.json'
DB = USER / 'qwen-studio.sqlite3'
STORE = Store(DB, RECORDS)
SUBMIT_LOCK = asyncio.Lock()
RECORD_LOCK = asyncio.Lock()
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}


def reply(data, status=200):
    return web.json_response(data, status=status, headers={'Cache-Control':'no-store'})


def mutate(request):
    if request.content_type != 'application/json':
        raise web.HTTPUnsupportedMediaType()
    origin = request.headers.get('Origin')
    if origin and urlsplit(origin).netloc != request.host:
        raise web.HTTPForbidden(text='Origin not allowed')


from .generation import image_path as _image_path, clean_draft as _clean_draft, graph

def image_path(image, output_only=False):
    return _image_path(image, folder_paths.get_input_directory(), folder_paths.get_output_directory(), output_only)

def clean_draft(draft):
    return _clean_draft(draft, folder_paths.get_input_directory(), folder_paths.get_output_directory())


def base_url():
    return 'http://127.0.0.1:'+str(getattr(PromptServer.instance,'port',None) or 8188)


async def comfy(session,path,payload=None):
    async with session.request('GET' if payload is None else 'POST',base_url()+path,json=payload,timeout=aiohttp.ClientTimeout(total=20)) as response:
        raw = await response.text()
        data = json.loads(raw) if raw else {}
        if response.status>=400:
            error = data.get('error',{})
            raise ValueError(error.get('message',str(data)) if isinstance(error,dict) else str(error))
        return data


@PromptServer.instance.routes.get('/qwen-cn/')
async def studio(request):
    return web.FileResponse(ROOT/'index.html',headers={'Cache-Control':'no-store'})


@PromptServer.instance.routes.get('/qwen-cn/health')
async def health(request):
    pressure = int(subprocess.check_output(['sysctl','-n','kern.memorystatus_vm_pressure_level'],timeout=2))
    try:
        with STORE.connect() as db:
            db.execute('SELECT count(*) FROM chats').fetchone()
        recovery=generation_ownership.readiness(STORE)
    except sqlite3.Error:
        return reply({'ready':False,'database_ready':False,'generation_recovery_ready':False,
                      'generation_recovery_state':'unavailable','code':'database_unavailable'},503)
    return reply({**build_identity(),**recovery,'database_ready':True,'ready':recovery['generation_recovery_ready'],'disk_free_bytes':shutil.disk_usage(folder_paths.get_output_directory()).free,'memory_pressure_level':pressure,'output_directory':folder_paths.get_output_directory(),'database':str(DB)})


@PromptServer.instance.routes.get('/qwen-cn/diagnostics')
async def diagnostics(request):
    return reply({'application':build_identity(), **await service_diagnostics(lm_chat.LM_URL, base_url())})


@PromptServer.instance.routes.get('/qwen-cn/chats')
async def chats(request):
    return reply(STORE.chats())


@PromptServer.instance.routes.get('/qwen-cn/trash')
async def trash_list(request):
    return reply(STORE.chats(deleted=True))


@PromptServer.instance.routes.delete('/qwen-cn/chats/{chat_id}')
async def delete_chat(request):
    mutate(request)
    try:
        STORE.trash(request.match_info['chat_id'])
        return reply({'deleted':True,'recoverable':True})
    except Conflict as error:
        return reply({'error':str(error)},409)
    except KeyError:
        raise web.HTTPNotFound()


@PromptServer.instance.routes.post('/qwen-cn/chats/{chat_id}/restore')
async def restore_chat(request):
    mutate(request)
    try:
        return reply(STORE.restore(request.match_info['chat_id']))
    except Conflict as error:
        return reply({'error':str(error)},409)
    except KeyError:
        raise web.HTTPNotFound()


@PromptServer.instance.routes.get('/qwen-cn/gallery')
async def gallery(request):
    try:
        offset=max(0,int(request.query.get('offset','0')))
        limit=max(1,min(100,int(request.query.get('limit','60'))))
        return reply(STORE.gallery(request.query.get('q','')[:200],offset,limit))
    except ValueError:
        return reply({'error':'Invalid pagination'},400)


@PromptServer.instance.routes.post('/qwen-cn/chats')
async def create_chat(request):
    mutate(request)
    body = await request.json()
    title = body.get('title','新对话')
    if not isinstance(title,str) or not title.strip() or len(title)>100:
        return reply({'error':'Invalid title'},400)
    return reply(STORE.create(title.strip()),201)


@PromptServer.instance.routes.get('/qwen-cn/chats/{chat_id}')
async def get_chat(request):
    try:
        return reply(STORE.chat(request.match_info['chat_id']))
    except KeyError:
        raise web.HTTPNotFound()


@PromptServer.instance.routes.post('/qwen-cn/chats/{chat_id}/draft')
@PromptServer.instance.routes.patch('/qwen-cn/chats/{chat_id}')
async def patch_chat(request):
    mutate(request)
    try:
        body = await request.json()
        title = body.get('title')
        if title is not None and (not isinstance(title,str) or not title.strip() or len(title)>100):
            raise ValueError('Invalid title')
        draft = clean_draft(body['draft']) if 'draft' in body else None
        return reply(STORE.patch(request.match_info['chat_id'],int(body['version']),title=title.strip() if title else None,draft=draft))
    except Conflict as error:
        return reply({'error':str(error)},409)
    except KeyError:
        raise web.HTTPNotFound()
    except (ValueError,TypeError) as error:
        return reply({'error':str(error)},400)


@PromptServer.instance.routes.post('/qwen-cn/chats/{chat_id}/generate')
async def generate(request):
    mutate(request)
    try:
        body = await request.json()
        if STORE.chat(request.match_info['chat_id'])['deleted_at'] is not None:
            return reply({'error':'对话已删除，请先在回收站恢复。'},410)
        settings = clean_draft(body)
        prompt = settings['prompt'].strip()
        request_key = body.get('request_key','')
        if not prompt or not isinstance(request_key,str) or not 8<=len(request_key)<=100:
            raise ValueError('Missing prompt or request key')
        width,height = map(int,settings['size'].split(','))
        async with SUBMIT_LOCK:
            # Idempotency makes retrying a lost HTTP response safe.
            previous = STORE.by_request(request_key)
            if previous:
                if previous['chat_id']!=request.match_info['chat_id'] or previous['prompt']!=prompt:
                    raise Conflict('重复的请求标识。')
                return reply(previous)
            if shutil.disk_usage(folder_paths.get_output_directory()).free<2*1024**3:
                raise ValueError('磁盘空间不足，请至少保留 2 GB 可用空间。')
            async with aiohttp.ClientSession() as session:
                queue = await comfy(session,'/queue')
                if queue['queue_running'] or queue['queue_pending']:
                    raise Conflict('ComfyUI 正在执行其他任务，请等当前任务完成。')
                client_id = 'qwen-chat-'+secrets.token_hex(16)
                message,created = STORE.reserve(request.match_info['chat_id'],prompt,settings['reference'],width,height,int(settings['quality']),client_id,request_key)
                try:
                    queued = await comfy(session,'/prompt',{'prompt':graph(prompt,width,height,int(settings['quality']),settings['reference']),'client_id':client_id,'extra_data':{'qwen_local_app':True,'qwen_chat_message':message['id'],'qwen_chat_id':message['chat_id']}})
                except ValueError as error:
                    STORE.update(message['id'],status='failed',error=str(error),finished=time.time())
                    raise
                # Transport failures leave a submitting row for queue/history reconciliation.
                message = STORE.update(message['id'],status='running',prompt_id=queued['prompt_id'])
                return reply(message,202)
    except Conflict as error:
        return reply({'error':str(error)},409)
    except KeyError:
        raise web.HTTPNotFound()
    except (ValueError,TypeError) as error:
        return reply({'error':str(error)},400)
    except (aiohttp.ClientError,asyncio.TimeoutError):
        return reply({'error':'请求已保存，正在核对生成状态，请稍后查看此对话。'},503)


@PromptServer.instance.routes.post('/qwen-cn/messages/{message_id}/stop')
async def stop(request):
    mutate(request)
    try:
        message = STORE.message(request.match_info['message_id'])
        if message['id'] in CHAT_TASKS:
            CHAT_TASKS[message['id']].cancel()
            await asyncio.gather(CHAT_TASKS[message['id']],return_exceptions=True)
        elif message['status'] in ('running','submitting') and message['kind']!='image':
            recovery=generation_ownership.reconcile(STORE)
            if STORE.message(message['id'])['status'] in ('running','submitting'):
                return reply({'requested':False, **recovery},409)
        elif message['status'] in ('running','submitting') and message['kind']=='image' and not message['prompt_id']:
            STORE.update(message['id'],phase='正在停止')
        elif message['status'] in ('running','submitting') and message['prompt_id']:
            async with aiohttp.ClientSession() as session:
                await comfy(session,'/interrupt',{'prompt_id':message['prompt_id']})
        return reply({'requested':True})
    except KeyError:
        raise web.HTTPNotFound()


@PromptServer.instance.routes.get('/qwen-cn/records')
async def records_get(request):
    # Backward-compatible migration endpoint for already-open versions of the UI.
    return reply([m for c in STORE.chats() for m in STORE.chat(c['id'])['messages'] if m['image']])


@PromptServer.instance.routes.post('/qwen-cn/records')
async def records_post(request):
    mutate(request)
    try:
        record = await request.json()
        image_path(record['image'],output_only=True)
        if not isinstance(record.get('prompt'),str) or len(record['prompt'])>4000:
            raise ValueError('Invalid prompt')
        STORE.import_record(record)
        # Preserve the old JSON as a readable migration backup; never remove it.
        async with RECORD_LOCK:
            existing = json.loads(RECORDS.read_text(encoding='utf-8')) if RECORDS.exists() else []
            if not any(r['image']['filename']==record['image']['filename'] and r['image'].get('subfolder','')==record['image'].get('subfolder','') for r in existing):
                existing.append({k:record[k] for k in ('prompt','image','seconds','width','height','steps','edited') if k in record})
                tmp=RECORDS.with_suffix('.tmp')
                tmp.write_text(json.dumps(existing,ensure_ascii=False,indent=2),encoding='utf-8')
                tmp.replace(RECORDS)
        return reply({'saved':True})
    except (KeyError,ValueError,TypeError) as error:
        return reply({'error':str(error)},400)


@PromptServer.instance.routes.get('/qwen-cn/download')
async def download(request):
    try:
        filename = request.query.get('filename','')
        target = image_path({'filename':filename,'subfolder':request.query.get('subfolder',''),'type':'output'},output_only=True)
        if target.suffix.lower()!='.png':
            raise ValueError('Invalid format')
        return web.FileResponse(target,headers={'Content-Disposition':"attachment; filename*=UTF-8''"+quote(filename),'Content-Type':'image/png'})
    except ValueError:
        raise web.HTTPNotFound()


async def listen_progress(message):
    try:
        async with aiohttp.ClientSession() as session:
            async with session.ws_connect(base_url()+'/ws?clientId='+message['client_id'],heartbeat=25) as socket:
                async for event in socket:
                    if event.type!=aiohttp.WSMsgType.TEXT:
                        continue
                    data=json.loads(event.data)
                    payload=data.get('data') or {}
                    if payload.get('prompt_id') and payload['prompt_id']!=message['prompt_id']:
                        continue
                    if data.get('type')=='progress':
                        STORE.update(message['id'],phase='正在绘制',step=payload.get('value'),total=payload.get('max'))
                    elif data.get('type')=='executing' and payload.get('node'):
                        labels={'451':'加载图像模型','453':'加载文本编码器','452':'理解图片与修改要求' if message['reference'] else '理解中文描述','458':'绘制图片','457':'解码图片','461':'保存图片'}
                        STORE.update(message['id'],phase=labels.get(str(payload['node']),'处理图片'),step=None,total=None)
    except (aiohttp.ClientError,asyncio.TimeoutError,ValueError):
        pass


async def monitor():
    listeners={}
    try:
        async with aiohttp.ClientSession() as session:
            while True:
                try:
                    active=[m for m in STORE.active() if m['kind']=='image']
                    for message in active:
                        mid=message['id']
                        if not message['prompt_id']:
                            # Recover a response lost between queue submission and SQLite commit.
                            queue=await comfy(session,'/queue')
                            match=next((q for q in queue['queue_running']+queue['queue_pending'] if q[3].get('qwen_chat_message')==mid),None)
                            history=await comfy(session,'/history?max_items=100')
                            pid=match[1] if match else next((pid for pid,h in history.items() if (h.get('prompt') or [None,None,None,{}])[3].get('qwen_chat_message')==mid),None)
                            if pid:
                                message=STORE.update(mid,prompt_id=pid,status='running')
                            elif time.time()-message['created']>30:
                                STORE.update(mid,status='failed',error='生成已中断，描述已保存，请重试。',finished=time.time())
                                continue
                            else:
                                continue
                        if message['phase']=='正在停止':
                            await comfy(session,'/interrupt',{'prompt_id':message['prompt_id']})
                            STORE.update(mid,phase='已请求停止')
                        if mid not in listeners or listeners[mid].done():
                            listeners[mid]=asyncio.create_task(listen_progress(message))
                        pid=message['prompt_id']
                        history=await comfy(session,'/history/'+quote(pid))
                        if pid in history:
                            result=history[pid]
                            images=[i for output in result.get('outputs',{}).values() for i in output.get('images',[])]
                            if result.get('status',{}).get('status_str')=='success' and images:
                                image_path(images[0],output_only=True)
                                stamps={kind:info.get('timestamp') for kind,info in result.get('status',{}).get('messages',[]) if isinstance(info,dict)}
                                seconds=(stamps['execution_success']-stamps['execution_start'])/1000 if stamps.get('execution_success') and stamps.get('execution_start') else time.time()-message['created']
                                STORE.update(mid,status='completed',image_json=json.dumps(images[0],ensure_ascii=False),seconds=seconds,finished=time.time(),phase='已完成',step=None,total=None)
                            else:
                                error=next((info.get('exception_message') for kind,info in result.get('status',{}).get('messages',[]) if kind=='execution_error'),'生成已停止，描述已保存。')
                                STORE.update(mid,status='failed',error=error,finished=time.time())
                            listeners.pop(mid).cancel()
                            queue=await comfy(session,'/queue')
                            if not queue['queue_running'] and not queue['queue_pending']:
                                await comfy(session,'/free',{'unload_models':True,'free_memory':True})
                        else:
                            queue=await comfy(session,'/queue')
                            present=any(q[1]==pid for q in queue['queue_running']+queue['queue_pending'])
                            if not present and time.time()-message['created']>15:
                                STORE.update(mid,status='failed',error='生成已中断，描述已保存，请重试。',finished=time.time())
                                listeners.pop(mid).cancel()
                            elif present:
                                pressure=int(subprocess.check_output(['sysctl','-n','kern.memorystatus_vm_pressure_level'],timeout=2))
                                if pressure>=4 or shutil.disk_usage(folder_paths.get_output_directory()).free<2*1024**3:
                                    await comfy(session,'/interrupt',{'prompt_id':pid})
                                    STORE.update(mid,phase='系统资源紧张，已安全请求停止。请关闭其他大型应用或释放磁盘空间后重试。')
                except (aiohttp.ClientError,asyncio.TimeoutError,OSError,ValueError,KeyError):
                    # A temporary network failure must not discard an in-flight image.
                    pass
                await asyncio.sleep(2)
    finally:
        for task in listeners.values():
            task.cancel()
        if listeners:
            await asyncio.gather(*listeners.values(),return_exceptions=True)


async def lifecycle(app):
    generation_ownership.reconcile(STORE)
    task=asyncio.create_task(monitor())
    yield
    task.cancel()
    pending=list(CHAT_TASKS.values())
    for item in pending:item.cancel()
    await asyncio.gather(*pending,return_exceptions=True)
    with contextlib.suppress(asyncio.CancelledError):
        await task

from .lm_chat import clean_options, install, CHAT_TASKS
install(__import__(__name__, fromlist=['']))
PromptServer.instance.app.cleanup_ctx.append(lifecycle)
