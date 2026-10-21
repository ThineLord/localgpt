"""Local, user-controlled long-term memory. No network or model-generated facts."""
import json
import re
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

from memory_retrieval import build_summary, select_for_query


def token_cost(text):
    return sum(2 if ord(c) > 127 else 0.35 for c in text)


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
            if not db.execute("SELECT 1 FROM memory_settings WHERE key='preferences_version'").fetchone():
                db.execute(
                    "INSERT INTO memory_settings(key,value) VALUES('preferences_version','1')"
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
            row = db.execute(
                "SELECT value FROM memory_settings WHERE key='preferences_version'"
            ).fetchone()
        return int(row["value"]) if row else 1

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

    def configure(self, data):
        if (
            not data
            or not set(data) <= {"enabled", "auto_capture"}
            or any(type(v) is not bool for v in data.values())
        ):
            raise ValueError("Invalid memory preferences")
        with self.connect() as db:
            db.executemany(
                "INSERT INTO memory_preferences VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                [(k, str(v).lower()) for k, v in data.items()],
            )
            db.execute(
                "UPDATE memory_settings SET value=CAST(value AS INTEGER)+1 WHERE key='preferences_version'"
            )
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

    def snapshot(self):
        items = self.list()
        prefs = self.preferences()
        return {
            "items": items,
            "preferences": prefs,
            "preferences_version": self.preferences_version(),
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
                row = db.execute("SELECT * FROM user_memory WHERE id=?", (memory_id,)).fetchone()
                if not row:
                    raise KeyError(memory_id)
                if version != row["version"]:
                    raise MemoryConflict("记忆已在其他页面更新，请刷新后重试。")
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
            else:
                exact = db.execute(
                    "SELECT * FROM user_memory WHERE lower(trim(content))=lower(trim(?))",
                    (content,),
                ).fetchone()
                if exact:
                    memory_id = exact["id"]
                    deduped = True
                    if exact["content"] != content or exact["category"] != category:
                        db.execute(
                            """
                            UPDATE user_memory SET content=?,category=?,source=?,chat_id=?,message_id=?,updated=?,version=version+1
                            WHERE id=?
                            """,
                            (content, category, source, chat_id, message_id, now, memory_id),
                        )
                elif topic:
                    slot = db.execute(
                        "SELECT * FROM user_memory WHERE topic IS NOT NULL AND topic=?",
                        (topic,),
                    ).fetchone()
                    if slot:
                        memory_id = slot["id"]
                        db.execute(
                            """
                            UPDATE user_memory SET content=?,category=?,source=?,chat_id=?,message_id=?,updated=?,version=version+1
                            WHERE id=?
                            """,
                            (content, category, source, chat_id, message_id, now, memory_id),
                        )
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
            db.execute(
                """
                INSERT INTO memory_meta(memory_id,active,confidence,provenance,semantic_key)
                VALUES(?,?,?,?,?)
                ON CONFLICT(memory_id) DO UPDATE SET
                  active=excluded.active,
                  provenance=COALESCE(excluded.provenance, memory_meta.provenance),
                  semantic_key=COALESCE(excluded.semantic_key, memory_meta.semantic_key)
                """,
                (memory_id, 1 if active else 0, 1.0, source, topic),
            )
            item = self._hydrate(self._row(db, memory_id))
            item["_deduped"] = deduped
            return item

    def set_active(self, memory_id, active, *, version=None):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM user_memory WHERE id=?", (memory_id,)).fetchone()
            if not row:
                raise KeyError(memory_id)
            if version is not None and version != row["version"]:
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
            return self._hydrate(self._row(db, memory_id))

    def delete(self, memory_id, *, version=None):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM user_memory WHERE id=?", (memory_id,)).fetchone()
            if not row:
                raise KeyError(memory_id)
            if version is not None and version != row["version"]:
                raise MemoryConflict("记忆已在其他页面更新，请刷新后重试。")
            db.execute("DELETE FROM memory_meta WHERE memory_id=?", (memory_id,))
            if db.execute("DELETE FROM user_memory WHERE id=?", (memory_id,)).rowcount == 0:
                raise KeyError(memory_id)

    def clear(self, *, confirm=False, version=None, item_count=None):
        if not confirm:
            raise ValueError("需要确认清空记忆。")
        current = self.snapshot()
        if version is not None and version != current["preferences_version"]:
            raise MemoryConflict("记忆设置已变更，请刷新后重试。")
        if item_count is not None and item_count != current["item_count"]:
            raise MemoryConflict("记忆列表已变更，请刷新后重试。")
        with self.connect() as db:
            db.execute("DELETE FROM memory_meta")
            db.execute("DELETE FROM user_memory")
            db.execute(
                "UPDATE memory_settings SET value=CAST(value AS INTEGER)+1 WHERE key='preferences_version'"
            )

    def forget_chat(self, chat_id):
        with self.connect() as db:
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
        """Backward-compatible wrapper returning saved ids only."""
        outcome = self.process_turn(text, chat_id, message_id)
        return outcome.get("saved", []) + outcome.get("updated", [])

    def context(self, query, budget=950):
        if not self.preferences()["enabled"]:
            return "", []
        suffix, ids, _ = select_for_query(self.list_active(), query, budget=budget)
        return suffix, ids
