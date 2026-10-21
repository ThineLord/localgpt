"""Synthetic upstream and temporary files only: upload transaction failure recovery."""
from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import aiohttp
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from runtime import install, errors
from storage import Conflict


class UploadRecoveryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.input, self.output = self.root / 'input', self.root / 'output'
        self.input.mkdir(); self.output.mkdir()
        self.mode = 'normal'; self.last_image = None
        upstream = web.Application()
        async def upload(request):
            reader = await request.multipart()
            fields, content, filename = {}, None, None
            async for part in reader:
                if part.name == 'image': content, filename = await part.read(), part.filename
                else: fields[part.name] = await part.text()
            self.assertEqual(fields, {'type': 'input', 'subfolder': 'hanzagent', 'overwrite': 'false'})
            self.assertTrue(filename.startswith('hanz-ref-'))
            if self.mode == 'failure_before_write': return web.json_response({'error': 'synthetic failure'}, status=503)
            path = self.input / fields['subfolder'] / filename
            path.parent.mkdir(exist_ok=True); path.write_bytes(content)
            self.last_image = {'filename': filename, 'subfolder': fields['subfolder'], 'type': 'input'}
            if self.mode == 'shared':
                chat = self.core.STORE.create('Synthetic consumer')
                self.core.STORE.patch(chat['id'], 0, draft={'reference': self.last_image})
            if self.mode == 'uncertain': return web.Response(text='{not json', content_type='application/json')
            return web.json_response({'name': filename, 'subfolder': fields['subfolder'], 'type': 'input'})
        upstream.router.add_post('/upload/image', upload)
        self.backend = TestServer(upstream); await self.backend.start_server()
        app = web.Application(middlewares=[errors])
        self.core = install(app, str(self.backend.make_url('')).rstrip('/'), self.root / 'data.sqlite3', self.input, self.output)
        self.client = TestClient(TestServer(app)); await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close(); await self.backend.close(); self.tmp.cleanup()

    async def upload(self):
        form = aiohttp.FormData()
        form.add_field('image', b'synthetic image bytes', filename='synthetic.png', content_type='image/png')
        response = await self.client.post('/qwen-cn/uploads', data=form)
        return response.status, await response.json()

    async def recovery(self):
        response = await self.client.get('/qwen-cn/uploads/recovery')
        self.assertEqual(response.status, 200)
        return (await response.json())['items']

    async def register(self, receipt_id):
        return await self.client.post('/qwen-cn/uploads/recovery/' + receipt_id + '/register', json={})

    def actual_file(self): return self.input / self.last_image['subfolder'] / self.last_image['filename']

    async def test_success_registers_and_removes_receipt(self):
        status, data = await self.upload()
        self.assertEqual(status, 200); self.assertIn('upload_id', data)
        self.assertTrue(self.actual_file().is_file())
        self.assertEqual(await self.recovery(), [])
        self.assertEqual(len(self.core.MEDIA.list_uploads()['items']), 1)

    async def test_registration_failure_safely_rolls_back_only_new_file(self):
        old = self.input / 'old-user-file.png'; old.write_bytes(b'preserve')
        with patch.object(self.core.MEDIA, 'register_upload', side_effect=ValueError('synthetic registration failure')):
            status, data = await self.upload()
        self.assertEqual(status, 503); self.assertTrue(data['rolled_back'])
        self.assertEqual(data['code'], 'upload_registration_failed')
        self.assertFalse(self.actual_file().exists())
        self.assertEqual(old.read_bytes(), b'preserve')
        self.assertEqual(await self.recovery(), [])

    async def test_rollback_failure_keeps_receipt_and_explicit_retry_registers(self):
        with patch.object(self.core.MEDIA, 'register_upload', side_effect=ValueError('synthetic failure')), \
             patch.object(self.core.MEDIA, '_unlink', side_effect=PermissionError('synthetic permission error')):
            status, data = await self.upload()
        self.assertEqual(status, 503); self.assertEqual(data['code'], 'upload_recovery_required')
        self.assertTrue(self.actual_file().exists())
        receipts = await self.recovery(); self.assertEqual(len(receipts), 1)
        self.assertEqual(receipts[0]['state'], 'retained'); self.assertTrue(receipts[0]['file_present'])
        path = self.core.MEDIA.upload_receipt_dir / (receipts[0]['id'] + '.json')
        payload = json.loads(path.read_text())
        self.assertNotIn('content', payload); self.assertNotIn('token', payload)
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        response = await self.register(receipts[0]['id'])
        self.assertEqual(response.status, 200); self.assertTrue((await response.json())['registered'])
        self.assertEqual(await self.recovery(), [])
        self.assertEqual(len(self.core.MEDIA.list_uploads()['items']), 1)

    async def test_real_sqlite_write_lock_does_not_lose_recovery_receipt(self):
        @contextmanager
        def short_connection():
            db = sqlite3.connect(self.core.STORE.path, timeout=.02)
            db.row_factory = sqlite3.Row
            try:
                with db: yield db
            finally: db.close()
        lock = sqlite3.connect(self.core.STORE.path); lock.execute('BEGIN IMMEDIATE')
        try:
            with patch.object(self.core.STORE, 'connect', short_connection):
                status, data = await self.upload()
        finally: lock.rollback(); lock.close()
        self.assertEqual(status, 503); self.assertEqual(data['code'], 'upload_recovery_required')
        self.assertTrue(self.actual_file().exists())
        receipts = await self.recovery(); self.assertEqual(len(receipts), 1)
        response = await self.register(receipts[0]['id'])
        self.assertEqual(response.status, 200)
        self.assertEqual(len(self.core.MEDIA.list_uploads()['items']), 1)

    async def test_unknown_upstream_outcome_can_be_explicitly_recovered(self):
        self.mode = 'uncertain'
        status, data = await self.upload()
        self.assertEqual(status, 503); self.assertIsNone(data['file_retained'])
        receipts = await self.recovery(); self.assertEqual(receipts[0]['state'], 'uncertain')
        self.assertTrue(receipts[0]['file_present'])
        response = await self.register(receipts[0]['id'])
        self.assertEqual(response.status, 200); self.assertTrue(self.actual_file().exists())

    async def test_unconfirmed_missing_file_is_not_falsely_registered(self):
        self.mode = 'failure_before_write'
        status, data = await self.upload()
        self.assertEqual(status, 503)
        receipts = await self.recovery(); self.assertFalse(receipts[0]['file_present'])
        response = await self.register(receipts[0]['id'])
        self.assertEqual(response.status, 409)
        self.assertEqual(self.core.MEDIA.list_uploads()['items'], [])
        self.assertEqual(len(await self.recovery()), 1)

    async def test_shared_file_is_never_rolled_back(self):
        self.mode = 'shared'
        with patch.object(self.core.MEDIA, 'register_upload', side_effect=ValueError('synthetic registration failure')):
            status, data = await self.upload()
        self.assertEqual(status, 503); self.assertEqual(data['code'], 'upload_recovery_required')
        self.assertTrue(self.actual_file().exists())
        receipts = await self.recovery()
        response = await self.register(receipts[0]['id'])
        self.assertEqual(response.status, 200)
        self.assertEqual(self.core.MEDIA.list_uploads()['items'][0]['reference_count'], 1)

    async def test_replacement_file_is_not_rolled_back_or_adopted(self):
        receipt = self.core.MEDIA.begin_upload('.png')
        image = receipt['image']; target = self.input / image['subfolder'] / image['filename']
        target.parent.mkdir(exist_ok=True); target.write_bytes(b'original synthetic upload')
        self.core.MEDIA.confirm_upload(receipt['id'], image)
        target.write_bytes(b'replaced file must remain')
        with self.assertRaises(Conflict): self.core.MEDIA.rollback_upload(receipt['id'])
        with self.assertRaises(Conflict): self.core.MEDIA.recover_upload(receipt['id'])
        self.assertEqual(target.read_bytes(), b'replaced file must remain')
        self.assertEqual(len(await self.recovery()), 1)


if __name__ == '__main__': unittest.main()
