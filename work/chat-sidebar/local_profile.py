"""Local-only avatar; no database schema, user-supplied paths or original uploads."""
import asyncio
import hashlib
import io
import os
from pathlib import Path
import tempfile
import warnings
from urllib.parse import urlsplit

from aiohttp import web
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_UPLOAD = 5 * 1024 * 1024
MAX_PIXELS = 16_000_000
TYPES = {'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WEBP'}


def normalize_avatar(raw, content_type):
    if content_type not in TYPES:
        raise ValueError('请选择 PNG、JPEG 或 WebP 图片。')
    if not raw or len(raw) > MAX_UPLOAD:
        raise ValueError('头像图片不能超过 5 MB。')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as probe:
                if probe.format != TYPES[content_type]:
                    raise ValueError('图片内容与文件类型不一致。')
                if probe.width * probe.height > MAX_PIXELS or max(probe.size) > 8192:
                    raise ValueError('图片尺寸过大，请使用不超过 1600 万像素的图片。')
                probe.verify()
            with Image.open(io.BytesIO(raw)) as source:
                source.seek(0)
                source.load()
                image = ImageOps.fit(ImageOps.exif_transpose(source).convert('RGBA'), (256, 256), method=Image.Resampling.LANCZOS)
                # A fresh image strips EXIF, text chunks and other original metadata.
                clean = Image.new('RGBA', image.size)
                clean.paste(image)
                result = io.BytesIO()
                clean.save(result, format='PNG')
                return result.getvalue()
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        raise ValueError('无法读取图片，请选择有效的 PNG、JPEG 或 WebP。') from exc


def install_profile(app, directory):
    root = Path(directory)
    avatar = root / 'avatar.png'
    lock = asyncio.Lock()

    def read():
        if root.is_symlink() or avatar.is_symlink():
            raise ValueError('头像存储路径不可用。')
        return avatar.read_bytes() if avatar.exists() else None

    def version(data):
        return hashlib.sha256(data).hexdigest() if data else 'default'

    def meta(data):
        v = version(data)
        return {'version': v, 'avatar_url': '/qwen-cn/profile/avatar?v=' + v if data else None}

    def reply(data, status=200):
        return web.json_response(data, status=status, headers={'Cache-Control': 'no-store'})

    def allowed(request):
        origin = request.headers.get('Origin')
        if request.headers.get('Sec-Fetch-Site') == 'cross-site' or (origin and urlsplit(origin).netloc != request.host):
            raise web.HTTPForbidden(text='Same origin required')

    async def get_profile(request):
        return reply(meta(read()))

    async def get_avatar(request):
        data = read()
        if data is None:
            raise web.HTTPNotFound()
        return web.Response(body=data, content_type='image/png', headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})

    async def update(request):
        allowed(request)
        if request.method == 'PUT':
            if request.content_type not in TYPES:
                return reply({'error': '请选择 PNG、JPEG 或 WebP 图片。'}, 415)
            if request.content_length is not None and request.content_length > MAX_UPLOAD:
                return reply({'error': '头像图片不能超过 5 MB。'}, 413)
            raw = bytearray()
            async for chunk in request.content.iter_chunked(65536):
                raw.extend(chunk)
                if len(raw) > MAX_UPLOAD:
                    return reply({'error': '头像图片不能超过 5 MB。'}, 413)
            data = await asyncio.to_thread(normalize_avatar, bytes(raw), request.content_type)
        else:
            data = None
        async with lock:
            previous = read()
            if request.headers.get('If-Match') != '"' + version(previous) + '"':
                return reply({'error': '头像已在其他窗口更新，请重新打开后再保存。', 'code': 'profile_conflict'}, 409)
            if data is None:
                if avatar.exists():
                    avatar.unlink()
            else:
                root.mkdir(mode=0o700, parents=True, exist_ok=True)
                fd, tmp = tempfile.mkstemp(prefix='.avatar-', dir=root)
                try:
                    with os.fdopen(fd, 'wb') as stream:
                        stream.write(data)
                        stream.flush()
                        os.fsync(stream.fileno())
                    os.replace(tmp, avatar)
                finally:
                    if os.path.exists(tmp):
                        os.unlink(tmp)
            return reply(meta(data))

    app.router.add_get('/qwen-cn/profile', get_profile)
    app.router.add_get('/qwen-cn/profile/avatar', get_avatar)
    app.router.add_put('/qwen-cn/profile/avatar', update)
    app.router.add_delete('/qwen-cn/profile/avatar', update)
