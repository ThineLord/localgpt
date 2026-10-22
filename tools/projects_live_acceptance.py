#!/usr/bin/env python3
"""One real local-model turn against a disposable Projects database.

Uses the production send/events path, a random fact found only in an uploaded
source, and a project instruction. No production data is read or modified.
The normal model loader may load the app's local model with its existing TTL.
"""
import asyncio
import json
from pathlib import Path
import sys
import tempfile
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'work' / 'chat-sidebar'))
from aiohttp.test_utils import TestClient, TestServer
from serve import create_app


async def main():
    with tempfile.TemporaryDirectory(prefix='localgpt-project-live-') as folder:
        root = Path(folder)
        (root / 'input').mkdir(); (root / 'output').mkdir()
        client = TestClient(TestServer(create_app(database=root / 'test.sqlite3',
                           input_root=root / 'input', output_root=root / 'output')))
        await client.start_server()
        message = None
        try:
            async def api(method, path, data=None):
                response = await client.request(method, '/qwen-cn' + path, json=data)
                result = await response.json()
                if response.status >= 400:
                    raise AssertionError((response.status, result))
                return result

            nonce = 'ORBIT-' + uuid.uuid4().hex[:10].upper()
            project = await api('POST', '/projects', {
                'name': 'Disposable live acceptance', 'memory_mode': 'project-only',
                'instructions': 'Begin every answer with PROJECT-CHECK. Answer in English. Cite the source filename.'})
            source = await api('POST', '/projects/' + project['id'] + '/sources', {
                'name': 'launch-brief.txt', 'text': 'Synthetic acceptance record. The launch code is ' + nonce + '. The workshop budget is 452 DKK.'})
            chat = await api('POST', '/chats', {'project_id': project['id']})
            message = await api('POST', '/chats/' + chat['id'] + '/send', {
                'prompt': 'What is the launch code and workshop budget in the source?',
                'mode': 'chat', 'model': 'qwen3-8b', 'thinking': 'off',
                'temperature': 0, 'max_tokens': 256, 'request_key': uuid.uuid4().hex})
            events = await client.get('/qwen-cn/messages/' + message['id'] + '/events')
            await asyncio.wait_for(events.read(), 180)
            saved = await api('GET', '/chats/' + chat['id'])
            final = next(m for m in saved['messages'] if m['id'] == message['id'])
            checks = {
                'completed': final['status'] == 'completed',
                'source_fact': nonce in final.get('answer', ''),
                'budget': '452' in final.get('answer', ''),
                'project_instruction': final.get('answer', '').lstrip().startswith('PROJECT-CHECK'),
                'source_provenance': source['id'] in (final.get('memory') or {}).get('project', {}).get('source_ids', []),
            }
            print(json.dumps({'checks': checks, 'answer': final.get('answer'),
                              'status': final['status'], 'error': final.get('error'),
                              'model': 'qwen3-8b', 'synthetic_source': True,
                              'real_local_inference': True}, indent=2))
            if not all(checks.values()):
                raise AssertionError('Live Projects acceptance failed')
        finally:
            if message:
                await client.post('/qwen-cn/messages/' + message['id'] + '/stop', json={})
            await client.close()


if __name__ == '__main__':
    asyncio.run(main())
