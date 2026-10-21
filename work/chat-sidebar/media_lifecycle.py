"""Explicit, retryable media deletion. Never scans or cleans the media directories.

SQLite rows remain until unlink succeeds. A durable journal survives an unlink or
commit failure; retrying the same operation accepts an already missing file.
Writers must reject references found in media_deletions (all states), inside their
write transaction. This is not secure erasure of filesystem snapshots or backups.
"""
import json
import os
from pathlib import Path, PurePosixPath
import stat
import time
import uuid
import unicodedata

from storage import Conflict


def canonical(image):
    if not isinstance(image, dict):
        raise ValueError('图片描述无效。')
    kind = image.get('type', 'output')
    name, folder = image.get('filename', ''), image.get('subfolder', '') or ''
    if kind not in ('input', 'output') or not isinstance(name, str) or not isinstance(folder, str):
        raise ValueError('图片描述无效。')
    if not name or name in ('.', '..') or '/' in name or '\\' in name or '\x00' in name:
        raise ValueError('图片文件名无效。')
    if '\\' in folder or '\x00' in folder or PurePosixPath(folder).is_absolute() or '..' in folder.split('/'):
        raise ValueError('图片目录无效。')
    folder = str(PurePosixPath(folder)) if folder else ''
    if folder == '.': folder = ''
    return {'type': kind, 'subfolder': folder, 'filename': name}


def key(image):
    value = canonical(image)
    # Compare conservatively across case-insensitive and normalization-insensitive
    # filesystems. Keep original descriptors for actual filesystem operations.
    return tuple(unicodedata.normalize('NFC', value[k]).casefold() for k in ('type', 'subfolder', 'filename'))


class MediaLifecycle:
    def __init__(self, store, input_root, output_root):
        self.store = store
        self.input_root, self.output_root = Path(input_root).resolve(), Path(output_root).resolve()
        with store.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS owned_uploads(id TEXT PRIMARY KEY,payload TEXT NOT NULL,created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS media_trash(id TEXT PRIMARY KEY,payload TEXT NOT NULL,deleted REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS media_deletions(id TEXT PRIMARY KEY,payload TEXT NOT NULL,state TEXT NOT NULL,error TEXT);
            ''')

    def _active(self, db):
        if db.execute("SELECT 1 FROM messages WHERE status IN ('running','submitting') LIMIT 1").fetchone():
            raise Conflict('仍有生成任务，请完成或停止后再永久删除。')

    def _path(self, image, *, owned_input=False):
        image = canonical(image)
        if image['type'] != 'output' and not owned_input:
            raise ValueError('仅能永久删除应用记录中的生成图片；参考图原文件保留。')
        base = self.input_root if image['type'] == 'input' else self.output_root
        path = base
        for part in (*PurePosixPath(image['subfolder']).parts, image['filename']):
            path = path / part
            try: mode = path.lstat().st_mode
            except FileNotFoundError: continue
            if stat.S_ISLNK(mode): raise ValueError('不能删除符号链接或其目录中的图片。')
        if not path.is_relative_to(base): raise ValueError('图片超出管理目录。')
        try: mode = path.lstat().st_mode
        except FileNotFoundError: return path
        if not stat.S_ISREG(mode): raise ValueError('图片目标不是普通文件。')
        return path

    def _unlink(self, image, *, owned_input=False, expected_fingerprint=None):
        """Open each directory without following symlinks, avoiding a path-swap race."""
        image = canonical(image)
        self._path(image, owned_input=owned_input)
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
        fd = os.open(self.input_root if image['type'] == 'input' else self.output_root, flags)
        try:
            for part in PurePosixPath(image['subfolder']).parts:
                try: next_fd = os.open(part, flags, dir_fd=fd)
                except FileNotFoundError: return False
                os.close(fd); fd = next_fd
            try: info = os.stat(image['filename'], dir_fd=fd, follow_symlinks=False)
            except FileNotFoundError: return False
            if not stat.S_ISREG(info.st_mode): raise ValueError('图片目标不是普通文件。')
            if expected_fingerprint is not None and self._fingerprint(info) != expected_fingerprint:
                raise Conflict('上传文件已变化，未自动清理。')
            os.unlink(image['filename'], dir_fd=fd)
            return True
        finally: os.close(fd)

    def _refs(self, db, image, *, messages=(), images=(), chats=(), archives=(), trash=()):
        target, refs = key(image), set()
        def add(value, owner):
            if value and isinstance(value, dict) and value.get('filename'):
                if key(value) == target: refs.add(owner)
        for row in db.execute('SELECT id,chat_id,image_json,reference_json,image_deleted FROM messages'):
            if row['id'] in messages: continue
            if row['id'] not in images and not row['image_deleted']:
                add(json.loads(row['image_json'] or 'null'), 'image:' + row['id'])
            add(json.loads(row['reference_json'] or 'null'), 'reference:' + row['id'])
        for row in db.execute('SELECT id,draft FROM chats'):
            if row['id'] not in chats: add(json.loads(row['draft']).get('reference'), 'draft:' + row['id'])
        for row in db.execute('SELECT id,payload FROM gallery_archive'):
            if row['id'] not in archives:
                payload = json.loads(row['payload'])
                add(payload.get('image'), 'archive:' + row['id'])
                add(payload.get('reference'), 'archive-reference:' + row['id'])
        for row in db.execute('SELECT id,payload FROM media_trash'):
            if row['id'] not in trash:
                payload = json.loads(row['payload'])
                add(payload.get('image'), 'trash:' + row['id'])
                add(payload.get('reference'), 'trash-reference:' + row['id'])
        return len(refs)

    def _item(self, db, message_id):
        row = db.execute('SELECT m.*,c.title AS chat_title,c.deleted_at AS chat_deleted FROM messages m JOIN chats c ON c.id=m.chat_id WHERE m.id=? AND m.image_json IS NOT NULL AND m.image_deleted=0', (message_id,)).fetchone()
        if row: return self.store._message(row)
        row = db.execute('SELECT payload FROM gallery_archive WHERE id=?', (message_id,)).fetchone()
        if row: return json.loads(row['payload'])
        raise KeyError(message_id)

    @property
    def upload_receipt_dir(self):
        return self.store.path.parent / 'hanzagent-upload-recovery'

    @staticmethod
    def _fingerprint(info):
        return [info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns]

    def _receipt_path(self, receipt_id):
        if not isinstance(receipt_id, str) or len(receipt_id) != 32 or any(c not in '0123456789abcdef' for c in receipt_id):
            raise ValueError('上传恢复标识无效。')
        folder = self.upload_receipt_dir
        if folder.is_symlink(): raise ValueError('上传恢复目录不能是符号链接。')
        return folder / (receipt_id + '.json')

    def _write_upload_receipt(self, receipt):
        path = self._receipt_path(receipt['id'])
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        temporary = path.parent / (receipt['id'] + '.' + uuid.uuid4().hex + '.tmp')
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(fd, 'w') as file:
                json.dump(receipt, file, ensure_ascii=False); file.flush(); os.fsync(file.fileno())
            os.replace(temporary, path)
            directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try: os.fsync(directory)
            finally: os.close(directory)
        finally:
            if temporary.exists(): temporary.unlink()

    def _read_upload_receipt(self, receipt_id):
        path = self._receipt_path(receipt_id)
        try: fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        except FileNotFoundError: raise KeyError(receipt_id)
        with os.fdopen(fd) as file:
            if os.fstat(file.fileno()).st_size > 8192: raise ValueError('上传恢复收据无效。')
            receipt = json.load(file)
        image = canonical(receipt['image'])
        expected = 'hanz-ref-' + receipt_id
        if receipt.get('id') != receipt_id or image['type'] != 'input' or image['subfolder'] != 'hanzagent' or image['filename'] not in [expected + ext for ext in ('.png', '.jpg', '.jpeg', '.webp')]:
            raise ValueError('上传恢复收据无效。')
        return receipt

    def begin_upload(self, extension):
        """Persist intent outside SQLite BEFORE ComfyUI can create the new file."""
        if extension not in ('.png', '.jpg', '.jpeg', '.webp'): raise ValueError('不支持的图片格式。')
        receipt_id = uuid.uuid4().hex
        image = {'type': 'input', 'subfolder': 'hanzagent', 'filename': 'hanz-ref-' + receipt_id + extension}
        path = self._path(image, owned_input=True)
        if path.exists(): raise Conflict('上传文件名冲突，未发送上传请求。')
        receipt = {'id': receipt_id, 'image': image, 'created': time.time(), 'state': 'pending'}
        self._write_upload_receipt(receipt)
        return receipt

    def confirm_upload(self, receipt_id, image):
        receipt = self._read_upload_receipt(receipt_id)
        if canonical(image) != receipt['image']:
            raise Conflict('上传服务返回的文件名不符，未自动登记或删除。')
        path = self._path(receipt['image'], owned_input=True)
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode): raise ValueError('上传文件不是普通文件。')
        receipt.update(state='received', fingerprint=self._fingerprint(info))
        self._write_upload_receipt(receipt)

    def note_upload_failure(self, receipt_id, state):
        # The original pending receipt already survives if a later disk write fails.
        try:
            receipt = self._read_upload_receipt(receipt_id)
            receipt['state'] = state
            self._write_upload_receipt(receipt)
        except OSError: pass

    def upload_recovery_list(self):
        items = []
        if not self.upload_receipt_dir.exists(): return {'items': items}
        if self.upload_receipt_dir.is_symlink(): raise ValueError('上传恢复目录不能是符号链接。')
        for path in sorted(self.upload_receipt_dir.glob('*.json')):
            receipt = self._read_upload_receipt(path.stem)
            try: present = self._path(receipt['image'], owned_input=True).is_file()
            except (OSError, ValueError): present = None
            items.append({k: receipt[k] for k in ('id', 'image', 'created', 'state')} | {'file_present': present})
        return {'items': items}

    def recover_upload(self, receipt_id):
        """Explicit action only. No remote request, content scan, or automatic retry."""
        receipt = self._read_upload_receipt(receipt_id)
        path = self._path(receipt['image'], owned_input=True)
        if not path.is_file(): raise Conflict('上传文件尚不存在，结果仍未确认；请稍后重试登记。')
        if receipt.get('fingerprint') and self._fingerprint(path.lstat()) != receipt['fingerprint']:
            raise Conflict('上传文件已变化，未登记其他文件。')
        registered = self.register_upload(receipt['image'])
        retained = False
        try: self._receipt_path(receipt_id).unlink()
        except OSError: retained = True  # Registration succeeded; receipt cleanup can be retried safely.
        return {**registered, 'receipt_retained': retained}

    def rollback_upload(self, receipt_id):
        """Rollback only a confirmed, unchanged UUID file owned by this request."""
        receipt = self._read_upload_receipt(receipt_id)
        if receipt.get('state') != 'received' or not receipt.get('fingerprint'):
            raise Conflict('上传结果尚未确认，未自动删除文件。')
        image = receipt['image']
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if self._refs(db, image): raise Conflict('上传文件已有引用，未自动删除。')
            for row in db.execute('SELECT payload FROM owned_uploads'):
                if key(json.loads(row['payload'])) == key(image): raise Conflict('上传文件已登记，未自动删除。')
            removed = self._unlink(image, owned_input=True, expected_fingerprint=receipt['fingerprint'])
        self._receipt_path(receipt_id).unlink()
        return {'rolled_back': True, 'deleted_files': int(removed)}

    def register_upload(self, image):
        """Called only by the successful HanzAgent upload pipeline, never a scan."""
        image = canonical(image)
        if image['type'] != 'input': raise ValueError('只能登记通过应用上传的参考图。')
        if not self._path(image, owned_input=True).is_file(): raise ValueError('上传的参考图不存在。')
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            for row in db.execute('SELECT payload FROM media_deletions'):
                if any(key(v) == key(image) for v in json.loads(row['payload'])['images']):
                    raise Conflict('此文件名已经用于删除操作，请重新上传为新文件名。')
            for row in db.execute('SELECT id,payload FROM owned_uploads'):
                if key(json.loads(row['payload'])) == key(image): return {'id': row['id'], 'image': image}
            upload_id = str(uuid.uuid4())
            db.execute('INSERT INTO owned_uploads VALUES(?,?,?)', (upload_id, json.dumps(image), time.time()))
        return {'id': upload_id, 'image': image}

    def list_uploads(self):
        with self.store.connect() as db:
            items = []
            for row in db.execute('SELECT * FROM owned_uploads ORDER BY created DESC'):
                image = json.loads(row['payload'])
                items.append({'id': row['id'], 'image': image, 'created': row['created'],
                              'reference_count': self._refs(db, image)})
        return {'items': items}

    def purge_upload(self, upload_id, confirm=True):
        if confirm is not True: raise ValueError('需要确认永久删除参考图文件。')
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE'); self._active(db)
            row = db.execute('SELECT payload FROM owned_uploads WHERE id=?', (upload_id,)).fetchone()
            if not row: raise KeyError(upload_id)
            image = canonical(json.loads(row['payload']))
            if image['type'] != 'input': raise ValueError('上传记录无效。')
            self._path(image, owned_input=True)
            refs = self._refs(db, image)
            if refs: raise Conflict(f'参考图仍有 {refs} 处有效引用，不能永久删除。')
            jid = self._journal(db, 'upload', upload_id, [image])
        try:
            with self.store.connect() as db:
                db.execute('BEGIN IMMEDIATE'); self._active(db)
                current = db.execute('SELECT payload FROM owned_uploads WHERE id=?', (upload_id,)).fetchone()
                if not current or key(json.loads(current['payload'])) != key(image):
                    raise Conflict('上传记录已经变化，未执行删除。')
                refs = self._refs(db, image)
                if refs: raise Conflict(f'参考图仍有 {refs} 处有效引用，不能永久删除。')
                removed = self._unlink(image, owned_input=True)
                db.execute('DELETE FROM owned_uploads WHERE id=?', (upload_id,))
                db.execute("UPDATE media_deletions SET state='complete',error=NULL WHERE id=?", (jid,))
        except Exception as error:
            self._failed(jid, error); raise
        return {'deleted': True, 'deleted_files': int(removed), 'already_missing': int(not removed),
                'retained_shared': 0, 'retained_inputs': 0}

    def trash_image(self, message_id):
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            item = self._item(db, message_id)
            if item['status'] != 'completed': raise Conflict('图片尚未生成完成。')
            canonical(item['image'])
            db.execute('INSERT OR IGNORE INTO media_trash VALUES(?,?,?)', (message_id, json.dumps(item, ensure_ascii=False), time.time()))
        return {'deleted': True, 'recoverable': True, 'file_retained': True, 'chat_image_retained': True}

    def restore_image(self, message_id):
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute("SELECT 1 FROM media_deletions WHERE id=? AND state!='complete'", ('image:' + message_id,)).fetchone():
                raise Conflict('此图片有未完成的永久删除，请先重试该操作。')
            row = db.execute('SELECT payload FROM media_trash WHERE id=?', (message_id,)).fetchone()
            if not row: raise KeyError(message_id)
            target = key(json.loads(row['payload'])['image'])
            for operation in db.execute("SELECT payload FROM media_deletions WHERE state!='complete'"):
                if any(key(image) == target for image in json.loads(operation['payload'])['images']):
                    raise Conflict('此图片有未完成的永久删除，请先重试该操作。')
            db.execute('DELETE FROM media_trash WHERE id=?', (message_id,))
        return {'restored': True}

    def trash_list(self):
        with self.store.connect() as db:
            items = [dict(json.loads(r['payload']), trashed_at=r['deleted']) for r in db.execute('SELECT * FROM media_trash ORDER BY deleted DESC')]
            operations = [dict(r) for r in db.execute("SELECT id,state,error FROM media_deletions WHERE state!='complete'")]
        return {'items': items, 'pending_deletions': operations}

    def _journal(self, db, operation, target, images):
        jid = operation + ':' + target
        planned = {key(v) for v in images}
        for other in db.execute("SELECT id,payload FROM media_deletions WHERE state!='complete' AND id!=?", (jid,)):
            if planned.intersection(key(v) for v in json.loads(other['payload'])['images']):
                raise Conflict('关联图片有另一项未完成的删除，请先重试原操作。')
        payload = json.dumps({'operation': operation, 'target': target, 'images': images})
        existing = db.execute('SELECT payload FROM media_deletions WHERE id=?', (jid,)).fetchone()
        if existing:
            # Once deletion starts its target set must never expand on retry.
            old = {key(v) for v in json.loads(existing['payload'])['images']}
            if {key(v) for v in images} != old: raise Conflict('删除范围已经变化，请检查引用后重试。')
            db.execute("UPDATE media_deletions SET state='pending',error=NULL WHERE id=?", (jid,))
        else: db.execute('INSERT INTO media_deletions VALUES(?,?,?,NULL)', (jid, payload, 'pending'))
        return jid

    def _failed(self, jid, error):
        with self.store.connect() as db:
            db.execute("UPDATE media_deletions SET state='failed',error=? WHERE id=?", (type(error).__name__ + ': 删除未完成，请检查文件权限或引用后重试。', jid))

    def _validate_image_target(self, db, message_id, image):
        current = self._item(db, message_id)
        if key(current['image']) != key(image):
            raise Conflict('图片记录已经变化，未执行删除。')

    def purge_image(self, message_id, confirm=True):
        if confirm is not True: raise ValueError('需要确认永久删除图片。')
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE'); self._active(db)
            row = db.execute('SELECT payload FROM media_trash WHERE id=?', (message_id,)).fetchone()
            if not row: raise KeyError(message_id)
            image = canonical(json.loads(row['payload'])['image']); self._path(image)
            self._validate_image_target(db, message_id, image)
            refs = self._refs(db, image, images={message_id}, archives={message_id}, trash={message_id})
            if refs: raise Conflict(f'图片仍有 {refs} 处有效引用，不能永久删除。')
            jid = self._journal(db, 'image', message_id, [image])
        try:
            with self.store.connect() as db:
                db.execute('BEGIN IMMEDIATE'); self._active(db)
                self._validate_image_target(db, message_id, image)
                refs = self._refs(db, image, images={message_id}, archives={message_id}, trash={message_id})
                if refs: raise Conflict(f'图片仍有 {refs} 处有效引用，不能永久删除。')
                removed = self._unlink(image)
                db.execute('UPDATE chats SET version=version+1 WHERE id IN (SELECT chat_id FROM messages WHERE id=?)', (message_id,))
                db.execute('UPDATE messages SET image_json=NULL,image_deleted=1 WHERE id=?', (message_id,))
                db.execute('DELETE FROM gallery_archive WHERE id=?', (message_id,))
                db.execute('DELETE FROM media_trash WHERE id=?', (message_id,))
                db.execute('INSERT OR IGNORE INTO removed_sources VALUES(?)', (image['subfolder'] + '/' + image['filename'],))
                db.execute("UPDATE media_deletions SET state='complete',error=NULL WHERE id=?", (jid,))
        except Exception as error:
            self._failed(jid, error); raise
        return {'deleted': True, 'deleted_files': int(removed), 'already_missing': int(not removed), 'retained_shared': 0, 'retained_inputs': 0}

    def _chat_plan(self, db, chat_id, *, validate_media=True):
        self._active(db)
        chat = db.execute('SELECT * FROM chats WHERE id=?', (chat_id,)).fetchone()
        if not chat: raise KeyError(chat_id)
        if chat['deleted_at'] is None: raise Conflict('只能永久删除回收站里的对话。')
        rows = db.execute('SELECT * FROM messages WHERE chat_id=?', (chat_id,)).fetchall()
        ids, owned, inputs = {r['id'] for r in rows}, {}, set()
        for value in [json.loads(chat['draft']).get('reference')] + [json.loads(r['reference_json'] or 'null') for r in rows]:
            if value and value.get('filename') and value.get('type', 'output') == 'input':
                inputs.add(json.dumps(value, sort_keys=True))
        for row in rows:
            if row['image_json']:
                raw = json.loads(row['image_json'])
                # Record-only deletion never needs to resolve or validate files.
                image = canonical(raw) if validate_media else raw
                if image.get('type', 'output') == 'output':
                    owned[json.dumps(image, sort_keys=True)] = image
                else: inputs.add(json.dumps(image, sort_keys=True))
        if not validate_media: return chat, rows, list(owned.values()), [], inputs
        deletable, shared = [], []
        for image in owned.values():
            self._path(image)
            refs = self._refs(db, image, messages=ids, chats={chat_id}, archives=ids, trash=ids)
            (shared if refs else deletable).append(image)
        return chat, rows, deletable, shared, inputs

    def _remove_chat_rows(self, db, chat, rows, deleted_keys=()):
        for row in rows:
            if row['source_key']: db.execute('INSERT OR IGNORE INTO purged_imports VALUES(?)', (row['source_key'],))
            image = json.loads(row['image_json'] or 'null')
            image_key = None
            if image:
                try:
                    desc = canonical(image); image_key = key(desc)
                except ValueError:
                    if deleted_keys: raise
                else:
                    db.execute('INSERT OR IGNORE INTO removed_sources VALUES(?)', (desc['subfolder'] + '/' + desc['filename'],))
            if image and image_key in deleted_keys:
                db.execute('DELETE FROM gallery_archive WHERE id=?', (row['id'],))
                db.execute('DELETE FROM media_trash WHERE id=?', (row['id'],))
            elif image and not row['image_deleted'] and row['status'] == 'completed':
                item = self.store._message(row)
                item.update(chat_id=None, chat_title='已删除对话', chat_deleted=True, chat_purged=True,
                            answer='', reasoning='', settings={}, reference=None, memory={}, prompt='已保留的图片')
                payload = json.dumps(item, ensure_ascii=False)
                db.execute('INSERT OR REPLACE INTO gallery_archive VALUES(?,?)', (row['id'], payload))
                db.execute('UPDATE media_trash SET payload=? WHERE id=?', (payload, row['id']))
        db.execute('DELETE FROM messages WHERE chat_id=?', (chat['id'],))
        db.execute('DELETE FROM chats WHERE id=?', (chat['id'],))
        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_memory'").fetchone():
            db.execute('UPDATE user_memory SET chat_id=NULL,message_id=NULL WHERE chat_id=?', (chat['id'],))

    def purge_chat(self, chat_id, include_media=False):
        if not isinstance(include_media, bool): raise ValueError('删除范围无效。')
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            chat, rows, files, shared, inputs = self._chat_plan(db, chat_id, validate_media=include_media)
            pending = db.execute("SELECT 1 FROM media_deletions WHERE id=? AND state!='complete'", ('chat:' + chat_id,)).fetchone()
            if pending and not include_media:
                raise Conflict('此对话有未完成的媒体删除，请使用原删除范围重试。')
            if not include_media:
                targets = set()
                for image in files + shared:
                    try: targets.add(key(image))
                    except ValueError: pass
                for operation in db.execute("SELECT payload FROM media_deletions WHERE state!='complete'"):
                    if targets.intersection(key(v) for v in json.loads(operation['payload'])['images']):
                        raise Conflict('关联图片有未完成的删除，请先重试原操作。')
                self._remove_chat_rows(db, chat, rows)
                return {'deleted': True, 'images_retained': True, 'deleted_files': 0,
                        'retained_shared': len(shared), 'retained_images': len(files) + len(shared), 'retained_inputs': len(inputs)}
            jid = self._journal(db, 'chat', chat_id, files)
        try:
            with self.store.connect() as db:
                db.execute('BEGIN IMMEDIATE')
                chat, rows, checked, shared, inputs = self._chat_plan(db, chat_id)
                if {key(v) for v in checked} != {key(v) for v in files}: raise Conflict('图片引用已变化，未继续删除；请重试。')
                removed = sum(self._unlink(image) for image in files)
                self._remove_chat_rows(db, chat, rows, {key(v) for v in files})
                db.execute("UPDATE media_deletions SET state='complete',error=NULL WHERE id=?", (jid,))
        except Exception as error:
            self._failed(jid, error); raise
        return {'deleted': True, 'deleted_files': removed, 'already_missing': len(files) - removed,
                'retained_shared': len(shared), 'retained_inputs': len(inputs), 'images_retained': bool(shared)}
