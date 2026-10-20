"""Exercise the workspace preview's actual forwarding and origin boundary."""
import unittest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from serve import create_app

class PreviewTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.received=[]
        backend=web.Application()
        async def echo(request):
            self.received.append(dict(request.headers))
            return web.json_response({'method':request.method,'body':await request.json()})
        async def events(request):
            response=web.StreamResponse(headers={'Content-Type':'text/event-stream'})
            await response.prepare(request)
            await response.write(b'data: {"answer":"first"}\n\n')
            await response.write(b'data: {"status":"completed"}\n\n')
            return response
        backend.router.add_post('/qwen-cn/echo',echo)
        backend.router.add_get('/qwen-cn/events',events)
        self.backend=TestServer(backend)
        await self.backend.start_server()
        self.client=TestClient(TestServer(create_app(str(self.backend.make_url('')).rstrip('/'))))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        await self.backend.close()

    async def test_workspace_page_and_stream_passthrough(self):
        response=await self.client.get('/qwen-cn/')
        self.assertEqual(response.status,200)
        self.assertIn('id="mobileMenu"',await response.text())
        response=await self.client.get('/qwen-cn/events')
        self.assertEqual(response.content_type,'text/event-stream')
        self.assertIn('"status":"completed"',await response.text())

    async def test_same_origin_write_and_cross_origin_rejection(self):
        origin=str(self.client.make_url('')).rstrip('/')
        response=await self.client.post('/qwen-cn/echo',json={'draft':'preserved'},headers={'Origin':origin})
        self.assertEqual(response.status,200)
        self.assertEqual((await response.json())['body']['draft'],'preserved')
        self.assertEqual(self.received[-1]['Origin'],str(self.backend.make_url('')).rstrip('/'))
        for headers in ({'Origin':'https://other.example'}, {'Sec-Fetch-Site':'cross-site'}, {'Host':'other.example'}):
            response=await self.client.post('/qwen-cn/echo',json={},headers=headers)
            self.assertEqual(response.status,403)
        self.assertEqual(len(self.received),1)
