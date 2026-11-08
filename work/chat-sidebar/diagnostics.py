"""Explicit, bounded, read-only probes. No startup, inference or response bodies."""
import asyncio
import ipaddress
from urllib.parse import urlsplit
import aiohttp


def loopback_url(value):
    try:
        url = urlsplit(value)
        if url.scheme not in ('http', 'https') or url.username or url.password or url.query or url.fragment:
            return False
        if url.hostname == 'localhost':
            return True
        return ipaddress.ip_address(url.hostname).is_loopback
    except (ValueError, TypeError):
        return False


async def probe(session, base, endpoint):
    if not loopback_url(base):
        return {'status': 'blocked'}
    try:
        async with session.get(base.rstrip('/') + endpoint, allow_redirects=False) as response:
            return {'status': 'available' if response.status == 200 else 'http_error', 'http_status': response.status}
    except (aiohttp.ClientError, asyncio.TimeoutError, ValueError):
        return {'status': 'unavailable'}


async def service_diagnostics(lm_url, comfy_url):
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=2)) as session:
        lm, comfy = await asyncio.gather(probe(session, lm_url, '/api/v1/models'), probe(session, comfy_url, '/queue'))
    return {'lm_studio': lm, 'comfyui': comfy}
