"""Synthetic UI fixture: temporary data, no network/model calls, no personal history."""
import argparse
import asyncio
import json
import tempfile
import time
import uuid
from pathlib import Path
from aiohttp import web
import lm_chat
from runtime import install, errors
from synthetic_image import write_png

ANSWER = '''这是一个用于界面验收的模拟回答，不是模型推理结果。

## 先把想法拆成三个步骤
- 明确想表达的主题，让内容围绕一个问题展开。
- 保留足够的留白，用简单、清晰的文字说明关键细节。
- 检查长段落、代码和图片在窄屏上的显示效果。

**本地聊天**与**图像生成**共享同一个输入框。你可以切换模式，也可以使用自动判断。

```python
message = "Hello, local workspace"
print(message)
```

A long line should wrap without pushing the composer or sidebar outside the viewport. 这段中英混排文字用于验证可读性、自然换行和流式输出时的滚动行为。'''

def create_demo():
    root = Path(tempfile.mkdtemp(prefix='localgpt-demo-'))
    (root/'input').mkdir(); (root/'output').mkdir()
    write_png(root/'output'/'fixture.png')
    @web.middleware
    async def fixture(request, handler):
        if request.path == '/qwen-cn/models':
            return web.json_response({'online':True,'default':'qwen3-8b','models':[{'key':'qwen3-8b','display_name':'Qwen3 8B · Demo','type':'llm','loaded_instances':[]}]})
        if request.path == '/qwen-cn/health':
            return web.json_response({'ready':True,'database':'Temporary demo database','demo':True})
        if request.path == '/qwen-cn/uploads' and request.method == 'POST':
            return await upload(request)
        if request.path == '/qwen-cn/lm/start':
            return web.json_response({'started':False,'demo':True})
        return await handler(request)
    app = web.Application(middlewares=[errors,fixture])
    async def run(core,message,settings,owner=None):
        mid=message['id']; image=settings['mode']=='image'
        core.STORE.update(mid,kind='image' if image else 'chat',status='running',phase='正在生成' if image else '正在回答')
        try:
            if image:
                for i in range(15):
                    core.STORE.update(mid,step=i+1,total=15,phase='正在生成'); await asyncio.sleep(.25)
                name='synthetic-'+mid+'.png'
                width,height=map(int,settings['size'].split(','))
                write_png(root/'output'/name,width,height)
                core.STORE.update(mid,image_json=json.dumps({'filename':name,'subfolder':'','type':'output'}),status='completed',finished=time.time(),phase='已完成')
            else:
                for end in range(1,len(ANSWER)+16,16):
                    core.STORE.update(mid,answer=ANSWER[:end]); await asyncio.sleep(.06)
                core.STORE.update(mid,status='completed',finished=time.time(),phase='已完成')
        except asyncio.CancelledError:
            core.STORE.update(mid,status='stopped',phase='已停止',finished=time.time())
        finally:
            if owner is not None:
                owner.close()
    lm_chat.run_turn = run
    core=install(app,'http://127.0.0.1:1',root/'demo.sqlite3',root/'input',root/'output')
    old=core.STORE.create('布局与排版示例')
    msg,_=core.STORE.reserve(old['id'],'如何让本地创作更简单？',None,512,512,15,'demo-client','demo-example-key',kind='chat',model='qwen3-8b')
    core.STORE.update(msg['id'],answer=ANSWER,status='completed',finished=time.time())
    core.STORE.create('新对话')
    async def index(r):return web.FileResponse(Path(__file__).with_name('index.html'),headers={'Cache-Control':'no-store'})
    async def upload(r):
        reader=await r.multipart();part=await reader.next()
        while part and part.name!='image':part=await reader.next()
        if not part:return web.json_response({'error':'Missing image'},status=400)
        content=await part.read();name='reference-'+uuid.uuid4().hex+'.png';(root/'input'/name).write_bytes(content)
        core.MEDIA.register_upload({'filename':name,'type':'input','subfolder':''})
        return web.json_response({'name':name,'subfolder':'','type':'input'})
    app.router.add_get('/',index);app.router.add_get('/qwen-cn/',index)
    app.router.add_post('/upload/image',upload)
    return app

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8191)
    web.run_app(create_demo(),host='127.0.0.1',port=parser.parse_args().port)
