"""The README demo must exercise the current send/ownership contract."""
import asyncio
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from aiohttp.test_utils import TestClient, TestServer
import demo
import lm_chat


class DemoTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.original_run = lm_chat.run_turn
        with patch.object(demo.tempfile, 'mkdtemp', return_value=self.temporary.name):
            app = demo.create_demo()
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        lm_chat.run_turn = self.original_run

    async def test_send_idempotence_completion_releases_owner(self):
        chat = await (await self.client.post('/qwen-cn/chats', json={})).json()
        route = '/qwen-cn/chats/' + chat['id'] + '/send'
        body = {'prompt': 'Synthetic demo chat', 'mode': 'chat', 'request_key': 'demo-recovery-contract'}
        sent = await self.client.post(route, json=body)
        self.assertEqual(sent.status, 202)
        message = await sent.json()
        retry = await self.client.post(route, json=body)
        self.assertEqual(retry.status, 200)
        self.assertEqual((await retry.json())['id'], message['id'])
        stream = await self.client.get('/qwen-cn/messages/' + message['id'] + '/events')
        await asyncio.wait_for(stream.read(), 10)
        saved = await (await self.client.get('/qwen-cn/chats/' + chat['id'])).json()
        self.assertEqual(saved['messages'][0]['status'], 'completed')
        self.assertIn('Hello, local workspace', saved['messages'][0]['answer'])
        later = await self.client.post(route, json={**body, 'request_key': 'demo-second-generation'})
        self.assertEqual(later.status, 202)
        later_message = await later.json()
        stop = await self.client.post('/qwen-cn/messages/' + later_message['id'] + '/stop', json={})
        self.assertEqual(stop.status, 200)

    async def test_generated_png_preview_download_and_svg_rejection(self):
        import io
        from PIL import Image
        chat = await (await self.client.post('/qwen-cn/chats', json={})).json()
        sent = await self.client.post('/qwen-cn/chats/' + chat['id'] + '/send', json={
            'prompt': 'Synthetic landscape', 'mode': 'image', 'size': '640,384',
            'request_key': 'demo-image-preview-download'})
        self.assertEqual(sent.status, 202)
        message = await sent.json()
        stream = await self.client.get('/qwen-cn/messages/' + message['id'] + '/events')
        await asyncio.wait_for(stream.read(), 15)
        saved = await (await self.client.get('/qwen-cn/chats/' + chat['id'])).json()
        self.assertEqual(saved['messages'][0]['status'], 'completed')
        descriptor = saved['messages'][0]['image']
        self.assertTrue(descriptor['filename'].endswith('.png'))
        for route in ('/view', '/qwen-cn/download'):
            response = await self.client.get(route, params=descriptor)
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers['Content-Type'], 'image/png')
            self.assertEqual(response.headers['X-Content-Type-Options'], 'nosniff')
            with Image.open(io.BytesIO(await response.read())) as image:
                self.assertEqual(image.size, (640, 384))
                self.assertIn('Synthetic fixture', image.info['Description'])
                image.verify()
            if route.endswith('download'):
                self.assertTrue(response.headers['Content-Disposition'].startswith('attachment;'))
        (Path(self.temporary.name) / 'output' / 'blocked.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg"/>')
        rejected = await self.client.get('/view', params={'filename': 'blocked.svg', 'type': 'output'})
        self.assertEqual(rejected.status, 415)
        routes = [route for route in self.client.app.router.routes() if str(route.resource.canonical) == '/view' and route.method == 'GET']
        self.assertEqual(len(routes), 1)
