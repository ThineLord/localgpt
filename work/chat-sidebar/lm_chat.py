"""Local LM Studio chat and image routing for the existing studio."""
import asyncio
import base64
import contextlib
import json
import math
import re
import secrets
import sqlite3
import time
from pathlib import Path

import aiohttp
from aiohttp import web

LM_URL = 'http://127.0.0.1:1234'
LMS = Path.home()/'.lmstudio/bin/lms'
CHAT_TASKS = {}


def clean_options(data):
    mode = data.get('mode','auto')
    model = data.get('model','qwen3-8b')
    thinking = data.get('thinking','off')
    if mode not in ('auto','chat','image') or thinking not in ('off','on'):
        raise ValueError('Invalid mode')
    if not isinstance(model,str) or len(model)>250:
        raise ValueError('Invalid model')
    temperature = float(data.get('temperature',0.7))
    cfg = float(data.get('cfg',1))
    max_tokens = int(data.get('max_tokens',2048))
    seed = data.get('seed')
    seed = None if seed in (None,'',-1,'-1') else int(seed)
    if not math.isfinite(temperature) or not 0<=temperature<=2 or not math.isfinite(cfg) or not 1<=cfg<=5 or not 128<=max_tokens<=4096 or (seed is not None and not 0<=seed<2**48):
        raise ValueError('Invalid generation settings')
    return dict(mode=mode,model=model,thinking=thinking,temperature=temperature,max_tokens=max_tokens,cfg=cfg,seed=seed)


async def lm_json(session,path,body=None):
    async with session.request('GET' if body is None else 'POST',LM_URL+path,json=body,timeout=aiohttp.ClientTimeout(total=180)) as response:
        data=await response.json()
        if response.status>=400:
            error=data.get('error','LM Studio request failed')
            raise ValueError(error if isinstance(error,str) else error.get('message',str(error)))
        return data


async def models(session):
    data=await lm_json(session,'/api/v1/models')
    return [m for m in data['models'] if m['type']=='llm' and 'image' not in (m.get('architecture') or '').lower() and 'image' not in m['key'].lower()]


async def cli(*args):
    process=await asyncio.create_subprocess_exec(str(LMS),*args,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.STDOUT)
    try:
        output,_=await asyncio.wait_for(process.communicate(),180)
        if process.returncode:
            raise ValueError('LM Studio: '+output.decode(errors='replace')[-600:])
    finally:
        if process.returncode is None:
            process.terminate()
            await process.wait()


async def release_owned(session,keep=None):
    for model in await models(session):
        for instance in model['loaded_instances']:
            identifier=instance['id']
            if identifier.startswith('hanzagent-') and identifier!=keep:
                await lm_json(session,'/api/v1/models/unload',{'instance_id':identifier})


async def load_model(session,key):
    available=await models(session)
    model=next((m for m in available if m['key']==key),None)
    if not model:
        raise ValueError('未找到所选对话模型，请刷新模型列表。')
    identifier='hanzagent-'+key
    await release_owned(session,keep=identifier)
    if not any(i['id']==identifier for i in model['loaded_instances']):
        await cli('load',key,'--identifier',identifier,'--context-length','8192','--ttl','300','-y')
    return identifier,model


def direct_intent(prompt,mode,has_image):
    if mode!='auto':return mode
    p=prompt.strip().lower()
    if re.search(r'(不要|不用|别|不需要).{0,8}(生图|画|生成图片)|\b(don.t|do not)\s+(draw|generate|create)',p):return 'chat'
    if re.search(r'^(画图|绘画|生图|生成图片|draw|paint|image).{0,40}(是什么|怎么|如何|为什么|哪个|区别|原理|模型|what|how|difference)',p):return 'chat'
    if re.search(r'^(请|帮我|给我|麻烦|可以|能不能|你能|现在|再|重新|please|can you|could you|i want you to|would you)?[，,\s]*(帮我|给我)?(画(?:一|个|张|出|幅|只|些|点)|绘制(?:一|个|张|出|幅)|生图[:：\s]|生成.{0,5}(图片|图像|照片|插画|壁纸|海报|一张图)|做.{0,5}(图片|海报|壁纸))',p):return 'image'
    if re.search(r'^(please\s+|can you\s+|could you\s+)?(draw|paint|render)\b|^(please\s+)?(generate|create|make)\s+(me\s+)?(an?\s+)?(image|picture|photo|illustration|poster)\b',p):return 'image'
    return None


def history_messages(messages,system,max_tokens):
    # Keep complete recent turns within the 8192-token context; CJK can take multiple tokens.
    budget=max(0,8192-max_tokens-500-sum(2 if ord(ch)>127 else .35 for ch in system))
    used=0;turns=[]
    for m in reversed(messages):
        answer=m.get('answer') or ('[已生成图片：'+m['prompt']+']' if m.get('image') else '')
        if not answer:continue
        cost=sum(2 if ord(ch)>127 else 0.35 for ch in m['prompt']+answer)
        if used+cost>budget:break
        used+=cost
        turns.append([{'role':'user','content':m['prompt']},{'role':'assistant','content':answer}])
    return [{'role':'system','content':system}]+[item for pair in reversed(turns) for item in pair]


async def classify(session,identifier,prompt,previous,reference):
    system='Classify the latest user request. Return JSON {"action":"chat" or "image","use_previous_image":true or false}. Choose image only if the user asks you to actually generate/draw/edit a picture. Questions about drawing, prompts, code, charts in code, explanations and descriptions are chat. Reference images alone do not imply editing. If changing an existing image choose use_previous_image=true. If unclear choose chat. /no_think'
    context={'recent_turns':[{'user':m['prompt'][:600],'assistant':m.get('answer','')[-400:],'has_image':bool(m.get('image'))} for m in previous[-3:]],'attached_image':bool(reference),'request':prompt}
    data=await lm_json(session,'/v1/chat/completions',{'model':identifier,'messages':[{'role':'system','content':system},{'role':'user','content':json.dumps(context,ensure_ascii=False)+'/no_think'}],'temperature':0,'max_tokens':100,'response_format':{'type':'json_schema','json_schema':{'name':'intent','strict':True,'schema':{'type':'object','properties':{'action':{'type':'string','enum':['chat','image']},'use_previous_image':{'type':'boolean'}},'required':['action','use_previous_image'],'additionalProperties':False}}}})
    content=data['choices'][0]['message']['content']
    content=re.sub(r'<think>.*?</think>','',content,flags=re.S).strip()
    decision=json.loads(content)
    return decision['action'],decision['use_previous_image']


async def queue_image(core,session,message,settings,reference):
    mid=message['id']
    core.STORE.update(mid,phase='准备图片生成')
    with contextlib.suppress(aiohttp.ClientError,asyncio.TimeoutError):
        await release_owned(session)
    if core.shutil.disk_usage(core.folder_paths.get_output_directory()).free<2*1024**3:
        raise ValueError('磁盘空间不足，请至少保留 2 GB 可用空间。')
    queue=await core.comfy(session,'/queue')
    if queue['queue_running'] or queue['queue_pending']:
        raise core.Conflict('ComfyUI 正在执行其他任务，请等当前任务完成。')
    g=core.graph(message['prompt'],message['width'],message['height'],message['steps'],reference,settings['cfg'],settings['seed'])
    core.STORE.update(mid,kind='image',reference_json=json.dumps(reference,ensure_ascii=False) if reference else None)
    result=await core.comfy(session,'/prompt',{'prompt':g,'client_id':message['client_id'],'extra_data':{'qwen_local_app':True,'qwen_chat_message':mid,'qwen_chat_id':message['chat_id']}})
    core.STORE.update(mid,kind='image',model='qwen-image-2.1-UC-Q4_K_M',status='running',prompt_id=result['prompt_id'],reference_json=json.dumps(reference,ensure_ascii=False) if reference else None,phase='准备生成')


async def run_turn(core,message,settings):
    mid=message['id'];answer='';reasoning=''
    try:
        async with aiohttp.ClientSession() as session:
            previous=[m for m in core.STORE.chat(message['chat_id'])['messages'] if m['id']!=mid]
            last_image=next((m['image'] for m in reversed(previous) if m.get('image')),None)
            reference=message['reference'];intent=direct_intent(message['prompt'],settings['mode'],bool(last_image or reference))
            identifier=None;model=None
            use_previous=bool(last_image and re.search(r'^(把|将|改成|换成|改为|再来|调亮|调暗|去掉|添加|加上|移除|change|make it|remove|add\b|edit)',message['prompt'].strip(),re.I))
            if intent!='image':
                queue=await core.comfy(session,'/queue')
                if queue['queue_running'] or queue['queue_pending']:raise core.Conflict('ComfyUI 正在执行其他任务，请等当前任务完成。')
                await core.comfy(session,'/free',{'unload_models':True,'free_memory':True})
                core.STORE.update(mid,phase='加载对话模型')
                identifier,model=await load_model(session,settings['model'])
                if intent is None:
                    core.STORE.update(mid,phase='理解你的请求')
                    intent,use_previous=await classify(session,identifier,message['prompt'],previous,reference)
            if intent=='image':
                if not reference and use_previous:reference=last_image
                await queue_image(core,session,message,settings,reference)
                return
            core.STORE.update(mid,kind='chat',status='running',phase='正在思考' if settings['thinking']=='on' else '正在回答')
            if reference and not model.get('capabilities',{}).get('vision'):
                raise ValueError('当前对话模型不支持看图。可选择「生图」编辑参考图，或移除参考图后继续聊天。')
            system='你是 HanzAgent，本地运行的助手。跟随用户的语言回答，准确、清晰。可用 Markdown 和代码块。你不能联网，也不能读电脑文件。图片由独立的本地生图流程处理；你不要声称已经生成或看到了未提供的图片。'
            memory=getattr(core,'MEMORY',None)
            if memory:
                recalled,ids=memory.context(message['prompt'])
                system+=recalled
                core.STORE.update(mid,memory_json=json.dumps({'used':ids,'saved':message.get('memory',{}).get('saved',[])},ensure_ascii=False))
            system_cost=sum(2 if ord(ch)>127 else .35 for ch in system)
            remaining=max(0,8192-settings['max_tokens']-500-int(system_cost))
            prompt_cost=sum(2 if ord(ch)>127 else .35 for ch in message['prompt'])
            if prompt_cost>remaining:raise ValueError('当前输入与回答长度超过 8192 上下文，请缩短输入或降低回答长度。')
            messages=history_messages(previous,system,settings['max_tokens']+int(prompt_cost))
            content=message['prompt']
            if model.get('architecture')=='qwen3':content+='\n/think' if settings['thinking']=='on' else '\n/no_think'
            if reference:
                image=core.image_path(reference)
                content=[{'type':'text','text':content},{'type':'image_url','image_url':{'url':'data:image/'+('jpeg' if image.suffix.lower() in ('.jpg','.jpeg') else image.suffix.lstrip('.'))+';base64,'+base64.b64encode(image.read_bytes()).decode()}}]
            messages.append({'role':'user','content':content})
            payload={'model':identifier,'messages':messages,'temperature':settings['temperature'],'max_tokens':settings['max_tokens'],'stream':True}
            last_save=0;finish=None;complete=False
            async with session.post(LM_URL+'/v1/chat/completions',json=payload,timeout=aiohttp.ClientTimeout(total=900,sock_read=180)) as response:
                if response.status>=400:raise ValueError((await response.text())[:600])
                async for line in response.content:
                    if not line.startswith(b'data:'):continue
                    data=line[5:].strip()
                    if data==b'[DONE]':
                        complete=True
                        break
                    event=json.loads(data)
                    if event.get('error'):raise ValueError(str(event['error']))
                    if not event.get('choices'):continue
                    choice=event['choices'][0];delta=choice.get('delta',{})
                    answer+=delta.get('content') or ''
                    reasoning+=delta.get('reasoning_content') or delta.get('reasoning') or ''
                    finish=choice.get('finish_reason') or finish
                    if time.monotonic()-last_save>.18:
                        core.STORE.update(mid,answer=answer,reasoning=reasoning)
                        last_save=time.monotonic()
            if not complete and finish is None:raise ValueError('回答连接提前结束，已保留收到的内容，请重试。')
            if '<think>' in answer:
                blocks=re.findall(r'<think>(.*?)</think>',answer,flags=re.S)
                reasoning+='\n'.join(blocks)
                answer=re.sub(r'<think>.*?</think>','',answer,flags=re.S).strip()
            if not answer.strip() and not reasoning.strip():raise ValueError('模型没有返回内容，请重试。')
            core.STORE.update(mid,status='completed',answer=answer,reasoning=reasoning,finished=time.time(),seconds=time.time()-message['created'],phase='达到回答长度上限' if finish=='length' else '已完成')
    except asyncio.CancelledError:
        # A successful queue submission belongs to the image monitor, not the cancelled chat task.
        current=core.STORE.message(mid)
        if current['kind']=='image':
            core.STORE.update(mid,phase='正在停止')
            if current['prompt_id']:
                async with aiohttp.ClientSession() as session:
                    await core.comfy(session,'/interrupt',{'prompt_id':current['prompt_id']})
        else:core.STORE.update(mid,status='stopped',answer=answer,reasoning=reasoning,phase='已停止',finished=time.time())
        raise
    except (aiohttp.ClientError,asyncio.TimeoutError) as error:
        if core.STORE.message(mid)['kind']=='image':return
        core.STORE.update(mid,status='failed',error='本地模型连接中断，请检查 LM Studio 服务后重试。',answer=answer,reasoning=reasoning,finished=time.time())
    except Exception as error:
        core.STORE.update(mid,status='failed',error=str(error),answer=answer,reasoning=reasoning,finished=time.time())


def install(core):
    routes=core.PromptServer.instance.routes
    @routes.get('/qwen-cn/models')
    async def model_list(request):
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as session:
                available=await asyncio.wait_for(models(session),5)
            return core.reply({'online':True,'models':available,'default':'qwen3-8b'})
        except (aiohttp.ClientError,asyncio.TimeoutError,ValueError) as error:
            return core.reply({'online':False,'models':[],'error':'LM Studio 未连接，请点击连接。'})

    @routes.post('/qwen-cn/lm/start')
    async def start(request):
        core.mutate(request)
        try:
            await cli('server','start','--port','1234')
            return core.reply({'started':True})
        except (OSError,ValueError,asyncio.TimeoutError) as error:
            return core.reply({'error':str(error)},503)

    @routes.post('/qwen-cn/chats/{chat_id}/send')
    async def send(request):
        core.mutate(request)
        try:
            body=await request.json();settings={**core.clean_draft(body),**clean_options(body)}
            prompt=settings['prompt'].strip();key=body.get('request_key','');chat_id=request.match_info['chat_id']
            if not prompt or not isinstance(key,str) or not 8<=len(key)<=100:raise ValueError('Missing prompt or request key')
            async with core.SUBMIT_LOCK:
                prior=core.STORE.by_request(key)
                if prior:
                    if prior['chat_id']!=chat_id or prior['prompt']!=prompt or prior['settings']!=settings:raise core.Conflict('重复的请求标识。')
                    return core.reply(prior)
                if core.STORE.chat(chat_id)['deleted_at'] is not None:return core.reply({'error':'对话已删除，请先在回收站恢复。'},410)
                width,height=map(int,settings['size'].split(','))
                message,_=core.STORE.reserve(chat_id,prompt,settings['reference'],width,height,int(settings['quality']),'qwen-chat-'+secrets.token_hex(16),key,kind='routing',model=settings['model'],settings=settings)
                memory=getattr(core,'MEMORY',None)
                if memory:
                    try:
                        saved=memory.capture(prompt,chat_id,message['id'])
                        message=core.STORE.update(message['id'],memory_json=json.dumps({'saved':saved,'used':[]}))
                    except (ValueError,sqlite3.Error) as error:
                        message=core.STORE.update(message['id'],memory_json=json.dumps({'saved':[],'used':[],'notice':str(error)},ensure_ascii=False))
                task=asyncio.create_task(run_turn(core,message,settings));CHAT_TASKS[message['id']]=task
                task.add_done_callback(lambda done:CHAT_TASKS.pop(message['id'],None))
            return core.reply(message,202)
        except core.Conflict as error:return core.reply({'error':str(error)},409)
        except KeyError:raise web.HTTPNotFound()
        except (ValueError,TypeError) as error:return core.reply({'error':str(error)},400)

    @routes.get('/qwen-cn/messages/{message_id}/events')
    async def events(request):
        mid=request.match_info['message_id']
        try:core.STORE.message(mid)
        except KeyError:raise web.HTTPNotFound()
        response=web.StreamResponse(headers={'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Accel-Buffering':'no'})
        await response.prepare(request);last=None
        try:
            while True:
                message=core.STORE.message(mid)
                encoded=json.dumps(message,ensure_ascii=False)
                if encoded!=last:
                    await response.write(('data: '+encoded+'\n\n').encode());last=encoded
                if message['status'] not in ('submitting','running'):break
                await asyncio.sleep(.25)
        except (ConnectionResetError,asyncio.CancelledError):pass
        return response
