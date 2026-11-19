// Appearance wallpaper: default off, bilingual picker, programmed cube styles,
// persistence, stacking, hidden-tab pause and reduced motion.
const fs = require("node:fs");
const path = require("node:path");

module.exports = async (page) => {
  const out = process.env.LOCALGPT_TEST_OUTPUT;
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const shot = (name) => page.screenshot({ path: path.join(out, name) });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: "no-preference", colorScheme: "light" });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => typeof appReady !== "undefined" && appReady);
  await page.locator("#prompt").waitFor();

  const off = await page.evaluate(() => ({
    canvas: !!document.getElementById("wallpaperField"),
    attr: document.documentElement.dataset.wallpaper || "",
    shell: getComputedStyle(document.querySelector(".shell")).backgroundColor,
  }));
  check(!off.canvas && !off.attr, "default wallpaper is not off: " + JSON.stringify(off));
  check(!off.shell.includes("0, 0, 0, 0"), "default shell is transparent: " + off.shell);
  await shot("default-off.png");

  async function openAppearance() {
    if (page.viewportSize().width <= 760) {
      if (!(await page.locator("#profileButton").isVisible())) await page.locator("#mobileMenu").click();
    }
    await page.locator("#profileButton").click();
    await page.locator("#appSettings").click();
    await page.locator("#preferencesDialog").waitFor({ state: "visible" });
    if (page.viewportSize().width <= 760 && await page.locator("#settingsBack").isVisible()) {
      await page.locator("#settingsBack").click();
    }
    await page.locator('[data-settings-section="appearance"]').click();
    await page.locator("#wallpaperOff").waitFor({ state: "visible" });
  }
  const stats = () => page.evaluate(() => {
    const canvas = document.getElementById("wallpaperField");
    if (!canvas) return null;
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let cool = 0, warm = 0, green = 0, pink = 0, dark = 0, light = 0, mid = 0, chroma = 0, n = 0, hash = 0;
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      n += 1;
      chroma = Math.max(chroma, Math.abs(r - g) + Math.abs(g - b));
      const y = (r + g + b) / 3;
      if (y < 42) dark += 1;
      else if (y > 210) light += 1;
      else if (y > 90 && y < 175) mid += 1;
      if (b > r + 25 && b > 70) cool += 1;
      if (r > 185 && g > 145 && b < 170 && r > b + 35) warm += 1;
      if (g > r + 18 && g > 75 && g + 8 >= b) green += 1;
      if (r > 165 && r > g + 12 && b > 95 && r > b) pink += 1;
      hash = (hash + r * 3 + g * 5 + b * 7) >>> 0;
    }
    const wall = getComputedStyle(canvas);
    return {
      style: canvas.dataset.style,
      motion: document.documentElement.dataset.wallpaperMotion || "",
      frames: Number(canvas.dataset.frames || 0),
      elapsed: Number(canvas.dataset.elapsed || 0),
      n, cool, warm, green, pink, dark, light, mid, chroma, hash,
      z: wall.zIndex,
      pe: wall.pointerEvents,
      sideZ: getComputedStyle(document.querySelector(".sidebar")).zIndex,
    };
  });

  await openAppearance();
  check((await page.locator("#wallpaperGraphite .wallpaper-name").textContent()) === "黑白灰", "Chinese graphite label");
  check((await page.locator("#wallpaperStarry .wallpaper-name").textContent()) === "星月夜", "Chinese starry label");
  check((await page.locator("#wallpaperLilies .wallpaper-name").textContent()) === "睡莲", "Chinese lilies label");
  const order = await page.locator(".wallpaper-preview").evaluateAll((nodes) => nodes.map((node) => node.id));
  check(order.join() === "wallpaperOff,wallpaperGraphite,wallpaperStarry,wallpaperLilies", "picker order " + order.join());
  await shot("picker-zh.png");

  await page.locator("#wallpaperGraphite").click();
  await page.waitForFunction(() => document.getElementById("wallpaperField")?.dataset.style === "graphite");
  const graphite = await stats();
  check(graphite && graphite.chroma <= 12 && graphite.dark > 50 && graphite.light > 50 && graphite.mid > 50, "graphite pixels " + JSON.stringify(graphite));
  check(graphite.pe === "none" && Number(graphite.z) < Number(graphite.sideZ), "stacking " + JSON.stringify(graphite));
  await page.locator("#closePreferences").click();
  await page.locator("#preferencesDialog").waitFor({ state: "hidden" });
  await shot("graphite.png");
  await page.locator("#prompt").click();
  await page.locator("#prompt").fill("wallpaper stays clickable");
  check((await page.locator("#prompt").inputValue()) === "wallpaper stays clickable", "prompt not editable");
  const stacked = await page.evaluate(() => {
    const button = document.getElementById("newChat");
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + 12, rect.top + rect.height / 2);
    const mid = document.elementFromPoint(window.innerWidth * 0.62, window.innerHeight * 0.32);
    return { button: button.contains(hit), mid: mid && (mid.id || mid.className), canvas: mid && mid.id === "wallpaperField" };
  });
  check(stacked.button && !stacked.canvas, "wallpaper is covering the UI " + JSON.stringify(stacked));
  const composer = await page.evaluate(() => {
    const canvas = document.getElementById("wallpaperField");
    const card = document.querySelector(".composer-card");
    const previous = canvas.style.pointerEvents;
    canvas.style.pointerEvents = "auto";
    const rect = card.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    canvas.style.pointerEvents = previous;
    const background = getComputedStyle(card).backgroundColor;
    return { hit: hit && (hit.id || hit.className), covered: hit === canvas, background };
  });
  check(!composer.covered && !String(composer.background).includes("0, 0, 0, 0"), "wallpaper covers the composer " + JSON.stringify(composer));
  const scrolled = await page.evaluate(() => {
    const el = document.getElementById("chatScroll");
    document.getElementById("intro").hidden = true;
    const probe = document.createElement("div");
    probe.id = "wallpaperScrollProbe";
    probe.style.height = "2400px";
    el.append(probe);
    el.scrollTop = 360;
    return el.scrollTop;
  });
  check(scrolled >= 300, "chat did not scroll " + scrolled);

  const moving = await stats();
  await page.waitForTimeout(450);
  const moved = await stats();
  check(moved.frames > moving.frames && moved.elapsed > moving.elapsed + 120, "graphite did not animate " + JSON.stringify({ moving, moved }));

  await openAppearance();
  await page.locator("#wallpaperMotion").click();
  await page.waitForFunction(() => document.documentElement.dataset.wallpaperMotion === "paused");
  const pausedAt = await stats();
  await page.waitForTimeout(350);
  const pausedStill = await stats();
  check(pausedStill.frames === pausedAt.frames && pausedStill.elapsed === pausedAt.elapsed, "pause did not hold");
  check((await page.locator("#wallpaperMotion").getAttribute("aria-pressed")) === "true", "pause button not pressed");
  await page.reload();
  await page.waitForFunction(() => typeof appReady !== "undefined" && appReady);
  check(await page.evaluate(() => localStorage.getItem("qwen-studio-wallpaper")) === "graphite", "style did not persist");
  check(await page.evaluate(() => document.documentElement.dataset.wallpaperMotion) === "paused", "pause did not persist");
  check(await page.evaluate(() => localStorage.getItem("qwen-studio-theme")) === null, "theme key was written by the wallpaper");

  await openAppearance();
  await page.locator("#wallpaperMotion").click();
  await page.waitForFunction(() => document.documentElement.dataset.wallpaperMotion === "running");
  await page.locator("#themeDark").click();
  check(await page.evaluate(() => document.documentElement.dataset.theme) === "dark", "dark theme did not apply");
  check(await page.evaluate(() => localStorage.getItem("qwen-studio-wallpaper")) === "graphite", "theme click cleared wallpaper");
  await page.locator("#wallpaperStarry").click();
  await page.waitForFunction(() => document.getElementById("wallpaperField")?.dataset.style === "starry");
  const starry = await stats();
  check(starry.cool > 80 && starry.warm > 8, "starry pixels " + JSON.stringify(starry));
  await page.locator("#closePreferences").click();
  await page.locator("#preferencesDialog").waitFor({ state: "hidden" });
  await shot("starry-dark.png");

  await openAppearance();
  await page.locator("#themeLight").click();
  await page.locator("#wallpaperLilies").click();
  await page.waitForFunction(() => document.getElementById("wallpaperField")?.dataset.style === "lilies");
  const lilies = await stats();
  check(lilies.green > 40 && lilies.pink > 5, "lilies pixels " + JSON.stringify(lilies));
  await page.locator('[data-settings-section="general"]').click();
  await page.locator("#language").click();
  await page.locator('[data-settings-section="appearance"]').click();
  check((await page.locator("#wallpaperLilies .wallpaper-name").textContent()) === "Water Lilies", "English lilies label");
  check((await page.locator("#wallpaperStarry .wallpaper-name").textContent()) === "Starry Night", "English starry label");
  check((await page.locator("#themeDark").getAttribute("aria-label")) === "Dark mode", "theme label did not translate");
  await page.locator("#closePreferences").click();
  await shot("lilies-light.png");
  await page.reload();
  await page.waitForFunction(() => typeof appReady !== "undefined" && appReady);
  const kept = await page.evaluate(() => ({
    style: document.getElementById("wallpaperField")?.dataset.style || "",
    wallpaper: localStorage.getItem("qwen-studio-wallpaper"),
    language: localStorage.getItem("qwen-studio-language"),
    theme: localStorage.getItem("qwen-studio-theme"),
  }));
  check(kept.style === "lilies" && kept.wallpaper === "lilies" && kept.language === "en" && kept.theme === "light", "reload lost choices " + JSON.stringify(kept));

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => document.documentElement.dataset.wallpaperMotion === "reduced");
  const reducedAt = await stats();
  await page.waitForTimeout(350);
  const reducedStill = await stats();
  check(reducedStill.frames === reducedAt.frames && reducedStill.style === "lilies", "reduced motion still animates " + JSON.stringify({ reducedAt, reducedStill }));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForFunction(() => document.documentElement.dataset.wallpaperMotion === "running");
  const resumed = await stats();
  await page.waitForTimeout(350);
  const resumedLater = await stats();
  check(resumedLater.frames > resumed.frames, "motion did not resume");

  const visible = await stats();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  check(await page.evaluate(() => document.documentElement.dataset.wallpaperMotion) === "hidden", "tab hide did not pause");
  const held = await stats();
  await page.waitForTimeout(400);
  const heldLater = await stats();
  check(heldLater.elapsed === held.elapsed && heldLater.frames === held.frames, "elapsed advanced while hidden");
  check(held.elapsed + 80 >= visible.elapsed, "hide rewound the clock");
  await page.evaluate(() => {
    delete document.hidden;
    delete document.visibilityState;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForFunction(() => document.documentElement.dataset.wallpaperMotion === "running");

  const plate = await page.evaluate(() => {
    const sample = document.createElement("div");
    sample.className = "assistant-message";
    sample.textContent = "可读的回答";
    document.body.append(sample);
    const color = getComputedStyle(sample).color;
    const background = getComputedStyle(sample).backgroundColor;
    sample.remove();
    const parse = (value) => {
      const nums = (value.match(/[\d.]+/g) || []).map(Number);
      if (value.startsWith("color(")) {
        return { rgb: nums.slice(0, 3).map((channel) => channel * 255), alpha: nums.length > 3 ? nums[3] : 1 };
      }
      return { rgb: nums.slice(0, 3), alpha: nums.length > 3 ? nums[3] : 1 };
    };
    const ink = parse(color).rgb;
    const bg = parse(background);
    const over = (base) => bg.rgb.map((channel, i) => channel * bg.alpha + base[i] * (1 - bg.alpha));
    const lum = (rgb) => {
      const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
    };
    const ratio = (rgb) => {
      const a = lum(ink), b = lum(rgb);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    return { color, background, white: ratio(over([255, 255, 255])), black: ratio(over([0, 0, 0])) };
  });
  check(plate.white >= 4.5 && plate.black >= 4.5, "assistant text contrast " + JSON.stringify(plate));

  const fetched = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => /\.(png|jpe?g|gif|webp)(\?|$)/i.test(name)));
  check(fetched.length === 0, "wallpaper fetched an image " + fetched.join(","));

  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.locator("#sidebarShade").isVisible()) await page.locator("#sidebarShade").click();
  await page.locator("#prompt").click();
  check(await page.evaluate(() => {
    const prompt = document.getElementById("prompt");
    const rect = prompt.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + 12, rect.top + 10);
    return prompt.contains(hit);
  }), "narrow prompt is not clickable");
  await shot("narrow.png");
  await openAppearance();
  await page.locator("#wallpaperOff").click();
  await page.waitForFunction(() => !document.getElementById("wallpaperField"));
  check(await page.evaluate(() => localStorage.getItem("qwen-studio-wallpaper")) === "off", "off was not stored");
  check(await page.evaluate(() => !document.documentElement.dataset.wallpaper), "off left a wallpaper attribute");
  await page.locator("#closePreferences").click();

  if (out) fs.writeFileSync(path.join(out, "wallpaper.json"), JSON.stringify({ graphite, starry, lilies, plate }, null, 2));
  return { defaultOff: true, graphite: true, starry: true, lilies: true, bilingual: true, persisted: true, paused: true, reduced: true, hidden: true, narrow: true };
};
