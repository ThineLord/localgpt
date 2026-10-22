"""Local, user-controlled long-term memory. No network or model-generated facts."""
import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

from memory_retrieval import build_summary, select_for_query, token_cost  # noqa: F401 re-export


class MemoryConflict(Exception):
    pass


class MemoryAmbiguous(Exception):
    pass


class MemoryStore:
    MAX_ITEMS = 100

    def __init__(self, path):
        self.path = Path(path)
        with self.connect(create=True) as db:
            db.executescript(
                """
              CREATE TABLE IF NOT EXISTS user_memory(
                id TEXT PRIMARY KEY, content TEXT NOT NULL, category TEXT NOT NULL,
                topic TEXT, source TEXT NOT NULL, chat_id TEXT, message_id TEXT,
                created REAL NOT NULL, updated REAL NOT NULL, version INTEGER NOT NULL DEFAULT 1);
              CREATE TABLE IF NOT EXISTS memory_preferences(key TEXT PRIMARY KEY,value TEXT NOT NULL);
              CREATE UNIQUE INDEX IF NOT EXISTS memory_topic ON user_memory(topic) WHERE topic IS NOT NULL;
              CREATE INDEX IF NOT EXISTS memory_source ON user_memory(chat_id);
              CREATE TABLE IF NOT EXISTS memory_meta(
                memory_id TEXT PRIMARY KEY,
                active INTEGER NOT NULL DEFAULT 1,
                confidence REAL NOT NULL DEFAULT 1,
                provenance TEXT,
                semantic_key TEXT,
                FOREIGN KEY(memory_id) REFERENCES user_memory(id) ON DELETE CASCADE);
              CREATE TABLE IF NOT EXISTS memory_settings(
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL);
            """
            )
            for key, value in (("preferences_version", "1"), ("collection_revision", "1")):
                if not db.execute(
                    "SELECT 1 FROM memory_settings WHERE key=?", (key,)
                ).fetchone():
                    db.execute(
                        "INSERT INTO memory_settings(key,value) VALUES(?,?)", (key, value)
                    )
            # One collection bump per changed row, including provenance edits made
            # outside this class. Creating the trigger does not rewrite legacy rows.
            db.executescript(
                """
                CREATE TRIGGER IF NOT EXISTS memory_revision_insert
                AFTER INSERT ON user_memory
                BEGIN
                  UPDATE memory_settings
                  SET value=CAST(value AS INTEGER)+1
                  WHERE key='collection_revision';
                END;
                CREATE TRIGGER IF NOT EXISTS memory_revision_update
                AFTER UPDATE ON user_memory
                BEGIN
                  UPDATE memory_settings
                  SET value=CAST(value AS INTEGER)+1
                  WHERE key='collection_revision';
                END;
                CREATE TRIGGER IF NOT EXISTS memory_revision_delete
                AFTER DELETE ON user_memory
                BEGIN
                  UPDATE memory_settings
                  SET value=CAST(value AS INTEGER)+1
                  WHERE key='collection_revision';
                END;
                """
            )

    @contextmanager
    def connect(self, *, create=False):
        db = sqlite3.connect(
            self.path.resolve().as_uri() + ("?mode=rwc" if create else "?mode=rw"),
            uri=True,
            timeout=10,
        )
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def _setting(self, db, key):
        row = db.execute(
            "SELECT value FROM memory_settings WHERE key=?", (key,)
        ).fetchone()
        return int(row["value"]) if row else 1

    def _bump_collection(self, db):
        db.execute(
            "UPDATE memory_settings SET value=CAST(value AS INTEGER)+1 WHERE key='collection_revision'"
        )

    def _bump_preferences(self, db):
        db.execute(
            "UPDATE memory_settings SET value=CAST(value AS INTEGER)+1 WHERE key='preferences_version'"
        )

    def _row(self, db, memory_id):
        row = db.execute(
            """
            SELECT m.*, COALESCE(meta.active,1) AS active, meta.confidence, meta.provenance AS meta_provenance,
                   meta.semantic_key
            FROM user_memory m
            LEFT JOIN memory_meta meta ON meta.memory_id = m.id
            WHERE m.id=?
            """,
            (memory_id,),
        ).fetchone()
        return dict(row) if row else None

    def _hydrate(self, row):
        if not row:
            return row
        out = dict(row)
        out["active"] = bool(out.pop("active", 1))
        out.pop("meta_provenance", None)
        out.pop("semantic_key", None)
        out.pop("confidence", None)
        return out

    def preferences_version(self):
        with self.connect() as db:
            return self._setting(db, "preferences_version")

    def collection_revision(self):
        with self.connect() as db:
            return self._setting(db, "collection_revision")

    def _preferences_from(self, db):
        defaults = {"enabled": True, "auto_capture": False}
        data = dict(db.execute("SELECT key,value FROM memory_preferences"))
        out = {}
        for key in ("enabled", "auto_capture"):
            if key in data:
                out[key] = data[key] == "true"
            else:
                out[key] = defaults[key]
        return out

    def preferences(self):
        with self.connect() as db:
            return self._preferences_from(db)

    def configure(self, data, *, preferences_version):
        if preferences_version is None:
            raise MemoryConflict("需要 preferences_version。")
        if (
            not data
            or not set(data) <= {"enabled", "auto_capture"}
            or any(type(v) is not bool for v in data.values())
        ):
            raise ValueError("Invalid memory preferences")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if self._setting(db, "preferences_version") != int(preferences_version):
                raise MemoryConflict("记忆设置已变更，请刷新后重试。")
            current = self._preferences_from(db)
            if all(current[key] == value for key, value in data.items()):
                return current
            db.executemany(
                "INSERT INTO memory_preferences VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                [(k, str(v).lower()) for k, v in data.items()],
            )
            self._bump_preferences(db)
            current = self._preferences_from(db)
        return current

    def _list(self, db):
        return [
            self._hydrate(dict(r))
            for r in db.execute(
                """
                SELECT m.*, COALESCE(meta.active,1) AS active
                FROM user_memory m
                LEFT JOIN memory_meta meta ON meta.memory_id = m.id
                ORDER BY m.updated DESC, m.id
                """
            )
        ]

    def list(self):
        with self.connect() as db:
            return self._list(db)

    def list_active(self):
        return [r for r in self.list() if r.get("active", True)]

    def slot_row(self, topic):
        if not topic:
            return None
        with self.connect() as db:
            row = db.execute(
                """
                SELECT m.*, COALESCE(meta.active,1) AS active
                FROM user_memory m
                LEFT JOIN memory_meta meta ON meta.memory_id = m.id
                WHERE m.topic IS NOT NULL AND m.topic=?
                """,
                (topic,),
            ).fetchone()
        return self._hydrate(dict(row)) if row else None

    def snapshot(self):
        with self.connect() as db:
            db.execute("BEGIN")
            items = self._list(db)
            prefs = self._preferences_from(db)
            preferences_version = self._setting(db, "preferences_version")
            collection_revision = self._setting(db, "collection_revision")
        return {
            "items": items,
            "preferences": prefs,
            "preferences_version": preferences_version,
            "collection_revision": collection_revision,
            "item_count": len(items),
            "summary": build_summary(items, prefs),
        }

    def _prior_active(self, db, memory_id):
        meta = db.execute(
            "SELECT active FROM memory_meta WHERE memory_id=?", (memory_id,)
        ).fetchone()
        return bool(meta["active"]) if meta else True

    def _write_meta(self, db, memory_id, active, source, topic):
        db.execute(
            """
            INSERT INTO memory_meta(memory_id,active,confidence,provenance,semantic_key)
            VALUES(?,?,?,?,?)
            ON CONFLICT(memory_id) DO UPDATE SET
              provenance=COALESCE(excluded.provenance, memory_meta.provenance),
              semantic_key=COALESCE(excluded.semantic_key, memory_meta.semantic_key),
              active=excluded.active
            """,
            (memory_id, 1 if active else 0, 1.0, source, topic),
        )

    def _next_active(self, prior, active):
        if active is None:
            return prior
        if type(active) is not bool:
            raise ValueError("Invalid active flag")
        return active

    def _mark(self, db, memory_id, *, deduped=False, replaced=False):
        item = self._hydrate(self._row(db, memory_id))
        item["_deduped"] = deduped
        item["_replaced"] = replaced
        return item

    def _update_row(self, db, memory_id, content, category, topic, source, chat_id, message_id, active):
        db.execute(
            """
            UPDATE user_memory
            SET content=?,category=?,topic=?,source=?,chat_id=?,message_id=?,updated=?,version=version+1
            WHERE id=?
            """,
            (content, category, topic, source, chat_id, message_id, time.time(), memory_id),
        )
        self._write_meta(db, memory_id, active, source, topic)
        return self._mark(db, memory_id, replaced=True)

    def put(
        self,
        content,
        category=None,
        *,
        memory_id=None,
        version=None,
        source="manual",
        chat_id=None,
        message_id=None,
        topic=None,
        active=None,
        allow_slot_replace=False,
    ):
        if not isinstance(content, str) or not 1 <= len(content.strip()) <= 800:
            raise ValueError("记忆需为 1–800 字，且类别有效。")
        if category is not None and category not in ("profile", "preference", "project", "note"):
            raise ValueError("记忆需为 1–800 字，且类别有效。")
        if active is not None and type(active) is not bool:
            raise ValueError("Invalid active flag")
        content = content.strip()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if memory_id:
                if version is None:
                    raise MemoryConflict("需要 version。")
                row = db.execute("SELECT * FROM user_memory WHERE id=?", (memory_id,)).fetchone()
                if not row:
                    raise KeyError(memory_id)
                if version != row["version"]:
                    raise MemoryConflict("记忆已在其他页面更新，请刷新后重试。")
                category = row["category"] if category is None else category
                keep_topic = row["topic"] if topic is None else topic
                prior_active = self._prior_active(db, memory_id)
                next_active = self._next_active(prior_active, active)
                if (
                    content == row["content"]
                    and category == row["category"]
                    and keep_topic == row["topic"]
                    and next_active == prior_active
                ):
                    return self._mark(db, memory_id, deduped=True)
                return self._update_row(
                    db, memory_id, content, category, keep_topic, source, chat_id, message_id, next_active
                )
            category = "preference" if category is None else category
            exact = db.execute(
                "SELECT * FROM user_memory WHERE lower(trim(content))=lower(trim(?))",
                (content,),
            ).fetchone()
            if exact:
                prior_active = self._prior_active(db, exact["id"])
                next_active = self._next_active(prior_active, active)
                same_fact = exact["content"].casefold() == content.casefold() and exact["category"] == category
                if same_fact and next_active == prior_active:
                    return self._mark(db, exact["id"], deduped=True)
                return self._update_row(
                    db,
                    exact["id"],
                    content,
                    category,
                    exact["topic"],
                    source,
                    chat_id,
                    message_id,
                    next_active,
                )
            if topic:
                slot = db.execute(
                    "SELECT * FROM user_memory WHERE topic IS NOT NULL AND topic=?",
                    (topic,),
                ).fetchone()
                if slot:
                    if not allow_slot_replace:
                        return None
                    prior_active = self._prior_active(db, slot["id"])
                    next_active = self._next_active(prior_active, active)
                    if slot["content"] == content and slot["category"] == category and next_active == prior_active:
                        return self._mark(db, slot["id"], deduped=True)
                    return self._update_row(
                        db, slot["id"], content, category, slot["topic"], source, chat_id, message_id, next_active
                    )
            if db.execute("SELECT count(*) FROM user_memory").fetchone()[0] >= self.MAX_ITEMS:
                raise ValueError("全局记忆已满，请整理后再添加。")
            memory_id = str(uuid.uuid4())
            now = time.time()
            db.execute(
                "INSERT INTO user_memory VALUES(?,?,?,?,?,?,?,?,?,1)",
                (memory_id, content, category, topic, source, chat_id, message_id, now, now),
            )
            self._write_meta(db, memory_id, True if active is None else active, source, topic)
            return self._mark(db, memory_id)

    def set_active(self, memory_id, active, *, version):
        if version is None:
            raise MemoryConflict("需要 version。")
        if type(active) is not bool:
            raise ValueError("Invalid active flag")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM user_memory WHERE id=?", (memory_id,)).fetchone()
            if not row:
                raise KeyError(memory_id)
            if version != row["version"]:
                raise MemoryConflict("记忆已在其他页面更新，请刷新后重试。")
            if self._prior_active(db, memory_id) == active:
                return self._mark(db, memory_id, deduped=True)
            db.execute(
                "UPDATE user_memory SET updated=?,version=version+1 WHERE id=?",
                (time.time(), memory_id),
            )
            db.execute(
                """
                INSERT INTO memory_meta(memory_id,active,confidence,provenance,semantic_key)
                VALUES(?,?,1,?,?)
                ON CONFLICT(memory_id) DO UPDATE SET active=excluded.active
                """,
                (memory_id, 1 if active else 0, row["source"], row["topic"]),
            )
            return self._hydrate(self._row(db, memory_id))

    def delete(self, memory_id, *, version):
        if version is None:
            raise MemoryConflict("需要 version。")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM user_memory WHERE id=?", (memory_id,)).fetchone()
            if not row:
                raise KeyError(memory_id)
            if version != row["version"]:
                raise MemoryConflict("记忆已在其他页面更新，请刷新后重试。")
            db.execute("DELETE FROM memory_meta WHERE memory_id=?", (memory_id,))
            if db.execute("DELETE FROM user_memory WHERE id=?", (memory_id,)).rowcount == 0:
                raise KeyError(memory_id)

    def clear(self, *, confirm=False, collection_revision=None):
        if not confirm:
            raise ValueError("需要确认清空记忆。")
        if collection_revision is None:
            raise MemoryConflict("需要 collection_revision。")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if self._setting(db, "collection_revision") != int(collection_revision):
                raise MemoryConflict("记忆列表已变更，请刷新后重试。")
            db.execute("DELETE FROM memory_meta")
            db.execute("DELETE FROM user_memory")
            self._bump_preferences(db)

    def forget_chat(self, chat_id):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            ids = [
                r[0]
                for r in db.execute(
                    "SELECT id FROM user_memory WHERE chat_id=?", (chat_id,)
                ).fetchall()
            ]
            for mid in ids:
                db.execute("DELETE FROM memory_meta WHERE memory_id=?", (mid,))
            db.execute("DELETE FROM user_memory WHERE chat_id=?", (chat_id,))

    def process_turn(self, text, chat_id, message_id):
        from memory_commands import MemoryCommandProcessor

        processor = MemoryCommandProcessor(self)
        return processor.process(text, chat_id, message_id, self.preferences())

    def capture(self, text, chat_id, message_id):
        outcome = self.process_turn(text, chat_id, message_id)
        return outcome.get("saved", []) + outcome.get("updated", [])

    def context(self, query, budget=950):
        if not self.preferences()["enabled"]:
            return "", []
        body, ids, _ = select_for_query(self.list_active(), query, budget=budget)
        return body, ids
