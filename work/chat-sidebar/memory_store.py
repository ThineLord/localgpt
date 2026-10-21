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

    def preferences(self):
        defaults = {"enabled": True, "auto_capture": False}
        with self.connect() as db:
            data = dict(db.execute("SELECT key,value FROM memory_preferences"))
        out = {}
        for key in ("enabled", "auto_capture"):
            if key in data:
                out[key] = data[key] == "true"
            else:
                out[key] = defaults[key]
        return out

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
            db.executemany(
                "INSERT INTO memory_preferences VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                [(k, str(v).lower()) for k, v in data.items()],
            )
            self._bump_preferences(db)
            self._bump_collection(db)
        return self.preferences()

    def list(self):
        with self.connect() as db:
            rows = [
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
        return rows

    def list_active(self):
        return [r for r in self.list() if r.get("active", True)]

    def slot_row(self, topic):
        if not topic:
            return None
        with self.connect() as db:
            row = db.execute(
                "SELECT * FROM user_memory WHERE topic IS NOT NULL AND topic=?",
                (topic,),
            ).fetchone()
        return self._hydrate(dict(row)) if row else None

    def snapshot(self):
        items = self.list()
        prefs = self.preferences()
        return {
            "items": items,
            "preferences": prefs,
            "preferences_version": self.preferences_version(),
            "collection_revision": self.collection_revision(),
            "item_count": len(items),
            "summary": build_summary(items, prefs),
        }

    def put(
        self,
        content,
        category="preference",
        *,
        memory_id=None,
        version=None,
        source="manual",
        chat_id=None,
        message_id=None,
        topic=None,
        active=True,
        allow_slot_replace=False,
    ):
        if (
            not isinstance(content, str)
            or not 1 <= len(content.strip()) <= 800
            or category not in ("profile", "preference", "project", "note")
        ):
            raise ValueError("记忆需为 1–800 字，且类别有效。")
        content = content.strip()
        now = time.time()
        deduped = False
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
                meta = db.execute(
                    "SELECT active FROM memory_meta WHERE memory_id=?", (memory_id,)
                ).fetchone()
                prior_active = bool(meta["active"]) if meta else True
                if content == row["content"] and category == row["category"]:
                    deduped = True
                    existing = self._hydrate(self._row(db, memory_id))
                    existing["_deduped"] = True
                    return existing
                keep_topic = topic if topic is not None else row["topic"]
                db.execute(
                    """
                    UPDATE user_memory SET content=?,category=?,topic=?,source=?,chat_id=?,message_id=?,updated=?,version=version+1
                    WHERE id=?
                    """,
                    (content, category, keep_topic, source, chat_id, message_id, now, memory_id),
                )
                db.execute(
                    """
                    INSERT INTO memory_meta(memory_id,active,confidence,provenance,semantic_key)
                    VALUES(?,?,?,?,?)
                    ON CONFLICT(memory_id) DO UPDATE SET
                      provenance=excluded.provenance,
                      semantic_key=COALESCE(excluded.semantic_key, memory_meta.semantic_key),
                      active=?
                    """,
                    (memory_id, 1 if prior_active else 0, 1.0, source, keep_topic, 1 if prior_active else 0),
                )
                self._bump_collection(db)
                item = self._hydrate(self._row(db, memory_id))
                item["_deduped"] = False
                return item
            else:
                exact = db.execute(
                    "SELECT * FROM user_memory WHERE lower(trim(content))=lower(trim(?))",
                    (content,),
                ).fetchone()
                if exact:
                    memory_id = exact["id"]
                    deduped = True
                    meta = db.execute(
                        "SELECT active FROM memory_meta WHERE memory_id=?", (memory_id,)
                    ).fetchone()
                    prior_active = bool(meta["active"]) if meta else True
                    if exact["content"] != content or exact["category"] != category:
                        db.execute(
                            """
                            UPDATE user_memory SET content=?,category=?,source=?,chat_id=?,message_id=?,updated=?,version=version+1
                            WHERE id=?
                            """,
                            (content, category, source, chat_id, message_id, now, memory_id),
                        )
                        self._bump_collection(db)
                    item = self._hydrate(self._row(db, memory_id))
                    item["_deduped"] = deduped
                    item["active"] = prior_active
                    return item
                elif topic:
                    slot = db.execute(
                        "SELECT * FROM user_memory WHERE topic IS NOT NULL AND topic=?",
                        (topic,),
                    ).fetchone()
                    if slot:
                        if not allow_slot_replace:
                            return None
                        memory_id = slot["id"]
                        db.execute(
                            """
                            UPDATE user_memory SET content=?,category=?,source=?,chat_id=?,message_id=?,updated=?,version=version+1
                            WHERE id=?
                            """,
                            (content, category, source, chat_id, message_id, now, memory_id),
                        )
                        self._bump_collection(db)
                    else:
                        if (
                            db.execute("SELECT count(*) FROM user_memory").fetchone()[0]
                            >= self.MAX_ITEMS
                        ):
                            raise ValueError("全局记忆已满，请整理后再添加。")
                        memory_id = str(uuid.uuid4())
                        db.execute(
                            "INSERT INTO user_memory VALUES(?,?,?,?,?,?,?,?,?,1)",
                            (
                                memory_id,
                                content,
                                category,
                                topic,
                                source,
                                chat_id,
                                message_id,
                                now,
                                now,
                            ),
                        )
                        self._bump_collection(db)
                else:
                    if (
                        db.execute("SELECT count(*) FROM user_memory").fetchone()[0]
                        >= self.MAX_ITEMS
                    ):
                        raise ValueError("全局记忆已满，请整理后再添加。")
                    memory_id = str(uuid.uuid4())
                    db.execute(
                        "INSERT INTO user_memory VALUES(?,?,?,?,?,?,?,?,?,1)",
                        (
                            memory_id,
                            content,
                            category,
                            topic,
                            source,
                            chat_id,
                            message_id,
                            now,
                            now,
                        ),
                    )
                    self._bump_collection(db)
            db.execute(
                """
                INSERT INTO memory_meta(memory_id,active,confidence,provenance,semantic_key)
                VALUES(?,?,?,?,?)
                ON CONFLICT(memory_id) DO UPDATE SET
                  provenance=COALESCE(excluded.provenance, memory_meta.provenance),
                  semantic_key=COALESCE(excluded.semantic_key, memory_meta.semantic_key),
                  active=memory_meta.active
                """,
                (memory_id, 1 if active else 0, 1.0, source, topic),
            )
            item = self._hydrate(self._row(db, memory_id))
            item["_deduped"] = deduped
            return item

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
            now = time.time()
            db.execute(
                "UPDATE user_memory SET updated=?,version=version+1 WHERE id=?",
                (now, memory_id),
            )
            db.execute(
                """
                INSERT INTO memory_meta(memory_id,active,confidence,provenance,semantic_key)
                VALUES(?,?,1,?,?)
                ON CONFLICT(memory_id) DO UPDATE SET active=excluded.active
                """,
                (memory_id, 1 if active else 0, row["source"], row["topic"]),
            )
            self._bump_collection(db)
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
            self._bump_collection(db)

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
            self._bump_collection(db)
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
            if ids:
                self._bump_collection(db)

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
