// Round 5 gallery module — synthetic DOM harness (no demo server).
// Run from repo root:
// NODE_PATH=/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules node -e "
// const { chromium } = require('playwright');
// const fs = require('fs');
// const run = eval(fs.readFileSync('tools/round5_gallery_acceptance.js','utf8'));
// (async () => { const b = await chromium.launch(); const p = await b.newPage();
// try { console.log(JSON.stringify(await run(p), null, 2)); console.log('PASS'); }
// catch (e) { console.error('FAIL:', e.message); process.exit(1); }
// finally { await b.close(); } })();"
async (page) => {
  const path = require("path");
  const fs = require("fs");

  const check = (ok, message) => {
    if (!ok) throw new Error(message);
  };

  const cssRel = "work/chat-sidebar/gallery-ui.css";
  const jsRel = "work/chat-sidebar/gallery-ui.js";
  const candidates = [
    path.resolve(__dirname, ".."),
    process.cwd(),
  ];
  const repoRoot = candidates.find((root) =>
    fs.existsSync(path.join(root, cssRel)),
  );
  check(repoRoot, "gallery-ui assets not found from harness");
  const cssPath = path.join(repoRoot, cssRel);
  const jsPath = path.join(repoRoot, jsRel);
  const css = fs.readFileSync(cssPath, "utf8");
  const js = fs.readFileSync(jsPath, "utf8");
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  const svgData = (w, h, color) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="${color}"/></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  };

  const items = [
    {
      id: "wide",
      prompt: "Wide landscape synthetic",
      width: 1600,
      height: 900,
      image: { filename: "wide.svg", subfolder: "", type: "output" },
    },
    {
      id: "tall",
      prompt: "Tall portrait synthetic",
      width: 600,
      height: 1200,
      image: { filename: "tall.svg", subfolder: "", type: "output" },
    },
    {
      id: "square",
      prompt: "Square synthetic",
      width: 800,
      height: 800,
      image: { filename: "square.svg", subfolder: "", type: "output" },
    },
    {
      id: "classic",
      prompt: "Classic 4:3 synthetic",
      width: 1024,
      height: 768,
      image: { filename: "classic.svg", subfolder: "", type: "output" },
    },
  ];

  const imageSrcByFilename = {
    "wide.svg": svgData(1600, 900, "#4a6fa5"),
    "tall.svg": svgData(600, 1200, "#6b4a8a"),
    "square.svg": svgData(800, 800, "#3d8b6e"),
    "classic.svg": svgData(1024, 768, "#b86b3d"),
  };

  const shell = `
<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root {
    --canvas: #0e0e0e;
    --surface-elevated: #212121;
    --ink: #ededed;
    --ink-secondary: #a3a3a3;
    --line: rgba(255,255,255,0.08);
    --row-hover: rgba(255,255,255,0.06);
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--canvas); color: var(--ink); font-family: system-ui, sans-serif; }
  #galleryView { width: 100%; min-height: 100vh; overflow-x: hidden; }
  #galleryHarness { width: var(--harness-width, 1440px); max-width: 100%; margin: 0 auto; }
</style>
</head>
<body>
  <section id="galleryView" aria-label="Gallery harness">
    <div id="galleryHarness">
      <div id="galleryGrid"></div>
    </div>
  </section>
</body>
</html>`;

  await page.setContent(shell, { waitUntil: "domcontentloaded" });
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: js });

  const events = { open: [], trash: [] };
  await page.exposeFunction("harnessOnOpen", (id) => events.open.push(id));
  await page.exposeFunction("harnessOnTrash", (id) => events.trash.push(id));

  const mount = async (width) => {
    await page.evaluate(
      ({ width, items, imageSrcByFilename }) => {
        document.getElementById("galleryHarness").style.setProperty(
          "--harness-width",
          `${width}px`,
        );
        const grid = document.getElementById("galleryGrid");
        window.HanzGallery.render(grid, items, {
          imageURL: (image) =>
            imageSrcByFilename[image.filename] ||
            imageSrcByFilename["square.svg"],
          language: "zh",
          onOpen: (item) => window.harnessOnOpen(item.id),
          onTrash: (item) => window.harnessOnTrash(item.id),
        });
      },
      { width, items, imageSrcByFilename },
    );
    await page.waitForSelector(".gallery-card img.gallery-img--loaded", {
      timeout: 5000,
    });
  };

  const expectCols = async (width, expectedCols) => {
    await mount(width);
    const cols = await page.evaluate(() =>
      Number(document.getElementById("galleryGrid").dataset.galleryCols || 0),
    );
    check(cols === expectedCols, `width ${width}: expected ${expectedCols} cols, got ${cols}`);
    const overflow = await page.evaluate(() => {
      const el = document.documentElement;
      return el.scrollWidth > el.clientWidth + 1;
    });
    check(!overflow, `width ${width}: horizontal overflow detected`);
    const aspects = await page.evaluate(() =>
      [...document.querySelectorAll(".gallery-media")].map((m) =>
        getComputedStyle(m).getPropertyValue("--gallery-aspect").trim(),
      ),
    );
    check(aspects.length === 4, "expected four tiles");
    check(
      new Set(aspects).size >= 3,
      "multi-aspect-ratio tiles should differ: " + aspects.join(", "),
    );
    const fits = await page.evaluate(() =>
      [...document.querySelectorAll(".gallery-card img")].every((img) => {
        const s = getComputedStyle(img);
        return s.objectFit === "contain";
      }),
    );
    check(fits, "images must use object-fit: contain");
    return cols;
  };

  await page.setViewportSize({ width: 1440, height: 900 });
  await expectCols(1440, 6);
  await expectCols(1280, 6);
  await expectCols(390, 2);

  await mount(1280);
  await page.evaluate(() => {
    document.getElementById("galleryHarness").style.setProperty(
      "--harness-width",
      "520px",
    );
  });
  await page.waitForTimeout(100);
  const colsAfterResize = await page.evaluate(() =>
    Number(document.getElementById("galleryGrid").dataset.galleryCols || 0),
  );
  check(colsAfterResize < 6, "resize should reduce column count");

  await mount(390);
  const tabOrder = await page.evaluate(() => {
    const grid = document.getElementById("galleryGrid");
    const buttons = [...grid.querySelectorAll("button")];
    return buttons.map((b) => b.className.split(" ").find((c) => c.startsWith("gallery-")));
  });
  check(
    tabOrder.join(",") === "gallery-card,gallery-remove,gallery-card,gallery-remove,gallery-card,gallery-remove,gallery-card,gallery-remove",
    "keyboard/DOM order should alternate card then remove: " + tabOrder.join(","),
  );

  await page.locator(".gallery-card").first().click();
  await page.waitForTimeout(50);
  check(events.open.includes("wide"), "onOpen should fire for first card");

  await page.locator(".gallery-remove").first().click();
  await page.waitForTimeout(50);
  check(events.trash.includes("wide"), "onTrash should fire for first tile");

  const ariaTrash = await page
    .locator(".gallery-remove")
    .first()
    .getAttribute("aria-label");
  check(
    ariaTrash === "移入回收站" || ariaTrash === "Move to trash",
    "trash aria-label must mean recycle bin: " + ariaTrash,
  );

  const hasCaption = await page.evaluate(() =>
    [...document.querySelectorAll(".gallery-card")].some((c) =>
      c.querySelector("span, .gallery-caption"),
    ),
  );
  check(!hasCaption, "persistent prompt caption must not be rendered");

  await page.evaluate(() => window.HanzGallery.destroy(document.getElementById("galleryGrid")));
  const childCount = await page.evaluate(
    () => document.getElementById("galleryGrid").childElementCount,
  );
  check(childCount === 0, "destroy should clear grid children");

  check(!errors.length, errors.join("; "));

  return {
    widths: { w1440: 6, w1280: 6, w390: 2 },
    resizeReducedColumns: colsAfterResize,
    tabOrderOk: true,
    onOpen: events.open,
    onTrash: events.trash,
    overflow: false,
    errors,
  };
}
