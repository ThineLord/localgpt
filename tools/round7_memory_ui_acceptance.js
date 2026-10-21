#!/usr/bin/env node
/**
 * Synthetic Round 7 memory UI acceptance.
 * Starts nothing by itself. Point it at demo.py:
 *   python3 work/chat-sidebar/demo.py --port 8196
 *   node tools/round7_memory_ui_acceptance.js
 * Refuses a server that is not the synthetic demo.
 */
const fs = require("fs");
const path = require("path");
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require("playwright-core"));
}

const base = process.env.MEMORY_UI_BASE || "http://127.0.0.1:8196";
const shotDir = path.resolve("output/playwright/round7-memory");
const UUID_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-/i;

function check(ok, message) {
  if (!ok) throw new Error(message);
}

async function main() {
  const healthRes = await fetch(base + "/qwen-cn/health");
  const health = await healthRes.json();
  if (!health.demo) throw new Error("Refusing non-demo server at " + base);
  check(
    String(health.database || "").toLowerCase().includes("temporary") ||
      String(health.database || "").toLowerCase().includes("demo"),
    "demo database was not temporary: " + health.database,
  );
  fs.mkdirSync(shotDir, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("qwen-studio-theme", "light");
    localStorage.setItem("qwen-studio-language", "zh");
    localStorage.setItem("qwen-studio-sidebar", "open");
  });
  await page.goto(base + "/qwen-cn/", { waitUntil: "domcontentloaded" });
  await page.locator("#prompt").waitFor();
  await page.waitForFunction(
    () => document.getElementById("retryConnection")?.hidden !== false,
  );

  const api = async (urlPath, method = "GET", body) => {
    const response = await page.request.fetch(base + urlPath, {
      method,
      data: body,
      headers: body ? { "content-type": "application/json" } : undefined,
    });
    const payload = await response.json();
    return { status: response.status(), payload };
  };

  async function openSettings() {
    const open = await page.evaluate(() => document.getElementById("preferencesDialog").open);
    if (open) return;
    if (!(await page.locator("#profileButton").isVisible())) {
      await page.locator("#mobileMenu").click();
      await page.locator("#profileButton").waitFor({ state: "visible" });
    }
    await page.locator("#profileButton").click();
    await page.locator("#appSettings").click();
    await page.waitForFunction(() => document.getElementById("preferencesDialog").open);
  }

  async function showSection(name) {
    await openSettings();
    const mobile = page.viewportSize().width <= 760;
    if (mobile) {
      const drawer = await page.evaluate(() =>
        document.getElementById("preferencesDialog").classList.contains("settings-nav-open"),
      );
      if (!drawer) await page.locator("#settingsBack").click();
    }
    await page.locator(`[data-settings-section="${name}"]`).click();
    await page.locator(`[data-settings-panel="${name}"]`).waitFor({ state: "visible" });
  }

  async function openManager() {
    await showSection("memory");
    await page.locator("#memoryNav").click();
    await page.waitForFunction(() => document.getElementById("memoryDialog").open);
    await page.locator("#memorySearch").waitFor({ state: "visible" });
  }

  async function closeManager() {
    if (await page.evaluate(() => document.getElementById("memoryDialog").open)) {
      await page.locator("#closeMemory").click();
      await page.waitForFunction(() => !document.getElementById("memoryDialog").open);
    }
  }

  async function closeSettings() {
    await closeManager();
    if (await page.evaluate(() => document.getElementById("preferencesDialog").open)) {
      await page.locator("#closePreferences").click();
      await page.waitForFunction(() => !document.getElementById("preferencesDialog").open);
    }
  }

  async function addMemory(text, category = "note") {
    await page.locator("#memoryAddButton").click();
    await page.locator("#memoryContent").fill(text);
    await page.locator("#memoryCategory").selectOption(category);
    await page.locator("#saveMemory").click();
    await page.locator("#memoryList").getByText(text, { exact: true }).waitFor();
  }

  function row(text) {
    return page.locator(".memory-item", { hasText: text });
  }

  await page.locator("#profileButton").click();
  await page.locator("#profileMenu").waitFor({ state: "visible" });
  const menuIds = await page.locator("#profileMenu [role='menuitem']").evaluateAll((els) => els.map((el) => el.id));
  check(JSON.stringify(menuIds) === JSON.stringify(["appSettings", "profileAbout"]), "avatar menu changed: " + menuIds.join(","));
  await page.locator("#profileAbout").click();
  await page.locator("#settingsPanelAbout").waitFor({ state: "visible" });
  await showSection("profile");
  check(await page.locator("#chooseAvatar").isVisible(), "profile panel missing");
  await showSection("appearance");
  check(await page.locator("#themeLight").isVisible(), "appearance panel missing");
  await showSection("memory");
  check(await page.locator("#memoryEnabled").isChecked(), "memory should start enabled");
  check(!(await page.locator("#memoryAutomatic").isChecked()), "auto capture should start off");
  const summary = await page.locator("#memorySettingsSummary").innerText();
  check(summary.includes("共") && summary.includes("使用中"), "settings summary missing: " + summary);
  const rails = await page.locator(".app-rail").count();
  check(rails === 1, "expected one rail, saw " + rails);
  check(
    await page.evaluate(() => !document.getElementById("preferencesDialog").matches(":modal")),
    "settings should stay a page, not a modal",
  );
  await page.screenshot({ path: path.join(shotDir, "personalization-light-1440.png") });

  await openManager();
  check(
    await page.evaluate(() => document.getElementById("memoryDialog").matches(":modal")),
    "memory manager should be modal",
  );
  check(await page.locator(".app-rail").count() === 1, "opening memory duplicated the rail");
  const first = "合成记忆甲喜欢茶，标记孔雀。";
  const second = "合成记忆乙喜欢咖啡，标记孔雀。";
  await addMemory(first, "preference");
  await addMemory(second, "note");
  let listed = (await api("/qwen-cn/memory")).payload;
  check(listed.item_count === 2, "add did not persist");
  check(listed.summary.counts.total === 2, "summary drifted from items");
  await page.locator("#memorySearch").fill("茶");
  await page.waitForFunction(() => document.querySelectorAll(".memory-item").length === 1);
  check(await row(first).count() === 1, "search missed the tea memory");
  check(await row(second).count() === 0, "search showed the coffee memory");
  await page.locator("#memorySearch").fill("");
  await page.waitForFunction(() => document.querySelectorAll(".memory-item").length === 2);

  const edited = "合成记忆甲喜欢红茶，标记孔雀。";
  await row(first).getByRole("button", { name: "编辑" }).click();
  await page.locator("#memoryContent").fill(edited);
  await page.locator("#saveMemory").click();
  await page.locator("#memoryList").getByText(edited, { exact: true }).waitFor();
  listed = (await api("/qwen-cn/memory")).payload;
  const tea = listed.items.find((item) => item.content === edited);
  check(tea && tea.version > 1, "edit did not bump version");
  await row(edited).getByRole("button", { name: "暂停使用" }).click();
  await row(edited).waitFor();
  await page.waitForFunction(
    (text) => document.querySelector(`.memory-item[data-active="false"]`)?.textContent.includes(text),
    edited,
  );
  listed = (await api("/qwen-cn/memory")).payload;
  check(listed.items.find((item) => item.content === edited).active === false, "pause did not persist");
  const pausedEdit = "合成记忆甲喜欢绿茶，标记孔雀。";
  await row(edited).getByRole("button", { name: "编辑" }).click();
  check(
    (await page.locator("#memoryEditorNote").innerText()).includes("不会重新启用"),
    "editor did not explain that save keeps a paused memory paused",
  );
  await page.locator("#memoryContent").fill(pausedEdit);
  await page.locator("#saveMemory").click();
  await page.locator("#memoryList").getByText(pausedEdit, { exact: true }).waitFor();
  listed = (await api("/qwen-cn/memory")).payload;
  check(listed.items.find((item) => item.content === pausedEdit).active === false, "content edit reactivated a paused memory");
  await row(pausedEdit).getByRole("button", { name: "恢复使用" }).click();
  await page.waitForFunction(
    (text) => [...document.querySelectorAll(".memory-item")].some((row) => row.dataset.active === "true" && row.textContent.includes(text)),
    pausedEdit,
  );
  listed = (await api("/qwen-cn/memory")).payload;
  check(listed.items.find((item) => item.content === pausedEdit).active === true, "resume did not persist");
  await page.screenshot({ path: path.join(shotDir, "manager-light-1440.png") });

  await row(second).getByRole("button", { name: "编辑" }).click();
  const draft = "合成记忆乙仍在编辑，不要覆盖。";
  await page.locator("#memoryContent").fill(draft);
  const current = listed.items.find((item) => item.content === second);
  const patched = await api("/qwen-cn/memory/" + current.id, "PATCH", {
    content: "合成记忆乙已被另一处改写。",
    version: current.version,
  });
  check(patched.status === 200, "setup patch failed " + patched.status);
  await page.locator("#saveMemory").click();
  await page.locator("#memoryConflict").waitFor({ state: "visible" });
  check((await page.locator("#memoryContent").inputValue()) === draft, "409 cleared the editor");
  const afterConflict = (await api("/qwen-cn/memory")).payload;
  check(
    afterConflict.items.some((item) => item.content === "合成记忆乙已被另一处改写。"),
    "409 save overwrote the server",
  );
  check(!afterConflict.items.some((item) => item.content === draft), "unsaved draft was written");
  await page.locator("#memoryReload").click();
  await page.waitForFunction(() =>
    (document.getElementById("memoryConflict").textContent || "").includes("服务器上现在是"),
  );
  check((await page.locator("#memoryContent").inputValue()) === draft, "reload replaced the editor");
  check((await page.locator("#memoryConflict").innerText()).includes("服务器上现在是"), "reload did not show the server text");
  await page.locator("#memoryAdopt").click();
  check(
    (await page.locator("#memoryContent").inputValue()) === "合成记忆乙已被另一处改写。",
    "adopt did not show the server text",
  );
  await page.locator("#cancelMemoryEdit").click();
  await page.screenshot({ path: path.join(shotDir, "conflict-light-1440.png") });

  const focusId = await page.evaluate(() => {
    document.getElementById("closeMemory").click();
    return document.getElementById("memoryDialog").open;
  });
  check(focusId === false, "memory dialog stayed open");
  await page.waitForFunction(() => document.activeElement?.id === "memoryNav");
  check(await page.evaluate(() => document.getElementById("preferencesDialog").open), "closing memory closed settings");

  await closeSettings();
  await page.evaluate(() => {
    const mode = document.getElementById("mode");
    mode.value = "chat";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.locator("#prompt").fill("记住：合成用户喜欢短句。");
  await page.waitForFunction(() => !document.getElementById("generate").disabled);
  await page.locator("#generate").click();
  await page.locator(".memory-turn-hint").first().waitFor({ timeout: 20000 });
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".memory-turn-hint")].some((node) => node.textContent.includes("已保存为记忆")),
  );
  const savedHint = await page.locator(".memory-turn-hint").last().innerText();
  check(!UUID_TEXT.test(savedHint), "hint printed an id: " + savedHint);
  check(!savedHint.includes("注入了"), "demo turn must not claim injected memories: " + savedHint);

  await page.locator("#prompt").fill("记住：我的密码是 12345");
  await page.waitForFunction(() => !document.getElementById("generate").disabled);
  await page.locator("#generate").click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".memory-turn-hint")].some((node) => node.textContent.includes("没有执行")),
  );
  const rejected = await page.locator(".memory-turn-hint").last().innerText();
  check(!rejected.includes("已保存"), "rejected command looked successful: " + rejected);
  check(!UUID_TEXT.test(rejected), "rejected hint printed an id");

  await page.locator("#prompt").fill("忘记：合成记忆");
  await page.waitForFunction(() => !document.getElementById("generate").disabled);
  await page.locator("#generate").click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".memory-turn-hint")].some((node) => node.textContent.includes("没有修改")),
  );
  listed = (await api("/qwen-cn/memory")).payload;
  check(listed.items.filter((item) => item.content.includes("合成记忆")).length === 2, "ambiguous forget changed rows");
  check(listed.items.some((item) => item.content === pausedEdit), "ambiguous forget removed the tea memory");
  check(listed.items.some((item) => item.content.includes("短句")), "ambiguous forget removed an unrelated memory");

  await openManager();
  await closeManager();
  await page.locator("#memoryEnabled").click();
  await page.waitForFunction(() => document.getElementById("memorySettingsSummary").textContent.includes("已关闭"));
  const beforeDisable = (await api("/qwen-cn/memory")).payload.item_count;
  await closeSettings();
  await page.locator("#prompt").fill("记住：合成秘密颜色霓虹紫。");
  await page.waitForFunction(() => !document.getElementById("generate").disabled);
  await page.locator("#generate").click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".memory-turn-hint")].some((node) => node.textContent.includes("本轮没有保存或引用")),
  );
  const disabledHint = await page.locator(".memory-turn-hint").last().innerText();
  check(!disabledHint.includes("已保存"), "disabled remember looked successful");
  listed = (await api("/qwen-cn/memory")).payload;
  check(listed.item_count === beforeDisable, "disabled remember stored a row");
  check(!listed.items.some((item) => item.content.includes("霓虹紫")), "disabled text was stored");
  await showSection("memory");
  await page.locator("#memoryEnabled").click();
  await page.waitForFunction(() => document.getElementById("memorySettingsSummary").textContent.includes("已开启"));
  listed = (await api("/qwen-cn/memory")).payload;
  check(listed.preferences.enabled === true, "re-enable did not persist");
  check(listed.items.some((item) => item.content === pausedEdit), "re-enable dropped saved rows");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#prompt").waitFor();
  await openManager();
  await page.locator("#memoryList").getByText(pausedEdit, { exact: true }).waitFor();
  await page.screenshot({ path: path.join(shotDir, "refresh-light-1440.png") });

  await row("已被另一处改写").getByRole("button", { name: "删除" }).click();
  await page.locator("#confirmAccept").click();
  await page.waitForFunction(() => !document.getElementById("confirmDialog").open);
  listed = (await api("/qwen-cn/memory")).payload;
  check(!listed.items.some((item) => item.content.includes("已被另一处改写")), "delete left the row");

  const stale = (await api("/qwen-cn/memory")).payload;
  const extra = await api("/qwen-cn/memory", "POST", { content: "合成列表外新增。", category: "note" });
  check(extra.status === 201, "extra insert failed");
  await page.locator("#clearMemory").click();
  await page.locator("#confirmAccept").click();
  await page.locator("#memoryConflict").waitFor({ state: "visible" });
  const kept = (await api("/qwen-cn/memory")).payload;
  check(kept.item_count === stale.item_count + 1, "stale clear deleted rows");
  check((await page.locator("#memoryConflict").innerText()).includes("不会用过期版本自动重试"), "clear conflict copy missing");
  await page.locator("#memoryReload").click();
  await page.locator("#memoryList").getByText("合成列表外新增。", { exact: true }).waitFor();
  await page.locator("#clearMemory").click();
  await page.locator("#confirmAccept").click();
  await page.waitForFunction(() => document.querySelector(".empty-memory"));
  listed = (await api("/qwen-cn/memory")).payload;
  check(listed.item_count === 0, "confirmed clear left rows");

  const signal = await page.evaluate(() => {
    const saved = window.HanzMemory.memorySignal({
      status: "saved",
      saved: ["11111111-1111-4111-8111-111111111111"],
      used: ["22222222-2222-4222-8222-222222222222"],
    });
    const rejectedSignal = window.HanzMemory.memorySignal({
      status: "rejected",
      saved: ["11111111-1111-4111-8111-111111111111"],
      used: ["22222222-2222-4222-8222-222222222222"],
      notice: "无法保存该内容。",
    });
    const entry = document.createElement("article");
    const shell = document.createElement("div");
    shell.className = "user-message-shell";
    entry.append(shell);
    window.HanzMemory.paintEntry(entry, {
      status: "disabled",
      saved: ["11111111-1111-4111-8111-111111111111"],
      used: ["22222222-2222-4222-8222-222222222222"],
    });
    return { saved, rejectedSignal, painted: shell.querySelector(".memory-turn-hint").textContent };
  });
  check(signal.saved.includes("注入了 1") && !UUID_TEXT.test(signal.saved), "used hint: " + signal.saved);
  check(signal.rejectedSignal.includes("没有执行") && !signal.rejectedSignal.includes("已保存") && !signal.rejectedSignal.includes("注入了"), "rejected signal: " + signal.rejectedSignal);
  check(signal.painted.includes("暂停") && !UUID_TEXT.test(signal.painted) && !signal.painted.includes("已保存"), "painted hint: " + signal.painted);

  await closeSettings();
  for (const [width, height, theme] of [
    [1280, 800, "light"],
    [1440, 900, "dark"],
    [390, 844, "light"],
    [390, 844, "dark"],
    [1280, 800, "dark"],
  ]) {
    await page.setViewportSize({ width, height });
    await showSection("appearance");
    await page.locator(theme === "dark" ? "#themeDark" : "#themeLight").click();
    await page.waitForFunction(
      (value) => document.documentElement.dataset.theme === value,
      theme,
    );
    await showSection("memory");
    const toggle = await page.locator("#memoryEnabled").boundingBox();
    check(toggle && toggle.width > 0 && toggle.x >= 0 && toggle.x + toggle.width <= width + 1, `${width}x${height} ${theme} toggle outside viewport`);
    await openManager();
    const box = await page.locator("#memoryDialog").boundingBox();
    check(box && box.x >= -1 && box.y >= -1, `${width} memory dialog origin`);
    check(box.x + box.width <= width + 1 && box.y + box.height <= height + 1, `${width}x${height} ${theme} dialog overflow ${JSON.stringify(box)}`);
    check(await page.locator(".app-rail").count() === 1, "rail duplicated at " + width);
    await page.screenshot({ path: path.join(shotDir, `memory-${theme}-${width}x${height}.png`) });
    await closeManager();
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator("#galleryNav").click();
  await page.waitForFunction(() => !document.getElementById("galleryView").hidden);
  await openManager();
  await page.locator("#closeMemory").click();
  await page.waitForFunction(() => document.activeElement?.id === "memoryNav" && document.getElementById("preferencesDialog").open);
  await page.locator("#closePreferences").click();
  await page.waitForFunction(
    () => !document.getElementById("preferencesDialog").open && !document.getElementById("galleryView").hidden && !document.getElementById("memoryDialog").open,
  );

  await showSection("general");
  await page.locator("#language").click();
  await showSection("memory");
  check((await page.locator('[data-settings-section="memory"] span').innerText()) === "Personalization", "English settings label missing");
  await showSection("general");
  await page.locator("#language").click();

  check(errors.length === 0, "page errors: " + errors.join("; "));
  await browser.close();
  console.log("round7_memory_ui_acceptance: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
