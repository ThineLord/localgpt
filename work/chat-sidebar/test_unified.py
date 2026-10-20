import asyncio
import json
import sys
import unittest
from aiohttp import web
from aiohttp.test_utils import TestServer
import test_chats as fixtures

class UnifiedTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await fixtures.APITests.asyncSetUp(self)
        self.lm=sys.modules['chat_test_plugin.lm_chat']
        self.old_url=self.lm.LM_URL
        self.payloads=[];self.long=False
        app=web.Application()
        async def models(request):
            return web.json_response({'models':[{'type':'llm','key':'qwen3-8b','architecture':'qwen3','loaded_instances':[{'id':'hanzagent-qwen3-8b'}],'capabilities':{}},{'type':'embedding','key':'embed'},{'type':'llm','key':'qwen-image','architecture':'qwen_image21'}]})
        async def completion(request):
            body=await request.json();self.payloads.append(body)
            if body.get('response_format'):return web.json_response({'choices':[{'message':{'content':'{"action":"chat","use_previous_image":false}'}}]})
            r=web.StreamResponse(headers={'Content-Type':'text/event-stream'});await r.prepare(request)
            try:
                for token in (['你好，','小林。'] if not self.long else ['测试']*100):
                    event={'choices':[{'delta':{'content':token}}]}
                    await r.write(('data: '+json.dumps(event,ensure_ascii=False)+'\n\n').encode());await asyncio.sleep(.03)
                await r.write(b'data: [DONE]\n\n')
            except ConnectionResetError:pass
            return r
        app.router.add_get('/api/v1/models',models);app.router.add_post('/v1/chat/completions',completion)
        async def unload(request):return web.json_response({})
        app.router.add_post('/api/v1/models/unload',unload)
        self.lm_server=TestServer(app);await self.lm_server.start_server();self.lm.LM_URL=str(self.lm_server.make_url('')).rstrip('/')
    async def asyncTearDown(self):
        await fixtures.APITests.asyncTearDown(self)
        self.lm.LM_URL=self.old_url
        await self.lm_server.close()
    create=fixtures.APITests.create
    async def wait_done(self,mid):
        for _ in range(100):
            m=self.backend.STORE.message(mid)
            if m['status'] not in ('running','submitting'):return m
            await asyncio.sleep(.04)
        self.fail('Turn did not finish')
    async def test_stream_persistence_context_idempotence_and_options(self):
        c=await self.create();url='/qwen-cn/chats/'+c['id']+'/send'
        payload={'prompt':'你好，小林','mode':'auto','request_key':'unified-stream-1','temperature':1.2,'max_tokens':512,'thinking':'off'}
        response=await self.client.post(url,json=payload);self.assertEqual(response.status,202);m=await response.json()
        retry=await self.client.post(url,json=payload);self.assertEqual(retry.status,200)
        self.assertEqual((await retry.json())['id'],m['id'])
        done=await self.wait_done(m['id']);self.assertEqual(done['answer'],'你好，小林。');self.assertEqual(done['status'],'completed')
        reopened=fixtures.storemod.Store(self.backend.DB);self.assertEqual(reopened.message(m['id'])['answer'],'你好，小林。')
        self.assertEqual(reopened.chat(c['id'])['draft']['temperature'],1.2)
        payload.update(prompt='我的名字？',mode='chat',request_key='unified-stream-2')
        m2=await (await self.client.post(url,json=payload)).json();await self.wait_done(m2['id'])
        body=self.payloads[-1];self.assertEqual(body['temperature'],1.2);self.assertEqual(body['max_tokens'],512)
        self.assertIn({'role':'assistant','content':'你好，小林。'},body['messages'])
        events=await self.client.get('/qwen-cn/messages/'+m2['id']+'/events');self.assertIn('你好，小林。',await events.text())
        bad=await self.client.post(url,json={**payload,'temperature':0});self.assertEqual(bad.status,409)
    async def test_stop_retains_partial_answer(self):
        self.long=True;c=await self.create()
        m=await (await self.client.post('/qwen-cn/chats/'+c['id']+'/send',json={'prompt':'继续说','mode':'chat','request_key':'stop-stream-test'})).json()
        await asyncio.sleep(.25)
        r=await self.client.post('/qwen-cn/messages/'+m['id']+'/stop',json={});self.assertEqual(r.status,200)
        done=await self.wait_done(m['id']);self.assertEqual(done['status'],'stopped');self.assertTrue(done['answer']);self.assertEqual(self.backend.STORE.active(),[])
    async def test_image_route_and_settings_do_not_require_chat(self):
        c=await self.create();self.done=True
        payload={'prompt':'帮我画一张橘猫','mode':'auto','quality':'15','seed':42,'cfg':2,'request_key':'image-route-test'}
        m=await (await self.client.post('/qwen-cn/chats/'+c['id']+'/send',json=payload)).json()
        done=await self.wait_done(m['id']);self.assertEqual(done['kind'],'image');self.assertEqual(done['status'],'completed')
        graph=self.submitted[0]['prompt'];self.assertEqual(graph['458']['inputs']['cfg'],2);self.assertEqual(graph['458']['inputs']['seed'],42)
        self.assertEqual(self.payloads,[])
    async def test_validation_origin_models_and_negative_intent(self):
        c=await self.create();url='/qwen-cn/chats/'+c['id']+'/send'
        for extra in [{'temperature':float('nan')},{'mode':'unknown'},{'reference':{'filename':'../private','type':'input'}},{'seed':-20}]:
            r=await self.client.post(url,json={'prompt':'test','request_key':'invalid-turn',**extra});self.assertEqual(r.status,400)
        r=await self.client.post(url,json={'prompt':'test','request_key':'evil-origin'},headers={'Origin':'https://evil.example'});self.assertEqual(r.status,403)
        catalog=await (await self.client.get('/qwen-cn/models')).json();self.assertEqual(len(catalog['models']),1)
        self.assertEqual(self.lm.direct_intent('不要画图，解释一下怎么生成图片','auto',True),'chat')
        self.assertIsNone(self.lm.direct_intent('如何生成图片？','auto',False))
        self.assertIsNone(self.lm.direct_intent('把背景换成蓝色','auto',True))
        self.assertEqual(self.lm.direct_intent('画图模型哪个好','auto',True),'chat')
        self.assertIsNone(self.lm.direct_intent('把刚才的话翻译成英文','auto',True))

    async def test_stop_during_image_submission_keeps_recoverable_record(self):
        started=asyncio.Event()
        previous=self.backend.comfy
        async def delayed(session,path,payload=None):
            if path=='/prompt':
                started.set()
                await asyncio.Event().wait()
            return await previous(session,path,payload)
        self.backend.comfy=delayed
        c=await self.create()
        m=await (await self.client.post('/qwen-cn/chats/'+c['id']+'/send',json={'prompt':'画一张猫','mode':'image','request_key':'stop-while-queueing'})).json()
        await asyncio.wait_for(started.wait(),2)
        r=await self.client.post('/qwen-cn/messages/'+m['id']+'/stop',json={})
        self.assertEqual(r.status,200)
        saved=self.backend.STORE.message(m['id'])
        self.assertEqual(saved['kind'],'image')
        self.assertEqual(saved['status'],'submitting')
        self.assertEqual(saved['phase'],'正在停止')
