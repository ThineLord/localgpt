#!/usr/bin/env node
/**
 * Round 8 pinned history plane. Synthetic demo only.
 *   python3 work/chat-sidebar/build.py
 *   python3 tools/round5_demo.py --port 8194
 *   node tools/round8_pinned_sidebar_acceptance.js
 *
 * Asserts computed backgrounds and geometry at 1440×900 in light and dark.
 * Screenshots: output/playwright/round8/ (gitignored).
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  ({ chromium } = require("playwright-core"));
}

const base = process.env.ROUND8_BASE || "http://127.0.0.1:8194";
const shotDir = path.resolve("output/playwright/round8");
const near = (value, expected, label) => {
  if (Math.abs(value - expected) >= 1) {
    throw new Error(`${label}: ${value} expected ${expected}`);
  }
};

function check(ok, message) {
  if (!ok) throw new Error(message);
}

function samplePixel(file, x, y) {
  const script = `
from PIL import Image
im = Image.open(${JSON.stringify(file)}).convert("RGB")
print("%d,%d,%d" % im.getpixel((${Math.round(x)}, ${Math.round(y)})))
`;
  return execFileSync("python3", ["-c", script], { encoding: "utf8" }).trim();
}

function rgbOf(pixel) {
  const [r, g, b] = pixel.split(",").map((n) => Number(n));
  return `rgb(${r}, ${g}, ${b})`;
}

async function readPlane(page) {
  return page.evaluate(() => {
    const css = (el) => getComputedStyle(el);
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const token = (name, prop) => {
      const probe = document.createElement("div");
      probe.style[prop] = `var(${name})`;
      document.body.appendChild(probe);
      const value = css(probe)[prop];
      probe.remove();
      return value;
    };
    const history = document.getElementById("historyPanel");
    const rail = document.querySelector("#sidebar .app-rail");
    const main = document.getElementById("mainContent");
    const toggle = document.getElementById("sidebarToggle");
    const prompt = document.getElementById("prompt");
    const historyCss = css(history);
    return {
      state: document.getElementById("sidebar").dataset.state,
      pinnedClass: document.body.classList.contains("sidebar-open"),
      temporaryClass: document.body.classList.contains("sidebar-temporary"),
      theme: document.documentElement.dataset.theme,
      historyBg: historyCss.backgroundColor,
      historyImage: historyCss.backgroundImage,
      historyShadow: historyCss.boxShadow,
      historyOpacity: historyCss.opacity,
      railBg: css(rail).backgroundColor,
      mainBg: css(main).backgroundColor,
      mainClip: css(main).clipPath,
      toggleOpacity: css(toggle).opacity,
      sidebarToken: token("--sidebar", "backgroundColor"),
      canvasToken: token("--canvas", "backgroundColor"),
      elevatedToken: token("--surface-elevated", "backgroundColor"),
      floatingShadow: token("--floating-shadow", "boxShadow"),
      history: box(history),
      rail: box(rail),
      main: box(main),
      prompt: box(prompt),
      stored: localStorage.getItem("qwen-studio-sidebar"),
    };
  });
}

async function settle(page, state) {
  await page.waitForFunction((expected) => {
    const panel = document.getElementById("historyPanel");
    const sidebar = document.querySelector("#sidebar");
    if (sidebar.dataset.state !== expected) return false;
    const transform = getComputedStyle(panel).transform;
    if (expected === "collapsed") return transform === "matrix(1, 0, 0, 1, -8, 0)";
    return transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)";
  }, state);
}

async function main() {
  const healthRes = await fetch(base + "/qwen-cn/health");
  const health = await healthRes.json();
  if (!health.demo) throw new Error("Synthetic demo required at " + base);
  fs.mkdirSync(shotDir, { recursive: true });

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: true,
    args: ["--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const results = [];
  try {
    for (const theme of ["light", "dark"]) {
      await page.goto(base + "/qwen-cn/");
      await page.evaluate((value) => {
        localStorage.setItem("qwen-studio-theme", value);
        localStorage.setItem("qwen-studio-sidebar", "closed");
      }, theme);
      await page.reload();
      await page.locator("#prompt").waitFor();
      check(
        (await page.evaluate(() => document.documentElement.dataset.theme)) === theme,
        "Theme did not apply: " + theme,
      );

      const collapsed = await readPlane(page);
      check(collapsed.state === "collapsed", theme + " did not start collapsed");
      near(collapsed.main.x, 52, theme + " collapsed main x");
      check(
        collapsed.mainClip === "inset(0px round 16px)",
        theme + " collapsed clip " + collapsed.mainClip,
      );
      check(collapsed.toggleOpacity === "1", theme + " collapsed toggle opacity");

      await page.locator("#homeNav").hover();
      await settle(page, "temporary");
      const temporary = await readPlane(page);
      near(temporary.main.x, collapsed.main.x, theme + " temporary shifted main x");
      near(temporary.main.y, collapsed.main.y, theme + " temporary shifted main y");
      near(temporary.main.width, collapsed.main.width, theme + " temporary shifted main width");
      near(temporary.prompt.x, collapsed.prompt.x, theme + " temporary shifted composer");
      near(temporary.history.x, 56, theme + " temporary panel x");
      near(temporary.history.y, 4, theme + " temporary panel y");
      near(temporary.history.width, 284, theme + " temporary panel width");
      near(temporary.history.height, 892, theme + " temporary panel height");
      near(temporary.rail.width, 52, theme + " rail width");
      check(
        temporary.mainClip === "inset(0px round 16px)",
        theme + " temporary clip " + temporary.mainClip,
      );
      check(
        temporary.historyBg === temporary.elevatedToken,
        theme + " temporary background " + temporary.historyBg,
      );
      check(
        temporary.historyShadow === temporary.floatingShadow && temporary.historyShadow !== "none",
        theme + " temporary shadow " + temporary.historyShadow,
      );
      check(temporary.historyBg !== temporary.railBg, theme + " temporary matched the rail");
      check(temporary.toggleOpacity === "1", theme + " temporary toggle opacity");
      check(temporary.historyImage === "none", theme + " temporary background image");
      const tempShot = path.join(shotDir, `temp-1440-${theme}.png`);
      await page.screenshot({ path: tempShot, scale: "css" });

      await page.mouse.move(980, 460);
      await settle(page, "collapsed");
      const afterLeave = await readPlane(page);
      near(afterLeave.main.x, collapsed.main.x, theme + " leave shifted main");
      near(afterLeave.prompt.x, collapsed.prompt.x, theme + " leave shifted composer");

      await page.locator("#homeNav").hover();
      await settle(page, "temporary");
      await page.locator("#sidebarToggle").click();
      await settle(page, "pinned");
      await page.mouse.move(980, 460);
      await page.waitForTimeout(180);
      const pinned = await readPlane(page);
      check(pinned.state === "pinned" && pinned.pinnedClass, theme + " pointer leave closed the pin");
      check(!pinned.temporaryClass, theme + " pinned still temporary");
      check(pinned.stored === "open", theme + " pin was not stored");
      check(pinned.historyBg === pinned.railBg, theme + " pinned history " + pinned.historyBg + " rail " + pinned.railBg);
      check(pinned.historyBg === pinned.sidebarToken, theme + " pinned history is not --sidebar");
      check(pinned.mainBg === pinned.canvasToken, theme + " main is not --canvas");
      check(pinned.historyBg !== pinned.mainBg, theme + " pinned history matched main");
      check(pinned.railBg !== pinned.mainBg, theme + " rail matched main");
      check(pinned.historyShadow === "none", theme + " pinned history kept a shadow");
      check(pinned.historyImage === "none", theme + " pinned background image");
      check(pinned.historyOpacity === "1", theme + " pinned history opacity");
      check(pinned.toggleOpacity === "1", theme + " pinned toggle opacity");
      check(
        pinned.mainClip === "inset(0px round 0px 16px 0px 0px)",
        theme + " pinned clip " + pinned.mainClip,
      );
      near(pinned.main.x, 340, theme + " pinned main x");
      near(pinned.history.x, 52, theme + " pinned panel x");
      near(pinned.history.width, 288, theme + " pinned panel width");
      near(pinned.history.y, 0, theme + " pinned panel y");
      near(pinned.history.height, 900, theme + " pinned panel height");
      near(pinned.rail.width, 52, theme + " pinned rail width");
      near(pinned.rail.x, 0, theme + " pinned rail x");
      const toggleHit = await page.evaluate(() => {
        const toggle = document.getElementById("sidebarToggle");
        const rect = toggle.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return !!hit && (hit === toggle || toggle.contains(hit));
      });
      check(toggleHit, theme + " pinned toggle is not visible to hit testing");

      const pinnedShot = path.join(shotDir, `pinned-1440-${theme}.png`);
      await page.screenshot({ path: pinnedShot, scale: "css" });
      const railPixel = rgbOf(samplePixel(pinnedShot, 20, 420));
      const historyPixel = rgbOf(samplePixel(pinnedShot, 200, 820));
      const mainPixel = rgbOf(samplePixel(pinnedShot, 900, 140));
      check(historyPixel === railPixel, theme + ` screenshot history ${historyPixel} rail ${railPixel}`);
      check(historyPixel !== mainPixel, theme + ` screenshot history matched main ${mainPixel}`);
      check(historyPixel === pinned.historyBg, theme + ` screenshot ${historyPixel} computed ${pinned.historyBg}`);
      check(mainPixel === pinned.mainBg, theme + ` screenshot main ${mainPixel} computed ${pinned.mainBg}`);

      const surfaces = { chat: pinned };
      await page.locator("#galleryNav").click();
      await page.waitForSelector("#galleryView:not([hidden])");
      const gallery = await readPlane(page);
      check(gallery.state === "pinned", theme + " gallery dropped the pin");
      check(gallery.historyBg === pinned.historyBg && gallery.mainBg === pinned.mainBg, theme + " gallery recolored the plane");
      near(gallery.main.x, pinned.main.x, theme + " gallery main x");
      near(gallery.history.x, pinned.history.x, theme + " gallery panel x");
      near(gallery.history.width, pinned.history.width, theme + " gallery panel width");
      check(gallery.mainClip === pinned.mainClip, theme + " gallery clip changed");
      surfaces.gallery = gallery;
      await page.screenshot({ path: path.join(shotDir, `gallery-1440-${theme}.png`), scale: "css" });

      await page.locator("#profileButton").click();
      await page.locator("#appSettings").click();
      await page.waitForSelector("#preferencesDialog[open]");
      const settings = await readPlane(page);
      const settingsBox = await page.locator(".settings-page").boundingBox();
      check(settings.state === "pinned", theme + " settings dropped the pin");
      check(settings.historyBg === pinned.historyBg && settings.mainBg === pinned.mainBg, theme + " settings recolored the plane");
      near(settings.main.x, pinned.main.x, theme + " settings main x");
      near(settings.history.x, pinned.history.x, theme + " settings panel x");
      near(settings.history.width, pinned.history.width, theme + " settings panel width");
      near(settingsBox.x, pinned.main.x, theme + " settings page x");
      check(settings.mainClip === pinned.mainClip, theme + " settings clip changed");
      surfaces.settings = settings;
      await page.screenshot({ path: path.join(shotDir, `settings-1440-${theme}.png`), scale: "css" });

      await page.reload();
      await page.locator("#prompt").waitFor();
      await settle(page, "pinned");
      const restored = await readPlane(page);
      check(restored.stored === "open" && restored.historyBg === pinned.historyBg, theme + " pin did not survive refresh");
      near(restored.main.x, 340, theme + " restored main x");
      check(restored.toggleOpacity === "1", theme + " restored toggle opacity");

      await page.locator("#sidebarToggle").click();
      await settle(page, "collapsed");
      const unpinned = await readPlane(page);
      near(unpinned.main.x, 52, theme + " unpin main x");
      check(unpinned.mainClip === "inset(0px round 16px)", theme + " unpin clip");
      const beforeHover = unpinned.main.x;
      await page.locator("#homeNav").hover();
      await settle(page, "temporary");
      const reopened = await readPlane(page);
      near(reopened.main.x, beforeHover, theme + " second temporary shifted content");
      check(reopened.historyBg === reopened.elevatedToken, theme + " second temporary lost elevation");
      check(reopened.historyShadow !== "none", theme + " second temporary lost shadow");
      await page.mouse.move(980, 460);
      await settle(page, "collapsed");

      results.push({
        theme,
        collapsedMainX: collapsed.main.x,
        temporary: {
          background: temporary.historyBg,
          shadow: temporary.historyShadow,
          box: temporary.history,
          mainX: temporary.main.x,
        },
        pinned: {
          history: pinned.historyBg,
          rail: pinned.railBg,
          main: pinned.mainBg,
          shadow: pinned.historyShadow,
          clip: pinned.mainClip,
          box: pinned.history,
          mainX: pinned.main.x,
          pixels: { history: historyPixel, rail: railPixel, main: mainPixel },
        },
        surfaces: {
          galleryMainX: gallery.main.x,
          settingsMainX: settings.main.x,
          settingsPageX: settingsBox.x,
        },
        restored: restored.stored,
        shots: {
          temp: tempShot,
          pinned: pinnedShot,
        },
      });
    }
  } finally {
    await browser.close();
  }
  const report = { base, viewport: "1440x900", results };
  const reportPath = path.join(shotDir, "report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
