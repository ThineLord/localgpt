import io
import tempfile
import unittest
from pathlib import Path
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image
from local_profile import install_profile, normalize_avatar, MAX_UPLOAD
from runtime import errors


def picture(fmt='PNG'):
    out=io.BytesIO();Image.new('RGB',(320,180),'#4f766b').save(out,format=fmt);return out.getvalue()


class AvatarTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)/'profile'
        app=web.Application(middlewares=[errors]);install_profile(app,self.root)
        self.client=TestClient(TestServer(app));await self.client.start_server()
    async def asyncTearDown(self):
        await self.client.close();self.tmp.cleanup()
    async def get(self):
        return await (await self.client.get('/qwen-cn/profile')).json()
    async def put(self,data,version='default',mime='image/png',extra=None):
        return await self.client.put('/qwen-cn/profile/avatar',data=data,headers={'Content-Type':mime,'If-Match':'"'+version+'"',**(extra or {})})
    async def test_save_reload_conflict_reset_and_no_original(self):
        self.assertEqual((await self.get())['version'],'default');self.assertFalse(self.root.exists())
        result=await self.put(picture());self.assertEqual(result.status,200);saved=await result.json()
        self.assertEqual(await self.get(),saved)
        with Image.open(self.root/'avatar.png') as image:
            self.assertEqual(image.size,(256,256));self.assertEqual(image.info,{})
        self.assertEqual({p.name for p in self.root.iterdir()},{'avatar.png'})
        self.assertEqual((self.root/'avatar.png').stat().st_mode & 0o777,0o600)
        self.assertEqual((await self.put(picture('JPEG'),mime='image/jpeg')).status,409)
        self.assertEqual(await self.get(),saved)
        raw=await self.client.get(saved['avatar_url']);self.assertEqual(raw.headers['X-Content-Type-Options'],'nosniff')
        reset=await self.client.delete('/qwen-cn/profile/avatar',headers={'If-Match':'"'+saved['version']+'"'})
        self.assertEqual(reset.status,200);self.assertEqual((await self.get())['version'],'default');self.assertFalse((self.root/'avatar.png').exists())
    async def test_invalid_spoofed_oversized_and_cross_origin(self):
        for data,mime,status in [(b'broken','image/png',400),(picture(),'image/jpeg',400),(b'<svg/>','image/svg+xml',415),(b'x'*(MAX_UPLOAD+1),'image/png',413)]:
            r=await self.put(data,mime=mime);self.assertEqual(r.status,status)
        r=await self.put(picture(),extra={'Origin':'https://evil.example'});self.assertEqual(r.status,403)
        self.assertFalse(self.root.exists())
    async def test_symlink_rejected_without_target_mutation(self):
        target=Path(self.tmp.name)/'untouched';target.write_bytes(b'original')
        self.root.mkdir();(self.root/'avatar.png').symlink_to(target)
        self.assertEqual((await self.put(picture())).status,400);self.assertEqual(target.read_bytes(),b'original')
    async def test_missing_version_cannot_overwrite(self):
        r=await self.client.delete('/qwen-cn/profile/avatar');self.assertEqual(r.status,409)
    def test_supported_formats_normalized(self):
        for fmt,mime in [('PNG','image/png'),('JPEG','image/jpeg'),('WEBP','image/webp')]:
            im=Image.open(io.BytesIO(normalize_avatar(picture(fmt),mime)));self.assertEqual(im.format,'PNG');self.assertEqual(im.size,(256,256))
