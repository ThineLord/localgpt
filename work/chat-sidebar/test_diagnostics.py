"""Build provenance and bounded model-service diagnostics use synthetic endpoints."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from aiohttp import web
from aiohttp.test_utils import TestServer
from build_info import read_build, build_identity
from diagnostics import loopback_url, service_diagnostics
import test_memory_runtime as fixtures


class BuildTests(unittest.TestCase):
    def test_build_validation_and_missing_archive_identity(self):
        with tempfile.TemporaryDirectory() as root:
            page = Path(root)/'index.html'
            self.assertEqual(read_build(page)['version'], 'unknown')
            page.write_text('<meta name="localgpt-version" content="0.2.0"><meta name="localgpt-build-sha" content="unknown">')
            self.assertEqual(read_build(page), {'version':'0.2.0', 'build_sha':'unknown', 'build_dirty':None})
            page.write_text('<meta name="localgpt-version" content="bad"><meta name="localgpt-build-sha" content="'+ 'a'*40 +'"><meta name="localgpt-build-dirty" content="false">')
            self.assertEqual(read_build(page), {'version':'unknown', 'build_sha':'a'*40, 'build_dirty':False})

    def test_identity_is_startup_snapshot_and_returns_copy(self):
        before = build_identity()
        with patch('build_info.read_build', side_effect=AssertionError('Runtime must not reload build')):
            changed = build_identity(); changed['version'] = 'fake'
            self.assertEqual(build_identity(), before)

    def test_probe_rejects_non_local_and_credential_urls(self):
        for url in ('https://example.com', 'http://127.0.0.1.example.com', 'file:///tmp/test', 'http://user:pass@localhost', 'http://localhost?secret=x', 'http://[::ffff:192.0.2.1]'):
            self.assertFalse(loopback_url(url), url)
        for url in ('http://127.0.0.1:1234','http://localhost:8188','http://[::1]:8188'):
            self.assertTrue(loopback_url(url), url)


class ProbeTests(unittest.IsolatedAsyncioTestCase):
    async def test_get_only_does_not_follow_redirect_or_expose_body(self):
        requests = []
        app = web.Application()
        async def models(request):
            requests.append((request.method, request.path))
            return web.Response(text='SYNTHETIC-PRIVATE-MODEL-DATA')
        async def queue(request):
            requests.append((request.method, request.path))
            raise web.HTTPFound('/unexpected')
        app.router.add_get('/api/v1/models', models); app.router.add_get('/queue', queue)
        server = TestServer(app); await server.start_server()
        try:
            result = await service_diagnostics(str(server.make_url('')), str(server.make_url('')))
            self.assertEqual(result['lm_studio']['status'], 'available')
            self.assertEqual(result['comfyui'], {'status':'http_error', 'http_status':302})
            self.assertNotIn('PRIVATE', str(result))
            self.assertEqual(set(requests), {('GET','/api/v1/models'),('GET','/queue')})
        finally:
            await server.close()
        result = await service_diagnostics('https://example.com', 'http://127.0.0.1:1')
        self.assertEqual(result['lm_studio']['status'], 'blocked')
        self.assertEqual(result['comfyui']['status'], 'unavailable')

    async def test_timeout_is_bounded(self):
        import asyncio
        app = web.Application()
        async def slow(request):
            await asyncio.sleep(3)
            return web.Response()
        app.router.add_get('/api/v1/models', slow); app.router.add_get('/queue', slow)
        server = TestServer(app); await server.start_server()
        try:
            start = asyncio.get_running_loop().time()
            result = await service_diagnostics(str(server.make_url('')), str(server.make_url('')))
            self.assertLess(asyncio.get_running_loop().time() - start, 2.8)
            self.assertEqual(result['lm_studio']['status'], 'unavailable')
        finally:
            await server.close()


class DiagnosticRuntimeTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = fixtures.RuntimeTests.asyncSetUp
    asyncTearDown = fixtures.RuntimeTests.asyncTearDown

    async def test_health_stays_independent_and_diagnostics_never_infer(self):
        with patch('runtime.service_diagnostics', side_effect=AssertionError('Health must not probe models')):
            health = await (await self.client.get('/qwen-cn/health')).json()
        self.assertTrue(health['database_ready'])
        self.assertEqual(health['version'], build_identity()['version'])
        result = await (await self.client.get('/qwen-cn/diagnostics')).json()
        self.assertEqual(result['lm_studio']['status'], 'available')
        self.assertEqual(result['comfyui']['status'], 'available')
        self.assertEqual(self.payloads, [])
        await self.lm.close(); await self.backend.close()
        health = await (await self.client.get('/qwen-cn/health')).json()
        self.assertTrue(health['database_ready'])
        result = await (await self.client.get('/qwen-cn/diagnostics')).json()
        self.assertEqual(result['lm_studio']['status'], 'unavailable')
        self.assertEqual(result['comfyui']['status'], 'unavailable')
