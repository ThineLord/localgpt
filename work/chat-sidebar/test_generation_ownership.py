"""APP-03 protocol acceptance using only fresh synthetic SQLite and local children.

No model, production path, socket, or deployment is used. Each child is bounded
and reaped, including deliberate SIGKILL fault injection.
"""
import asyncio
from contextlib import contextmanager
import json
import os
from pathlib import Path
import select
import signal
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from generation_ownership import GenerationLock, OwnershipUnavailable, readiness, reconcile
from storage import Store, Conflict


CHILD = r'''
import json, os, sqlite3, sys, time
from contextlib import contextmanager
from pathlib import Path
from storage import Store
from generation_ownership import GenerationLock, reconcile
path, chat, mode = sys.argv[1:]
def emit(value):
    print(json.dumps(value), flush=True)
def pause():
    emit({'paused': True})
    time.sleep(30)
    return 0
class PausingStore(Store):
    @contextmanager
    def connect(self, **kwargs):
        with super().connect(**kwargs) as db:
            db.create_function('test_pause', 0, pause)
            yield db
store = PausingStore(path)
if mode == 'race':
    emit({'ready': True})
    sys.stdin.readline()
owner = GenerationLock(path)
acquired = owner.acquire()
if not acquired:
    emit({'acquired': False})
    sys.exit(0)
if mode == 'reconcile':
    emit(reconcile(store))  # A second handle must see this owner's busy lock.
    store.reconcile_generation(owner)
    sys.exit(0)
message, created = store.reserve(chat, 'synthetic child', None, 512, 512, 25,
    'synthetic', 'child-' + mode, kind='routing', owner=owner)
if mode == 'terminal':
    store.update(message['id'], status='running', answer='committed partial')
    emit({'acquired': True, 'message': message['id'], 'nonce': owner.nonce})
    store.update(message['id'], status='completed', answer='uncommitted final', finished=time.time())
elif mode == 'wal':
    store.update(message['id'], answer='committed partial')
    db = sqlite3.connect(path)
    db.execute('BEGIN IMMEDIATE')
    db.execute("UPDATE messages SET answer='uncommitted partial' WHERE id=?", (message['id'],))
    emit({'acquired': True, 'message': message['id'], 'nonce': owner.nonce, 'uncommitted': True})
else:
    emit({'acquired': True, 'message': message['id'], 'nonce': owner.nonce})
time.sleep(30)
'''


class OwnershipTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='localgpt-app03-ownership-')
        self.root = Path(self.tmp.name)
        self.path = self.root / 'synthetic.sqlite3'
        self.store = Store(self.path)
        self.chat = self.store.create()['id']
        self.children = []
        self.owners = []

    def tearDown(self):
        for process in self.children:
            if process.poll() is None:
                process.kill()
            process.communicate(timeout=5)
            self.assertIsNotNone(process.returncode)
        for owner in self.owners:
            owner.close()
        self.tmp.cleanup()

    def owner(self, path=None):
        owner = GenerationLock(path or self.path)
        self.owners.append(owner)
        self.assertTrue(owner.acquire())
        return owner

    def reserve(self, owner=None, key='synthetic-key', kind='chat'):
        return self.store.reserve(self.chat, 'synthetic prompt', None, 512, 512,
            25, 'synthetic client', key, kind=kind, model='synthetic model',
            settings={'temperature': 0.5}, owner=owner)[0]

    def rows(self, table):
        with self.store.connect() as db:
            return [dict(row) for row in db.execute('SELECT * FROM ' + table)]

    def trigger(self, sql):
        with self.store.connect() as db:
            db.execute(sql)

    def child(self, mode):
        env = dict(os.environ, PYTHONPATH=str(Path(__file__).resolve().parent))
        process = subprocess.Popen([sys.executable, '-u', '-c', CHILD,
            str(self.path), self.chat, mode], stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0, env=env)
        self.children.append(process)
        return process

    def output(self, process):
        readable, _, _ = select.select([process.stdout], [], [], 8)
        self.assertTrue(readable, 'child readiness timeout')
        line = process.stdout.readline()
        self.assertTrue(line, 'child exited before emitting evidence')
        return json.loads(line)

    def kill(self, process):
        process.kill()
        process.communicate(timeout=5)
        self.assertEqual(process.returncode, -signal.SIGKILL)

    def integrity(self):
        with self.store.connect() as db:
            self.assertEqual(db.execute('PRAGMA journal_mode').fetchone()[0], 'wal')
            self.assertEqual(db.execute('PRAGMA quick_check').fetchone()[0], 'ok')
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_atomic_owner_insert_abort_preserves_message_and_chat(self):
        owner = self.owner()
        before = self.store.chat(self.chat)
        self.trigger("CREATE TRIGGER reject_owner BEFORE INSERT ON generation_owners BEGIN SELECT RAISE(ABORT,'synthetic owner insert'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.reserve(owner)
        self.assertEqual(self.rows('messages'), [])
        self.assertEqual(self.rows('generation_owners'), [])
        self.assertEqual(self.store.chat(self.chat), before)
        self.integrity()

    def test_atomic_terminal_and_owner_retirement_rollback(self):
        owner = self.owner()
        message = self.reserve(owner)
        before = self.store.chat(self.chat)
        self.trigger("CREATE TRIGGER reject_retirement BEFORE DELETE ON generation_owners BEGIN SELECT RAISE(ABORT,'synthetic retirement'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.update(message['id'], status='completed', answer='synthetic final')
        self.assertEqual(self.store.chat(self.chat), before)
        self.assertEqual(len(self.rows('generation_owners')), 1)
        self.trigger('DROP TRIGGER reject_retirement')
        self.store.update(message['id'], status='completed', answer='synthetic final')
        self.assertEqual(self.rows('generation_owners'), [])

    def test_recovery_is_atomic_idempotent_and_preserves_payloads(self):
        completed = self.reserve(self.owner(), 'completed-sentinel')
        self.store.update(completed['id'], status='completed', answer='finished synthetic', reasoning='reason', memory_json='{"saved": ["synthetic"]}')
        self.owners[-1].close()
        sentinel = self.store.message(completed['id'])
        owner = self.owner()
        active = self.reserve(owner)
        self.store.update(active['id'], status='running', answer='committed partial', reasoning='partial reasoning', memory_json='{"used": ["synthetic"]}')
        before = self.store.message(active['id'])
        owner.close()
        self.assertEqual(readiness(self.store)['generation_recovery_state'], 'recovery_required')
        self.trigger("CREATE TRIGGER reject_receipt BEFORE INSERT ON generation_recoveries BEGIN SELECT RAISE(ABORT,'synthetic receipt'); END")
        self.assertEqual(reconcile(self.store)['generation_recovery_state'], 'unavailable')
        self.assertEqual(self.store.message(active['id']), before)
        self.assertEqual(len(self.rows('generation_owners')), 1)
        self.assertEqual(self.rows('generation_recoveries'), [])
        self.trigger('DROP TRIGGER reject_receipt')
        self.assertEqual(reconcile(self.store)['recovered'], 1)
        after = self.store.message(active['id'])
        for key in before.keys() - {'status', 'finished', 'phase', 'error'}:
            self.assertEqual(after[key], before[key], key)
        self.assertEqual(after['status'], 'failed')
        self.assertEqual(self.store.message(completed['id']), sentinel)
        receipt = self.rows('generation_recoveries')
        self.assertEqual(receipt[0]['owner_nonce'], owner.nonce)
        self.assertEqual(receipt[0]['previous_status'], 'running')
        self.assertEqual(receipt[0]['reason'], 'owner_exited')
        self.assertFalse({'prompt', 'answer'} & receipt[0].keys())
        self.assertEqual(reconcile(self.store)['recovered'], 0)
        self.assertEqual(self.rows('generation_recoveries'), receipt)
        self.assertEqual(self.store.message(active['id']), after)
        self.integrity()

    def test_same_process_and_other_process_live_owner_protection_then_sigkill(self):
        process = self.child('hold')
        evidence = self.output(process)
        before = self.store.message(evidence['message'])
        self.assertEqual(reconcile(self.store)['generation_recovery_state'], 'busy')
        self.assertEqual(self.store.message(evidence['message']), before)
        contender = GenerationLock(self.path)
        self.assertFalse(contender.acquire())
        self.kill(process)
        self.assertEqual(reconcile(self.store)['recovered'], 1)
        self.assertEqual(self.store.message(evidence['message'])['status'], 'failed')
        owner = self.owner()
        contender = GenerationLock(self.path)
        self.assertFalse(contender.acquire())
        owner.close()
        self.assertTrue(contender.acquire())
        contender.close()

    def test_two_process_contenders_exactly_one_reserves(self):
        first, second = self.child('race'), self.child('race')
        self.assertTrue(self.output(first)['ready'])
        self.assertTrue(self.output(second)['ready'])
        for process in (first, second):
            process.stdin.write(b'go\n'); process.stdin.flush()
        evidence = [self.output(first), self.output(second)]
        self.assertEqual(sum(item['acquired'] for item in evidence), 1)
        self.assertEqual(len(self.rows('messages')), 1)
        self.assertEqual(len(self.rows('generation_owners')), 1)
        self.assertEqual(reconcile(self.store)['generation_recovery_state'], 'busy')

    def test_unknown_legacy_owner_even_old_age_is_never_recovered(self):
        message = self.reserve()
        self.store.update(message['id'], answer='legacy still writing')
        with self.store.connect() as db:
            db.execute('UPDATE messages SET created=0 WHERE id=?', (message['id'],))
        before = self.store.message(message['id'])
        self.assertEqual(reconcile(self.store)['generation_recovery_state'], 'ownership_unknown')
        self.assertEqual(self.store.message(message['id']), before)
        self.store.update(message['id'], answer='legacy writer continued')
        self.assertEqual(reconcile(self.store)['generation_recovery_state'], 'ownership_unknown')
        self.assertEqual(self.store.message(message['id'])['answer'], 'legacy writer continued')
        with self.assertRaises(Conflict):
            self.reserve(key='other-key')

    def test_unknown_protocol_nonce_and_same_handle_fail_closed(self):
        owner = self.owner()
        message = self.reserve(owner)
        self.assertEqual(self.store.reconcile_generation(owner)['generation_recovery_state'], 'ownership_unknown')
        owner.close()
        for field, value in [('protocol_version', 99), ('owner_nonce', 'not-a-nonce'), ('database_inode', -1), ('lock_inode', -1)]:
            with self.subTest(field=field):
                with self.store.connect() as db:
                    original = db.execute('SELECT '+field+' FROM generation_owners').fetchone()[0]
                    db.execute('UPDATE generation_owners SET '+field+'=?', (value,))
                self.assertEqual(reconcile(self.store)['generation_recovery_state'], 'ownership_unknown')
                self.assertEqual(self.store.message(message['id'])['status'], 'submitting')
                with self.store.connect() as db:
                    db.execute('UPDATE generation_owners SET '+field+'=?', (original,))

    def test_lock_path_alias_and_replacement_do_not_recover_live_owner(self):
        owner = self.owner()
        message = self.reserve(owner)
        alias = self.root / 'alias.sqlite3'
        alias.symlink_to(self.path)
        contender = GenerationLock(alias)
        self.assertFalse(contender.acquire())
        owner.path.rename(self.root / 'held-lock')
        self.assertEqual(reconcile(self.store)['generation_recovery_state'], 'ownership_unknown')
        self.assertEqual(self.store.message(message['id'])['status'], 'submitting')
        with self.assertRaises(OwnershipUnavailable):
            owner.validate(self.path)

    def test_lock_symlink_unsafe_mode_and_hardlinks_rejected(self):
        lock_path = self.path.with_name(self.path.name + '.generation.lock')
        target = self.root / 'target'
        target.write_text('synthetic')
        lock_path.symlink_to(target)
        self.assertEqual(reconcile(self.store)['generation_recovery_state'], 'unavailable')
        lock_path.unlink()
        lock_path.write_text(''); lock_path.chmod(0o644)
        self.assertEqual(reconcile(self.store)['generation_recovery_state'], 'unavailable')
        lock_path.chmod(0o600)
        os.link(lock_path, self.root / 'lock-hardlink')
        self.assertEqual(reconcile(self.store)['generation_recovery_state'], 'unavailable')
        (self.root / 'lock-hardlink').unlink()
        os.link(self.path, self.root / 'db-hardlink')
        self.assertEqual(reconcile(self.store)['generation_recovery_state'], 'unavailable')

    def test_image_handoff_retires_owner_without_recovering_image(self):
        owner = self.owner()
        message = self.reserve(owner, kind='routing')
        self.store.update(message['id'], kind='image', phase='submitted image')
        self.assertEqual(self.rows('generation_owners'), [])
        owner.close()
        for status in ('submitting', 'running'):
            self.store.update(message['id'], status=status)
            before = self.store.message(message['id'])
            self.assertEqual(reconcile(self.store)['recovered'], 0)
            self.assertEqual(self.store.message(message['id']), before)
            with self.assertRaises(Conflict):
                self.reserve(key='image-still-blocks')

    def test_additive_schema_preserves_legacy_rows_and_columns(self):
        message = self.reserve()
        before = self.store.chat(self.chat)
        with self.store.connect() as db:
            columns = [tuple(row) for row in db.execute('PRAGMA table_info(messages)')]
            db.execute('DROP TABLE generation_recoveries')
            db.execute('DROP TABLE generation_owners')
        self.store = Store(self.path)
        self.assertEqual(self.store.chat(self.chat), before)
        with self.store.connect() as db:
            self.assertEqual([tuple(row) for row in db.execute('PRAGMA table_info(messages)')], columns)
        self.assertEqual(reconcile(self.store)['generation_recovery_state'], 'ownership_unknown')
        self.assertEqual(self.store.message(message['id'])['status'], 'submitting')
        self.integrity()

    def test_additive_schema_second_create_failure_rolls_back_first(self):
        self.reserve()
        before = self.store.chat(self.chat)
        with self.store.connect() as db:
            db.execute('DROP TABLE generation_recoveries')
            db.execute('DROP TABLE generation_owners')
        connect = sqlite3.connect

        def denied_connect(*args, **kwargs):
            db = connect(*args, **kwargs)
            def authorize(action, first, second, database, source):
                if action == sqlite3.SQLITE_CREATE_TABLE and first == 'generation_recoveries':
                    return sqlite3.SQLITE_DENY
                return sqlite3.SQLITE_OK
            db.set_authorizer(authorize)
            return db

        with patch('storage.sqlite3.connect', side_effect=denied_connect):
            with self.assertRaises(sqlite3.DatabaseError):
                Store(self.path)
        with self.store.connect() as db:
            tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertNotIn('generation_owners', tables)
        self.assertNotIn('generation_recoveries', tables)
        self.assertEqual(self.store.chat(self.chat), before)
        self.store = Store(self.path)
        self.assertEqual(self.store.chat(self.chat), before)
        self.assertEqual(reconcile(self.store)['generation_recovery_state'], 'ownership_unknown')
        self.integrity()

    def test_kill_during_owner_insert_rolls_back_entire_reservation(self):
        before = self.store.chat(self.chat)
        self.trigger('CREATE TRIGGER pause_owner BEFORE INSERT ON generation_owners BEGIN SELECT test_pause(); END')
        process = self.child('reserve-kill')
        self.assertTrue(self.output(process)['paused'])
        self.kill(process)
        self.assertEqual(self.store.chat(self.chat), before)
        self.assertEqual(self.rows('generation_owners'), [])
        self.trigger('DROP TRIGGER pause_owner')
        self.integrity()

    def test_kill_during_reconciliation_rolls_back_then_recovers_once(self):
        owner = self.owner()
        message = self.reserve(owner)
        owner.close()
        before = self.store.chat(self.chat)
        self.trigger("CREATE TRIGGER pause_recovery AFTER UPDATE OF status ON messages WHEN NEW.status='failed' BEGIN SELECT test_pause(); END")
        process = self.child('reconcile')
        self.assertEqual(self.output(process)['generation_recovery_state'], 'busy')
        self.assertTrue(self.output(process)['paused'])
        self.kill(process)
        self.assertEqual(self.store.chat(self.chat), before)
        self.assertEqual(len(self.rows('generation_owners')), 1)
        self.assertEqual(self.rows('generation_recoveries'), [])
        self.trigger('DROP TRIGGER pause_recovery')
        self.assertEqual(reconcile(self.store)['recovered'], 1)
        self.assertEqual(reconcile(self.store)['recovered'], 0)
        self.assertEqual(self.store.message(message['id'])['status'], 'failed')
        self.integrity()

    def test_sqlite_writer_lock_fails_closed_then_recovers_after_release(self):
        owner = self.owner()
        message = self.reserve(owner)
        self.store.update(message['id'], answer='committed partial')
        owner.close()
        before = self.store.chat(self.chat)
        before_owners = self.rows('generation_owners')
        connect = self.store.connect
        @contextmanager
        def short_timeout(**kwargs):
            with connect(**kwargs) as db:
                db.execute('PRAGMA busy_timeout=10')
                yield db
        blocker = sqlite3.connect(self.path)
        try:
            blocker.execute('BEGIN IMMEDIATE')
            with patch.object(self.store, 'connect', short_timeout):
                self.assertEqual(reconcile(self.store)['generation_recovery_state'], 'unavailable')
                self.assertEqual(readiness(self.store)['generation_recovery_state'], 'recovery_required')
                self.assertEqual(self.store.chat(self.chat), before)
                self.assertEqual(self.rows('generation_owners'), before_owners)
                self.assertEqual(self.rows('generation_recoveries'), [])
                check_owner = self.owner()
                check_owner.close()
        finally:
            blocker.rollback()
            blocker.close()
        self.assertEqual(reconcile(self.store)['recovered'], 1)
        self.assertEqual(self.store.message(message['id'])['status'], 'failed')
        self.assertEqual(self.store.message(message['id'])['answer'], 'committed partial')
        self.integrity()

    def test_sigkill_before_terminal_commit_rolls_back_and_preserves_completed(self):
        owner = self.owner()
        completed = self.reserve(owner, key='completed-terminal-sentinel')
        self.store.update(completed['id'], status='completed', answer='synthetic finished', finished=123)
        owner.close()
        sentinel = self.store.message(completed['id'])
        self.trigger("CREATE TRIGGER pause_terminal AFTER UPDATE OF status ON messages WHEN NEW.status='completed' BEGIN SELECT test_pause(); END")
        process = self.child('terminal')
        evidence = self.output(process)
        self.assertTrue(self.output(process)['paused'])
        self.assertEqual(self.store.message(evidence['message'])['status'], 'running')
        self.assertEqual(len(self.rows('generation_owners')), 1)
        self.kill(process)
        rolled_back = self.store.message(evidence['message'])
        self.assertEqual(rolled_back['status'], 'running')
        self.assertEqual(rolled_back['answer'], 'committed partial')
        self.assertIsNone(rolled_back['finished'])
        self.assertEqual(len(self.rows('generation_owners')), 1)
        self.trigger('DROP TRIGGER pause_terminal')
        self.assertEqual(reconcile(self.store)['recovered'], 1)
        self.assertEqual(self.store.message(evidence['message'])['status'], 'failed')
        self.assertEqual(self.store.message(evidence['message'])['answer'], 'committed partial')
        self.assertEqual(self.store.message(completed['id']), sentinel)
        self.integrity()

    def test_sigkill_preserves_uncheckpointed_wal_and_rolls_back_uncommitted(self):
        keeper = sqlite3.connect(self.path)
        self.addCleanup(keeper.close)
        keeper.execute('PRAGMA wal_autocheckpoint=0')
        keeper.execute('BEGIN')
        keeper.execute('SELECT count(*) FROM messages').fetchone()
        process = self.child('wal')
        evidence = self.output(process)
        wal = Path(str(self.path) + '-wal')
        self.assertTrue(wal.exists())
        self.assertGreater(wal.stat().st_size, 32)
        self.kill(process)
        self.assertEqual(self.store.message(evidence['message'])['answer'], 'committed partial')
        self.assertEqual(reconcile(self.store)['recovered'], 1)
        self.assertEqual(self.store.message(evidence['message'])['answer'], 'committed partial')
        self.integrity()


class CancellationTests(unittest.IsolatedAsyncioTestCase):
    setUp = OwnershipTests.setUp
    tearDown = OwnershipTests.tearDown
    owner = OwnershipTests.owner
    reserve = OwnershipTests.reserve
    rows = OwnershipTests.rows

    async def test_cancel_before_first_coroutine_instruction_retires_owner(self):
        import lm_chat
        owner = self.owner()
        message = self.reserve(owner)
        entered = []
        async def never_started():
            entered.append(True)
            await asyncio.Event().wait()
        task = asyncio.create_task(never_started())
        lm_chat.CHAT_TASKS[message['id']] = task
        core = SimpleNamespace(STORE=self.store)
        task.add_done_callback(lambda done: lm_chat.finish_task(core, message['id'], owner, done))
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        self.assertTrue(task.cancelled())
        self.assertEqual(entered, [])
        self.assertEqual(self.store.message(message['id'])['status'], 'stopped')
        self.assertEqual(self.rows('generation_owners'), [])
        self.assertNotIn(message['id'], lm_chat.CHAT_TASKS)
        replacement = self.owner()
        replacement.close()

    async def test_task_creation_failure_releases_lock_and_next_reconcile_recovers(self):
        import lm_chat
        handlers = {}
        class Routes:
            def route(self, path):
                def register(handler):
                    handlers[path] = handler
                    return handler
                return register
            get = post = route
        core = SimpleNamespace(STORE=self.store, SUBMIT_LOCK=asyncio.Lock(), Conflict=Conflict,
            mutate=lambda request: None, reply=lambda body, status=200: (body, status),
            clean_draft=lambda body: dict(body, size='512,512', quality='25', reference=None),
            PromptServer=SimpleNamespace(instance=SimpleNamespace(routes=Routes())))
        lm_chat.install(core)
        async def body():
            return {'prompt': 'synthetic task failure', 'request_key': 'synthetic-task-failure', 'mode': 'chat'}
        request = SimpleNamespace(json=body, match_info={'chat_id': self.chat})
        unstarted = []
        def reject_task(coroutine):
            unstarted.append(coroutine)
            raise RuntimeError('synthetic create_task failure')
        try:
            with patch.object(lm_chat.asyncio, 'create_task', side_effect=reject_task):
                with self.assertRaisesRegex(RuntimeError, 'synthetic create_task failure'):
                    await handlers['/qwen-cn/chats/{chat_id}/send'](request)
        finally:
            # asyncio.create_task failures leave caller-owned unstarted coroutines.
            # Close the injected coroutine in this harness to avoid an unrelated warning.
            for coroutine in unstarted:
                coroutine.close()
        self.assertEqual(len(unstarted), 1)
        self.assertEqual(len(self.store.active()), 1)
        self.assertEqual(len(self.rows('generation_owners')), 1)
        self.assertEqual(lm_chat.CHAT_TASKS, {})
        self.assertEqual(reconcile(self.store)['recovered'], 1)
        self.assertEqual(self.store.active(), [])
        self.assertEqual(self.rows('generation_owners'), [])
        self.assertEqual(self.rows('messages')[0]['status'], 'failed')


if __name__ == '__main__':
    unittest.main()
