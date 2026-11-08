"""Local Projects: additive metadata, source bytes and scoped chat retrieval.

Existing chats/messages are never copied or re-keyed. All membership and project
trash operations are transactional; removal is recoverable through restore.
"""
import asyncio
import hashlib
import io
import json
import re
import sqlite3
import time
import uuid
import zipfile
from pathlib import Path
from xml.etree import ElementTree

from memory_store import MemoryStore
from storage import Conflict

COLORS = ('default', 'gray', 'blue', 'green', 'yellow', 'orange', 'red', 'pink', 'purple')
ICONS = ('folder', 'book', 'briefcase', 'code', 'graduation', 'globe', 'heart', 'lightbulb', 'chart', 'pen', 'plane', 'coffee')
TEXT_EXTENSIONS = {'.txt', '.md', '.csv', '.tsv', '.json', '.py', '.js', '.ts', '.html', '.css', '.yaml', '.yml', '.xml', '.log', '.sql', '.tex'}
MAX_FILE_BYTES = 10 * 1024**2
MAX_TEXT = 200_000
SOURCE_COLUMNS = 'id,project_id,name,kind,mime,size,sha256,created,deleted_at'


def cost(text):
    return sum(2 if ord(ch) > 127 else .35 for ch in text)


def clip(text, budget):
    used = 0
    for i, ch in enumerate(text):
        used += 2 if ord(ch) > 127 else .35
        if used > budget:
            return text[:i]
    return text


def terms(text):
    text = text.casefold()
    words = set(re.findall(r'[a-z0-9_]{2,}', text))
    for run in re.findall(r'[\u3400-\u9fff]+', text):
        words.update(run[i:i + 2] for i in range(max(1, len(run) - 1)))
    return words


def extract(name, content):
    """Never execute source documents. Reject unsupported/empty extraction explicitly."""
    suffix = Path(name).suffix.lower()
    if suffix in TEXT_EXTENSIONS:
        try:
            text = content.decode('utf-8-sig')
        except UnicodeDecodeError:
            raise ValueError('请将文本文件保存为 UTF-8。 / Save text files as UTF-8.')
        if '\x00' in text:
            raise ValueError('文件不是有效的文本。 / Invalid text file.')
        mime = 'text/plain; charset=utf-8'
    elif suffix == '.pdf':
        from pypdf import PdfReader
        try:
            reader = PdfReader(io.BytesIO(content))
            if reader.is_encrypted or len(reader.pages) > 300:
                raise ValueError('PDF 必须未加密且不超过 300 页。 / PDF must be unencrypted, at most 300 pages.')
            parts = []
            for page in reader.pages:
                parts.append(page.extract_text() or '')
                if sum(map(len, parts)) > MAX_TEXT:
                    raise ValueError('提取内容过长，请拆分文件。 / Split this document into smaller files.')
            text = '\n\n'.join(parts)
        except ValueError:
            raise
        except Exception as error:
            raise ValueError('无法读取此 PDF。 / Cannot read this PDF.') from error
        mime = 'application/pdf'
    elif suffix == '.docx':
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                info = archive.getinfo('word/document.xml')
                if info.file_size > 4 * 1024**2:
                    raise ValueError('Word 文档过大。 / Word document is too large.')
                xml = archive.read(info)
                if b'<!DOCTYPE' in xml or b'<!ENTITY' in xml:
                    raise ValueError('不支持此 Word 文档。 / Unsupported Word document.')
                root = ElementTree.fromstring(xml)
                ns = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
                text = '\n'.join(''.join(p.itertext()) for p in root.iter(ns + 'p'))
        except (zipfile.BadZipFile, KeyError, ElementTree.ParseError) as error:
            raise ValueError('无法读取此 Word 文档。 / Cannot read this Word document.') from error
        mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    else:
        raise ValueError('支持 PDF、DOCX、UTF-8 文本和代码文件。 / Use PDF, DOCX, UTF-8 text or code files.')
    if len(text) > MAX_TEXT:
        raise ValueError('提取内容超过 200,000 字符，请拆分文件。 / Split files over 200,000 extracted characters.')
    if not text.strip():
        raise ValueError('未找到可读取的文字；扫描 PDF 请先 OCR。 / No readable text; OCR scanned PDFs first.')
    return text, mime


class ProjectStore:
    def __init__(self, store):
        self.store = store
        self._memories = {}
        with store.connect() as db:
            exists = db.execute("SELECT 1 FROM sqlite_master WHERE name='projects' AND type='table'").fetchone()
            # Online SQLite backup includes WAL; never replace an existing checkpoint.
            if not exists:
                backup_dir = store.path.parent / '.localgpt-backups'
                backup_dir.mkdir(exist_ok=True)
                target = backup_dir / ('before-projects-' + str(time.time_ns()) + '.sqlite3')
                with sqlite3.connect(target) as copy:
                    db.backup(copy)
                target.chmod(0o600)
            db.executescript('''
                CREATE TABLE IF NOT EXISTS projects(
                    id TEXT PRIMARY KEY,name TEXT NOT NULL,icon TEXT NOT NULL,color TEXT NOT NULL,
                    instructions TEXT NOT NULL DEFAULT '',memory_mode TEXT NOT NULL,
                    pinned INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1,
                    created REAL NOT NULL,updated REAL NOT NULL,deleted_at REAL);
                CREATE TABLE IF NOT EXISTS project_chats(
                    chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
                    project_id TEXT REFERENCES projects(id),version INTEGER NOT NULL DEFAULT 1);
                CREATE INDEX IF NOT EXISTS project_membership ON project_chats(project_id);
                CREATE TABLE IF NOT EXISTS project_sources(
                    id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),
                    name TEXT NOT NULL,kind TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,
                    sha256 TEXT NOT NULL,content BLOB NOT NULL,text TEXT NOT NULL,
                    created REAL NOT NULL,deleted_at REAL);
                CREATE INDEX IF NOT EXISTS project_source_lookup ON project_sources(project_id,deleted_at);
                CREATE TABLE IF NOT EXISTS project_source_chunks(
                    id INTEGER PRIMARY KEY,source_id TEXT NOT NULL REFERENCES project_sources(id) ON DELETE CASCADE,
                    offset INTEGER NOT NULL,body TEXT NOT NULL,UNIQUE(source_id,offset));
                CREATE TABLE IF NOT EXISTS project_source_terms(
                    term TEXT NOT NULL,chunk_id INTEGER NOT NULL REFERENCES project_source_chunks(id) ON DELETE CASCADE,
                    PRIMARY KEY(term,chunk_id)) WITHOUT ROWID;
                CREATE INDEX IF NOT EXISTS project_terms_chunk ON project_source_terms(chunk_id);
                CREATE TABLE IF NOT EXISTS project_source_index(
                    source_id TEXT PRIMARY KEY REFERENCES project_sources(id) ON DELETE CASCADE,
                    version INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS project_trash_chats(
                    chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
                    project_id TEXT NOT NULL REFERENCES projects(id),deleted_at REAL NOT NULL);
            ''')

    def _get(self, db, project_id, deleted=False):
        row = db.execute('SELECT * FROM projects WHERE id=?', (project_id,)).fetchone()
        if not row or (row['deleted_at'] is not None and not deleted):
            raise KeyError(project_id)
        return dict(row)

    def _version(self, project, expected):
        if type(expected) is not int or expected != project['version']:
            raise Conflict('项目已在另一页面更新，请重新打开后重试。 / Project changed in another tab. Reopen and retry.')

    def _clean(self, data, creating=False):
        allowed = {'name', 'icon', 'color', 'instructions', 'pinned'}
        if creating:
            allowed.add('memory_mode')
        if set(data) - allowed - {'version'}:
            raise ValueError('无效的项目字段。 / Invalid project field.')
        result = {k: v for k, v in data.items() if k in allowed}
        for key, limit in (('name', 100), ('instructions', 4000)):
            if key in result:
                if not isinstance(result[key], str) or len(result[key]) > limit or '\x00' in result[key]:
                    raise ValueError('项目名称或指令过长。 / Project name or instructions too long.')
                if key == 'name':
                    result[key] = result[key].strip()
                    if not result[key]:
                        raise ValueError('请输入项目名称。 / Enter a project name.')
        for key, choices in (('icon', ICONS), ('color', COLORS), ('memory_mode', ('default', 'project-only'))):
            if key in result and result[key] not in choices:
                raise ValueError('无效的项目选项。 / Invalid project option.')
        if 'pinned' in result and type(result['pinned']) is not bool:
            raise ValueError('Invalid pinned value')
        return result

    def create(self, data):
        values = {'name': '', 'icon': 'folder', 'color': 'default', 'memory_mode': 'default', **self._clean(data, True)}
        self._clean(values, True)
        now, project_id = time.time(), str(uuid.uuid4())
        with self.store.connect() as db:
            db.execute('INSERT INTO projects(id,name,icon,color,instructions,memory_mode,pinned,created,updated) VALUES(?,?,?,?,?,?,?,?,?)',
                       (project_id, values['name'], values['icon'], values['color'], values.get('instructions', ''), values['memory_mode'], values.get('pinned', False), now, now))
        return self.get(project_id)

    def list(self, deleted=False):
        with self.store.connect() as db:
            result = []
            for row in db.execute('SELECT * FROM projects WHERE (deleted_at IS NOT NULL)=? ORDER BY pinned DESC,updated DESC,id', (int(deleted),)):
                p = dict(row)
                p.pop('instructions')
                p['pinned'] = bool(p['pinned'])
                p['chat_ids'] = [r[0] for r in db.execute('SELECT pc.chat_id FROM project_chats pc JOIN chats c ON c.id=pc.chat_id WHERE pc.project_id=? AND c.deleted_at IS NULL ORDER BY c.updated DESC', (p['id'],))]
                p['source_count'] = db.execute('SELECT count(*) FROM project_sources WHERE project_id=? AND deleted_at IS NULL', (p['id'],)).fetchone()[0]
                result.append(p)
            return result

    def get(self, project_id):
        with self.store.connect() as db:
            p = self._get(db, project_id)
            p['pinned'] = bool(p['pinned'])
            ids = {r[0] for r in db.execute('SELECT chat_id FROM project_chats WHERE project_id=?', (project_id,))}
            p['sources'] = [dict(r) for r in db.execute(f'SELECT {SOURCE_COLUMNS} FROM project_sources WHERE project_id=? AND deleted_at IS NULL ORDER BY created DESC,id', (project_id,))]
        p['chats'] = [c for c in self.store.chats() if c['id'] in ids]
        with self.store.connect() as db:
            for chat in p['chats']:
                latest = db.execute('SELECT prompt FROM messages WHERE chat_id=? ORDER BY created DESC LIMIT 1', (chat['id'],)).fetchone()
                chat['preview'] = latest['prompt'][:180] if latest else ''
        return p

    def search_chats(self, project_id, query):
        project = self.get(project_id)
        query = query.strip()[:200]
        if not query:
            return project['chats']
        with self.store.connect() as db:
            matches = {row[0] for row in db.execute('''
                SELECT c.id FROM chats c JOIN project_chats pc ON pc.chat_id=c.id
                WHERE pc.project_id=? AND c.deleted_at IS NULL AND
                (instr(lower(c.title),lower(?)) OR EXISTS(SELECT 1 FROM messages m
                 WHERE m.chat_id=c.id AND (instr(lower(m.prompt),lower(?)) OR instr(lower(m.answer),lower(?)))))
            ''', (project_id, query, query, query))}
        return [chat for chat in project['chats'] if chat['id'] in matches]

    def patch(self, project_id, data):
        values = self._clean(data)
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            self._version(self._get(db, project_id), data.get('version'))
            if values:
                sql = ','.join(k + '=?' for k in values)
                db.execute(f'UPDATE projects SET {sql},version=version+1,updated=? WHERE id=?', (*values.values(), time.time(), project_id))
        return self.get(project_id)

    def membership(self, chat_id):
        with self.store.connect() as db:
            row = db.execute('SELECT project_id,version FROM project_chats WHERE chat_id=?', (chat_id,)).fetchone()
        return dict(row) if row else {'project_id': None, 'version': 0}

    def for_chat(self, chat_id):
        membership = self.membership(chat_id)
        if membership['project_id']:
            with self.store.connect() as db:
                return self._get(db, membership['project_id'])
        return None

    def create_chat(self, title, project_id):
        now, chat_id = time.time(), str(uuid.uuid4())
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            self._get(db, project_id)
            db.execute('INSERT INTO chats(id,title,created,updated) VALUES(?,?,?,?)', (chat_id, title, now, now))
            db.execute('INSERT INTO project_chats(chat_id,project_id) VALUES(?,?)', (chat_id, project_id))
            db.execute('UPDATE projects SET updated=? WHERE id=?', (now, project_id))
        return self.store.chat(chat_id)

    def move(self, chat_id, project_id, expected):
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            chat = db.execute('SELECT * FROM chats WHERE id=? AND deleted_at IS NULL', (chat_id,)).fetchone()
            if not chat:
                raise KeyError(chat_id)
            if db.execute("SELECT 1 FROM messages WHERE chat_id=? AND status IN ('submitting','running')", (chat_id,)).fetchone():
                raise Conflict('请等待生成结束后移动对话。 / Wait for this response before moving the chat.')
            if project_id is not None:
                self._get(db, project_id)
            old = db.execute('SELECT * FROM project_chats WHERE chat_id=?', (chat_id,)).fetchone()
            version = old['version'] if old else 0
            if type(expected) is not int or expected != version:
                raise Conflict('对话归属已更新，请重试。 / Chat membership changed. Retry.')
            # Moving out of project-only memory exposes its transcript to a new
            # context only after an explicit UI confirmation, never via auto capture.
            db.execute('INSERT INTO project_chats(chat_id,project_id,version) VALUES(?,?,?) ON CONFLICT(chat_id) DO UPDATE SET project_id=excluded.project_id,version=excluded.version',
                       (chat_id, project_id, version + 1))
            db.execute('UPDATE projects SET updated=? WHERE id IN (?,?)', (time.time(), project_id, old['project_id'] if old else None))
        return self.membership(chat_id)

    def trash(self, project_id, expected):
        now = time.time()
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            self._version(self._get(db, project_id), expected)
            if db.execute("SELECT 1 FROM messages m JOIN project_chats pc ON pc.chat_id=m.chat_id WHERE pc.project_id=? AND m.status IN ('submitting','running')", (project_id,)).fetchone():
                raise Conflict('项目内仍有生成任务。 / A response is still running in this project.')
            db.execute('INSERT OR REPLACE INTO project_trash_chats SELECT c.id,?,? FROM chats c JOIN project_chats pc ON pc.chat_id=c.id WHERE pc.project_id=? AND c.deleted_at IS NULL', (project_id, now, project_id))
            db.execute('UPDATE chats SET deleted_at=?,version=version+1,draft_version=draft_version+1 WHERE id IN (SELECT chat_id FROM project_trash_chats WHERE project_id=?) AND deleted_at IS NULL', (now, project_id))
            db.execute('UPDATE projects SET deleted_at=?,version=version+1 WHERE id=?', (now, project_id))

    def restore(self, project_id, expected):
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            self._version(self._get(db, project_id, True), expected)
            db.execute('UPDATE projects SET deleted_at=NULL,version=version+1,updated=? WHERE id=?', (time.time(), project_id))
            db.execute('UPDATE chats SET deleted_at=NULL,version=version+1,draft_version=draft_version+1 WHERE id IN (SELECT pc.chat_id FROM project_trash_chats pt JOIN project_chats pc ON pc.chat_id=pt.chat_id AND pc.project_id=pt.project_id JOIN chats c ON c.id=pt.chat_id AND c.deleted_at=pt.deleted_at WHERE pt.project_id=?)', (project_id,))
            db.execute('DELETE FROM project_trash_chats WHERE project_id=?', (project_id,))
        return self.get(project_id)

    def add_source(self, project_id, name, content, kind='file'):
        name = str(name or '').replace('\\', '/').split('/')[-1].strip()
        if not name or len(name) > 180 or any(ord(ch) < 32 for ch in name):
            raise ValueError('无效的文件名。 / Invalid file name.')
        if not content or len(content) > MAX_FILE_BYTES:
            raise ValueError('每个文件需为 1 字节至 10 MB。 / Files must be 1 byte to 10 MB.')
        text, mime = extract(name, content)
        digest, source_id = hashlib.sha256(content).hexdigest(), str(uuid.uuid4())
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            self._get(db, project_id)
            existing = db.execute('SELECT id FROM project_sources WHERE project_id=? AND sha256=? AND deleted_at IS NULL', (project_id, digest)).fetchone()
            if existing:
                return self.source(project_id, existing['id'])
            if db.execute('SELECT count(*) FROM project_sources WHERE project_id=? AND deleted_at IS NULL', (project_id,)).fetchone()[0] >= 100:
                raise ValueError('每个项目最多 100 个来源。 / Maximum 100 sources per project.')
            db.execute('INSERT INTO project_sources(id,project_id,name,kind,mime,size,sha256,content,text,created) VALUES(?,?,?,?,?,?,?,?,?,?)', (source_id, project_id, name, kind, mime, len(content), digest, content, text, time.time()))
            self._index_source(db, source_id, name, text)
            db.execute('UPDATE projects SET updated=? WHERE id=?', (time.time(), project_id))
        return self.source(project_id, source_id)

    def source(self, project_id, source_id, raw=False):
        with self.store.connect() as db:
            self._get(db, project_id)
            row = db.execute(f'SELECT {SOURCE_COLUMNS},text,content FROM project_sources WHERE id=? AND project_id=? AND deleted_at IS NULL', (source_id, project_id)).fetchone()
            if not row:
                raise KeyError(source_id)
            out = dict(row)
            if not raw:
                out.pop('content')
            return out

    def sources(self, project_id, deleted=False):
        with self.store.connect() as db:
            self._get(db, project_id)
            return [dict(r) for r in db.execute(f'SELECT {SOURCE_COLUMNS} FROM project_sources WHERE project_id=? AND (deleted_at IS NOT NULL)=? ORDER BY created DESC', (project_id, int(deleted)))]

    def remove_source(self, project_id, source_id, restore=False):
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            self._get(db, project_id)
            source = db.execute('SELECT * FROM project_sources WHERE id=? AND project_id=?', (source_id, project_id)).fetchone()
            if not source:
                raise KeyError(source_id)
            if restore and source['deleted_at'] is not None:
                if db.execute('SELECT count(*) FROM project_sources WHERE project_id=? AND deleted_at IS NULL', (project_id,)).fetchone()[0] >= 100:
                    raise ValueError('每个项目最多 100 个来源。 / Maximum 100 sources per project.')
                if db.execute('SELECT 1 FROM project_sources WHERE project_id=? AND sha256=? AND deleted_at IS NULL', (project_id, source['sha256'])).fetchone():
                    raise Conflict('此来源内容已存在。 / This source content is already in the project.')
            db.execute('UPDATE project_sources SET deleted_at=? WHERE id=?', (None if restore else time.time(), source_id))

    def memory_for_chat(self, chat_id, default):
        project = self.for_chat(chat_id)
        if not project or project['memory_mode'] == 'default':
            return default
        return self.scoped_memory(project['id'])

    def scoped_memory(self, project_id):
        with self.store.connect() as db:
            self._get(db, project_id)
        # Validate the database identity before using it as a path component.
        if project_id not in self._memories:
            folder = self.store.path.parent / '.localgpt-project-memory'
            folder.mkdir(mode=0o700, exist_ok=True)
            path = folder / (str(uuid.UUID(project_id)) + '.sqlite3')
            self._memories[project_id] = MemoryStore(path)
            path.chmod(0o600)
        return self._memories[project_id]

    def _index_source(self, db, source_id, name, text):
        # Derived data only. Source bytes/text remain authoritative and immutable.
        db.execute('DELETE FROM project_source_chunks WHERE source_id=?', (source_id,))
        for offset in range(0, len(text), 1000):
            body = text[offset:offset + 1200]
            chunk_id = db.execute('INSERT INTO project_source_chunks(source_id,offset,body) VALUES(?,?,?)',
                                  (source_id, offset, body)).lastrowid
            db.executemany('INSERT INTO project_source_terms(term,chunk_id) VALUES(?,?)',
                           ((term, chunk_id) for term in terms(name + ' ' + body)))
        db.execute('INSERT OR REPLACE INTO project_source_index VALUES(?,1)', (source_id,))

    def _ensure_source_index(self, project_id):
        # Lazy upgrade of existing sources. Recheck under the writer transaction
        # so concurrent requests cannot duplicate/partially rebuild an index.
        with self.store.connect() as db:
            missing = [row[0] for row in db.execute("""SELECT s.id FROM project_sources s
                LEFT JOIN project_source_index i ON i.source_id=s.id
                WHERE s.project_id=? AND s.deleted_at IS NULL AND (i.version IS NULL OR i.version!=1)""", (project_id,))]
        for source_id in missing:
            with self.store.connect() as db:
                db.execute('BEGIN IMMEDIATE')
                row = db.execute("""SELECT s.name,s.text FROM project_sources s
                    LEFT JOIN project_source_index i ON i.source_id=s.id
                    WHERE s.id=? AND s.project_id=? AND s.deleted_at IS NULL
                    AND (i.version IS NULL OR i.version!=1)""", (source_id, project_id)).fetchone()
                if row:
                    self._index_source(db, source_id, row['name'], row['text'])

    async def context_async(self, chat_id, query, budget=2200, include_history=True):
        # SQLite connections are opened in the worker, never shared across threads.
        return await asyncio.to_thread(self.context, chat_id, query, budget, include_history)

    def context(self, chat_id, query, budget=2200, include_history=True):
        project = self.for_chat(chat_id)
        if not project:
            return '', '', None
        self._ensure_source_index(project['id'])
        query_terms, candidates = terms(query), []
        with self.store.connect() as db:
            db.execute('CREATE TEMP TABLE query_terms(term TEXT PRIMARY KEY) WITHOUT ROWID')
            db.executemany('INSERT INTO query_terms VALUES(?)', ((term,) for term in query_terms))
            # Match the cached inverted index; rank metadata first, then fetch at
            # most two bodies per source (the existing per-source context cap).
            rows = db.execute("""WITH hits AS (
                SELECT t.chunk_id,count(*) AS score FROM query_terms q
                JOIN project_source_terms t ON t.term=q.term
                JOIN project_source_chunks c ON c.id=t.chunk_id
                JOIN project_sources s ON s.id=c.source_id
                WHERE s.project_id=? AND s.deleted_at IS NULL GROUP BY t.chunk_id
            ), ranked AS (
                SELECT c.id,c.source_id,c.offset,s.name,s.created,COALESCE(h.score,0)+1 AS score,
                ROW_NUMBER() OVER(PARTITION BY c.source_id ORDER BY COALESCE(h.score,0) DESC,c.offset) AS rank
                FROM project_source_chunks c JOIN project_sources s ON s.id=c.source_id
                LEFT JOIN hits h ON h.chunk_id=c.id WHERE s.project_id=? AND s.deleted_at IS NULL
            ) SELECT r.*,c.body FROM ranked r JOIN project_source_chunks c ON c.id=r.id
              WHERE r.rank<=2 ORDER BY r.score DESC,r.created DESC,r.source_id,r.offset""", (project['id'], project['id']))
            for row in rows:
                candidates.append((row['score'], 'source', row['source_id'], row['name'], row['body'], row['offset']))
            for row in db.execute("SELECT m.id,m.chat_id,c.title,m.prompt,m.answer FROM messages m JOIN chats c ON c.id=m.chat_id JOIN project_chats pc ON pc.chat_id=c.id WHERE pc.project_id=? AND c.id!=? AND c.deleted_at IS NULL AND m.status='completed' AND m.kind='chat' ORDER BY m.created DESC LIMIT 150", (project['id'], chat_id)):
                if not include_history:
                    break
                body = row['prompt'] + '\n' + row['answer']
                score = len(query_terms & terms(row['title'] + ' ' + body))
                if score:
                    candidates.append((score, 'chat', row['chat_id'], row['title'], body[:4000], 0))
        candidates.sort(key=lambda item: item[0], reverse=True)
        entries, source_ids, chat_ids, per_source = [], [], [], {}
        for _, kind, identity, name, body, offset in candidates:
            if budget < 120 or len(entries) >= 8:
                break
            if per_source.get(identity, 0) >= 2:
                continue
            # Bound per-entry size and total serialization cost, including names.
            body = clip(body, min(650, budget - 100))
            entry = {'kind': kind, 'id': identity, 'name': name, 'excerpt': body, 'offset': offset}
            encoded = json.dumps(entry, ensure_ascii=False)
            if cost(encoded) > budget:
                continue
            entries.append(entry)
            per_source[identity] = per_source.get(identity, 0) + 1
            budget -= cost(encoded) + 5
            target = source_ids if kind == 'source' else chat_ids
            if identity not in target:
                target.append(identity)
        data = json.dumps(entries, ensure_ascii=False) if entries else ''
        metadata = {'id': project['id'], 'name': project['name'], 'memory_mode': project['memory_mode'], 'source_ids': source_ids, 'chat_ids': chat_ids}
        return project['instructions'], data, metadata
