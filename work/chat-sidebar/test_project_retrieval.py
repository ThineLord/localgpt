"""Cached retrieval preserves source scope and keeps work off the event loop."""
import asyncio
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from project_store import ProjectStore, terms
from storage import Store


class RetrievalTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = Store(Path(self.temp.name) / 'synthetic.sqlite3')
        self.projects = ProjectStore(self.store)
        self.project = self.projects.create({'name': 'Synthetic retrieval'})
        self.chat = self.projects.create_chat('Synthetic question', self.project['id'])

    def add(self, name='source.txt', text='项目检索使用星环坐标。 Alpha calibration evidence. ' * 100):
        return self.projects.add_source(self.project['id'], name, text.encode())

    async def test_warm_index_does_not_retokenize_sources(self):
        source = self.add()
        with patch('project_store.terms', wraps=terms) as tokenize:
            _, body, meta = await self.projects.context_async(self.chat['id'], '星环坐标 calibration')
            self.assertEqual(tokenize.call_count, 1)  # The query, not every source chunk.
        self.assertIn('星环坐标', body)
        self.assertIn(source['id'], meta['source_ids'])
        self.assertLessEqual(len(json.loads(body)), 2)

    async def test_legacy_index_rebuild_is_atomic_and_preserves_source(self):
        source = self.add()
        before = self.projects.source(self.project['id'], source['id'], raw=True)
        with self.store.connect() as db:
            db.execute('DELETE FROM project_source_chunks')
            db.execute('DELETE FROM project_source_index')
        results = await asyncio.gather(*[self.projects.context_async(self.chat['id'], 'calibration') for _ in range(2)])
        self.assertTrue(all(source['id'] in result[2]['source_ids'] for result in results))
        self.assertEqual(self.projects.source(self.project['id'], source['id'], raw=True), before)
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM project_source_index').fetchone()[0], 1)
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')

    async def test_removed_restored_and_other_project_sources(self):
        source = self.add()
        other = self.projects.create({'name': 'Other project'})
        self.projects.add_source(other['id'], 'other.txt', b'PRIVATE-OTHER-PROJECT calibration')
        self.projects.remove_source(self.project['id'], source['id'])
        _, body, meta = await self.projects.context_async(self.chat['id'], 'calibration')
        self.assertEqual(body, '')
        self.assertEqual(meta['source_ids'], [])
        self.projects.remove_source(self.project['id'], source['id'], restore=True)
        _, body, meta = await self.projects.context_async(self.chat['id'], 'calibration')
        self.assertNotIn('PRIVATE-OTHER-PROJECT', body)
        self.assertEqual(meta['source_ids'], [source['id']])

    async def test_index_failure_rolls_back_source_and_cache(self):
        original = self.projects._index_source
        def broken(db, source_id, name, text):
            original(db, source_id, name, text)
            raise RuntimeError('Synthetic index write failure')
        with patch.object(self.projects, '_index_source', side_effect=broken):
            with self.assertRaises(RuntimeError):
                self.add()
        with self.store.connect() as db:
            for table in ['project_sources', 'project_source_chunks', 'project_source_terms', 'project_source_index']:
                self.assertEqual(db.execute('SELECT count(*) FROM ' + table).fetchone()[0], 0)

    async def test_async_retrieval_allows_heartbeat(self):
        started, release = threading.Event(), threading.Event()
        original = self.projects.context
        def delayed(*args, **kwargs):
            started.set()
            release.wait(2)
            return original(*args, **kwargs)
        with patch.object(self.projects, 'context', side_effect=delayed):
            job = asyncio.create_task(self.projects.context_async(self.chat['id'], 'calibration'))
            try:
                for _ in range(100):
                    if started.is_set():
                        break
                    await asyncio.sleep(.005)
                self.assertTrue(started.is_set())
                # If context ran synchronously, it would already have finished.
                self.assertFalse(job.done())
                await asyncio.sleep(.01)
            finally:
                release.set()
                await job
