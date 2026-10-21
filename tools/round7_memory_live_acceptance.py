#!/usr/bin/env python3
"""LM Studio loopback acceptance for Round 7 memory (isolated synthetic DB only).

Requires LM Studio (or compatible server) on http://127.0.0.1:1234 with a loaded chat model.

Example:
  python3 tools/round7_memory_live_acceptance.py --database /tmp/r7mem.sqlite3 --create
"""
import argparse
import json
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "work" / "chat-sidebar"
sys.path.insert(0, str(ROOT))

from memory_store import MemoryStore  # noqa: E402

LM_URL = "http://127.0.0.1:1234"
BACKEND = "http://127.0.0.1:8188"


def http_json(url, method="GET", payload=None, timeout=120):
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def lm_chat(prompt, system_extra=""):
    system = (
        "你是 LocalGPT，本地运行的助手。跟随用户的语言回答，准确、清晰。"
        + system_extra
    )
    body = {
        "model": "local-model",
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
        "max_tokens": 256,
        "stream": False,
    }
    return http_json(LM_URL + "/v1/chat/completions", "POST", body)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--database",
        required=True,
        help="Path to an isolated SQLite file (must not be your real LocalGPT DB)",
    )
    parser.add_argument(
        "--create",
        action="store_true",
        help="Create a fresh database file (fails if file exists without --create)",
    )
    parser.add_argument("--lm-url", default=LM_URL)
    args = parser.parse_args()
    global LM_URL
    LM_URL = args.lm_url.rstrip("/")

    db = Path(args.database).expanduser().resolve()
    if db.exists() and not args.create:
        print("Refusing to use existing database without --create", file=sys.stderr)
        sys.exit(2)
    if args.create and db.exists():
        db.unlink()
    db.parent.mkdir(parents=True, exist_ok=True)

    mem = MemoryStore(db)
    mem.configure({"enabled": True, "auto_capture": False})

    try:
        http_json(LM_URL + "/api/v1/models")
    except (urllib.error.URLError, TimeoutError) as err:
        print(f"LM Studio not reachable at {LM_URL}: {err}", file=sys.stderr)
        sys.exit(3)

    fact = "用户最喜欢的颜色是钴蓝色。"
    mem.process_turn("记住：" + fact, "live-chat", "m1")
    ctx, ids = mem.context("最喜欢的颜色是什么？")
    assert ids, "retrieval should select saved memory"
    r1 = lm_chat("我最喜欢的颜色是什么？", ctx)
    answer1 = r1["choices"][0]["message"]["content"]
    print("Before correction:", answer1[:200])

    mem.process_turn('将记忆"钴蓝色"修改为"琥珀色"', "live-chat", "m2")
    ctx2, ids2 = mem.context("颜色")
    r2 = lm_chat("我最喜欢的颜色是什么？", ctx2)
    answer2 = r2["choices"][0]["message"]["content"]
    print("After correction:", answer2[:200])
    print("Selected IDs:", ids2)

    mem.process_turn("忘记：钴蓝色", "live-chat", "m3")
    ctx3, ids3 = mem.context("颜色")
    assert not ids3
    r3 = lm_chat("我最喜欢的颜色是什么？", ctx3)
    print("After forget (no memory block):", r3["choices"][0]["message"]["content"][:200])

    mem.configure({"enabled": False})
    out = mem.process_turn("记住：不应保存", "live-chat", "m4")
    assert out.get("status") == "disabled"
    print("Disabled capture status:", out)

    print("round7_memory_live_acceptance: OK")


if __name__ == "__main__":
    main()
