// Synthetic only. Start tools/round5_demo.py on 8194; use Playwright.
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
  const railIdentity = () =>
    page.evaluate(() => {
      const rails = [...document.querySelectorAll(".app-rail")];
      const rail = document.querySelector("#sidebar .app-rail");
      return {
        one: rails.length === 1 && rails[0] === rail,
        outside: !rail.closest("#preferencesDialog"),
        inert: document.getElementById("homeNav").inert,
        modal: document.getElementById("preferencesDialog").matches(":modal"),
      };
    });
  const clipOf = (selector) =>
    page.locator(selector).evaluate((el) => getComputedStyle(el).clipPath);
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
      check(
        (await page.locator("#composerHelp").count()) === 0,
        "Visible composer hint should be removed",
      );
      check((await page.locator("#intro h1").count()) === 0, "Welcome heading should be removed");
      const composer = await page.locator("#composerCard").boundingBox();
      if (width > 760)
        check(
          Math.abs(composer.y - (height * 0.4 + 18)) < 1,
          `Empty composer y ${composer.y} at ${width}x${height}`,
        );
      else {
        check(
          Math.abs(composer.y - 692) < 2,
          `Mobile composer y ${composer.y} should stay near 692`,
        );
        check(
          composer.y + composer.height <= height + 1,
          "Mobile composer overflows the viewport",
        );
      }
      await openSidebar(width);
      const toggle = page.locator("#sidebarToggle");
      if (width > 760) await page.locator("#homeNav").hover();
      await toggle.focus();
      check(
        (await toggle.evaluate((e) => getComputedStyle(e).opacity)) === "1",
        "Focused pin toggle faded",
      );
      await toggle.blur();
      check(
        (await toggle.evaluate((e) => getComputedStyle(e).opacity)) === "1",
        "Blurred pin toggle faded",
      );
      if (width > 760) {
        const before = await page.locator("#mainContent").boundingBox();
        await page.locator("#homeNav").hover();
        await state("temporary");
        const during = await page.locator("#mainContent").boundingBox();
        check(Math.abs(before.x - during.x) < 1, "Temporary sidebar shifted the page");
        check(Math.abs(before.x - 52) < 1, "Collapsed rail inset");
        await page.screenshot({
          path: out + `temp-${width}-${theme}.png`,
          scale: "css",
        });
        await toggle.click();
        await state("pinned");
        const pinnedMain = await page.locator("#mainContent").boundingBox();
        check(Math.abs(pinnedMain.x - 340) < 1, "Pinned main inset");
        check(
          (await clipOf("#mainContent")) === "inset(0px 0px 0px -16px round 16px)",
          "Pinned corners " + (await clipOf("#mainContent")),
        );
        await page.setViewportSize({ width: width === 1440 ? 1280 : 1440, height: width === 1440 ? 800 : 900 });
        await state("pinned");
        check(
          Math.abs((await page.locator("#mainContent").boundingBox()).x - 340) < 1,
          "Pinned inset changed across desktop viewport",
        );
        await page.setViewportSize({ width, height });
        await state("pinned");
        await toggle.click();
        await state("collapsed");
        check(
          (await clipOf("#mainContent")) === "inset(0px round 16px)",
          "Collapsed clip " + (await clipOf("#mainContent")),
        );
      }
      const profile = page.locator("#profileButton");
      await profile.scrollIntoViewIfNeeded();
      await profile.click();
      check(
        (await page.locator("#profileMenu button[role=menuitem]").count()) === 2,
        "Profile menu should only expose Settings and About",
      );
      await page.keyboard.press("Escape");
      await openSidebar(width);
      await profile.click();
      await page.locator("#appSettings").click();
      await page.waitForSelector("#preferencesDialog[open]");
      const identity = await railIdentity();
      check(identity.one && identity.outside, "Settings must reuse the sidebar rail node");
      check(!identity.modal && !identity.inert, "Settings page made the rail inert");
      check((await page.locator(".settings-rail").count()) === 0, "Duplicate settings rail");
      const shellBox = await page.locator("#mainContent").boundingBox();
      const settingsBox = await page.locator(".settings-page").boundingBox();
      check(Math.abs(settingsBox.x - shellBox.x) < 1, "Settings page is not on the main surface");
      check(
        (await clipOf(".settings-page")) === "inset(0px 0px 0px -16px round 16px)" &&
          (await clipOf("#mainContent")) === "none",
        "Settings clip " + (await clipOf(".settings-page")) + " underlying " + (await clipOf("#mainContent")),
      );
      await page.screenshot({
        path: out + `settings-${width}-${theme}.png`,
        scale: "css",
      });
      if (width > 760) {
        await page.locator("#homeNav").hover();
        await state("temporary");
        check(
          Math.abs((await page.locator("#mainContent").boundingBox()).x - shellBox.x) < 1,
          "Temporary open shifted settings",
        );
        await page.locator("#sidebarToggle").click();
        await state("pinned");
        check(
          Math.abs((await page.locator(".settings-page").boundingBox()).x - 340) < 1,
          "Pinned settings did not follow the main surface",
        );
        await page.locator("#profileButton").click();
        check(await page.locator("#profileMenu").isVisible(), "Profile menu failed while settings is open");
        await page.keyboard.press("Escape");
        check(await page.locator("#preferencesDialog[open]").count(), "Profile escape closed settings");
        await page.locator("#galleryNav").click();
        await page.waitForSelector("#galleryView:not([hidden])");
        check((await page.locator("#preferencesDialog[open]").count()) === 0, "Gallery left settings open");
        check(
          (await clipOf("#mainContent")) === "inset(0px 0px 0px -16px round 16px)",
          "Gallery lost the pinned corner contract",
        );
        await page.locator("#profileButton").click();
        await page.locator("#appSettings").click();
        await page.waitForSelector("#preferencesDialog[open]");
        await page.locator("#homeNav").click();
        await page.locator("#intro").waitFor({ state: "visible" });
        check((await page.locator("#preferencesDialog[open]").count()) === 0, "Home left settings open");
        await state("pinned");
        await page.locator("#sidebarToggle").click();
        await state("collapsed");
      } else {
        const layer = await page.evaluate(() => {
          const close = document.getElementById("closePreferences");
          const box = close.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          const shade = getComputedStyle(document.getElementById("sidebarShade"));
          return {
            sidebarOpen: document.body.classList.contains("sidebar-open"),
            shadeDisplay: shade.display,
            shadePointer: shade.pointerEvents,
            hitClose: !!hit?.closest("#closePreferences"),
            menuInHeader: document.getElementById("mobileMenu").closest(".settings-layout-header") !== null,
          };
        });
        check(!layer.sidebarOpen, "Opening settings left the mobile sidebar open");
        check(layer.shadeDisplay === "none", "Opening settings left #sidebarShade displayed");
        check(layer.shadePointer === "none", "Opening settings left #sidebarShade intercepting clicks");
        check(layer.hitClose, "#sidebarShade intercepts #closePreferences");
        check(layer.menuInHeader, "Mobile settings hid the shared menu button");
        await page.locator("#settingsBack").click();
        await page.locator(".settings-nav-open").waitFor();
        const nav = await page.locator("#settingsNav").boundingBox();
        check(nav.x < 1, `Mobile settings nav still inset at ${nav.x}`);
        const navBg = await page.locator("#settingsNav").evaluate((el) => getComputedStyle(el).backgroundColor);
        const pageBg = await page.locator(".settings-page").evaluate((el) => getComputedStyle(el).backgroundColor);
        check(navBg === pageBg, "Mobile settings nav background drifted from the page");
        await page.locator("#settingsNavShade").click();
        await page.waitForFunction(
          () => !document.getElementById("preferencesDialog").classList.contains("settings-nav-open"),
        );
        await page.locator("#closePreferences").click();
        await page.waitForFunction(() => !document.getElementById("preferencesDialog").open);
        check(
          !(await page.evaluate(() => document.body.classList.contains("settings-surface-open"))),
          "Close left the settings surface class",
        );
        await page.locator("#mobileMenu").click();
        await page.locator("#profileButton").click();
        await page.locator("#appSettings").click();
        await page.waitForSelector("#preferencesDialog[open]");
        await page.locator("#mobileMenu").click();
        await state("mobile-overlay");
        const mobileRail = await railIdentity();
        check(mobileRail.one && !mobileRail.inert, "Mobile drawer rail is not the shared node");
        await page.locator("#galleryNav").click();
        await page.waitForSelector("#galleryView:not([hidden])");
        await state("mobile-closed");
        check((await page.locator("#preferencesDialog[open]").count()) === 0, "Mobile gallery left settings open");
        await page.locator("#mobileMenu").click();
        await page.locator("#profileButton").click();
        await page.locator("#appSettings").click();
        await page.waitForSelector("#preferencesDialog[open]");
        await page.locator("#mobileMenu").click();
        await state("mobile-overlay");
        await page.locator("#homeNav").click();
        await page.locator("#intro").waitFor({ state: "visible" });
        await state("mobile-closed");
        check((await page.locator("#preferencesDialog[open]").count()) === 0, "Mobile home left settings open");
      }
      results.push({ width, theme, composer });
    }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + "/qwen-cn/");
  await page.locator("#profileButton").click();
  await page.locator("#appSettings").click();
  await page.waitForSelector("#preferencesDialog[open]");
  await page.locator('[data-settings-section="memory"]').click();
  await page.locator("#memoryNav").click();
  await page.waitForSelector("#memoryDialog[open]");
  check(await page.locator("#backMemory").isVisible(), "Memory back control missing");
  check(await page.locator("#preferencesDialog[open]").count(), "Memory detached from settings");
  await page.locator("#backMemory").click();
  await page.waitForFunction(() => !document.getElementById("memoryDialog").open);
  check(await page.locator("#preferencesDialog[open]").count(), "Back left settings");
  await page.locator("#memoryNav").click();
  await page.waitForSelector("#memoryDialog[open]");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.getElementById("memoryDialog").open);
  check(await page.locator("#preferencesDialog[open]").count(), "Escape closed the parent settings page");
  const lifecycle = await page.evaluate(async () => {
    const dialog = document.getElementById("preferencesDialog");
    const selected = (name) =>
      document.querySelector(`[data-settings-section="${name}"]`)?.getAttribute("aria-selected");
    const marked = () => document.body.classList.contains("settings-surface-open");
    window.AppShell.openSettings("general");
    let settled = null;
    const pending = window.AppShell.closeSettings().then(() => {
      settled = { open: dialog.open, marked: marked() };
    });
    const isPromise = pending instanceof Promise;
    await pending;
    window.AppShell.openSettings("general");
    const first = window.AppShell.closeSettings();
    window.AppShell.openSettings("appearance");
    await first;
    dialog.dispatchEvent(new ToggleEvent("beforetoggle", { oldState: "open", newState: "closed" }));
    dialog.dispatchEvent(new Event("close"));
    await Promise.resolve();
    const reopened = { open: dialog.open, marked: marked(), selected: selected("appearance") };
    const nav = window.AppShell.leaveSettingsForNavigation();
    window.AppShell.openSettings("general");
    await nav;
    dialog.dispatchEvent(new ToggleEvent("beforetoggle", { oldState: "open", newState: "closed" }));
    await Promise.resolve();
    const afterNav = { open: dialog.open, marked: marked(), selected: selected("general") };
    await window.AppShell.closeSettings();
    return {
      isPromise,
      settledClosed: !!settled && !settled.open && !settled.marked,
      reopened,
      afterNav,
      closed: !dialog.open && !marked(),
      registered: typeof window.AppShellRegistrations.openMemory === "function",
    };
  });
  check(
    lifecycle.isPromise &&
      lifecycle.settledClosed &&
      lifecycle.reopened.open &&
      lifecycle.reopened.marked &&
      lifecycle.reopened.selected === "true" &&
      lifecycle.afterNav.open &&
      lifecycle.afterNav.marked &&
      lifecycle.afterNav.selected === "true" &&
      lifecycle.closed &&
      lifecycle.registered,
    "closeSettings lifecycle broke " + JSON.stringify(lifecycle),
  );
  await page.evaluate(() => window.AppShell.openMemory(document.getElementById("memoryNav")));
  await page.waitForSelector("#memoryDialog[open]");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.getElementById("memoryDialog").open);

  await page.evaluate(() => {
    const form = document.getElementById("form");
    window.__previousSubmit = form.onsubmit;
    window.__submits = 0;
    form.onsubmit = (event) => {
      event.preventDefault();
      window.__submits += 1;
    };
  });
  const prompt = page.locator("#prompt");
  await prompt.fill("alpha");
  const composed = await prompt.evaluate((el) => {
    const compose = new KeyboardEvent("keydown", {
      key: "Enter",
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(compose);
    const legacy = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(legacy, "keyCode", { get: () => 229 });
    el.dispatchEvent(legacy);
    return { submits: window.__submits, legacyCode: legacy.keyCode };
  });
  check(composed.submits === 0 && composed.legacyCode === 229, "IME Enter submitted the composer");
  await prompt.press("Shift+Enter");
  check((await prompt.inputValue()).includes("\n"), "Shift+Enter did not insert a newline");
  check(await page.evaluate(() => window.__submits) === 0, "Shift+Enter submitted");
  await prompt.press("Enter");
  check(await page.evaluate(() => window.__submits) === 1, "Enter did not submit");
  await page.evaluate(() => {
    document.getElementById("form").onsubmit = window.__previousSubmit;
  });
  await prompt.fill("");
  const typing = { composed, shift: true, enter: true };

  const chats = await (await page.request.get(base + "/qwen-cn/chats")).json();
  const target = chats.find((c) => c.title === "Synthetic long conversation");
  check(target, "Synthetic chat missing");
  check(target.pinned === false && target.pin_version === 0, "Synthetic chat pin default");
  await page.request.patch(base + `/qwen-cn/chats/${target.id}/pin`, {
    data: { pinned: true, pin_version: target.pin_version ?? 0 },
  });
  await page.goto(base + "/qwen-cn/");
  await page.locator("#prompt").waitFor();
  await page.locator("#homeNav").hover();
  await page.locator(".sidebar-label").filter({ hasText: /固定|Pinned/ }).first().waitFor();
  check(
    (await page.locator(".sidebar-label").filter({ hasText: /固定|Pinned/ }).count()) >= 1,
    "Pinned group heading",
  );
  return { results, lifecycle, typing };
};
