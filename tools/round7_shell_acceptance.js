// Synthetic only. Start tools/round5_demo.py on 8194; use Playwright CLI run-code.
async (page) => {
  const out = "output/playwright/round7/",
    base = "http://127.0.0.1:8194";
  if (!(await (await page.request.get(base + "/qwen-cn/health")).json()).demo)
    throw Error("Synthetic demo required");
  const check = (v, m) => {
    if (!v) throw Error(m);
  };
  const state = (s) =>
    page.waitForFunction(
      (x) => document.querySelector("#sidebar").dataset.state === x,
      s,
    );
  const openSidebar = async (width) => {
    if (width > 760) return;
    const open = await page.evaluate(() =>
      document.body.classList.contains("sidebar-open"),
    );
    if (!open) await page.locator("#mobileMenu").click();
  };
  const results = [];
  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
    [390, 844],
  ])
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height });
      await page.goto(base + "/qwen-cn/");
      await page.evaluate(
        (t) => {
          localStorage.setItem("qwen-studio-theme", t);
          localStorage.setItem("qwen-studio-sidebar", "closed");
        },
        theme,
      );
      await page.reload();
      await page.locator("#prompt").waitFor();
      if (await page.locator("#preferencesDialog[open]").count())
        await page.locator("#closePreferences").click();
      await openSidebar(width);
      check(
        await page.locator("#composerHelp").count() === 0,
        "Visible composer hint should be removed",
      );
      check(
        await page.locator("#intro h1").count() === 0,
        "Welcome heading should be removed",
      );
      const toggleOpacity = await page
        .locator("#sidebarToggle")
        .evaluate((e) => getComputedStyle(e).opacity);
      check(toggleOpacity === "1", "Pin toggle must stay visible");
      if (width > 760) {
        await page.locator("#homeNav").hover();
        await state("temporary");
        await page.screenshot({
          path: out + `temp-${width}-${theme}.png`,
          scale: "css",
        });
        await page.locator("#sidebarToggle").click();
        await state("pinned");
        const mainX = (await page.locator("#mainContent").boundingBox()).x;
        check(Math.abs(mainX - 340) < 1, "Pinned main inset");
      }
      const profile = page.locator("#profileButton");
      await profile.scrollIntoViewIfNeeded();
      await profile.click({ force: true });
      check(
        (await page.locator("#profileMenu button[role=menuitem]").count()) === 2,
        "Profile menu should only expose Settings and About",
      );
      await page.keyboard.press("Escape");
      await openSidebar(width);
      await profile.click({ force: true });
      await page.locator("#appSettings").click();
      await page.waitForSelector("#preferencesDialog[open]");
      check(
        await page.locator(".settings-rail").count() === 0,
        "Settings must not duplicate navigation rail",
      );
      const railBox = await page.locator(".app-rail").boundingBox();
      check(railBox && railBox.width > 40, "Shared app rail remains visible");
      await page.screenshot({
        path: out + `settings-${width}-${theme}.png`,
        scale: "css",
      });
      await page.locator("#closePreferences").click();
      await page.goto(base + "/qwen-cn/#gallery");
      await page.waitForSelector("#galleryView:not([hidden])");
      await openSidebar(width);
      await page.locator("#profileButton").click({ force: true });
      await page.locator("#appSettings").click();
      await page.waitForSelector("#preferencesDialog[open]");
      if (width <= 760) {
        await page.locator("#settingsBack").click();
        await page.locator(".settings-nav-open").waitFor();
      }
      await page.locator('[data-settings-section="memory"]').click({ force: true });
      await page.locator("#memoryNav").click({ force: true });
      await page.waitForSelector("#memoryDialog[open]");
      await page.locator("#backMemory").click();
      await page.waitForSelector("#preferencesDialog[open]");
      await page.locator("#closePreferences").click();
      results.push({ width, theme });
    }
  const chats = await (await page.request.get(base + "/qwen-cn/chats")).json();
  const target = chats.find((c) => c.title === "Synthetic long conversation");
  check(target, "Synthetic chat missing");
  await page.request.patch(base + `/qwen-cn/chats/${target.id}/pin`, {
    data: { pinned: true, pin_version: target.pin_version ?? 0 },
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + "/qwen-cn/");
  await page.locator("#homeNav").hover();
  await page.waitForTimeout(200);
  check(
    (await page.locator(".sidebar-label").filter({ hasText: /固定|Pinned/ }).count()) >=
      1,
    "Pinned group heading",
  );
  return { results };
};
