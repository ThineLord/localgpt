import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from memory_store import MemoryStore, MemoryConflict, token_cost
from storage import Store, Conflict
from serve import create_app
import lm_chat

class MemoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.path=Path(self.tmp.name)/'data.sqlite3';self.store=Store(self.path);self.mem=MemoryStore(self.path)
    def tearDown(self):self.tmp.cleanup()
    def test_capture_dedup_correction_and_privacy(self):
        self.mem.configure({'auto_capture':True})
        self.mem.capture('我叫林雨。','a','1');self.mem.capture('我叫林雨。','a','2');self.assertEqual(len(self.mem.list()),1)
        self.mem.capture('我叫陈晨。','b','3');self.assertEqual(len(self.mem.list()),1);self.assertIn('陈晨',self.mem.list()[0]['content'])
        for text in ('请记住我的密码是 12345','这段文件说：我叫小明','我喜欢中文吗？','```我喜欢绿色```','给我写一段故事'):
            self.assertEqual(self.mem.capture(text,'a','4'),[])
        self.mem.process_turn('记住：我喜欢简洁的中文回答。','a','5')
        self.assertEqual(len(MemoryStore(self.path).list()),2)
        context,ids=self.mem.context('你好');self.assertIn('中文',context);self.assertGreaterEqual(len(ids),1)
        name_ctx,_=self.mem.context('我的名字');self.assertIn('陈晨',name_ctx)
    def test_disabled_forgetting_versions_and_budget(self):
        item=self.mem.put('我偏好精确回答')
        with self.assertRaises(MemoryConflict):self.mem.put('更正',memory_id=item['id'],version=0)
        self.mem.put('我偏好短回答',memory_id=item['id'],version=1)
        self.mem.configure({'enabled':False});self.assertEqual(self.mem.context('你好'),('',[]));self.assertEqual(self.mem.capture('我叫测试','a','m'),[])
        self.mem.configure({'enabled':True});self.mem.delete(item['id']);self.assertEqual(self.mem.context('你好'),('',[]))
        for i in range(15):self.mem.put(('偏好'+str(i))*30)
        text,_=self.mem.context('偏好',budget=500);self.assertLess(token_cost(text),800)
        self.mem.clear(confirm=True);self.assertEqual(self.mem.list(),[])
    def test_gallery_delete_purge_and_retained_images(self):
        self.store.import_record({'prompt':'test','image':{'filename':'x.png','subfolder':'unit'}})
        image=self.store.gallery()['items'][0]
        with self.assertRaises(Conflict):self.store.purge('legacy')
        self.mem.process_turn('记住：我喜欢测试','legacy','note')
        self.store.trash('legacy');self.store.purge('legacy')
        self.assertEqual(self.store.chats(deleted=True),[]);self.assertEqual(len(self.mem.list()),1);self.assertIsNone(self.mem.list()[0]["chat_id"])
        with self.assertRaises(KeyError):self.store.chat('legacy')
        kept=self.store.gallery()['items'][0];self.assertTrue(kept['chat_purged']);self.assertIsNone(kept['chat_id']);self.assertEqual(kept['prompt'],'已保留的图片')
        self.store.delete_gallery(image['id']);self.assertEqual(self.store.gallery()['total'],0)
        self.store.import_record({'prompt':'test','image':{'filename':'x.png','subfolder':'unit'}});self.assertEqual(self.store.gallery()['total'],0)
    def test_old_backend_import_cannot_resurrect_purged_records(self):
        self.store.import_record({'prompt':'private prompt','image':{'filename':'legacy.png'}})
        self.store.trash('legacy');self.store.purge('legacy')
        with self.store.connect() as db:
            db.execute("INSERT INTO chats(id,title,created,updated) VALUES('legacy','old import',1,1)")
            db.execute("INSERT INTO messages(id,chat_id,prompt,status,created,source_key) VALUES('reimport','legacy','private prompt','completed',1,'/legacy.png')")
        reopened=Store(self.path)
        with self.assertRaises(KeyError):reopened.chat('legacy')
        self.assertEqual(reopened.gallery()['total'],1)  # Saved image, no chat text.

    def test_gallery_removal_updates_conversation(self):
        self.store.import_record({'prompt':'test','image':{'filename':'x.png'}})
        m=self.store.gallery()['items'][0];self.store.delete_gallery(m['id'])
        self.assertIsNone(self.store.message(m['id'])['image']);self.assertTrue(self.store.message(m['id'])['image_deleted'])
        self.assertEqual(Store(self.path).gallery()['total'],0)

class RuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);(self.root/'input').mkdir();(self.root/'output').mkdir();self.payloads=[]
        backend=web.Application()
        async def queue(r):return web.json_response({'queue_running':[],'queue_pending':[]})
        async def free(r):return web.Response()  # ComfyUI /free succeeds with an empty body.
        backend.router.add_get('/queue',queue);backend.router.add_post('/free',free)
        self.backend=TestServer(backend);await self.backend.start_server()
        lm=web.Application()
        async def models(r):return web.json_response({'models':[{'type':'llm','key':'qwen3-8b','architecture':'qwen3','capabilities':{},'loaded_instances':[{'id':'hanzagent-qwen3-8b'}]}]})
        async def answer(r):
            body=await r.json();self.payloads.append(body)
            response=web.StreamResponse(headers={'Content-Type':'text/event-stream'});await response.prepare(r)
            try:
                for text in ['memory ','test']:
                    await response.write(('data: '+json.dumps({'choices':[{'delta':{'content':text}}]})+'\n\n').encode());await asyncio.sleep(.01)
                await response.write(b'data: [DONE]\n\n')
            except ConnectionResetError:pass
            return response
        lm.router.add_get('/api/v1/models',models);lm.router.add_post('/v1/chat/completions',answer)
        self.lm=TestServer(lm);await self.lm.start_server();self.previous_url=lm_chat.LM_URL;lm_chat.LM_URL=str(self.lm.make_url('')).rstrip('/')
        self.client=TestClient(TestServer(create_app(str(self.backend.make_url('')).rstrip('/'),database=self.root/'db.sqlite3',input_root=self.root/'input',output_root=self.root/'output')));await self.client.start_server()
    async def asyncTearDown(self):
        await self.client.close();await self.lm.close();await self.backend.close();lm_chat.LM_URL=self.previous_url;self.tmp.cleanup()
    async def chat(self):return await (await self.client.post('/qwen-cn/chats',json={})).json()
    async def send(self,chat,prompt,key):
        response=await self.client.post('/qwen-cn/chats/'+chat['id']+'/send',json={'prompt':prompt,'mode':'chat','request_key':key});self.assertEqual(response.status,202)
        message=await response.json();events=await self.client.get('/qwen-cn/messages/'+message['id']+'/events');await events.read();return message
    async def test_explicit_remember_when_auto_off_and_memory_payload(self):
        await self.client.patch('/qwen-cn/memory/preferences',json={'auto_capture':False,'enabled':True})
        chat=await self.chat()
        message=await self.send(chat,'记住：Round7 显式记忆。','memory-explicit-1')
        mem=message.get('memory') or {}
        self.assertTrue(mem.get('saved') or mem.get('updated'))
        self.assertEqual(mem.get('status'),'saved')
        snap=await (await self.client.get('/qwen-cn/memory')).json()
        self.assertIn('summary',snap);self.assertIn('preferences_version',snap)
        self.assertEqual(snap['item_count'],1)
    async def test_cross_chat_recall_delete_and_disabled(self):
        one=await self.chat();await self.send(one,'记住：我喜欢简洁的中文回答。','memory-request-1')
        data=await (await self.client.get('/qwen-cn/memory')).json();self.assertEqual(len(data['items']),1)
        two=await self.chat();await self.send(two,'你好','memory-request-2')
        self.assertIn('我喜欢简洁的中文回答',self.payloads[-1]['messages'][0]['content'])
        self.assertEqual(len([m for m in self.payloads[-1]['messages'] if m['role']=='user']),1)
        await self.client.patch('/qwen-cn/memory/preferences',json={'enabled':False})
        await self.send(two,'继续','memory-request-3');self.assertNotIn('跨对话记忆',self.payloads[-1]['messages'][0]['content'])
        await self.client.patch('/qwen-cn/memory/preferences',json={'enabled':True})
        await self.client.delete('/qwen-cn/memory/'+data['items'][0]['id'],json={})
        three=await self.chat();await self.send(three,'你好','memory-request-4');self.assertNotIn('跨对话记忆',self.payloads[-1]['messages'][0]['content'])
    async def test_permissions_memory_conflict_and_purge_api(self):
        for route in ('/qwen-cn/memory','/qwen-cn/chats'):
            response=await self.client.post(route,json={'content':'test'},headers={'Origin':'https://other.example'});self.assertEqual(response.status,403)
        saved=await (await self.client.post('/qwen-cn/memory',json={'content':'test'})).json()
        response=await self.client.patch('/qwen-cn/memory/'+saved['id'],json={'content':'new','version':0});self.assertEqual(response.status,409)
        chat=await self.chat();route='/qwen-cn/trash/'+chat['id']
        response=await self.client.delete(route,json={'confirm':True});self.assertEqual(response.status,409)
        await self.client.delete('/qwen-cn/chats/'+chat['id'],json={})
        response=await self.client.delete(route,json={});self.assertEqual(response.status,400)
        response=await self.client.delete(route,json={'confirm':True});self.assertEqual(response.status,200)
        response=await self.client.get('/qwen-cn/chats/'+chat['id']);self.assertEqual(response.status,404)
