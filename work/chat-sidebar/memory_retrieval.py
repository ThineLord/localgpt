"""Deterministic memory retrieval for chat context injection.

The marker expression below is a best-effort filter, not a security boundary.
Low-trust facts are returned as data for a separate user-role wrapper. Callers
must not copy them into a system message. Style hints are not unrestricted
instructions.
"""
import json
import re

_STYLE_SLOTS = frozenset({"response_language", "answer_style", "tone"})

_STOPWORDS = frozenset(
    {
        "the",
        "and",
        "for",
        "are",
        "but",
        "not",
        "you",
        "all",
        "can",
        "her",
        "was",
        "one",
        "our",
        "out",
        "什么",
        "怎么",
        "为什么",
        "是否",
        "可以",
        "请问",
        "等于",
        "多少",
    }
)

_INJECTION_MARKERS = re.compile(
    r"(ignore\s+(all\s+)?(previous|prior)\s+instructions|"
    r"system\s*:\s*|<<\s*sys\s*>>|"
    r"你现在是|扮演|role\s*:\s*assistant|"
    r"工具调用|function\s*call|"
    r"sudo\s+|api[_\s-]?key\s*[:=])",
    re.I,
)

_SYNONYMS = {
    "name": {"名字", "姓名", "称呼", "name"},
    "response_language": {"中文", "英文", "chinese", "english", "语言", "language"},
    "answer_style": {"简洁", "详细", "concise", "verbose", "风格", "style"},
}


def token_cost(text):
    return sum(2 if ord(c) > 127 else 0.35 for c in text)


def _terms(text):
    if not isinstance(text, str):
        return set()
    words = set(re.findall(r"[a-z0-9]{2,}", text.lower()))
    for run in re.findall(r"[\u4e00-\u9fff]+", text):
        words.update(run[i : i + 2] for i in range(len(run) - 1))
    return {w for w in words if w not in _STOPWORDS and len(w) > 1}


def _hostile(text):
    return bool(_INJECTION_MARKERS.search(text or ""))


def _slot_terms(row):
    topic = row.get("topic") or ""
    base = _terms(row.get("content", ""))
    if topic in _SYNONYMS:
        base |= {t for t in _SYNONYMS[topic] if t not in _STOPWORDS}
    return base


def _meaningful_overlap(query_terms, row):
    content_terms = _terms(row.get("content", ""))
    slot_terms = _slot_terms(row)
    return len(query_terms & content_terms) + len(query_terms & slot_terms)


def _effect(row):
    if (row.get("topic") or "") in _STYLE_SLOTS:
        return "style_hint"
    return "reference"


def _score_row(row, query_terms):
    if row.get("active") is False:
        return -1
    content = row.get("content") or ""
    if _hostile(content):
        return -1
    topic = row.get("topic") or ""
    cat = row.get("category") or ""
    overlap = _meaningful_overlap(query_terms, row)
    if topic in _STYLE_SLOTS:
        return 2 if overlap >= 0 else -1
    if cat == "preference" and topic not in _STYLE_SLOTS:
        if overlap < 1:
            return -1
    if cat in ("profile", "project") and overlap < 1:
        return -1
    if cat == "note" and overlap < 2:
        return -1
    return overlap * 3 + (1 if cat in ("profile", "preference") else 0)


def select_for_query(rows, query, budget=950):
    """Return (json_payload, chosen_ids, chosen_payload)."""
    query_terms = _terms(query)
    ranked = []
    seen_topics = {}
    for row in sorted(rows, key=lambda r: (r.get("updated") or 0, r.get("id") or ""), reverse=True):
        score = _score_row(row, query_terms)
        if score < 0:
            continue
        topic = row.get("topic")
        if topic and topic in seen_topics:
            continue
        if topic:
            seen_topics[topic] = row["id"]
        ranked.append((score, row))
    ranked.sort(key=lambda pair: (pair[0], pair[1].get("updated") or 0), reverse=True)
    chosen = []
    used = 0
    ids = []
    for _, row in ranked:
        if len(chosen) >= 12:
            break
        payload = {
            "category": row["category"],
            "fact": row["content"],
            "trust": "untrusted",
            "effect": _effect(row),
        }
        cost = token_cost(json.dumps(payload, ensure_ascii=False)) + 20
        if used + cost > budget:
            continue
        chosen.append(payload)
        ids.append(row["id"])
        used += cost
    if not chosen:
        return "", [], []
    return json.dumps(chosen, ensure_ascii=False), ids, chosen


def build_summary(rows, preferences):
    active = [r for r in rows if r.get("active", True)]
    by_cat = {}
    for row in active:
        by_cat[row.get("category", "note")] = by_cat.get(row.get("category", "note"), 0) + 1
    highlights = []
    for row in sorted(active, key=lambda r: r.get("updated") or 0, reverse=True)[:5]:
        text = (row.get("content") or "").strip()
        if len(text) > 72:
            text = text[:69] + "…"
        highlights.append({"id": row["id"], "category": row.get("category"), "preview": text})
    return {
        "counts": {"total": len(rows), "active": len(active), "by_category": by_cat},
        "highlights": highlights,
        "recall_enabled": bool(preferences.get("enabled")),
        "auto_capture": bool(preferences.get("auto_capture")),
    }
