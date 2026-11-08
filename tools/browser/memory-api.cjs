// Current contract adapted from round7_memory_api_acceptance.js. Run via tools/validate.py.
/**
 * Round 7 memory API acceptance against synthetic demo (no Playwright required).
 * Usage: node tools/round7_memory_api_acceptance.js [baseUrl]
 */
const base = process.env.LOCALGPT_TEST_BASE;

async function request(path, method = "GET", body) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${text}`);
  return data;
}

async function waitMessage(sendBody) {
  const events = await fetch(
    base + `/qwen-cn/messages/${sendBody.id}/events`,
  );
  await events.text();
  return sendBody;
}

async function main() {
  const health = await request("/qwen-cn/health");
  if (!health.demo) throw new Error("Synthetic demo required (demo.py --port 8193)");

  const snap0 = await request("/qwen-cn/memory");
  if (!snap0.summary || snap0.preferences_version == null) {
    throw new Error("GET /memory must include summary and preferences_version");
  }

  let snap = await request("/qwen-cn/memory");
  await request("/qwen-cn/memory/preferences", "PATCH", {
    auto_capture: false,
    enabled: true,
    preferences_version: snap.preferences_version,
  });

  const chat = await request("/qwen-cn/chats", "POST", {});
  const sent = await request(`/qwen-cn/chats/${chat.id}/send`, "POST", {
    prompt: "记住：Synthetic Round7 API acceptance.",
    mode: "chat",
    request_key: "round7-api-" + Date.now(),
  });
  const message = await waitMessage(sent);
  const mem = message.memory || {};
  if (!((mem.saved && mem.saved.length) || (mem.updated && mem.updated.length))) {
    throw new Error("Explicit remember should populate memory.saved");
  }

  const snap1 = await request("/qwen-cn/memory");
  if (snap1.item_count < 1) throw new Error("Memory item not persisted");

  snap = await request("/qwen-cn/memory");
  await request("/qwen-cn/memory/preferences", "PATCH", {
    enabled: false,
    preferences_version: snap.preferences_version,
  });
  const chat2 = await request("/qwen-cn/chats", "POST", {});
  const blockedSend = await request(`/qwen-cn/chats/${chat2.id}/send`, "POST", {
    prompt: "记住：should not save while disabled",
    mode: "chat",
    request_key: "round7-disabled-" + Date.now(),
  });
  const blocked = await waitMessage(blockedSend);
  if ((blocked.memory || {}).status !== "disabled") {
    throw new Error("Disabled memory should return status disabled");
  }

  console.log("round7_memory_api_acceptance: OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
