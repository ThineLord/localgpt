"""Deterministic explicit memory commands (current user turn only)."""
import re

from memory_retrieval import unsafe_for_recall
from memory_store import MemoryConflict

# A payload needs punctuation or whitespace after the verb. 记住了吗 is not 记住 + 了吗.
_REMEMBER_PUNCT = re.compile(
    r"^(?:请)?(?:记住|记一下|记下来)\s*[：:，,]\s*(\S.*?)\s*$|"
    r"^(?:please\s+)?remember\s*[:：]\s*(\S.*?)\s*$",
    re.I | re.S,
)
_REMEMBER_LOOSE = re.compile(
    r"^(?:请)?(?:记住|记一下|记下来)[ \t]+(\S.*?)\s*$|"
    r"^(?:请)?(?:记住|记一下|记下来)(我的\S.*?)\s*$|"
    r"^(?:please\s+)?remember\s+that\s+(\S.*?)\s*$|"
    r"^(?:please\s+)?remember\s+(?!that\b)(\S.*?)\s*$",
    re.I | re.S,
)
_FORGET_PUNCT = re.compile(
    r"^(?:请)?(?:忘记|忘掉|删除记忆)\s*[：:，,]\s*(\S.*?)\s*$|"
    r"^(?:please\s+)?forget\s*[:：]\s*(\S.*?)\s*$",
    re.I | re.S,
)
_FORGET_LOOSE = re.compile(
    r"^(?:请)?(?:忘记|忘掉|删除记忆)[ \t]+(\S.*?)\s*$|"
    r"^(?:please\s+)?forget\s+about\s+(\S.*?)\s*$|"
    r"^(?:please\s+)?forget\s+(?!about\b)(\S.*?)\s*$",
    re.I | re.S,
)
_OPEN_QUESTION = re.compile(
    r"^(?:whether|if|what|why|how|when|who|which|did|do|does|is|are|can|could|would|should)\b|"
    r"^(?:是不是|什么|为什么|怎么|如何)",
    re.I,
)
_NEGATION = re.compile(r"(不要|别删|并非|do\s+not|don't|never)", re.I)
# Fragment form keeps the rest of the fact. About form replaces the whole fact.
_CORRECT_QUOTED_ZH = re.compile(
    r'^将记忆[「\"“](.+?)[」\"”]修改为[「\"“](.+?)[」\"”][。.!！]?$',
    re.S,
)
_CORRECT_QUOTED_EN = re.compile(
    r'^(?:please\s+)?(?:correct|change|update)(?:\s+the)?\s+memory\s+'
    r'["“「](.+?)["”」]\s+to\s+["“「](.+?)["”」][.!]?$',
    re.I | re.S,
)
_CORRECT_ABOUT_ZH = re.compile(
    r'^修改我之前关于[「\"“](.+?)[」\"”]的记忆[：:,，\s]+(.+)$'
    r'|^修改我之前关于([^「\"“].*?)的记忆[：:,，\s]+(.+)$',
    re.S,
)
_CORRECT_ABOUT_EN = re.compile(
    r'^(?:please\s+)?(?:correct|change|update)\s+my\s+memory\s+about\s+'
    r'["“「](.+?)["”」]\s*(?:to|:)\s+(.+)$'
    r'|^(?:please\s+)?(?:correct|change|update)\s+my\s+memory\s+about\s+'
    r'([^"“「].*?)\s*(?:to|:)\s+(.+)$',
    re.I | re.S,
)
_STYLE = re.compile(
    r"^(?:以后|今后)(?:回答|回复)时请[：:,，\s]*(.+)$|"
    r"^(?:from\s+now\s+on|going\s+forward),?\s+please\s+(.+)$",
    re.I | re.S,
)
_LANGUAGE_HINT = re.compile(r"中文|汉语|英文|英语|Chinese|English", re.I)
_VERBOSITY_HINT = re.compile(r"简洁|简短|精简|详细|详尽|concise|brief|verbose|detailed", re.I)
_TONE_HINT = re.compile(r"正式|随意|口语|formal|casual", re.I)

_SECRET = re.compile(
    r"(密码|密钥|银行卡|身份证|password|api.?key|secret|credit.card|ssn)",
    re.I,
)
_UNSAFE = re.compile(
    r"(ignore\s+all|system\s*:|你现在是|扮演|sudo\s+|role\s*:\s*assistant)",
    re.I,
)

_STATEMENT_PATTERNS = [
    (re.compile(r"^(?:我的名字是|我叫|my name is)\s*([^。.!！\n]{1,60})[。.!！]?$", re.I), "profile", "name"),
    (
        re.compile(
            r"^(?:我(?:更|比较)?喜欢|我偏好|我习惯|i prefer|i like|i usually)\s*[^？?\n]{1,150}[。.!！]?$",
            re.I,
        ),
        "preference",
        None,
    ),
    (re.compile(r"^(?:我是|我的工作是|i work as|i am an?)\s*[^？?\n]{1,120}[。.!！]?$", re.I), "profile", None),
]


def _group_value(match):
    if not match:
        return ""
    return next((g.strip() for g in match.groups() if g), "")


def _is_question(text):
    raw = (text or "").strip()
    if not raw:
        return False
    if "?" in raw or "？" in raw:
        return True
    return bool(re.search(r"[吗呢么嘛][。.!！…]*$", raw))


def _usable_payload(value):
    value = (value or "").strip()
    if not value or not re.search(r"[\w\u4e00-\u9fff]", value):
        return None
    return value


def _bounded_value(text, punct, loose):
    """Return a payload only for an imperative with a real boundary. Questions return None."""
    raw = (text or "").strip()
    if _is_question(raw):
        return None
    match = punct.match(raw)
    if match:
        return _usable_payload(_group_value(match))
    match = loose.match(raw)
    if not match:
        return None
    value = _usable_payload(_group_value(match))
    if value is None or _OPEN_QUESTION.match(value):
        return None
    return value


def _remember_value(text):
    return _bounded_value(text, _REMEMBER_PUNCT, _REMEMBER_LOOSE)


def _forget_value(text):
    return _bounded_value(text, _FORGET_PUNCT, _FORGET_LOOSE)


def _normalize_match(text):
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _unsafe_payload(text):
    return bool(_UNSAFE.search(text or "")) or unsafe_for_recall(text)


def _reject_capture_text(text):
    if not isinstance(text, str) or not text.strip():
        return True
    if len(text) > 800:
        return True
    if "```" in text or text.strip().startswith(">") or "?" in text or "？" in text:
        return True
    if _SECRET.search(text):
        return True
    if _unsafe_payload(text):
        return True
    return False


def _strip_wrapping_quotes(text):
    value = (text or "").strip()
    for left, right in (('"', '"'), ("“", "”"), ("「", "」"), ("'", "'")):
        if len(value) >= 2 and value.startswith(left) and value.endswith(right):
            return value[1:-1].strip()
    return value


def _paired_groups(match):
    groups = [g for g in match.groups() if g is not None]
    if len(groups) < 2:
        return "", ""
    return groups[0].strip(), _strip_wrapping_quotes(groups[1])


def _quoted_correction(text):
    for pattern in (_CORRECT_QUOTED_ZH, _CORRECT_QUOTED_EN):
        match = pattern.match(text)
        if match:
            old, new = _paired_groups(match)
            return old, new
    return None


def _about_correction(text):
    for pattern in (_CORRECT_ABOUT_ZH, _CORRECT_ABOUT_EN):
        match = pattern.match(text)
        if match:
            old, new = _paired_groups(match)
            return old, new
    return None


def _explicit_command(text):
    raw = (text or "").strip()
    if not raw or _is_question(raw):
        return False
    return bool(
        _remember_value(raw) is not None
        or _forget_value(raw) is not None
        or _quoted_correction(raw)
        or _about_correction(raw)
        or _STYLE.match(raw)
    )


_COMMAND_REPLY = {
    "zh": {
        "saved": "已保存这条记忆。",
        "updated": "已更新这条记忆。",
        "forgotten": "已删除匹配的记忆。",
        "ambiguous": "没有执行：匹配到的记忆不唯一。",
        "rejected": "没有保存、修改或删除记忆。",
        "disabled": "记忆已暂停，这次没有保存、修改或删除。",
    },
    "en": {
        "saved": "Saved this memory.",
        "updated": "Updated this memory.",
        "forgotten": "Deleted the matching memory.",
        "ambiguous": "Not done: more than one memory matched.",
        "rejected": "Did not save, change, or delete a memory.",
        "disabled": "Memory is paused, so this was not saved, changed, or deleted.",
    },
}


def command_reply(prompt, outcome):
    """Fixed confirmation for an explicit command. None means the turn still needs the model."""
    if not _explicit_command(prompt or ""):
        return None
    status = (outcome or {}).get("status")
    if status not in _COMMAND_REPLY["zh"]:
        return None
    english = re.match(
        r"(?is)^\s*(?:please\s+)?(?:remember|forget|correct|change|update)\b|"
        r"^\s*(?:from\s+now\s+on|going\s+forward)\b",
        prompt or "",
    )
    return _COMMAND_REPLY["en" if english else "zh"][status]


def _splice_fragment(content, old, new):
    """Replace one occurrence. 'ambiguous' if the fragment repeats; 'missing' if absent."""
    if not old:
        return "missing"
    exact = content.count(old)
    if exact > 1:
        return "ambiguous"
    if exact == 1:
        return content.replace(old, new, 1)
    matches = list(re.finditer(re.escape(old), content, flags=re.IGNORECASE))
    if len(matches) > 1:
        return "ambiguous"
    if len(matches) == 1:
        found = matches[0]
        return content[: found.start()] + new + content[found.end() :]
    return "missing"


def _rows_with_fragment(store, fragment):
    exact, folded = [], []
    needle = fragment.casefold()
    for row in store.list():
        content = row["content"]
        if fragment in content:
            exact.append(row)
        elif needle and needle in content.casefold():
            folded.append(row)
    return exact or folded


def _rows_about(store, selector):
    needle = selector.casefold()
    if len(needle) < 2:
        return None
    return [row for row in store.list() if needle in (row.get("content") or "").casefold()]


def _truthful(result):
    status = result.get("status")
    if status in ("disabled", "rejected", "ambiguous"):
        result["saved"] = []
        result["updated"] = []
        result["forgotten"] = []
    if status == "saved" and not result.get("saved"):
        result["status"] = "rejected"
        result["notice"] = result.get("notice") or "未保存记忆。"
    elif status == "updated" and not result.get("updated"):
        result["status"] = "rejected"
        result["notice"] = result.get("notice") or "未更新记忆。"
    elif status == "forgotten" and not result.get("forgotten"):
        result["status"] = "rejected"
        result["notice"] = result.get("notice") or "未删除记忆。"
    return result


def _match_rows(store, needle, *, topic=None):
    """Match an explicit target. A longer sentence that merely contains a short fact is not a target."""
    needle_n = _normalize_match(needle)
    if not needle_n:
        return []
    negative = bool(_NEGATION.search(needle or ""))
    hits = []
    seen = set()

    def add(row):
        if row["id"] not in seen:
            seen.add(row["id"])
            hits.append(row)

    for row in store.list():
        content_n = _normalize_match(row.get("content") or "")
        row_topic = _normalize_match(row.get("topic") or "")
        exact = bool(content_n) and needle_n == content_n
        inside = bool(content_n) and needle_n in content_n
        topic_hit = bool(row_topic) and needle_n == row_topic
        if exact or topic_hit:
            add(row)
        elif inside and not negative:
            add(row)
    if topic:
        wanted = _normalize_match(topic)
        for row in store.list():
            if _normalize_match(row.get("topic") or "") == wanted:
                add(row)
    return hits


class MemoryCommandProcessor:
    def __init__(self, store):
        self.store = store

    def process(self, text, chat_id, message_id, preferences):
        return _truthful(self._process(text, chat_id, message_id, preferences))

    def _process(self, text, chat_id, message_id, preferences):
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
        if not raw or _is_question(raw):
            return result

        explicit_intent = _explicit_command(raw)

        if not preferences.get("enabled"):
            if explicit_intent:
                result["notice"] = "记忆已暂停，聊天中不会保存、删除或引用记忆。可在设置中重新开启。"
                result["status"] = "disabled"
            return result

        if not explicit_intent and _reject_capture_text(raw):
            return result

        forget = _forget_value(raw)
        if forget is not None:
            return self._forget(forget, result)

        quoted = _quoted_correction(raw)
        if quoted:
            return self._correct_fragment(quoted[0], quoted[1], chat_id, message_id, result)

        about = _about_correction(raw)
        if about:
            return self._correct_full(about[0], about[1], chat_id, message_id, result)

        style = _STYLE.match(raw)
        if style:
            return self._save_style(_group_value(style), chat_id, message_id, result)

        remember = _remember_value(raw)
        if remember is not None:
            value = remember
            if _unsafe_payload(value):
                result["notice"] = "无法保存含系统或权限指令的内容。"
                result["status"] = "rejected"
                return result
            return self._save_explicit(value, chat_id, message_id, result)

        if not preferences.get("auto_capture"):
            return result

        if _reject_capture_text(raw):
            return result
        return self._auto_statement(raw, chat_id, message_id, result)

    def _style_assignments(self, value):
        """Map a style sentence onto separate slots. Unknown text gets no slot."""
        language = verbosity = tone = None
        if re.search(r"中文|汉语|Chinese", value, re.I):
            language = "用中文回答。"
        elif re.search(r"英文|英语|English", value, re.I):
            language = "Answer in English."
        if re.search(r"简洁|简短|精简|concise|brief", value, re.I):
            verbosity = "请简洁回答。"
        elif re.search(r"详细|详尽|verbose|detailed", value, re.I):
            verbosity = "请详细回答。"
        if re.search(r"正式|formal", value, re.I):
            tone = "请用正式语气。"
        elif re.search(r"随意|口语|casual", value, re.I):
            tone = "请用随意语气。"
        slots = []
        if language and _LANGUAGE_HINT.search(value):
            slots.append(("response_language", language))
        if verbosity and _VERBOSITY_HINT.search(value):
            slots.append(("answer_style", verbosity))
        if tone and _TONE_HINT.search(value):
            slots.append(("tone", tone))
        return slots

    def _save_style(self, value, chat_id, message_id, result):
        if not value or len(value) > 800 or _unsafe_payload(value):
            result["notice"] = "无法保存该偏好表述。"
            result["status"] = "rejected"
            return result
        slots = self._style_assignments(value)
        if not slots:
            row = self.store.put(
                value,
                "preference",
                source="explicit",
                chat_id=chat_id,
                message_id=message_id,
                topic=None,
                allow_slot_replace=False,
            )
            if row is None:
                result["notice"] = "无法保存该偏好表述。"
                result["status"] = "rejected"
                return result
            return self._record_write(row, result)
        written = []
        for topic, normalized in slots:
            content = value if len(slots) == 1 else normalized
            row = self.store.put(
                content,
                "preference",
                source="explicit",
                chat_id=chat_id,
                message_id=message_id,
                topic=topic,
                allow_slot_replace=True,
            )
            if row is None:
                result["notice"] = "已有冲突的记忆槽位，未自动覆盖。"
                result["status"] = "rejected"
                return result
            written.append(row)
        for row in written:
            key = "updated" if row.get("_deduped") or row.get("_replaced") else "saved"
            result[key].append(row["id"])
        result["status"] = "updated" if result["updated"] else "saved"
        if any(not row.get("active", True) for row in written):
            result["notice"] = "已写入该记忆，但它当前处于停用状态，不会被引用。可在设置中重新启用。"
        return result

    def _record_write(self, row, result):
        key = "updated" if row.get("_deduped") or row.get("_replaced") else "saved"
        result[key].append(row["id"])
        result["status"] = key
        if not row.get("active", True):
            result["notice"] = "已写入该记忆，但它当前处于停用状态，不会被引用。可在设置中重新启用。"
        return result

    def _save_explicit(self, value, chat_id, message_id, result):
        if not value or len(value) > 800 or _SECRET.search(value) or _unsafe_payload(value):
            result["notice"] = "无法保存该内容。"
            result["status"] = "rejected"
            return result
        category, topic = self._classify(value)
        row = self.store.put(
            value,
            category,
            source="explicit",
            chat_id=chat_id,
            message_id=message_id,
            topic=topic,
            allow_slot_replace=True,
        )
        if row is None:
            result["notice"] = "已有相关记忆，请使用更正句式修改。"
            result["status"] = "rejected"
            return result
        return self._record_write(row, result)

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
        if topic and self.store.slot_row(topic):
            result["notice"] = "已有相关记忆，自动捕获不会覆盖。"
            result["status"] = "rejected"
            return result
        row = self.store.put(
            text.strip(),
            category,
            source="statement",
            chat_id=chat_id,
            message_id=message_id,
            topic=topic,
            allow_slot_replace=False,
        )
        if row is None:
            result["status"] = "rejected"
            return result
        return self._record_write(row, result)

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
        row = hits[0]
        try:
            self.store.delete(row["id"], version=row["version"])
        except MemoryConflict as error:
            result["notice"] = str(error)
            result["status"] = "rejected"
            result["forgotten"] = []
            return result
        except KeyError:
            result["notice"] = "未找到匹配的记忆，未删除任何内容。"
            result["status"] = "rejected"
            result["forgotten"] = []
            return result
        result["forgotten"].append(row["id"])
        result["status"] = "forgotten"
        return result

    def _reject_replacement(self, new_value, result):
        if (
            not new_value
            or len(new_value) > 800
            or _unsafe_payload(new_value)
            or _SECRET.search(new_value)
        ):
            result["notice"] = "更正内容无效。"
            result["status"] = "rejected"
            return True
        return False

    def _write_correction(self, row, content, chat_id, message_id, result):
        if not content or len(content) > 800 or _unsafe_payload(content) or _SECRET.search(content):
            result["notice"] = "更正后的记忆无效，未修改。"
            result["status"] = "rejected"
            return result
        try:
            updated = self.store.put(
                content,
                row["category"],
                memory_id=row["id"],
                version=row["version"],
                source="explicit",
                chat_id=chat_id,
                message_id=message_id,
                topic=row.get("topic"),
                allow_slot_replace=True,
            )
        except MemoryConflict as error:
            result["notice"] = str(error)
            result["status"] = "rejected"
            return result
        result["updated"].append(updated["id"])
        result["status"] = "updated"
        if not updated.get("active", True):
            result["notice"] = "已修改该记忆，但它当前处于停用状态，不会被引用。可在设置中重新启用。"
        return result

    def _correct_fragment(self, old_fragment, new_value, chat_id, message_id, result):
        if self._reject_replacement(new_value, result):
            return result
        hits = _rows_with_fragment(self.store, old_fragment)
        if not hits:
            result["notice"] = "未找到要修改的记忆。"
            result["status"] = "rejected"
            return result
        if len(hits) > 1:
            result["notice"] = "匹配到多条记忆，请提供更精确的原文片段。"
            result["status"] = "ambiguous"
            return result
        row = hits[0]
        spliced = _splice_fragment(row["content"], old_fragment, new_value)
        if spliced == "ambiguous":
            result["notice"] = "原文片段在这条记忆中出现多次，未修改。请改用「修改我之前关于…的记忆」。"
            result["status"] = "ambiguous"
            return result
        if spliced == "missing" or not isinstance(spliced, str):
            result["notice"] = "未找到可替换的原文片段，未整段覆盖。"
            result["status"] = "rejected"
            return result
        return self._write_correction(row, spliced, chat_id, message_id, result)

    def _correct_full(self, selector, new_value, chat_id, message_id, result):
        if self._reject_replacement(new_value, result):
            return result
        hits = _rows_about(self.store, selector)
        if hits is None:
            result["notice"] = "修改范围太宽，请写明要改的是哪一条记忆。"
            result["status"] = "ambiguous"
            return result
        if not hits:
            result["notice"] = "未找到要修改的记忆。"
            result["status"] = "rejected"
            return result
        if len(hits) > 1:
            result["notice"] = "匹配到多条记忆，请提供更精确的原文片段。"
            result["status"] = "ambiguous"
            return result
        return self._write_correction(hits[0], new_value, chat_id, message_id, result)

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
