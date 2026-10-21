"""Deterministic explicit memory commands (current user turn only)."""
import re

from memory_store import MemoryConflict

_REMEMBER = re.compile(
    r"^(?:请)?(?:记住|记一下|记下来)[：:,，\s]*(.+)$|"
    r"^(?:please\s+)?remember(?:\s+that)?[：:,\s]+(.+)$",
    re.I | re.S,
)
_FORGET = re.compile(
    r"^(?:请)?(?:忘记|忘掉|删除记忆)[：:,，\s]*(.+)$|"
    r"^(?:please\s+)?forget(?:\s+about)?[：:,\s]+(.+)$",
    re.I | re.S,
)
_CORRECT_QUOTED = re.compile(
    r"^将记忆[「\"“](.+?)[」\"”]修改为[「\"“](.+?)[」\"”][。.!！]?$",
    re.I | re.S,
)
_CORRECT_ABOUT = re.compile(
    r"^修改我之前关于[「\"“]?(.+?)[」\"”]?的记忆[：:,，\s]*(.+)$",
    re.I | re.S,
)
_STYLE = re.compile(
    r"^(?:以后|今后)(?:回答|回复)时请[：:,，\s]*(.+)$|"
    r"^(?:from\s+now\s+on|going\s+forward),?\s+please\s+(.+)$",
    re.I | re.S,
)

_SECRET = re.compile(
    r"(密码|密钥|银行卡|身份证|password|api.?key|secret|credit.card|ssn)",
    re.I,
)

_STATEMENT_PATTERNS = [
    (re.compile(r"^(?:我的名字是|我叫|my name is)\s*([^。.!！\n]{1,60})[。.!！]?$", re.I), "profile", "name"),
    (
        re.compile(r"^(?:我(?:更|比较)?喜欢|我偏好|我习惯|i prefer|i like|i usually)\s*[^？?\n]{1,150}[。.!！]?$", re.I),
        "preference",
        None,
    ),
    (re.compile(r"^(?:我是|我的工作是|i work as|i am an?)\s*[^？?\n]{1,120}[。.!！]?$", re.I), "profile", None),
]


def _normalize_match(text):
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _reject_capture_text(text):
    if not isinstance(text, str) or not text.strip():
        return True
    if len(text) > 800:
        return True
    if "```" in text or text.strip().startswith(">") or "?" in text or "？" in text:
        return True
    if _SECRET.search(text):
        return True
    if _REMEMBER.search(text.strip()) is None and re.search(
        r"(ignore\s+all|system\s*:|你现在是|扮演|sudo\s+)", text, re.I
    ):
        return True
    return False


def _match_rows(store, needle, *, topic=None):
    needle_n = _normalize_match(needle)
    hits = []
    for row in store.list_active():
        content_n = _normalize_match(row["content"])
        if needle_n and (needle_n in content_n or content_n in needle_n):
            hits.append(row)
            continue
        if topic and row.get("topic") == topic:
            hits.append(row)
    if topic:
        topic_hits = [r for r in store.list_active() if r.get("topic") == topic]
        if topic_hits and not hits:
            hits = topic_hits
    return hits


class MemoryCommandProcessor:
    def __init__(self, store):
        self.store = store

    def process(self, text, chat_id, message_id, preferences):
        result = {
            "saved": [],
            "updated": [],
            "forgotten": [],
            "notice": None,
            "status": None,
        }
        if not isinstance(text, str):
            return result
        raw = text.strip()
        if not raw or _reject_capture_text(raw):
            return result

        if not preferences.get("enabled"):
            if _REMEMBER.search(raw) or _STYLE.search(raw) or _CORRECT_QUOTED.search(raw) or _CORRECT_ABOUT.search(raw):
                result["notice"] = "记忆已暂停，聊天中不会保存或引用记忆。可在设置中重新开启。"
                result["status"] = "disabled"
            return result

        forget = _FORGET.match(raw)
        if forget:
            return self._forget(forget.group(1).strip(), result)

        quoted = _CORRECT_QUOTED.match(raw)
        if quoted:
            return self._correct_known(quoted.group(1).strip(), quoted.group(2).strip(), result)

        about = _CORRECT_ABOUT.match(raw)
        if about:
            return self._correct_known(about.group(1).strip(), about.group(2).strip(), result)

        style = _STYLE.match(raw)
        if style:
            value = style.group(1).strip()
            if not value or len(value) > 800:
                return result
            row = self.store.put(
                value,
                "preference",
                source="explicit",
                chat_id=chat_id,
                message_id=message_id,
                topic="answer_style",
            )
            result["updated" if row.get("_deduped") else "saved"].append(row["id"])
            result["status"] = "updated" if row.get("_deduped") else "saved"
            return result

        remember = _REMEMBER.match(raw)
        if remember:
            value = remember.group(1).strip()
            return self._save_explicit(value, chat_id, message_id, result)

        if not preferences.get("auto_capture"):
            return result

        return self._auto_statement(raw, chat_id, message_id, result)

    def _save_explicit(self, value, chat_id, message_id, result):
        if not value or len(value) > 800:
            return result
        category, topic = self._classify(value)
        row = self.store.put(
            value,
            category,
            source="explicit",
            chat_id=chat_id,
            message_id=message_id,
            topic=topic,
        )
        key = "updated" if row.get("_deduped") else "saved"
        result[key].append(row["id"])
        result["status"] = key
        return result

    def _auto_statement(self, text, chat_id, message_id, result):
        category = "note"
        topic = None
        matched = False
        for pattern, cat, key in _STATEMENT_PATTERNS:
            if pattern.match(text):
                category, topic, matched = cat, key, True
                break
        if not matched:
            return result
        if re.search(
            r"(中文|英文|Chinese|English).*(回答|回复|answer|response)|(answer|respond|reply).*\b(Chinese|English)\b",
            text,
            re.I,
        ):
            category, topic = "preference", "response_language"
        row = self.store.put(
            text.strip(),
            category,
            source="statement",
            chat_id=chat_id,
            message_id=message_id,
            topic=topic,
        )
        key = "updated" if row.get("_deduped") else "saved"
        result[key].append(row["id"])
        result["status"] = key
        return result

    def _forget(self, needle, result):
        hits = _match_rows(self.store, needle)
        if not hits:
            result["notice"] = "未找到匹配的记忆，未删除任何内容。"
            result["status"] = "rejected"
            return result
        if len(hits) > 1:
            result["notice"] = "有多条记忆与描述相近，请用「将记忆“…”修改为“…”」或到设置中指定删除。"
            result["status"] = "ambiguous"
            return result
        self.store.delete(hits[0]["id"], version=hits[0]["version"])
        result["forgotten"].append(hits[0]["id"])
        result["status"] = "forgotten"
        return result

    def _correct_known(self, old_fragment, new_value, result):
        if not new_value or len(new_value) > 800:
            result["notice"] = "更正内容无效。"
            result["status"] = "rejected"
            return result
        hits = _match_rows(self.store, old_fragment)
        if not hits:
            result["notice"] = "未找到要修改的记忆。"
            result["status"] = "rejected"
            return result
        if len(hits) > 1:
            result["notice"] = "匹配到多条记忆，请提供更精确的原文片段。"
            result["status"] = "ambiguous"
            return result
        row = hits[0]
        try:
            updated = self.store.put(
                new_value,
                row["category"],
                memory_id=row["id"],
                version=row["version"],
                source="explicit",
                chat_id=row.get("chat_id"),
                message_id=row.get("message_id"),
                topic=row.get("topic"),
            )
        except MemoryConflict as error:
            result["notice"] = str(error)
            result["status"] = "rejected"
            return result
        result["updated"].append(updated["id"])
        result["status"] = "updated"
        return result

    def _classify(self, value):
        category = "note"
        topic = None
        for pattern, cat, key in _STATEMENT_PATTERNS:
            if pattern.match(value):
                return cat, key
        if re.search(
            r"(中文|英文|Chinese|English).*(回答|回复|answer|response)|(answer|respond|reply).*\b(Chinese|English)\b",
            value,
            re.I,
        ):
            return "preference", "response_language"
        if re.search(r"(简洁|详细|concise|详细回答|简短)", value, re.I):
            return "preference", "answer_style"
        return category, topic
