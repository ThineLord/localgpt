"""Transactional local chat store. Images remain in ComfyUI input/output folders."""
from pathlib import Path, PurePosixPath
from contextlib import contextmanager
import json
import sqlite3
import time
import uuid
import unicodedata

class Conflict(Exception):
    pass

def _ensure_pin_schema(db):
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS chat_pin(
            chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
            pinned INTEGER NOT NULL DEFAULT 0,
            pin_version INTEGER NOT NULL DEFAULT 0,
            pinned_at REAL
        );
        """
    )


def _pin_row(db, chat_id):
    row = db.execute(
        "SELECT pinned, pin_version, pinned_at FROM chat_pin WHERE chat_id=?", (chat_id,)
    ).fetchone()
    if not row:
        return {"pinned": False, "pin_version": 0, "pinned_at": None}
    return {
        "pinned": bool(row["pinned"]),
        "pin_version": int(row["pin_version"]),
        "pinned_at": row["pinned_at"],
    }


def _attach_pin_fields(chat_dict, pin):
    chat_dict["pinned"] = pin["pinned"]
    chat_dict["pin_version"] = pin["pin_version"]
    return chat_dict


def _chats_order_sql():
    return """
        ORDER BY COALESCE(p.pinned, 0) DESC,
                 CASE WHEN COALESCE(p.pinned, 0) = 1 THEN p.pinned_at ELSE NULL END ASC,
                 c.updated DESC,
                 c.id
    """


class Store:
    def __init__(self, path, legacy=None):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect(create=True) as db:
            db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS chats(
                    id TEXT PRIMARY KEY, title TEXT NOT NULL, created REAL NOT NULL,
                    updated REAL NOT NULL, version INTEGER NOT NULL DEFAULT 0, draft_version INTEGER NOT NULL DEFAULT 0,
                    draft TEXT NOT NULL DEFAULT '{}');
                CREATE TABLE IF NOT EXISTS messages(
                    id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id),
                    prompt TEXT NOT NULL, reference_json TEXT, image_json TEXT,
                    status TEXT NOT NULL, prompt_id TEXT, client_id TEXT,
                    phase TEXT NOT NULL DEFAULT '准备生成', step INTEGER, total INTEGER,
                    created REAL NOT NULL, finished REAL, seconds REAL,
                    width INTEGER NOT NULL DEFAULT 512, height INTEGER NOT NULL DEFAULT 512,
                    steps INTEGER NOT NULL DEFAULT 25, error TEXT,
                    request_key TEXT UNIQUE, source_key TEXT UNIQUE);
                CREATE INDEX IF NOT EXISTS messages_chat ON messages(chat_id, created);
                CREATE INDEX IF NOT EXISTS messages_status ON messages(status);
            ''')
        with self.connect() as db:
            if 'deleted_at' not in {row['name'] for row in db.execute('PRAGMA table_info(chats)')}:
                db.execute('ALTER TABLE chats ADD COLUMN deleted_at REAL')
        with self.connect() as db:
            columns = {r['name'] for r in db.execute('PRAGMA table_info(messages)')}
            for name, definition in {'kind':"TEXT NOT NULL DEFAULT 'image'", 'answer':"TEXT NOT NULL DEFAULT ''", 'reasoning':"TEXT NOT NULL DEFAULT ''", 'model':"TEXT NOT NULL DEFAULT ''", 'settings_json':"TEXT NOT NULL DEFAULT '{}'"}.items():
                if name not in columns:
                    db.execute(f'ALTER TABLE messages ADD COLUMN {name} {definition}')
        with self.connect() as db:
            columns = {r['name'] for r in db.execute('PRAGMA table_info(messages)')}
            if 'image_deleted' not in columns:db.execute('ALTER TABLE messages ADD COLUMN image_deleted INTEGER NOT NULL DEFAULT 0')
            if 'memory_json' not in columns:db.execute("ALTER TABLE messages ADD COLUMN memory_json TEXT NOT NULL DEFAULT '{}' ")
            db.executescript('CREATE TABLE IF NOT EXISTS gallery_archive(id TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS removed_sources(source TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS purged_imports(source TEXT PRIMARY KEY);')
            _ensure_pin_schema(db)
        # Additive protocol schema: all DDL is one transaction, no legacy rows adopted.
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute("""CREATE TABLE IF NOT EXISTS generation_owners(
                message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
                owner_nonce TEXT NOT NULL, protocol_version INTEGER NOT NULL,
                database_device INTEGER NOT NULL, database_inode INTEGER NOT NULL,
                lock_device INTEGER NOT NULL, lock_inode INTEGER NOT NULL,
                acquired_at REAL NOT NULL)""")
            db.execute("""CREATE TABLE IF NOT EXISTS generation_recoveries(
                message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
                owner_nonce TEXT NOT NULL, protocol_version INTEGER NOT NULL,
                previous_status TEXT NOT NULL, recovered_at REAL NOT NULL,
                reason TEXT NOT NULL)""")
        # Older ComfyUI extensions can reimport their historical JSON on restart.
        # Honor explicit purge tombstones without changing that installation.
        with self.connect() as db:
            db.execute('DELETE FROM messages WHERE source_key IN (SELECT source FROM purged_imports)')
            if db.execute('SELECT 1 FROM purged_imports LIMIT 1').fetchone():
                db.execute("DELETE FROM chats WHERE id='legacy' AND NOT EXISTS(SELECT 1 FROM messages WHERE chat_id='legacy')")
        if legacy and Path(legacy).exists():
            records = json.loads(Path(legacy).read_text(encoding='utf-8'))
            for record in records:
                self.import_record(record)

    @contextmanager
    def connect(self, *, create=False):
        db = sqlite3.connect(self.path.resolve().as_uri() + ('?mode=rwc' if create else '?mode=rw'), uri=True, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('PRAGMA busy_timeout=10000')
        try:
            with db:
                yield db
        finally:
            db.close()

    def _chat(self, row):
        result = dict(row)
        result['draft'] = json.loads(result['draft'])
        return result

    def _message(self, row):
        result = dict(row)
        result['reference'] = json.loads(result.pop('reference_json') or 'null')
        result['image'] = json.loads(result.pop('image_json') or 'null')
        result['settings'] = json.loads(result.pop('settings_json') or '{}')
        result['edited'] = result['reference'] is not None
        result['memory'] = json.loads(result.pop('memory_json', '{}'))
        if result.get('image_deleted'): result['image'] = None
        return result

    def chats(self, deleted=False):
        with self.connect() as db:
            rows = db.execute(
                f"""SELECT c.id,c.title,c.created,c.updated,c.version,
                (SELECT count(*) FROM messages m WHERE m.chat_id=c.id) AS count,
                (SELECT count(*) FROM messages m WHERE m.chat_id=c.id AND m.status IN ('submitting','running')) AS active,
                COALESCE(p.pinned, 0) AS pinned, COALESCE(p.pin_version, 0) AS pin_version
                FROM chats c
                LEFT JOIN chat_pin p ON p.chat_id = c.id
                WHERE (c.deleted_at IS NOT NULL)=?{_chats_order_sql()}""",
                (int(deleted),),
            )
            listed = []
            for row in rows:
                item = dict(row)
                item["pinned"] = bool(item["pinned"])
                item["pin_version"] = int(item["pin_version"])
                listed.append(item)
            return listed

    def create(self, title='新对话'):
        now = time.time()
        chat_id = str(uuid.uuid4())
        with self.connect() as db:
            db.execute('INSERT INTO chats(id,title,created,updated) VALUES(?,?,?,?)', (chat_id,title,now,now))
        return self.chat(chat_id)

    def chat(self, chat_id):
        with self.connect() as db:
            row = db.execute('SELECT * FROM chats WHERE id=?',(chat_id,)).fetchone()
            if not row:
                raise KeyError(chat_id)
            result = self._chat(row)
            _attach_pin_fields(result, _pin_row(db, chat_id))
            result['messages'] = [self._message(r) for r in db.execute('SELECT * FROM messages WHERE chat_id=? ORDER BY created,id',(chat_id,))]
            return result

    def _check_media_reference(self, db, reference):
        if reference is None or reference == {}:
            return
        # A legacy marker carries no filesystem reference.
        if isinstance(reference, dict) and reference.get('legacy') is True and 'filename' not in reference:
            return
        def key(image):
            # Keep the same canonical path policy as MediaLifecycle, but avoid
            # importing the UI runtime from the independently installed Store.
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
            # APFS may treat case and Unicode normalization variants as one
            # file. Normalize identity only; keep stored/on-disk names intact.
            return tuple(unicodedata.normalize('NFC', value).casefold()
                         for value in (kind, '' if folder == '.' else folder, name))
        # Validate before checking for the additive table: old installations and
        # prevalidated requests must not introduce an alias that bypasses a tombstone.
        target = key(reference)
        if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='media_deletions'").fetchone():
            return
        for row in db.execute('SELECT payload FROM media_deletions'):
            if any(key(image) == target for image in json.loads(row['payload']).get('images', [])):
                raise Conflict('这张图片正在删除或已永久删除，请重新选择参考图片。')

    def patch(self, chat_id, expected, title=None, draft=None):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            self._check_media_reference(db, (draft or {}).get('reference'))
            row = db.execute('SELECT * FROM chats WHERE id=?',(chat_id,)).fetchone()
            if not row:
                raise KeyError(chat_id)
            if row['draft_version'] != expected:
                raise Conflict('对话已在其他页面更新，请刷新后重试。')
            new_title = row['title'] if title is None else title
            new_draft = row['draft'] if draft is None else json.dumps(draft,ensure_ascii=False)
            db.execute('UPDATE chats SET title=?,draft=?,version=version+1,draft_version=draft_version+1,updated=? WHERE id=?', (new_title,new_draft,time.time(),chat_id))
        return self.chat(chat_id)

    def reserve(self, chat_id, prompt, reference, width, height, steps, client_id, request_key, kind="image", model="", settings=None, owner=None):
        if owner is not None:
            owner.validate(self.path)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            self._check_media_reference(db, reference)
            duplicate = db.execute('SELECT * FROM messages WHERE request_key=?',(request_key,)).fetchone()
            if duplicate:
                if duplicate['chat_id'] != chat_id:
                    raise Conflict('重复的请求标识。')
                return self._message(duplicate),False
            chat = db.execute('SELECT * FROM chats WHERE id=?',(chat_id,)).fetchone()
            if not chat or chat['deleted_at'] is not None:
                raise KeyError(chat_id)
            if db.execute("SELECT id FROM messages WHERE status IN ('submitting','running')").fetchone():
                raise Conflict('本地模型正在处理其他任务，请等当前任务完成。')
            now = time.time()
            msg_id = str(uuid.uuid4())
            db.execute('''INSERT INTO messages(id,chat_id,prompt,reference_json,status,created,width,height,steps,client_id,request_key)
                VALUES(?,?,?,?,?,?,?,?,?,?,?)''',(msg_id,chat_id,prompt,json.dumps(reference,ensure_ascii=False) if reference else None,'submitting',now,width,height,steps,client_id,request_key))
            db.execute('UPDATE messages SET kind=?,model=?,settings_json=? WHERE id=?',(kind,model,json.dumps(settings or {},ensure_ascii=False),msg_id))
            if owner is not None:
                db.execute("INSERT INTO generation_owners VALUES(?,?,?,?,?,?,?,?)",
                    (msg_id, owner.nonce, 1, *owner.database_identity, *owner.lock_identity, now))
                owner.validate(self.path)
            title = prompt.replace('\n',' ').strip()[:32] if chat['title']=='新对话' else chat['title']
            db.execute("UPDATE chats SET title=?,draft=?,version=version+1,draft_version=draft_version+1,updated=? WHERE id=?",(title,json.dumps({**(settings or {}),"prompt":"","reference":None},ensure_ascii=False),now,chat_id))
        return self.message(msg_id),True

    def message(self, message_id):
        with self.connect() as db:
            row = db.execute('SELECT * FROM messages WHERE id=?',(message_id,)).fetchone()
            if not row:
                raise KeyError(message_id)
            return self._message(row)

    def by_request(self, key):
        with self.connect() as db:
            row=db.execute('SELECT * FROM messages WHERE request_key=?',(key,)).fetchone()
            return self._message(row) if row else None

    def active(self):
        with self.connect() as db:
            return [self._message(r) for r in db.execute("SELECT * FROM messages WHERE status IN ('submitting','running')")]

    def update(self, message_id, **fields):
        allowed = {'status','prompt_id','phase','step','total','finished','seconds','error','image_json','kind','answer','reasoning','model','reference_json','settings_json','memory_json'}
        if not fields or not set(fields).issubset(allowed):
            raise ValueError('Invalid fields')
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            self._check_media_reference(db, json.loads(fields.get('reference_json') or 'null'))
            self._check_media_reference(db, json.loads(fields.get('image_json') or 'null'))
            row = db.execute('SELECT chat_id FROM messages WHERE id=?',(message_id,)).fetchone()
            if not row:
                raise KeyError(message_id)
            db.execute('UPDATE messages SET '+','.join(k+'=?' for k in fields)+' WHERE id=?',(*fields.values(),message_id))
            if fields.get('status') in ('completed', 'failed', 'stopped') or fields.get('kind') == 'image':
                db.execute('DELETE FROM generation_owners WHERE message_id=?', (message_id,))
            db.execute('UPDATE chats SET version=version+1,updated=? WHERE id=?',(time.time(),row['chat_id']))
        return self.message(message_id)

    def _generation_rows(self, db):
        return db.execute("""SELECT m.id,m.chat_id,m.status,o.* FROM messages m
            LEFT JOIN generation_owners o ON o.message_id=m.id
            WHERE m.kind IN ('chat','routing') AND m.status IN ('submitting','running')""").fetchall()

    def _known_generation(self, row, owner):
        nonce = row['owner_nonce']
        return (row['protocol_version'] == 1 and isinstance(nonce, str)
                and len(nonce) == 32 and all(c in '0123456789abcdef' for c in nonce)
                and (row['database_device'], row['database_inode']) == owner.database_identity
                and (row['lock_device'], row['lock_inode']) == owner.lock_identity
                and nonce != owner.nonce)

    def generation_status(self, owner):
        owner.validate(self.path)
        with self.connect() as db:
            rows = self._generation_rows(db)
        state = ('ownership_unknown' if any(not self._known_generation(r, owner) for r in rows)
                 else 'recovery_required' if rows else 'ready')
        return {'generation_recovery_ready': not rows, 'generation_recovery_state': state}

    def reconcile_generation(self, owner):
        """Must hold this database's lock; unknown/legacy owners are never adopted."""
        owner.validate(self.path)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            rows = self._generation_rows(db)
            if any(not self._known_generation(row, owner) for row in rows):
                return {'generation_recovery_ready': False, 'generation_recovery_state': 'ownership_unknown', 'recovered': 0}
            now = time.time()
            for row in rows:
                db.execute("""UPDATE messages SET status='failed', finished=?, phase='生成已中断',
                    error='Generation interrupted: owner exited. 已保留部分回答，请显式重试。'
                    WHERE id=? AND status=? AND kind IN ('chat','routing')
                    AND EXISTS(SELECT 1 FROM generation_owners WHERE message_id=? AND owner_nonce=?)""",
                    (now, row['id'], row['status'], row['id'], row['owner_nonce']))
                db.execute('INSERT INTO generation_recoveries VALUES(?,?,?,?,?,?)',
                    (row['id'], row['owner_nonce'], 1, row['status'], now, 'owner_exited'))
                db.execute('DELETE FROM generation_owners WHERE message_id=? AND owner_nonce=?',
                    (row['id'], row['owner_nonce']))
                db.execute('UPDATE chats SET version=version+1,updated=? WHERE id=?', (now, row['chat_id']))
            owner.validate(self.path)
        return {'generation_recovery_ready': True, 'generation_recovery_state': 'ready', 'recovered': len(rows)}

    def import_record(self, record):
        image = record.get('image') or {}
        if not image.get('filename'):
            return
        source = (image.get('subfolder') or '')+'/'+image['filename']
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            try:self._check_media_reference(db,image)
            except Conflict:return
            if db.execute('SELECT source FROM removed_sources WHERE source=?',(source,)).fetchone(): return
            if db.execute('SELECT id FROM messages WHERE source_key=?',(source,)).fetchone() or any((json.loads(r['image_json']).get('subfolder',''),json.loads(r['image_json']).get('filename'))==(image.get('subfolder',''),image['filename']) for r in db.execute('SELECT image_json FROM messages WHERE image_json IS NOT NULL')):
                return
            now = time.time()
            db.execute("INSERT OR IGNORE INTO chats(id,title,created,updated) VALUES('legacy','既有作品',?,?)",(now,now))
            db.execute('''INSERT INTO messages(id,chat_id,prompt,image_json,status,created,finished,seconds,width,height,steps,source_key,reference_json)
                VALUES(?,'legacy',?,?,'completed',?,?,?,?,?,?,?,?)''',(str(uuid.uuid4()),record.get('prompt',''),json.dumps(image,ensure_ascii=False),now,now,record.get('seconds'),record.get('width',512),record.get('height',512),record.get('steps',25),source,json.dumps(record.get('reference') or ({'legacy':True} if record.get('edited') else None))))
            db.execute("UPDATE chats SET version=version+1,updated=? WHERE id='legacy'",(now,))

    def trash(self, chat_id):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if not db.execute('SELECT id FROM chats WHERE id=?',(chat_id,)).fetchone():
                raise KeyError(chat_id)
            if db.execute("SELECT id FROM messages WHERE chat_id=? AND status IN ('submitting','running')",(chat_id,)).fetchone():
                raise Conflict('此对话正在生成内容，请先停止或等待完成。')
            db.execute('UPDATE chats SET deleted_at=COALESCE(deleted_at,?),version=version+1,draft_version=draft_version+1 WHERE id=?',(time.time(),chat_id))
        return self.chat(chat_id)

    def restore(self, chat_id):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='media_deletions'").fetchone() and db.execute("SELECT 1 FROM media_deletions WHERE id=? AND state!='complete'",('chat:'+chat_id,)).fetchone():
                raise Conflict('此对话有未完成的永久删除，请先重试原操作。')
            if not db.execute('SELECT id FROM chats WHERE id=?',(chat_id,)).fetchone():
                raise KeyError(chat_id)
            db.execute('UPDATE chats SET deleted_at=NULL,updated=?,version=version+1,draft_version=draft_version+1 WHERE id=?',(time.time(),chat_id))
        return self.chat(chat_id)

    def gallery(self, search='', offset=0, limit=60):
        with self.connect() as db:
            rows=db.execute("SELECT m.*,c.title AS chat_title,c.deleted_at AS chat_deleted FROM messages m JOIN chats c ON c.id=m.chat_id WHERE m.status='completed' AND m.image_json IS NOT NULL AND m.image_deleted=0")
            items=[self._message(r) for r in rows]
            items += [json.loads(r['payload']) for r in db.execute('SELECT payload FROM gallery_archive')]
        with self.connect() as db:
            if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='media_trash'").fetchone():
                hidden={r['id'] for r in db.execute('SELECT id FROM media_trash')}
                items=[m for m in items if m['id'] not in hidden]
        if search:items=[m for m in items if search.lower() in m['prompt'].lower()]
        items.sort(key=lambda m:(m['created'],m['id']),reverse=True)
        total=len(items);page=items[offset:offset+limit]
        return {'items':page,'total':total,'next_offset':offset+len(page) if offset+len(page)<total else None}

    def _check_legacy_deletion(self, db):
        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name IN ('media_trash','media_deletions') LIMIT 1").fetchone():
            raise Conflict('数据已升级，请在 8190 端口的 LocalGPT 新版界面执行删除。')

    def delete_gallery(self, message_id):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            self._check_legacy_deletion(db)
            row=db.execute('SELECT * FROM messages WHERE id=? AND image_json IS NOT NULL AND image_deleted=0',(message_id,)).fetchone()
            archived=db.execute('SELECT payload FROM gallery_archive WHERE id=?',(message_id,)).fetchone()
            if not row and not archived:raise KeyError(message_id)
            image=json.loads(row['image_json']) if row else json.loads(archived['payload'])['image']
            source=(image.get('subfolder') or '')+'/'+image['filename']
            db.execute('INSERT OR IGNORE INTO removed_sources VALUES(?)',(source,))
            # Remove references to the same gallery asset across related messages.
            if row:
                db.execute('UPDATE messages SET image_deleted=1 WHERE image_json=?',(row['image_json'],))
                db.execute('UPDATE chats SET version=version+1 WHERE id=?',(row['chat_id'],))
            db.execute('DELETE FROM gallery_archive WHERE id=?',(message_id,))
        return {'deleted':True,'original_file_retained':True}

    def purge(self, chat_id):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            self._check_legacy_deletion(db)
            chat=db.execute('SELECT * FROM chats WHERE id=?',(chat_id,)).fetchone()
            if not chat:raise KeyError(chat_id)
            if chat['deleted_at'] is None:raise Conflict('只能永久删除回收站里的对话。')
            rows=db.execute('SELECT * FROM messages WHERE chat_id=?',(chat_id,)).fetchall()
            if any(r['status'] in ('running','submitting') for r in rows):raise Conflict('对话仍有任务运行，请稍后重试。')
            for row in rows:
                if row['source_key']:db.execute('INSERT OR IGNORE INTO purged_imports VALUES(?)',(row['source_key'],))
                if row['image_json']:
                    image=json.loads(row['image_json'])
                    db.execute('INSERT OR IGNORE INTO removed_sources VALUES(?)',((image.get('subfolder') or '')+'/'+image['filename'],))
                if row['image_json'] and not row['image_deleted'] and row['status']=='completed':
                    m=self._message(row);m.update(chat_id=None,chat_title='已删除对话',chat_deleted=True,chat_purged=True)
                    # Keep only gallery data, not the deleted conversation or reasoning.
                    m.update(answer='',reasoning='',settings={},reference=None,memory={},prompt='已保留的图片')
                    db.execute('INSERT OR REPLACE INTO gallery_archive VALUES(?,?)',(m['id'],json.dumps(m,ensure_ascii=False)))
            db.execute('DELETE FROM messages WHERE chat_id=?',(chat_id,))
            db.execute('DELETE FROM chats WHERE id=?',(chat_id,))
            # MemoryStore is optional for installations that predate this feature.
            if db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='user_memory'").fetchone():
                db.execute('UPDATE user_memory SET chat_id=NULL,message_id=NULL WHERE chat_id=?',(chat_id,))
        return {'deleted':True,'images_retained':True}
