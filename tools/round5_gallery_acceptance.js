// Round 5 gallery module — synthetic DOM harness (module CSS+JS only).
// Run from repo root:
// node -e "
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
  const candidates = [process.cwd()];
  const repoRoot = candidates.find((root) =>
    fs.existsSync(path.join(root, cssRel)),
  );
  check(repoRoot, "gallery-ui assets not found from harness");
  const css = fs.readFileSync(path.join(repoRoot, cssRel), "utf8");
  const js = fs.readFileSync(path.join(repoRoot, jsRel), "utf8");
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  const svgData = (w, h, color) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="${color}"/></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  };

  const masonryItems = [
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
    {
      id: "no-meta",
      prompt: "No metadata natural aspect",
      image: { filename: "natural.svg", subfolder: "", type: "output" },
    },
    {
      id: "panorama",
      prompt: "Extra column filler",
      width: 1200,
      height: 500,
      image: { filename: "panorama.svg", subfolder: "", type: "output" },
    },
  ];

  const imageSrcByFilename = {
    "wide.svg": svgData(1600, 900, "#4a6fa5"),
    "tall.svg": svgData(600, 1200, "#6b4a8a"),
    "square.svg": svgData(800, 800, "#3d8b6e"),
    "classic.svg": svgData(1024, 768, "#b86b3d"),
    "natural.svg": svgData(900, 300, "#c9a227"),
    "panorama.svg": svgData(1200, 500, "#2d6a7e"),
  };

  const shell = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8" />
<style>
  :root {
    --canvas: #0e0e0e; --surface-elevated: #212121; --ink: #ededed;
    --ink-secondary: #a3a3a3; --line: rgba(255,255,255,0.08); --row-hover: rgba(255,255,255,0.06);
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--canvas); overflow-x: hidden; }
  #galleryView { width: 100%; }
  #galleryGrid { width: 100%; }
</style></head>
<body>
  <section id="galleryView"><div id="galleryGrid"></div></section>
</body></html>`;

  await page.setContent(shell, { waitUntil: "domcontentloaded" });
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: js });

  const events = { open: [], trash: [] };
  await page.exposeFunction("harnessOnOpen", (id) => events.open.push(id));
  await page.exposeFunction("harnessOnTrash", (id) => events.trash.push(id));

  const mount = async (contentWidth, itemList = masonryItems) => {
    await page.evaluate(
      ({ contentWidth, itemList, imageSrcByFilename }) => {
        const grid = document.getElementById("galleryGrid");
        grid.style.width = `${contentWidth}px`;
        window.HanzGallery.render(grid, itemList, {
          imageURL: (image) =>
            imageSrcByFilename[image.filename] ||
            imageSrcByFilename["square.svg"],
          language: "zh",
          onOpen: (item) => window.harnessOnOpen(item.id),
          onTrash: (item) => window.harnessOnTrash(item.id),
        });
      },
      { contentWidth, itemList, imageSrcByFilename },
    );
    await page.waitForSelector(".gallery-card img.gallery-img--loaded", {
      timeout: 8000,
    });
    await page.waitForTimeout(80);
  };

  const readLayout = () =>
    page.evaluate(() => {
      const grid = document.getElementById("galleryGrid");
      const inline = grid.style.gridTemplateColumns || "";
      const repeatMatch = inline.match(/repeat\(\s*(\d+)/);
      let colCount = repeatMatch ? Number(repeatMatch[1]) : 0;
      if (!colCount) {
        const gtc = getComputedStyle(grid).gridTemplateColumns;
        colCount =
          gtc && gtc !== "none"
            ? gtc.split(/\s+/).filter(Boolean).length
            : 0;
      }

      const tiles = [...grid.querySelectorAll(".gallery-tile")];
      const positions = tiles.map((tile) => {
        const m = new DOMMatrixReadOnly(getComputedStyle(tile).transform);
        const rect = tile.getBoundingClientRect();
        return {
          left: m.m41,
          top: m.m42,
          bottom: m.m42 + rect.height,
          height: rect.height,
        };
      });

      const byCol = new Map();
      for (const p of positions) {
        const key = Math.round(p.left);
        if (!byCol.has(key)) byCol.set(key, []);
        byCol.get(key).push(p);
      }

      const MAX_STACK_GAP = 20;
      let maxVerticalGap = 0;
      for (const col of byCol.values()) {
        col.sort((a, b) => a.top - b.top);
        for (let i = 1; i < col.length; i++) {
          const gap = col[i].top - col[i - 1].bottom;
          if (gap > maxVerticalGap) maxVerticalGap = gap;
        }
      }

      const noMetaTile = grid.querySelector(
        '.gallery-tile[data-gallery-aspect]',
      );
      const noMeta = [...grid.querySelectorAll(".gallery-tile")].find((t) => {
        const card = t.querySelector(".gallery-card");
        return card?.getAttribute("aria-label")?.includes("No metadata");
      });
      const naturalAspect = noMeta
        ? Number(noMeta.dataset.galleryAspect || 0)
        : 0;

      return {
        colCount,
        dataCols: Number(grid.dataset.galleryCols || 0),
        distinctLefts: new Set(positions.map((p) => Math.round(p.left))).size,
        maxVerticalGap,
        naturalAspect,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    });

  const assertColumns = async (contentWidth, expected, itemList = masonryItems) => {
    await mount(contentWidth, itemList);
    const layout = await readLayout();
    check(
      layout.colCount === expected,
      `content ${contentWidth}px: grid-template-columns count expected ${expected}, got ${layout.colCount} (${layout.dataCols} data)`,
    );
    check(
      layout.dataCols === expected,
      `data-gallery-cols mismatch at ${contentWidth}: ${layout.dataCols}`,
    );
    const minDistinct = Math.min(expected, itemList.length);
    check(
      layout.distinctLefts === minDistinct,
      `distinct column positions at ${contentWidth}: expected ${minDistinct}, got ${layout.distinctLefts}`,
    );
    check(!layout.overflow, `horizontal overflow at content width ${contentWidth}`);
    return layout;
  };

  await page.setViewportSize({ width: 1500, height: 1200 });

  const at1292 = await assertColumns(1292, 6);
  const at1132 = await assertColumns(1132, 5);
  const at358 = await assertColumns(358, 1);

  check(
    at1292.maxVerticalGap <= 20,
    `masonry stack gap too large at 1292: ${at1292.maxVerticalGap}px (max 20)`,
  );
  check(
    at1132.maxVerticalGap <= 20,
    `masonry stack gap too large at 1132: ${at1132.maxVerticalGap}px`,
  );

  check(
    Math.abs(at1292.naturalAspect - 3) < 0.05,
    `no-metadata item should use natural 3:1 aspect, got ${at1292.naturalAspect}`,
  );

  await mount(1292);
  await page.evaluate(() => {
    document.getElementById("galleryGrid").style.width = "1132px";
  });
  await page.waitForTimeout(120);
  const afterResize = await readLayout();
  check(
    afterResize.colCount === 5,
    `resize 1292→1132: expected 5 cols, got ${afterResize.colCount}`,
  );

  await mount(358);
  const tabOrder = await page.evaluate(() => {
    const buttons = [
      ...document.getElementById("galleryGrid").querySelectorAll("button"),
    ];
    return buttons.map((b) =>
      b.className.split(" ").find((c) => c.startsWith("gallery-")),
    );
  });
  const expectedTab = masonryItems
    .map(() => "gallery-card,gallery-remove")
    .join(",");
  check(tabOrder.join(",") === expectedTab, "tab/DOM order: " + tabOrder.join(","));

  await page.locator(".gallery-card").first().click();
  await page.waitForTimeout(40);
  check(events.open.includes("wide"), "onOpen callback");

  await page.locator(".gallery-remove").first().click();
  await page.waitForTimeout(40);
  check(events.trash.includes("wide"), "onTrash callback");

  await page.evaluate(() =>
    window.HanzGallery.destroy(document.getElementById("galleryGrid")),
  );
  const childCount = await page.evaluate(
    () => document.getElementById("galleryGrid").childElementCount,
  );
  check(childCount === 0, "destroy clears children");
  check(!errors.length, errors.join("; "));

  return {
    columns: { w1292: at1292.colCount, w1132: at1132.colCount, w358: at358.colCount },
    resizeTo1132: afterResize.colCount,
    maxVerticalGap: { w1292: at1292.maxVerticalGap, w1132: at1132.maxVerticalGap },
    naturalAspectNoMeta: at1292.naturalAspect,
    tabOrderOk: true,
    onOpen: events.open,
    onTrash: events.trash,
    errors,
  };
}
