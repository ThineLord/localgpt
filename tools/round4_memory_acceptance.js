// Round 4 memory/settings UI acceptance — synthetic demo only.
// Run: cd work/chat-sidebar && python build.py && python demo.py --port 8191
// npx playwright test is not required; use: npx playwright run-code tools/round4_memory_acceptance.js
// Or pipe this file as the async page => {...} body via your project's Playwright harness.
async (page) => {
  const base = "http://127.0.0.1:8191";
  const health = await (await page.request.get(base + "/qwen-cn/health")).json();
  if (!health.demo) throw new Error("Synthetic demo on port 8191 required");
  const check = (ok, m) => {
    if (!ok) throw new Error(m);
  };
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + "/qwen-cn/");
  await page.evaluate(() => {
    localStorage.setItem("qwen-studio-theme", "light");
    localStorage.setItem("qwen-studio-language", "zh");
    localStorage.setItem("qwen-studio-sidebar", "open");
  });
  await page.reload();
  await page.locator("#chatList .chat-item").first().waitFor();

  await page.locator("#appSettings").click();
  await page.waitForFunction(
    () => document.getElementById("preferencesDialog")?.open,
  );
  check(
    await page.locator("#settingsPanelAbout").count() === 1,
    "About settings panel missing",
  );
  check(
    await page.locator("#settingsPanelDiagnostics").count() === 1,
    "Diagnostics settings panel missing",
  );
  await page.locator('[data-settings-section="about"]').click();
  await page
    .locator("#settingsPanelAbout")
    .waitFor({ state: "visible" });
  check(
    (await page.locator("#settingsPanelAbout .settings-about-copy").count()) >=
      1,
    "About copy missing",
  );
  await page.locator('[data-settings-section="diagnostics"]').click();
  await page.locator("#connection").waitFor({ state: "visible" });
  check(
    await page.locator("#settingsDatabasePathDisplay").isVisible(),
    "Database path hook missing",
  );

  await page.locator('[data-settings-section="memory"]').click();
  await page.locator("#memoryNav").click();
  await page.locator("#memoryDialog").waitFor({ state: "visible" });
  check(
    await page.locator("#memoryListView").isVisible(),
    "Memory list view should be visible",
  );
  check(
    await page.locator("#memoryEditorView").isHidden(),
    "Editor should start hidden",
  );
  check(
    await page.locator("#memorySearch").isVisible(),
    "Memory search missing",
  );

  const seed = "Synthetic Round 4 memory acceptance entry";
  await page.locator("#memoryAddButton").click();
  await page.waitForFunction(
    () => !document.getElementById("memoryEditorView")?.hidden,
  );
  await page.locator("#memoryContent").fill(seed);
  await page.locator("#saveMemory").click();
  await page.waitForFunction(
    () => !document.getElementById("memoryListView")?.hidden,
  );
  await page.waitForFunction(
    (text) =>
      [...document.querySelectorAll("#memoryList .memory-item p")].some(
        (p) => p.textContent === text,
      ),
    seed,
  );

  await page.locator("#memorySearch").fill("nonexistent-query-xyz");
  await page.waitForFunction(
    () => !!document.querySelector(".empty-memory-search"),
  );
  await page.locator("#memorySearch").fill("Round 4");
  await page.waitForFunction(
    () => document.querySelectorAll("#memoryList .memory-item").length === 1,
  );

  const clickRowMore = async () => {
    await page
      .locator("#memoryList .memory-item-more")
      .first()
      .evaluate((node) => node.click());
    await page.waitForFunction(
      () => document.querySelector(".memory-row-menu:popover-open"),
    );
  };
  await clickRowMore();
  await page.evaluate(() =>
    document
      .querySelector(".memory-row-menu:popover-open button")
      ?.click(),
  );
  await page.waitForFunction(
    () => !document.getElementById("memoryEditorView")?.hidden,
  );
  await page.locator("#memoryEditorBack").click();
  await page.waitForFunction(
    () => !document.getElementById("memoryListView")?.hidden,
  );

  await clickRowMore();
  await page.evaluate(() =>
    document
      .querySelector(".memory-row-menu:popover-open .danger-link")
      ?.click(),
  );
  await page.waitForFunction(() => document.getElementById("confirmDialog")?.open);
  await page.locator("#confirmCancel").click();
  await page.waitForFunction(() => !document.getElementById("confirmDialog")?.open);

  await page.route("**/qwen-cn/memory/*", async (route) => {
    if (route.request().method() === "DELETE")
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic delete failure" }),
      });
    else await route.continue();
  });
  await clickRowMore();
  await page.evaluate(() =>
    document
      .querySelector(".memory-row-menu:popover-open .danger-link")
      ?.click(),
  );
  await page.locator("#confirmAccept").click();
  await page.waitForFunction(
    () => document.querySelector("#confirmError")?.hidden === false,
  );
  await page.unroute("**/qwen-cn/memory/*");
  if (await page.evaluate(() => document.getElementById("confirmDialog")?.open))
    await page.locator("#confirmCancel").click();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.getElementById("memoryDialog")?.open);

  await page.setViewportSize({ width: 390, height: 844 });
  if (!(await page.evaluate(() => document.getElementById("preferencesDialog")?.open)))
    await page.locator("#appSettings").click();
  await page.waitForFunction(() => document.getElementById("preferencesDialog")?.open);
  await page.evaluate(() => {
    const dialog = document.getElementById("preferencesDialog");
    if (innerWidth <= 760 && !dialog.classList.contains("settings-nav-open"))
      document.getElementById("settingsBack")?.click();
    document.querySelector('[data-settings-section="memory"]')?.click();
  });
  await page.locator("#memoryNav").click({ force: true });
  await page.waitForFunction(() => document.getElementById("memoryDialog")?.open);
  const box = await page.locator("#memoryDialog").boundingBox();
  check(box && box.width <= 390, "Mobile memory dialog should fit viewport");

  check(errors.length === 0, "Browser errors: " + errors.join("; "));
  return {
    aboutPanel: true,
    diagnosticsHooks: true,
    memorySearch: true,
    addEditBack: true,
    emptySearch: true,
    confirmGuard: true,
    mobileLayout: true,
  };
};
