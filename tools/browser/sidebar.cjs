// Current contract adapted from round8_pinned_sidebar_acceptance.js. Run via tools/validate.py.
/**
 * Pinned history plane. Round 8's rail-colored target was wrong.
 * Pinned history matches --canvas; the rail stays --sidebar. Synthetic demo only.
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

const base = process.env.LOCALGPT_TEST_BASE;
const shotDir = path.resolve((process.env.LOCALGPT_TEST_OUTPUT + '/round8'));
const near = (value, expected, label) => {
  if (Math.abs(value - expected) >= 1) {
    throw new Error(`${label}: ${value} expected ${expected}`);
  }
};

function check(ok, message) {
  if (!ok) throw new Error(message);
}

function hairline(width) {
  // Chrome's used value snaps a specified 0.5px border to 1px.
  return width === "0.5px" || width === "1px";
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
      historyRadius: historyCss.borderRadius,
      railBg: css(rail).backgroundColor,
      mainBg: css(main).backgroundColor,
      mainClip: css(main).clipPath,
      mainBorderWidth: css(main).borderLeftWidth,
      mainBorderStyle: css(main).borderLeftStyle,
      mainBorderColor: css(main).borderLeftColor,
      dividerColor: token("--main-divider", "borderLeftColor"),
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
      await page.goto(base + "/qwen-cn/");await page.waitForFunction(() => typeof appReady !== 'undefined' && appReady);
      await page.evaluate((value) => {
        localStorage.setItem("qwen-studio-theme", value);
        localStorage.setItem("qwen-studio-sidebar", "closed");
      }, theme);
      await page.reload();await page.waitForFunction(() => typeof appReady !== 'undefined' && appReady);
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
      check(collapsed.mainBorderWidth === "0px", theme + " collapsed drew a divider");

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
      check(pinned.historyBg === pinned.mainBg, theme + " pinned history " + pinned.historyBg + " main " + pinned.mainBg);
      check(pinned.historyBg === pinned.canvasToken, theme + " pinned history is not --canvas");
      check(pinned.mainBg === pinned.canvasToken, theme + " main is not --canvas");
      check(pinned.historyBg !== pinned.railBg, theme + " pinned history matched the rail");
      check(pinned.railBg === pinned.sidebarToken, theme + " rail is not --sidebar");
      check(pinned.railBg !== pinned.mainBg, theme + " rail matched main");
      check(pinned.historyRadius === "16px 0px 0px 16px", theme + " history radius " + pinned.historyRadius);
      check(hairline(pinned.mainBorderWidth) && pinned.mainBorderStyle === "solid", theme + " main border " + pinned.mainBorderWidth);
      const authoredHairline = await page.evaluate(() => {
        const visit = (rules) => {
          for (const rule of rules) {
            if (String(rule.cssText || "").includes("0.5px solid var(--main-divider)")) return true;
            if (rule.cssRules && visit(rule.cssRules)) return true;
          }
          return false;
        };
        return [...document.styleSheets].some((sheet) => {
          try { return visit(sheet.cssRules); } catch { return false; }
        });
      });
      check(authoredHairline, theme + " stylesheet is missing the 0.5px divider");
      check(pinned.mainBorderColor === pinned.dividerColor, theme + " divider " + pinned.mainBorderColor + " token " + pinned.dividerColor);
      check(pinned.historyShadow === "none", theme + " pinned history kept a shadow");
      check(pinned.historyImage === "none", theme + " pinned background image");
      check(pinned.historyOpacity === "1", theme + " pinned history opacity");
      check(pinned.toggleOpacity === "1", theme + " pinned toggle opacity");
      check(
        pinned.mainClip === "inset(0px 0px 0px -16px round 16px)",
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
      check(historyPixel === mainPixel, theme + ` screenshot history ${historyPixel} main ${mainPixel}`);
      check(historyPixel !== railPixel, theme + ` screenshot history matched rail ${railPixel}`);
      check(historyPixel === pinned.historyBg, theme + ` screenshot ${historyPixel} computed ${pinned.historyBg}`);
      check(mainPixel === pinned.mainBg, theme + ` screenshot main ${mainPixel} computed ${pinned.mainBg}`);

      const rowMenu = await page.evaluate(async () => {
        const row = document.querySelector(".chat-row");
        const trigger = row?.querySelector(".chat-menu-trigger");
        if (!trigger) return { missing: true };
        trigger.click();
        const menu = row.querySelector(".chat-row-menu");
        const rect = menu.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + 12);
        const result = {
          missing: false,
          hit: !!hit && (hit === menu || menu.contains(hit)),
          inside: rect.width > 40 && rect.height > 20 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1 && rect.left >= -1,
        };
        menu.hidePopover?.();
        return result;
      });
      check(!rowMenu.missing && rowMenu.hit && rowMenu.inside, theme + " chat menu clipped " + JSON.stringify(rowMenu));

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
      check(hairline(gallery.mainBorderWidth), theme + " gallery divider " + gallery.mainBorderWidth);
      surfaces.gallery = gallery;
      await page.screenshot({ path: path.join(shotDir, `gallery-1440-${theme}.png`), scale: "css" });

      const pinBeforeSettings = await page.evaluate(() => localStorage.getItem("qwen-studio-sidebar"));
      await page.locator("#profileButton").click();
      const profileMenu = await page.evaluate(() => {
        const menu = document.getElementById("profileMenu");
        const rect = menu.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + Math.min(24, rect.height / 2));
        return {
          hit: !!hit && (hit === menu || menu.contains(hit)),
          inside: rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
          width: rect.width,
          height: rect.height,
        };
      });
      check(profileMenu.hit && profileMenu.inside && profileMenu.width > 40 && profileMenu.height > 40, theme + " profile menu clipped " + JSON.stringify(profileMenu));
      await page.locator("#appSettings").click();
      await page.waitForFunction(() => {
        const nav = document.getElementById("settingsNav");
        return document.getElementById("preferencesDialog").open && nav.parentElement.id === "sidebar";
      });
      const settings = await readPlane(page);
      const hierarchy = await page.evaluate(() => {
        const nav = document.getElementById("settingsNav");
        const history = document.getElementById("historyPanel");
        const pageEl = document.querySelector(".settings-page");
        const main = document.getElementById("mainContent");
        const rail = document.querySelector("#sidebar .app-rail");
        const item = nav.querySelector(".settings-nav-item");
        const selected = nav.querySelector('[aria-selected="true"]');
        const navBox = nav.getBoundingClientRect();
        const pageBox = pageEl.getBoundingClientRect();
        const railBox = rail.getBoundingClientRect();
        const hit = document.elementFromPoint(navBox.x + navBox.width / 2, Math.min(navBox.bottom - 24, navBox.y + 80));
        const itemCss = getComputedStyle(item);
        const navCss = getComputedStyle(nav);
        const pageCss = getComputedStyle(pageEl);
        const mainCss = getComputedStyle(main);
        const probe = document.createElement("div");
        probe.style.backgroundColor = "rgba(255,255,255,0.1)";
        document.body.appendChild(probe);
        const darkSelected = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return {
          rails: document.querySelectorAll(".app-rail").length,
          navInDialog: !!nav.closest("#preferencesDialog"),
          historyVisibility: getComputedStyle(history).visibility,
          hitNav: !!hit && (hit === nav || nav.contains(hit)),
          hitHistory: !!hit && (hit === history || history.contains(hit)),
          navX: navBox.x,
          navWidth: navBox.width,
          pageX: pageBox.x,
          railX: railBox.x,
          railWidth: railBox.width,
          pageBorder: pageCss.borderLeftWidth,
          pageClip: pageCss.clipPath,
          mainClip: mainCss.clipPath,
          mainBorder: mainCss.borderLeftWidth,
          pageBg: pageCss.backgroundColor,
          navBg: navCss.backgroundColor,
          columns: pageCss.gridTemplateColumns.trim().split(/\s+/).length,
          font: itemCss.fontSize,
          height: itemCss.height,
          pad: [itemCss.paddingTop, itemCss.paddingRight, itemCss.paddingBottom, itemCss.paddingLeft].join(" "),
          gap: itemCss.gap,
          radius: itemCss.borderRadius,
          navPad: [navCss.paddingTop, navCss.paddingRight, navCss.paddingBottom, navCss.paddingLeft].join(" "),
          selected: selected ? getComputedStyle(selected).backgroundColor : "",
          darkSelected,
          stored: localStorage.getItem("qwen-studio-sidebar"),
        };
      });
      check(settings.state === "pinned", theme + " settings dropped the pin");
      check(hierarchy.rails === 1 && !hierarchy.navInDialog, theme + " settings duplicated navigation");
      check(hierarchy.historyVisibility === "hidden" && hierarchy.hitNav && !hierarchy.hitHistory, theme + " history peeked over settings");
      near(hierarchy.navX, 52, theme + " settings nav x");
      near(hierarchy.navWidth, 288, theme + " settings nav width");
      near(hierarchy.pageX, 340, theme + " settings main x");
      near(hierarchy.railX, 0, theme + " settings rail x");
      near(hierarchy.railWidth, 52, theme + " settings rail width");
      near(settings.main.x, 340, theme + " settings underlying main x");
      check(hairline(hierarchy.pageBorder) && hierarchy.mainBorder === "0px", theme + " double border " + hierarchy.pageBorder + "/" + hierarchy.mainBorder);
      check(hierarchy.pageClip === pinned.mainClip && hierarchy.mainClip === "none", theme + " double clip " + hierarchy.pageClip + " / " + hierarchy.mainClip);
      check(hierarchy.pageBg === pinned.mainBg && hierarchy.navBg === pinned.canvasToken, theme + " settings plane " + hierarchy.navBg);
      check(hierarchy.columns === 1, theme + " settings kept a second column " + hierarchy.columns);
      check(hierarchy.stored === pinBeforeSettings, theme + " settings rewrote the pin preference");
      check(hierarchy.font === "14px" && hierarchy.height === "35px", theme + " nav metrics " + hierarchy.font + " " + hierarchy.height);
      check(hierarchy.pad === "6px 10px 6px 10px" && hierarchy.gap === "8px" && hierarchy.radius === "8px", theme + " nav item box " + hierarchy.pad);
      check(hierarchy.navPad === "4px 6px 8px 6px", theme + " nav padding " + hierarchy.navPad);
      if (theme === "dark") check(hierarchy.selected === hierarchy.darkSelected, theme + " selected " + hierarchy.selected);
      await page.screenshot({ path: path.join(shotDir, `settings-1440-${theme}.png`), scale: "css" });
      await page.locator('[data-settings-section="memory"]').click();
      await page.locator("#memoryNav").click();
      await page.waitForSelector("#memoryDialog[open]");
      await page.locator("#backMemory").click();
      await page.waitForFunction(() => !document.getElementById("memoryDialog").open && document.getElementById("preferencesDialog").open);
      await page.locator("#closePreferences").click();
      await page.waitForFunction(() => !document.getElementById("preferencesDialog").open && !document.body.classList.contains("settings-surface-open"));
      check(await page.locator("#galleryView").isVisible(), theme + " closing settings left Gallery");
      check(
        await page.evaluate(() => document.getElementById("settingsNav").closest("#preferencesDialog") !== null),
        theme + " settings nav was not restored",
      );
      check(
        (await page.evaluate(() => localStorage.getItem("qwen-studio-sidebar"))) === pinBeforeSettings,
        theme + " closing settings rewrote the pin preference",
      );
      const settingsBox = { x: hierarchy.pageX };
      surfaces.settings = settings;

      await page.goto(base + "/qwen-cn/");await page.waitForFunction(() => typeof appReady !== 'undefined' && appReady);
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
      check((await page.evaluate(() => localStorage.getItem("qwen-studio-sidebar"))) === "closed", theme + " unpin did not store closed");
      await page.locator("#profileButton").click();
      await page.locator("#appSettings").click();
      await page.waitForFunction(() => document.getElementById("settingsNav").parentElement.id === "sidebar");
      const forced = await page.evaluate(() => ({
        stored: localStorage.getItem("qwen-studio-sidebar"),
        pinnedClass: document.body.classList.contains("sidebar-open"),
        mainX: document.getElementById("mainContent").getBoundingClientRect().x,
        pageX: document.querySelector(".settings-page").getBoundingClientRect().x,
        navX: document.getElementById("settingsNav").getBoundingClientRect().x,
      }));
      check(forced.stored === "closed" && !forced.pinnedClass, theme + " collapsed settings rewrote pin " + forced.stored);
      near(forced.mainX, 340, theme + " collapsed settings main x");
      near(forced.pageX, 340, theme + " collapsed settings page x");
      near(forced.navX, 52, theme + " collapsed settings nav x");
      await page.locator("#closePreferences").click();
      await page.waitForFunction(() => !document.body.classList.contains("settings-surface-open"));
      await settle(page, "collapsed");
      const restoredCollapsed = await readPlane(page);
      near(restoredCollapsed.main.x, 52, theme + " settings close did not restore the collapsed inset");
      check(restoredCollapsed.stored === "closed", theme + " settings close stored a pin");

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
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + "/qwen-cn/");await page.waitForFunction(() => typeof appReady !== 'undefined' && appReady);
    await page.evaluate(() => {
      localStorage.setItem("qwen-studio-theme", "dark");
      localStorage.setItem("qwen-studio-sidebar", "closed");
    });
    await page.reload();await page.waitForFunction(() => typeof appReady !== 'undefined' && appReady);
    await page.locator("#prompt").waitFor();
    await page.locator("#mobileMenu").click();
    await page.locator("#profileButton").click();
    await page.locator("#appSettings").click();
    await page.waitForSelector("#preferencesDialog[open]");
    const mobile = await page.evaluate(() => {
      const nav = document.getElementById("settingsNav");
      return {
        inDialog: !!nav.closest("#preferencesDialog"),
        rails: document.querySelectorAll(".app-rail").length,
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        stored: localStorage.getItem("qwen-studio-sidebar"),
      };
    });
    check(mobile.inDialog && mobile.rails === 1 && !mobile.overflow && mobile.stored === "closed", "Mobile settings " + JSON.stringify(mobile));
    await page.locator("#settingsBack").click();
    await page.locator(".settings-nav-open").waitFor();
    const mobileNav = await page.locator("#settingsNav").boundingBox();
    check(mobileNav.x < 8 && mobileNav.width > 120 && mobileNav.width < 360, "Mobile settings drawer " + JSON.stringify(mobileNav));
    check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "Mobile settings drawer overflow");
    await page.locator("#closePreferences").click();
    await page.waitForFunction(() => !document.getElementById("preferencesDialog").open);
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
