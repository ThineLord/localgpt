"""Health must probe SQLite and distinguish it from a model/proxy outage."""
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from aiohttp.test_utils import TestClient, TestServer
from serve import create_app
from storage import Store

class HealthTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp=tempfile.TemporaryDirectory();root=Path(self.tmp.name);self.root=root
        self.client=TestClient(TestServer(create_app('http://127.0.0.1:1',database=root/'db.sqlite3',input_root=root/'input',output_root=root/'output')))
        await self.client.start_server()
    async def asyncTearDown(self):
        await self.client.close();self.tmp.cleanup()
    async def test_history_health_independent_of_comfy(self):
        r=await self.client.get('/qwen-cn/health');self.assertEqual(r.status,200)
        self.assertTrue((await r.json())['database_ready'])
        self.assertEqual((await self.client.get('/qwen-cn/chats')).status,200)
        self.assertEqual((await self.client.get('/view?filename=missing.png')).status,502)
    async def test_sqlite_unavailable_then_recovery(self):
        with patch.object(Store,'connect',side_effect=sqlite3.OperationalError('synthetic lock')):
            for path in ('/qwen-cn/health','/qwen-cn/chats'):
                r=await self.client.get(path);self.assertEqual(r.status,503)
                self.assertEqual((await r.json())['code'],'database_unavailable')
        r=await self.client.get('/qwen-cn/health');self.assertEqual(r.status,200)
    async def test_health_does_not_reset_history(self):
        c=await(await self.client.post('/qwen-cn/chats',json={'title':'Synthetic persistence'})).json()
        for _ in range(4):self.assertEqual((await self.client.get('/qwen-cn/health')).status,200)
        self.assertEqual((await(await self.client.get('/qwen-cn/chats')).json())[0]['id'],c['id'])

    async def test_missing_database_never_creates_replacement_and_recovers(self):
        original=await(await self.client.post('/qwen-cn/chats',json={'title':'Synthetic original'})).json()
        source=self.root/'db.sqlite3';held=self.root/'held.sqlite3'
        source.rename(held)
        try:
            for path in ('/qwen-cn/health','/qwen-cn/chats','/qwen-cn/memory'):
                response=await self.client.get(path)
                self.assertEqual(response.status,503)
                self.assertEqual((await response.json())['code'],'database_unavailable')
                self.assertFalse(source.exists(), 'Runtime must never create a replacement DB')
        finally:held.rename(source)
        self.assertEqual((await self.client.get('/qwen-cn/health')).status,200)
        records=await(await self.client.get('/qwen-cn/chats')).json()
        self.assertEqual(records[0]['id'],original['id'])

class GenerationIdentityTests(unittest.TestCase):
    def test_identical_seed_does_not_reuse_deleted_output_names(self):
        from generation import graph
        first=graph('Synthetic',512,512,15,None,seed=42)
        second=graph('Synthetic',512,512,15,None,seed=42)
        a=first['461']['inputs'].pop('filename_prefix');b=second['461']['inputs'].pop('filename_prefix')
        self.assertNotEqual(a,b)
        self.assertEqual(first,second)
