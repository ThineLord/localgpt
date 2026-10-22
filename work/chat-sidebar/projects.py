"""Same-origin HTTP interface for local project management."""
import asyncio
from urllib.parse import quote

from aiohttp import web
from project_store import MAX_FILE_BYTES, ProjectStore


def install(core):
    projects = core.PROJECTS = ProjectStore(core.STORE)
    routes, reply, mutate = core.PromptServer.instance.routes, core.reply, core.mutate

    @routes.get('/qwen-cn/projects')
    async def listing(r):
        return reply(projects.list(r.query.get('deleted') == 'true'))

    @routes.post('/qwen-cn/projects')
    async def create(r):
        mutate(r)
        return reply(projects.create(await r.json()), 201)

    @routes.get('/qwen-cn/projects/{project_id}')
    async def get(r):
        return reply(projects.get(r.match_info['project_id']))

    @routes.get('/qwen-cn/projects/{project_id}/search')
    async def search(r):
        return reply(projects.search_chats(r.match_info['project_id'], r.query.get('q', '')))

    @routes.patch('/qwen-cn/projects/{project_id}')
    async def patch(r):
        mutate(r)
        return reply(projects.patch(r.match_info['project_id'], await r.json()))

    @routes.delete('/qwen-cn/projects/{project_id}')
    async def delete(r):
        mutate(r)
        data = await r.json()
        if data.get('confirm') is not True:
            raise ValueError('Confirm moving the project and its chats to trash.')
        projects.trash(r.match_info['project_id'], data.get('version'))
        return reply({'deleted': True, 'recoverable': True})

    @routes.post('/qwen-cn/projects/{project_id}/restore')
    async def restore(r):
        mutate(r)
        return reply(projects.restore(r.match_info['project_id'], (await r.json()).get('version')))

    @routes.get('/qwen-cn/chats/{chat_id}/project')
    async def membership(r):
        core.STORE.chat(r.match_info['chat_id'])
        return reply(projects.membership(r.match_info['chat_id']))

    @routes.patch('/qwen-cn/chats/{chat_id}/project')
    async def move(r):
        mutate(r)
        data = await r.json()
        if 'project_id' not in data:
            raise ValueError('Missing project_id')
        return reply(projects.move(r.match_info['chat_id'], data['project_id'], data.get('version')))

    @routes.post('/qwen-cn/projects/{project_id}/sources')
    async def upload(r):
        project_id = r.match_info['project_id']
        projects.get(project_id)
        if r.content_type == 'application/json':
            data = await r.json()
            text = data.get('text')
            if not isinstance(text, str):
                raise ValueError('Missing source text')
            name = str(data.get('name') or 'Note')
            if not name.endswith('.txt'):
                name += '.txt'
            return reply(projects.add_source(project_id, name, text.encode('utf-8'), 'note'), 201)
        if not r.content_type.startswith('multipart/'):
            raise web.HTTPUnsupportedMediaType()
        reader = await r.multipart()
        part = await reader.next()
        if part is None or part.name != 'file' or not part.filename:
            raise ValueError('Missing file')
        content = bytearray()
        while True:
            chunk = await part.read_chunk()
            if not chunk:
                break
            content.extend(chunk)
            if len(content) > MAX_FILE_BYTES:
                raise ValueError('文件不能超过 10 MB。 / Maximum file size is 10 MB.')
        # Parsing a PDF must not block streaming responses or the UI event loop.
        item = await asyncio.to_thread(projects.add_source, project_id, part.filename, bytes(content))
        return reply(item, 201)

    @routes.get('/qwen-cn/projects/{project_id}/sources')
    async def sources(r):
        return reply(projects.sources(r.match_info['project_id'], r.query.get('deleted') == 'true'))

    @routes.get('/qwen-cn/projects/{project_id}/sources/{source_id}')
    async def source(r):
        return reply(projects.source(r.match_info['project_id'], r.match_info['source_id']))

    @routes.get('/qwen-cn/projects/{project_id}/sources/{source_id}/download')
    async def download(r):
        item = projects.source(r.match_info['project_id'], r.match_info['source_id'], True)
        # Active HTML/code is always downloaded, never executed on the app origin.
        return web.Response(body=item['content'], headers={
            'Content-Type': 'application/octet-stream', 'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store', 'Content-Disposition': "attachment; filename*=UTF-8''" + quote(item['name'], safe='')})

    @routes.delete('/qwen-cn/projects/{project_id}/sources/{source_id}')
    async def remove_source(r):
        mutate(r)
        projects.remove_source(r.match_info['project_id'], r.match_info['source_id'])
        return reply({'deleted': True, 'recoverable': True})

    @routes.post('/qwen-cn/projects/{project_id}/sources/{source_id}/restore')
    async def restore_source(r):
        mutate(r)
        projects.remove_source(r.match_info['project_id'], r.match_info['source_id'], True)
        return reply({'restored': True})

    @routes.get('/qwen-cn/projects/{project_id}/memory')
    async def memory(r):
        project = projects.get(r.match_info['project_id'])
        if project['memory_mode'] != 'project-only':
            return reply(core.MEMORY.snapshot())
        return reply(projects.scoped_memory(project['id']).snapshot())

    @routes.delete('/qwen-cn/projects/{project_id}/memory/{memory_id}')
    async def delete_memory(r):
        mutate(r)
        project = projects.get(r.match_info['project_id'])
        if project['memory_mode'] != 'project-only':
            raise ValueError('Use Settings to manage shared saved memories.')
        data = await r.json()
        projects.scoped_memory(project['id']).delete(r.match_info['memory_id'], version=data.get('version'))
        return reply({'deleted': True})

    @routes.post('/qwen-cn/projects/{project_id}/memory')
    async def add_memory(r):
        mutate(r)
        project_id = r.match_info['project_id']
        project = projects.get(project_id)
        if project['memory_mode'] != 'project-only':
            raise ValueError('Use Settings to manage shared saved memories.')
        data = await r.json()
        message = core.STORE.message(data.get('message_id'))
        if projects.membership(message['chat_id'])['project_id'] != project_id:
            raise KeyError(message['id'])
        return reply(projects.scoped_memory(project_id).put(data.get('content'), category='note', source='manual', chat_id=message['chat_id'], message_id=message['id']), 201)

    @routes.patch('/qwen-cn/projects/{project_id}/memory/preferences')
    async def memory_preferences(r):
        mutate(r)
        project = projects.get(r.match_info['project_id'])
        if project['memory_mode'] != 'project-only':
            raise ValueError('Use Settings to manage shared saved memories.')
        data = await r.json()
        memory = projects.scoped_memory(project['id'])
        memory.configure({'enabled': data.get('enabled')}, preferences_version=data.get('preferences_version'))
        return reply(memory.snapshot())
