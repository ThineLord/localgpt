import asyncio
from contextlib import closing
import importlib.util
import json
import sqlite3
import pathlib
import sys
import tempfile
import types
import unittest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

ROOT=pathlib.Path(__file__).parent
spec=importlib.util.spec_from_file_location('chat_storage',ROOT/'storage.py')
storemod=importlib.util.module_from_spec(spec);spec.loader.exec_module(storemod)

class StorageTests(unittest.TestCase):
    def test_migration_restart_and_unique_images(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=pathlib.Path(tmp)
            records=[{'prompt':'中文橘猫','image':{'filename':'cat_1.png','subfolder':'a','type':'output'}}, {'prompt':'第二张','image':{'filename':'cat_2.png','subfolder':'a','type':'output'}}]
            legacy=path/'old.json';legacy.write_text(json.dumps(records))
            store=storemod.Store(path/'chat.sqlite3',legacy)
            again=storemod.Store(path/'chat.sqlite3',legacy)
            self.assertEqual(len(again.chat('legacy')['messages']),2)
            self.assertTrue(legacy.exists())
            self.assertEqual(again.chat('legacy')['messages'][0]['prompt'],'中文橘猫')
            store.import_record({'prompt':'相同文件名，另一目录','image':{'filename':'cat_1.png','subfolder':'b','type':'output'}})
            self.assertEqual(len(store.chat('legacy')['messages']),3)
    def test_old_schema_upgrade_delete_restore_gallery(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp)
            # Explicit v1 schema, independent of unpublished historical source files.
            with closing(sqlite3.connect(root/'db.sqlite3')) as db:
                db.executescript("""
                    CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                    CREATE TABLE chats(id TEXT PRIMARY KEY,title TEXT NOT NULL,created REAL NOT NULL,
                        updated REAL NOT NULL,version INTEGER NOT NULL DEFAULT 0,
                        draft_version INTEGER NOT NULL DEFAULT 0,draft TEXT NOT NULL DEFAULT '{}');
                    CREATE TABLE messages(id TEXT PRIMARY KEY,chat_id TEXT NOT NULL REFERENCES chats(id),
                        prompt TEXT NOT NULL,reference_json TEXT,image_json TEXT,status TEXT NOT NULL,
                        prompt_id TEXT,client_id TEXT,phase TEXT NOT NULL DEFAULT '准备生成',step INTEGER,
                        total INTEGER,created REAL NOT NULL,finished REAL,seconds REAL,width INTEGER NOT NULL DEFAULT 512,
                        height INTEGER NOT NULL DEFAULT 512,steps INTEGER NOT NULL DEFAULT 25,error TEXT,
                        request_key TEXT UNIQUE,source_key TEXT UNIQUE);
                """)
            record={'prompt':'橘猫 landscape','image':{'filename':'cat.png','subfolder':'cats','type':'output'}}
            with closing(sqlite3.connect(root/'db.sqlite3')) as db:
                db.execute("INSERT INTO chats(id,title,created,updated) VALUES('legacy','Synthetic legacy',1,1)")
                db.execute("INSERT INTO messages(id,chat_id,prompt,image_json,status,created,source_key) VALUES('old-message','legacy',?,?,'completed',1,'cats/cat.png')",(record['prompt'],json.dumps(record['image'])))
                db.commit()
            legacy=root/'old.json';legacy.write_text(json.dumps([record]))
            store=storemod.Store(root/'db.sqlite3',legacy)
            self.assertIsNone(store.chat('legacy')['deleted_at'])
            self.assertEqual(store.chat('legacy')['messages'][0]['id'],'old-message')
            store.trash('legacy')
            self.assertEqual(store.chats(),[])
            self.assertEqual(store.chats(deleted=True)[0]['id'],'legacy')
            page=store.gallery('landscape',limit=1)
            self.assertEqual(page['total'],1);self.assertTrue(page['items'][0]['chat_deleted'])
            reopened=storemod.Store(root/'db.sqlite3',legacy)
            self.assertEqual(reopened.chats(),[])
            self.assertEqual(len(reopened.chat('legacy')['messages']),1)
            reopened.restore('legacy')
            self.assertEqual(len(reopened.chats()),1)
            self.assertIsNone(reopened.gallery()['items'][0]['chat_deleted'])
            self.assertTrue(legacy.exists())

    def test_draft_conflict_and_progress_do_not_conflict(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=storemod.Store(pathlib.Path(tmp)/'db.sqlite3')
            chat=store.create()
            saved=store.patch(chat['id'],0,draft={'prompt':'双语 draft'})
            with self.assertRaises(storemod.Conflict):store.patch(chat['id'],0,draft={'prompt':'stale'})
            self.assertEqual(store.chat(chat['id'])['draft']['prompt'],'双语 draft')
            message,_=store.reserve(chat['id'],'cat',None,512,512,15,'client','request-123')
            before=store.chat(chat['id'])
            store.update(message['id'],phase='正在绘制',step=6,total=15)
            updated=store.patch(chat['id'],before['draft_version'],draft={'prompt':'next'})
            self.assertEqual(updated['draft']['prompt'],'next')

class APITests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name)
        (self.root/'input').mkdir();(self.root/'output').mkdir()
        (self.root/'output'/'test.png').write_bytes(b'test image fixture')
        (self.root/'input'/'ref.png').write_bytes(b'reference fixture')
        fakepaths=types.ModuleType('folder_paths')
        fakepaths.get_user_directory=lambda:str(self.root/'user')
        fakepaths.get_output_directory=lambda:str(self.root/'output')
        fakepaths.get_input_directory=lambda:str(self.root/'input')
        self.app=web.Application();routes=web.RouteTableDef()
        server=types.ModuleType('server');server.PromptServer=types.SimpleNamespace(instance=types.SimpleNamespace(routes=routes,app=self.app,port=8188))
        self.old={k:sys.modules.get(k) for k in ('folder_paths','server')};sys.modules.update({'folder_paths':fakepaths,'server':server})
        name='chat_test_plugin'
        spec=importlib.util.spec_from_file_location(name,ROOT/'backend.py',submodule_search_locations=[str(ROOT)])
        self.backend=importlib.util.module_from_spec(spec);sys.modules[name]=self.backend;spec.loader.exec_module(self.backend)
        self.submitted=[];self.done=False;self.fail_submit=False
        async def comfy(session,path,payload=None):
            if path=='/queue':return {'queue_running':[],'queue_pending':[]}
            if path=='/prompt':
                if self.fail_submit:raise ValueError('invalid graph')
                self.submitted.append(payload);return {'prompt_id':'test-prompt'}
            if path.startswith('/history'):
                return {'test-prompt':{'status':{'status_str':'success','completed':True,'messages':[['execution_start',{'timestamp':1000}],['execution_success',{'timestamp':4000}]]},'outputs':{'461':{'images':[{'filename':'test.png','subfolder':'','type':'output'}]}}}} if self.done else {}
            return {}
        async def progress(message):await asyncio.Event().wait()
        self.backend.comfy=comfy;self.backend.listen_progress=progress
        self.app.add_routes(routes)
        self.client=TestClient(TestServer(self.app));await self.client.start_server()
    async def asyncTearDown(self):
        await self.client.close()
        for key,value in self.old.items():
            if value is None:sys.modules.pop(key,None)
            else:sys.modules[key]=value
        self.temp.cleanup()
    async def create(self):
        r=await self.client.post('/qwen-cn/chats',json={});self.assertEqual(r.status,201);return await r.json()
    async def test_two_clients_durable_draft_and_conflict(self):
        chat=await self.create();url='/qwen-cn/chats/'+chat['id']
        draft={'prompt':'中文 and English','reference':{'filename':'ref.png','subfolder':'','type':'input'},'size':'512,512','quality':'15'}
        r=await self.client.patch(url,json={'version':0,'draft':draft});self.assertEqual(r.status,200)
        # An independent HTTP client with no browser/localStorage state reads the same database.
        import aiohttp
        async with aiohttp.ClientSession() as second:
            async with second.get(str(self.client.make_url(url))) as response:remote=await response.json()
        self.assertEqual(remote['draft'],draft)
        r=await self.client.patch(url,json={'version':0,'draft':{'prompt':'overwrite'}});self.assertEqual(r.status,409)
        reopened=storemod.Store(self.backend.DB)
        self.assertEqual(reopened.chat(chat['id'])['draft'],draft)
        r=await self.client.patch(url,json={'version':remote['draft_version'],'title':'橘猫创作'});self.assertEqual(r.status,200)
        self.assertEqual((await r.json())['title'],'橘猫创作')
    async def test_generation_idempotent_background_persistence_and_edit_graph(self):
        chat=await self.create();url='/qwen-cn/chats/'+chat['id']+'/generate'
        payload={'prompt':'橘猫','reference':{'filename':'ref.png','type':'input','subfolder':''},'size':'512,512','quality':'15','request_key':'unique-request-key'}
        r=await self.client.post(url,json=payload);self.assertEqual(r.status,202);message=await r.json()
        retry=await self.client.post(url,json=payload);self.assertEqual(retry.status,200);self.assertEqual((await retry.json())['id'],message['id'])
        self.assertEqual(len(self.submitted),1)
        graph=self.submitted[0]['prompt'];self.assertEqual(graph['451']['inputs']['unet_name'],'qwen-image-2.1-UC-Q4_K_M.gguf');self.assertEqual(graph['452']['inputs']['images.image_1'],['460',0])
        self.assertEqual(graph['480']['inputs']['device'],'auto')
        self.done=True
        # No browser poll or completion POST is involved; the background monitor saves the result.
        for _ in range(40):
            await asyncio.sleep(.1)
            saved=self.backend.STORE.message(message['id'])
            if saved['status']=='completed':break
        self.assertEqual(saved['status'],'completed');self.assertEqual(saved['seconds'],3)
        self.assertEqual(saved['image']['filename'],'test.png')
        self.assertEqual(storemod.Store(self.backend.DB).chat(chat['id'])['messages'][0]['image']['filename'],'test.png')
    async def test_delete_restore_gallery_and_active_guard(self):
        chat=await self.create();chat_id=chat['id'];url='/qwen-cn/chats/'+chat_id
        message,_=self.backend.STORE.reserve(chat_id,'gallery cat',None,512,512,15,'test-client','trash-test-request')
        blocked=await self.client.delete(url,json={});self.assertEqual(blocked.status,409)
        self.backend.STORE.update(message['id'],status='completed',image_json=json.dumps({'filename':'test.png','subfolder':'','type':'output'}))
        deleted=await self.client.delete(url,json={});self.assertEqual(deleted.status,200)
        self.assertEqual(await (await self.client.get('/qwen-cn/chats')).json(),[])
        trash=await (await self.client.get('/qwen-cn/trash')).json();self.assertEqual(trash[0]['id'],chat_id)
        page=await (await self.client.get('/qwen-cn/gallery?q=cat&limit=1')).json()
        self.assertEqual(page['total'],1);self.assertEqual(page['items'][0]['chat_id'],chat_id)
        self.assertTrue(page['items'][0]['chat_deleted'])
        self.assertTrue((self.root/'output'/'test.png').exists())
        forbidden=await self.client.post(url+'/generate',json={'prompt':'test','request_key':'blocked-deleted'})
        self.assertEqual(forbidden.status,410)
        restored=await self.client.post(url+'/restore',json={});self.assertEqual(restored.status,200)
        self.assertEqual(len((await restored.json())['messages']),1)
        self.assertEqual(len(await (await self.client.get('/qwen-cn/chats')).json()),1)

    async def test_validation_and_failures_preserve_prompt(self):
        chat=await self.create();url='/qwen-cn/chats/'+chat['id']+'/generate'
        payload={'prompt':'saved prompt','size':'512,512','quality':'15','request_key':'failed-request'}
        self.fail_submit=True
        r=await self.client.post(url,json=payload);self.assertEqual(r.status,400)
        messages=self.backend.STORE.chat(chat['id'])['messages'];self.assertEqual(messages[0]['status'],'failed');self.assertEqual(messages[0]['prompt'],'saved prompt')
        payload['reference']={'filename':'../secret.png','type':'input'};payload['request_key']='bad-image-key'
        r=await self.client.post(url,json=payload);self.assertEqual(r.status,400)
        r=await self.client.post('/qwen-cn/chats',json={},headers={'Origin':'https://unrelated.example'});self.assertEqual(r.status,403)
        self.assertEqual(len(self.backend.STORE.chat(chat['id'])['messages']),1)

if __name__=='__main__':unittest.main(verbosity=2)
