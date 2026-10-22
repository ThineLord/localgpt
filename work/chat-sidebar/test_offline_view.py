"""Managed /view and /qwen-cn/download while the Comfy proxy is offline.

Uses the real serve.create_app with a temporary database and media roots.
No demo route and no production user data.
"""
import json
from pathlib import Path
import tempfile
import unittest

from aiohttp.test_utils import TestClient, TestServer
from serve import create_app
from storage import Store

PNG = b'\x89PNG\r\n\x1a\nsynthetic-png'
JPEG = b'\xff\xd8\xffsynthetic-jpeg'
SECRET = b'SECRET-OUTSIDE-BYTES'


class OfflineManagedMediaTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.input = self.root / 'input'
        self.output = self.root / 'output'
        self.temp = self.root / 'temp'
        self.outside = self.root / 'outside'
        for folder in (self.input, self.output, self.temp, self.outside):
            folder.mkdir()
        (self.output / 'ok.png').write_bytes(PNG)
        (self.output / 'album').mkdir()
        (self.output / 'album' / 'nested.png').write_bytes(PNG + b'-nested')
        (self.input / 'ref.jpg').write_bytes(JPEG)
        (self.temp / 'preview.png').write_bytes(b'TEMP-ONLY')
        (self.outside / 'secret.png').write_bytes(SECRET)
        (self.output / 'escape.png').symlink_to(self.outside / 'secret.png')
        (self.output / 'linked-dir').symlink_to(self.outside, target_is_directory=True)
        (self.output / 'not-a-file.png').mkdir()
        self.db = self.root / 'db.sqlite3'
        self.client = TestClient(TestServer(create_app(
            'http://127.0.0.1:1', database=self.db, input_root=self.input, output_root=self.output,
        )))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self.tmp.cleanup()

    def url(self, route, **query):
        from urllib.parse import urlencode
        return route + '?' + urlencode(query)

    async def test_get_and_head_return_managed_bytes(self):
        cases = [
            ('/view', {'filename': 'ok.png', 'type': 'output', 'subfolder': ''}, PNG),
            ('/view', {'filename': 'nested.png', 'subfolder': 'album', 'type': 'output'}, PNG + b'-nested'),
            ('/view', {'filename': 'ref.jpg', 'type': 'input'}, JPEG),
            ('/qwen-cn/download', {'filename': 'ok.png', 'subfolder': '', 'type': 'output'}, PNG),
            ('/qwen-cn/download', {'filename': 'nested.png', 'subfolder': 'album', 'type': 'output'}, PNG + b'-nested'),
            ('/qwen-cn/download', {'filename': 'ref.jpg', 'type': 'input', 'subfolder': ''}, JPEG),
            ('/qwen-cn/download', {'filename': 'ok.png', 'subfolder': ''}, PNG),
        ]
        for route, query, payload in cases:
            target = self.url(route, **query)
            got = await self.client.get(target)
            self.assertEqual(got.status, 200, target)
            self.assertEqual(await got.read(), payload)
            head = await self.client.head(target)
            self.assertEqual(head.status, 200, target)
            self.assertEqual(head.content_length, len(payload))
            if route.endswith('/download'):
                disposition = head.headers['Content-Disposition']
                self.assertIn('attachment', disposition)
                self.assertIn(query['filename'], disposition)
                self.assertNotIn('..', disposition)
                self.assertNotIn(str(self.root), disposition)

    async def test_missing_is_404_and_unsupported_type_is_explicit(self):
        for route in ('/view', '/qwen-cn/download'):
            missing = await self.client.get(self.url(route, filename='missing.png', type='output'))
            self.assertEqual(missing.status, 404, route)
            head = await self.client.head(self.url(route, filename='missing.png', type='output'))
            self.assertEqual(head.status, 404, route)
            unsupported = await self.client.get(self.url(route, filename='preview.png', type='temp'))
            self.assertEqual(unsupported.status, 400, route)
            raw = await unsupported.read()
            self.assertNotIn(b'TEMP-ONLY', raw)
            body = json.loads(raw)
            self.assertEqual(body['error'], 'Unsupported image type')
            self.assertEqual(body['type'], 'temp')
            directory = await self.client.get(self.url(route, filename='not-a-file.png', type='output'))
            self.assertEqual(directory.status, 404, route)

    async def test_active_documents_and_non_images_are_not_served(self):
        payload = b'<script>window.untrustedMediaExecuted=true</script>'
        for name in ('note.html', 'vector.svg', 'settings.json', 'no-extension'):
            (self.output / name).write_bytes(payload)
            for route in ('/view', '/qwen-cn/download'):
                for method in (self.client.get, self.client.head):
                    response = await method(self.url(route, filename=name, type='output'))
                    self.assertEqual(response.status, 415, (route, name))
                    self.assertNotIn(payload, await response.read())
        # Even misleading contents cannot select an active document MIME type.
        (self.output / 'misleading.PNG').write_bytes(payload)
        for route in ('/view', '/qwen-cn/download'):
            response = await self.client.get(self.url(route, filename='misleading.PNG'))
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers['Content-Type'], 'image/png')
            self.assertEqual(response.headers['X-Content-Type-Options'], 'nosniff')

    async def test_traversal_and_symlink_escape_rejected(self):
        attacks = [
            {'filename': '../secret.png', 'type': 'output'},
            {'filename': 'secret.png', 'subfolder': '..', 'type': 'output'},
            {'filename': 'secret.png', 'subfolder': 'linked-dir', 'type': 'output'},
            {'filename': 'escape.png', 'type': 'output'},
            {'filename': '/etc/passwd', 'type': 'output'},
            {'filename': 'ok.png', 'subfolder': '/tmp', 'type': 'output'},
        ]
        for route in ('/view', '/qwen-cn/download'):
            for query in attacks:
                for method in (self.client.get, self.client.head):
                    response = await method(self.url(route, **query))
                    self.assertIn(response.status, (400, 404), (route, query, response.status))
                    self.assertNotIn(SECRET, await response.read())
        self.assertEqual((self.outside / 'secret.png').read_bytes(), SECRET)

    async def test_offline_backend_still_lists_history_and_media(self):
        store = Store(self.db)
        chat = store.create('Synthetic offline chat')
        message, _ = store.reserve(chat['id'], 'Synthetic prompt', None, 512, 512, 15, 'test', 'offline-key')
        image = {'filename': 'ok.png', 'subfolder': '', 'type': 'output'}
        store.update(message['id'], status='completed', image_json=json.dumps(image))
        health = await self.client.get('/qwen-cn/health')
        self.assertEqual(health.status, 200)
        chats = await self.client.get('/qwen-cn/chats')
        self.assertEqual(chats.status, 200)
        self.assertEqual((await chats.json())[0]['id'], chat['id'])
        gallery = await self.client.get('/qwen-cn/gallery')
        self.assertEqual(gallery.status, 200)
        self.assertEqual((await gallery.json())['total'], 1)
        self.assertEqual((await self.client.get('/qwen-cn/media/trash')).status, 200)
        self.assertEqual((await self.client.get('/qwen-cn/uploads')).status, 200)
        proxied = await self.client.get('/qwen-cn/upstream-probe')
        self.assertEqual(proxied.status, 502)
        blocked = await self.client.get(self.url('/view', filename='ok.png', type='output'), headers={'Sec-Fetch-Site': 'cross-site'})
        self.assertEqual(blocked.status, 403)
        blocked_download = await self.client.get(
            self.url('/qwen-cn/download', filename='ok.png', type='output'), headers={'Host': 'other.example'},
        )
        self.assertEqual(blocked_download.status, 403)
