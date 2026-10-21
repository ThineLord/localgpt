import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from media_lifecycle import MediaLifecycle, canonical
from generation import clean_draft
from memory_store import MemoryStore
from storage import Store, Conflict


class MediaLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.input, self.output = self.root / 'input', self.root / 'output'
        self.input.mkdir(); self.output.mkdir()
        self.store = Store(self.root / 'test.sqlite3')
        self.memory = MemoryStore(self.store.path)
        self.media = MediaLifecycle(self.store, self.input, self.output)
        self.serial = 0

    def tearDown(self): self.tmp.cleanup()

    def image(self, filename='image.png', subfolder=''):
        path = self.output / subfolder / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'synthetic image bytes')
        return {'filename': filename, 'subfolder': subfolder, 'type': 'output'}

    def message(self, image=None, reference=None, chat=None):
        self.serial += 1
        chat = chat or self.store.create('Synthetic chat')
        message, _ = self.store.reserve(chat['id'], 'Synthetic prompt', reference, 512, 512, 15, 'test', 'request-' + str(self.serial))
        self.store.update(message['id'], status='completed', image_json=json.dumps(image) if image else None)
        return chat, self.store.message(message['id'])

    def journal(self, jid):
        with self.store.connect() as db:
            return dict(db.execute('SELECT * FROM media_deletions WHERE id=?', (jid,)).fetchone())

    def test_trash_restore_leaves_chat_and_file_intact(self):
        image = self.image(); chat, message = self.message(image)
        self.media.trash_image(message['id'])
        self.assertEqual(self.media.trash_list()['items'][0]['id'], message['id'])
        self.assertEqual(self.store.message(message['id'])['image'], image)
        self.assertTrue((self.output / 'image.png').exists())
        self.media.restore_image(message['id'])
        self.assertEqual(self.media.trash_list()['items'], [])
        with self.assertRaises(KeyError): self.media.purge_image(message['id'])

    def test_shared_reordered_json_and_trashed_chat_protect_file(self):
        image = self.image(); chat, first = self.message(image)
        reordered = {'type': 'output', 'filename': 'image.png', 'subfolder': ''}
        other, second = self.message(reordered)
        self.store.trash(other['id']); self.media.trash_image(first['id'])
        with self.assertRaises(Conflict): self.media.purge_image(first['id'])
        self.assertTrue((self.output / 'image.png').exists())
        self.assertIsNotNone(self.store.message(first['id'])['image'])

    def test_draft_and_message_reference_protect_file(self):
        image = self.image(); chat, first = self.message(image)
        other = self.store.create('Synthetic draft')
        self.store.patch(other['id'], 0, draft={'reference': image})
        self.media.trash_image(first['id'])
        with self.assertRaises(Conflict): self.media.purge_image(first['id'])
        self.store.patch(other['id'], 1, draft={})
        ref_chat, ref_msg = self.message(reference=image)
        with self.assertRaises(Conflict): self.media.purge_image(first['id'])
        self.store.trash(ref_chat['id']); self.media.purge_chat(ref_chat['id'])
        result = self.media.purge_image(first['id'])
        self.assertEqual(result['deleted_files'], 1)
        self.assertFalse((self.output / 'image.png').exists())
        self.assertIsNone(self.store.message(first['id'])['image'])
        self.assertEqual(self.journal('image:' + first['id'])['state'], 'complete')

    def test_active_generation_and_confirmation_are_guarded(self):
        image = self.image(); chat, first = self.message(image)
        self.media.trash_image(first['id'])
        with self.assertRaises(ValueError): self.media.purge_image(first['id'], confirm=False)
        other = self.store.create('Synthetic task')
        self.store.reserve(other['id'], 'Synthetic task', None, 512, 512, 15, 'test', 'active-key')
        with self.assertRaises(Conflict): self.media.purge_image(first['id'])
        self.assertTrue((self.output / 'image.png').exists())

    def test_unlink_failure_retains_retry_target_and_durable_journal(self):
        image = self.image(); chat, first = self.message(image)
        self.media.trash_image(first['id'])
        with patch.object(self.media, '_unlink', side_effect=PermissionError('synthetic failure')):
            with self.assertRaises(PermissionError): self.media.purge_image(first['id'])
        self.assertEqual(self.journal('image:' + first['id'])['state'], 'failed')
        self.assertIsNotNone(self.store.message(first['id'])['image'])
        with self.assertRaises(Conflict): self.media.restore_image(first['id'])
        (self.output / 'image.png').unlink()  # Simulate unlink succeeded but DB commit did not.
        result = self.media.purge_image(first['id'])
        self.assertEqual(result['deleted_files'], 0)
        self.assertEqual(result['already_missing'], 1)
        self.assertEqual(self.media.trash_list()['pending_deletions'], [])

    def test_missing_file_and_changed_record(self):
        image = self.image(); chat, first = self.message(image)
        self.media.trash_image(first['id'])
        other = self.image('other.png')
        self.store.update(first['id'], image_json=json.dumps(other))
        with self.assertRaises(Conflict): self.media.purge_image(first['id'])
        self.assertTrue((self.output / 'other.png').exists())
        self.store.update(first['id'], image_json=json.dumps(image))
        (self.output / 'image.png').unlink()
        self.assertEqual(self.media.purge_image(first['id'])['already_missing'], 1)

    def test_path_traversal_symlinks_directories_and_input_rejected(self):
        for desc in ({'filename': '../secret'}, {'filename': 'x', 'subfolder': '../escape'},
                     {'filename': 'x', 'subfolder': '/absolute'}, {'filename': 'x', 'subfolder': 'a/../../b'}):
            with self.assertRaises(ValueError): canonical(desc)
        outside = self.root / 'outside'; outside.mkdir(); (outside / 'secret.png').write_bytes(b'preserve')
        (self.output / 'link').symlink_to(outside, target_is_directory=True)
        (self.output / 'direct.png').symlink_to(outside / 'secret.png')
        (self.output / 'directory.png').mkdir()
        for desc in ({'filename': 'secret.png', 'subfolder': 'link'}, {'filename': 'direct.png'},
                     {'filename': 'directory.png'}, {'filename': 'x.png', 'type': 'input'}):
            with self.assertRaises(ValueError): self.media._path(desc)
        self.assertEqual((outside / 'secret.png').read_bytes(), b'preserve')

    def test_purge_chat_retains_images_and_independent_memory_by_default(self):
        image = self.image(); chat, first = self.message(image)
        item = self.memory.put('Synthetic preference', source='manual', chat_id=chat['id'], message_id=first['id'])
        self.store.trash(chat['id']); result = self.media.purge_chat(chat['id'])
        self.assertTrue(result['images_retained'])
        self.assertTrue((self.output / 'image.png').exists())
        self.assertEqual(self.store.gallery()['total'], 1)
        saved = self.memory.list()[0]
        self.assertEqual(saved['id'], item['id']); self.assertIsNone(saved['chat_id']); self.assertIsNone(saved['message_id'])
        with self.assertRaises(KeyError): self.store.chat(chat['id'])

    def test_purge_chat_only_unshared_output_and_keep_input(self):
        own = self.image('own.png'); shared = self.image('shared.png')
        reference = {'filename': 'upload.png', 'type': 'input'}
        (self.input / 'upload.png').write_bytes(b'synthetic reference')
        chat, first = self.message(own, reference)
        _, second = self.message(shared, chat=chat)
        other, third = self.message(shared)
        self.store.trash(chat['id']); result = self.media.purge_chat(chat['id'], include_media=True)
        self.assertEqual(result['deleted_files'], 1)
        self.assertEqual(result['retained_shared'], 1)
        self.assertEqual(result['retained_inputs'], 1)
        self.assertFalse((self.output / 'own.png').exists())
        self.assertTrue((self.output / 'shared.png').exists())
        self.assertTrue((self.input / 'upload.png').exists())
        self.assertEqual(self.store.message(third['id'])['image'], shared)
        self.store.update(third['id'], image_json=json.dumps(shared))  # Shared retained media is not tombstoned.
        journal = json.loads(self.journal('chat:' + chat['id'])['payload'])
        self.assertEqual(journal['images'], [own])

    def test_partial_chat_file_failure_is_visible_and_retryable(self):
        first_image = self.image('first.png'); second_image = self.image('second.png')
        chat, first = self.message(first_image)
        _, second = self.message(second_image, chat=chat)
        self.store.trash(chat['id'])
        real_unlink = self.media._unlink
        count = 0
        def fail_second(image):
            nonlocal count
            count += 1
            if count == 2: raise PermissionError('synthetic failure')
            return real_unlink(image)
        with patch.object(self.media, '_unlink', side_effect=fail_second):
            with self.assertRaises(PermissionError): self.media.purge_chat(chat['id'], include_media=True)
        self.assertEqual(len(self.store.chat(chat['id'])['messages']), 2)
        self.assertEqual(self.journal('chat:' + chat['id'])['state'], 'failed')
        with self.assertRaises(Conflict): self.media.purge_chat(chat['id'], include_media=False)
        result = self.media.purge_chat(chat['id'], include_media=True)
        self.assertEqual(result['deleted_files'], 1); self.assertEqual(result['already_missing'], 1)
        self.assertFalse((self.output / 'first.png').exists()); self.assertFalse((self.output / 'second.png').exists())

    def test_archive_reference_protected_and_trashed_payload_scrubbed_on_chat_purge(self):
        image = self.image(); chat, first = self.message(image)
        self.media.trash_image(first['id']); self.store.trash(chat['id'])
        self.media.purge_chat(chat['id'])
        payload = self.media.trash_list()['items'][0]
        self.assertEqual(payload['prompt'], '已保留的图片'); self.assertIsNone(payload['chat_id'])
        self.assertEqual(self.media.purge_image(first['id'])['deleted_files'], 1)
        self.assertEqual(self.store.gallery()['total'], 0)

    def test_registered_upload_delete_and_unowned_input_rejected(self):
        image = {'filename': 'owned.png', 'type': 'input'}
        (self.input / 'owned.png').write_bytes(b'synthetic uploaded input')
        (self.input / 'unowned.png').write_bytes(b'synthetic legacy input')
        with self.assertRaises(KeyError): self.media.purge_upload('unowned.png')
        with self.assertRaises(ValueError): self.media._unlink({'filename': 'unowned.png', 'type': 'input'})
        upload = self.media.register_upload(image)
        self.assertEqual(self.media.register_upload(image)['id'], upload['id'])
        listing = self.media.list_uploads()['items']
        self.assertEqual(len(listing), 1); self.assertEqual(listing[0]['reference_count'], 0)
        self.assertEqual(set(listing[0]), {'id', 'image', 'created', 'reference_count'})
        with self.assertRaises(ValueError): self.media.purge_upload(upload['id'], confirm=False)
        result = self.media.purge_upload(upload['id'])
        self.assertEqual(result['deleted_files'], 1)
        self.assertFalse((self.input / 'owned.png').exists())
        self.assertTrue((self.input / 'unowned.png').exists())
        self.assertEqual(self.media.list_uploads()['items'], [])
        self.assertEqual(self.journal('upload:' + upload['id'])['state'], 'complete')

    def test_registered_upload_references_and_trashed_messages_block_delete(self):
        image = {'filename': 'owned.png', 'type': 'input'}
        (self.input / 'owned.png').write_bytes(b'synthetic upload')
        upload = self.media.register_upload(image)
        chat = self.store.create('Synthetic draft')
        self.store.patch(chat['id'], 0, draft={'reference': image})
        self.assertEqual(self.media.list_uploads()['items'][0]['reference_count'], 1)
        with self.assertRaises(Conflict): self.media.purge_upload(upload['id'])
        self.store.patch(chat['id'], 1, draft={})
        other, message = self.message(reference=image)
        self.store.trash(other['id'])
        with self.assertRaises(Conflict): self.media.purge_upload(upload['id'])
        self.media.purge_chat(other['id'])
        self.assertEqual(self.media.purge_upload(upload['id'])['deleted_files'], 1)

    def test_registered_upload_failure_is_durable_and_retryable(self):
        image = {'filename': 'owned.png', 'type': 'input'}
        (self.input / 'owned.png').write_bytes(b'synthetic upload')
        upload = self.media.register_upload(image)
        with patch.object(self.media, '_unlink', side_effect=PermissionError('synthetic failure')):
            with self.assertRaises(PermissionError): self.media.purge_upload(upload['id'])
        self.assertEqual(self.journal('upload:' + upload['id'])['state'], 'failed')
        self.assertEqual(len(self.media.list_uploads()['items']), 1)
        (self.input / 'owned.png').unlink()
        self.assertEqual(self.media.purge_upload(upload['id'])['already_missing'], 1)

    def test_upload_registration_rejects_missing_output_symlink_and_tombstone(self):
        with self.assertRaises(ValueError): self.media.register_upload(self.image())
        with self.assertRaises(ValueError): self.media.register_upload({'type': 'input', 'filename': 'missing.png'})
        outside = self.root / 'outside.png'; outside.write_bytes(b'synthetic preserve')
        (self.input / 'linked.png').symlink_to(outside)
        with self.assertRaises(ValueError): self.media.register_upload({'type': 'input', 'filename': 'linked.png'})
        image = {'filename': 'owned.png', 'type': 'input'}
        (self.input / 'owned.png').write_bytes(b'synthetic upload')
        upload = self.media.register_upload(image); self.media.purge_upload(upload['id'])
        (self.input / 'owned.png').write_bytes(b'synthetic replacement')
        with self.assertRaises(Conflict): self.media.register_upload(image)
        self.assertEqual(outside.read_bytes(), b'synthetic preserve')

    def test_record_only_purge_preserves_invalid_or_symlinked_media(self):
        outside = self.root / 'outside.png'; outside.write_bytes(b'preserve')
        (self.output / 'linked.png').symlink_to(outside)
        for image in ({'filename': 'linked.png'}, {'filename': 'outside.png', 'subfolder': '../'}):
            chat, message = self.message()
            # Emulate a preexisting legacy descriptor without validating it as a new upload.
            with self.store.connect() as db:
                db.execute('UPDATE messages SET image_json=? WHERE id=?', (json.dumps(image), message['id']))
            self.store.trash(chat['id'])
            with self.assertRaises(ValueError): self.media.purge_chat(chat['id'], include_media=True)
            result = self.media.purge_chat(chat['id'], include_media=False)
            self.assertTrue(result['images_retained']); self.assertEqual(result['deleted_files'], 0)
        self.assertEqual(outside.read_bytes(), b'preserve')
        self.assertTrue((self.output / 'linked.png').is_symlink())

    def test_upload_archive_and_media_trash_references_are_protected(self):
        image = {'filename': 'owned.png', 'type': 'input'}
        (self.input / 'owned.png').write_bytes(b'synthetic upload')
        upload = self.media.register_upload(image)
        for table in ('gallery_archive', 'media_trash'):
            with self.store.connect() as db:
                payload = json.dumps({'image': {'filename': 'other.png'}, 'reference': image})
                if table == 'gallery_archive': db.execute('INSERT INTO gallery_archive VALUES(?,?)', ('synthetic', payload))
                else: db.execute('INSERT INTO media_trash VALUES(?,?,?)', ('synthetic', payload, 1))
            with self.assertRaises(Conflict): self.media.purge_upload(upload['id'])
            with self.store.connect() as db: db.execute('DELETE FROM ' + table + ' WHERE id=?', ('synthetic',))
        self.assertEqual(self.media.purge_upload(upload['id'])['deleted_files'], 1)

    def test_prevalidated_path_alias_cannot_bypass_later_deletion(self):
        image = self.image('fixture.png')
        (self.output / 'alias').mkdir()
        source, message = self.message(image)
        target = self.store.create('Synthetic target')
        alias = {**image, 'subfolder': 'alias/..'}
        # Simulate validation in one request before another request unlinks it.
        validated = clean_draft({'reference': alias}, self.input, self.output)
        self.media.trash_image(message['id']); self.media.purge_image(message['id'])
        with self.assertRaises(ValueError): self.store.patch(target['id'], 0, draft=validated)
        with self.assertRaises(Conflict): self.store.patch(target['id'], 0, draft={'reference': image})
        self.assertEqual(self.store.chat(target['id'])['draft'], {})
        self.assertFalse((self.output / 'fixture.png').exists())

    def test_store_rejects_unsafe_references_without_journal_table(self):
        store = Store(self.root / 'before-media.sqlite3')
        chat = store.create('Synthetic pre-migration chat')
        with store.connect() as db:
            self.assertIsNone(db.execute("SELECT name FROM sqlite_master WHERE name='media_deletions'").fetchone())
        for image in ({'filename': '../secret'}, {'filename': '/absolute'},
                      {'filename': 'image.png', 'subfolder': 'alias/..'},
                      {'filename': 'image.png', 'subfolder': '/absolute'},
                      {'filename': 'image.png', 'subfolder': 'alias\\nested'},
                      {'filename': 'image\\name.png'}, {'filename': 'image.png', 'type': 'temp'}):
            with self.subTest(image=image):
                with self.assertRaises(ValueError): store.patch(chat['id'], 0, draft={'reference': image})
                with self.assertRaises(ValueError): store.reserve(chat['id'], 'Synthetic', image, 512, 512, 15, 'test', 'unsafe-key')
        self.assertEqual(store.chat(chat['id'])['draft'], {})
        self.assertEqual(store.chat(chat['id'])['messages'], [])

    def test_completed_output_cannot_resurrect_permanently_deleted_path(self):
        image = self.image(); chat, message = self.message(image)
        self.media.trash_image(message['id']); self.media.purge_image(message['id'])
        with self.assertRaises(Conflict):
            self.store.update(message['id'], image_json=json.dumps(image), answer='must not persist')
        saved = self.store.message(message['id'])
        self.assertIsNone(saved['image']); self.assertEqual(saved['answer'], '')
        self.store.update(message['id'], image_json=None)

    def test_retained_gallery_images_remain_usable_after_record_only_purge(self):
        image = self.image(); chat, message = self.message(image)
        self.store.trash(chat['id']); self.media.purge_chat(chat['id'], include_media=False)
        # Retained media are not tombstoned and can be reused or republished.
        other, reused = self.message(image=image, reference=image)
        self.assertEqual(reused['image'], image)
        self.assertEqual(reused['reference'], image)
        draft_chat = self.store.create('Synthetic retained image draft')
        saved = self.store.patch(draft_chat['id'], 0, draft={'reference': image})
        self.assertEqual(saved['draft']['reference'], image)
        self.assertTrue((self.output / 'image.png').exists())

    def test_legacy_delete_methods_cannot_bypass_upgraded_lifecycle(self):
        image = self.image(); chat, message = self.message(image)
        reopened = Store(self.store.path)
        with self.assertRaisesRegex(Conflict, '8190'): reopened.delete_gallery(message['id'])
        self.store.trash(chat['id'])
        with self.assertRaisesRegex(Conflict, '8190'): reopened.purge(chat['id'])
        self.assertEqual(self.store.message(message['id'])['image'], image)
        self.assertTrue((self.output / 'image.png').exists())
        self.media.trash_image(message['id'])
        self.assertEqual(self.media.purge_image(message['id'])['deleted_files'], 1)
        self.assertTrue(self.media.purge_chat(chat['id'])['deleted'])

    def test_case_and_unicode_alias_drafts_protect_actual_output_name(self):
        cases = [
            ('Original.PNG', 'FolderA', 'original.png', 'foldera'),
            ('Résumé.PNG', 'AlbumÉ', 're\u0301sume\u0301.png', 'albume\u0301'),
        ]
        for filename, folder, alias_name, alias_folder in cases:
            with self.subTest(filename=filename):
                image = self.image(filename, folder)
                source, message = self.message(image)
                target = self.store.create('Synthetic alias draft')
                alias = {**image, 'filename': alias_name, 'subfolder': alias_folder}
                self.store.patch(target['id'], 0, draft={'reference': alias})
                self.media.trash_image(message['id'])
                disk_names = sorted(str(p.relative_to(self.output)) for p in self.output.rglob('*'))
                with self.assertRaises(Conflict): self.media.purge_image(message['id'])
                self.assertEqual(self.store.message(message['id'])['image'], image)
                self.assertEqual(canonical(image), image)
                self.assertEqual(sorted(str(p.relative_to(self.output)) for p in self.output.rglob('*')), disk_names)
                self.assertEqual((self.output / folder / filename).read_bytes(), b'synthetic image bytes')
                self.store.patch(target['id'], 1, draft={})
                self.media.purge_image(message['id'])
                journal = json.loads(self.journal('image:' + message['id'])['payload'])
                self.assertEqual(journal['images'], [image])  # Identity folding never renames a file.
                with self.assertRaises(Conflict): self.store.patch(target['id'], 2, draft={'reference': alias})
                with self.assertRaises(Conflict): self.store.update(message['id'], image_json=json.dumps(alias))
                with self.assertRaises(Conflict):
                    self.store.reserve(target['id'], 'Synthetic', alias, 512, 512, 15, 'test', 'alias-' + filename)
                self.assertFalse((self.output / folder / filename).exists())

    def test_upload_alias_references_and_tombstones_preserve_original_spelling(self):
        image = {'filename': 'Café.PNG', 'subfolder': 'UploadsÉ', 'type': 'input'}
        folder = self.input / image['subfolder']; folder.mkdir()
        path = folder / image['filename']; path.write_bytes(b'synthetic upload')
        upload = self.media.register_upload(image)
        self.assertEqual(upload['image'], image)
        target = self.store.create('Synthetic upload alias')
        alias = {'filename': 'cafe\u0301.png', 'subfolder': 'uploadse\u0301', 'type': 'input'}
        self.store.patch(target['id'], 0, draft={'reference': alias})
        self.assertEqual(self.media.list_uploads()['items'][0]['reference_count'], 1)
        with self.assertRaises(Conflict): self.media.purge_upload(upload['id'])
        self.assertEqual(path.read_bytes(), b'synthetic upload')
        self.assertEqual(self.media.list_uploads()['items'][0]['image'], image)
        self.store.patch(target['id'], 1, draft={})
        self.media.purge_upload(upload['id'])
        with self.assertRaises(Conflict): self.store.patch(target['id'], 2, draft={'reference': alias})
        journal = json.loads(self.journal('upload:' + upload['id'])['payload'])
        self.assertEqual(journal['images'], [image])
        self.assertFalse(path.exists())


if __name__ == '__main__': unittest.main()
