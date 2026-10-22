"""Independent chat pin metadata (Round 7). Pin state does not touch chat.version/draft_version."""
import time
from storage import Conflict, _pin_row


def _expected_pin_version(value):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError("固定版本无效。")
    return value


def set_pin(store, chat_id, pinned, expected_version):
    if not isinstance(pinned, bool):
        raise ValueError("Invalid pin state.")
    expected_version = _expected_pin_version(expected_version)
    with store.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        chat = db.execute(
            "SELECT id, deleted_at FROM chats WHERE id=?", (chat_id,)
        ).fetchone()
        if not chat:
            raise KeyError(chat_id)
        if chat["deleted_at"] is not None:
            raise ValueError("回收站中的对话不能固定。")
        meta = _pin_row(db, chat_id)
        if meta["pin_version"] != int(expected_version):
            raise Conflict("固定状态已在其他页面更新，请刷新后重试。")
        if pinned:
            now = time.time()
            if db.execute(
                "SELECT 1 FROM chat_pin WHERE chat_id=?", (chat_id,)
            ).fetchone():
                db.execute(
                    "UPDATE chat_pin SET pinned=1, pin_version=pin_version+1, pinned_at=? WHERE chat_id=?",
                    (now, chat_id),
                )
            else:
                db.execute(
                    "INSERT INTO chat_pin(chat_id, pinned, pin_version, pinned_at) VALUES(?, 1, 1, ?)",
                    (chat_id, now),
                )
        elif db.execute(
            "SELECT 1 FROM chat_pin WHERE chat_id=?", (chat_id,)
        ).fetchone():
            db.execute(
                "UPDATE chat_pin SET pinned=0, pin_version=pin_version+1, pinned_at=NULL WHERE chat_id=?",
                (chat_id,),
            )
        meta = _pin_row(db, chat_id)
        return {"chat_id": chat_id, **meta}


def install(store, routes, mutate, reply):
    @routes.patch("/qwen-cn/chats/{chat_id}/pin")
    async def patch_pin(request):
        mutate(request)
        data = await request.json()
        if "pinned" not in data or "pin_version" not in data:
            raise ValueError("缺少固定状态。")
        result = set_pin(
            store,
            request.match_info["chat_id"],
            data["pinned"],
            data["pin_version"],
        )
        return reply(result)
