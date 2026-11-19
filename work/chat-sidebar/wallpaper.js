/* Programmatic micro-cube wallpaper. No image or font fetches. */
(() => {
  "use strict";
  const KEY = "qwen-studio-wallpaper";
  const STYLES = ["off", "graphite"];
  const BUTTONS = [
    ["wallpaperOff", "off"],
    ["wallpaperGraphite", "graphite"],
  ];
  if (!document.getElementById("wallpaperOff")) return;

  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  let style = "off";
  let field = null;
  let ctx = null;
  let scene = null;
  let raf = 0;
  let last = 0;
  let elapsed = 0;
  let frames = 0;

  function tr(key) {
    return typeof t === "function" ? t(key) : key;
  }
  function hash(x, y) {
    let n = Math.imul(x + 1, 0x9e3779b1) ^ Math.imul(y + 1, 0x85ebca6b);
    n = Math.imul(n ^ (n >>> 16), 0xc2b2ae35);
    return (n ^ (n >>> 16)) >>> 0;
  }
  function scale(rgb, factor) {
    return rgb.map((channel) => Math.max(0, Math.min(255, Math.round(channel * factor))));
  }
  function css(rgb) {
    return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  }
  function cellSize(width, height) {
    const raw = Math.sqrt((width * height) / 14000);
    return Math.max(5, Math.min(8, Math.round(raw)));
  }
  function metrics(cell) {
    const top = Math.max(1, Math.round(cell * 0.34));
    const lip = 1;
    return { cell, top, lip, body: cell - top - lip, left: Math.floor(cell / 2) };
  }
  function graphite(u, v, col, row) {
    let g = 214 - v * 28;
    if (u < 0.16) g = 16 + v * 10;
    if (u > 0.2 && u < 0.3 && v > 0.16 && v < 0.88) g = 242;
    const dx = u - 0.68;
    const dy = v - 0.4;
    const d2 = dx * dx + dy * dy * 1.15;
    if (d2 < 0.03) g = 248 - d2 * 900;
    else if (d2 < 0.045) g = 28;
    if (v > 0.82) g = 58;
    if (v > 0.9) g = 196;
    if (u > 0.36 && u < 0.56 && v > 0.22 && v < 0.72) {
      const cu = Math.floor((u - 0.36) / 0.05);
      const cv = Math.floor((v - 0.22) / 0.08);
      g = (cu + cv) % 2 === 0 ? 132 : 46;
      if (u < 0.375 || u > 0.545 || v < 0.24 || v > 0.7) g = 20;
    }
    g = Math.max(0, Math.min(255, g + (hash(col, row) % 11) - 5));
    return [g, g, g];
  }
  function sample(name, u, v, col, row) {
    if (name === "graphite") return graphite(u, v, col, row);
    return [0, 0, 0];
  }
  function fillPixels(data, width, height, x, y, w, h, rgb) {
    const x0 = Math.max(0, x | 0);
    const y0 = Math.max(0, y | 0);
    const x1 = Math.min(width, (x + w) | 0);
    const y1 = Math.min(height, (y + h) | 0);
    for (let yy = y0; yy < y1; yy++) {
      let i = (yy * width + x0) * 4;
      for (let xx = x0; xx < x1; xx++) {
        data[i] = rgb[0];
        data[i + 1] = rgb[1];
        data[i + 2] = rgb[2];
        data[i + 3] = 255;
        i += 4;
      }
    }
  }
  function stamp(data, width, height, x, y, rgb, box) {
    const top = scale(rgb, 1.35);
    const left = scale(rgb, 0.98);
    const right = scale(rgb, 0.55);
    const lip = scale(rgb, 0.32);
    fillPixels(data, width, height, x, y, box.cell, box.top, top);
    fillPixels(data, width, height, x, y + box.top, box.left, box.body, left);
    fillPixels(data, width, height, x + box.left, y + box.top, box.cell - box.left, box.body, right);
    fillPixels(data, width, height, x, y + box.cell - box.lip, box.cell, box.lip, lip);
  }
  function paintCube(x, y, rgb, box) {
    const top = scale(rgb, 1.35);
    const left = scale(rgb, 0.98);
    const right = scale(rgb, 0.55);
    const lip = scale(rgb, 0.32);
    ctx.fillStyle = css(top);
    ctx.fillRect(x, y, box.cell, box.top);
    ctx.fillStyle = css(left);
    ctx.fillRect(x, y + box.top, box.left, box.body);
    ctx.fillStyle = css(right);
    ctx.fillRect(x + box.left, y + box.top, box.cell - box.left, box.body);
    ctx.fillStyle = css(lip);
    ctx.fillRect(x, y + box.cell - box.lip, box.cell, box.lip);
  }
  function popPixels(col, row, time) {
    const h = hash(col >> 1, row >> 1);
    const period = 6400 + (h % 4200);
    const dur = 640 + (h % 280);
    const u = (time + (h % period)) % period;
    if (u > dur) return 0;
    const wave = Math.sin(Math.PI * (u / dur));
    const amp = 1 + (h % 2);
    if (wave > 0.55) return amp;
    if (wave > 0.2) return 1;
    return 0;
  }
  function readStyle() {
    try {
      const saved = localStorage.getItem(KEY);
      return STYLES.includes(saved) ? saved : "off";
    } catch {
      return "off";
    }
  }
  function motionMode() {
    if (style === "off") return "off";
    if (reduce.matches) return "reduced";
    if (document.hidden) return "hidden";
    return "running";
  }
  function publish() {
    if (!field) return;
    const mode = motionMode();
    field.dataset.style = style;
    field.dataset.motion = mode;
    field.dataset.frames = String(frames);
    field.dataset.elapsed = String(Math.round(elapsed));
    document.documentElement.dataset.wallpaperMotion = mode;
  }
  function paintSettled() {
    if (!ctx || !scene) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(scene.base, 0, 0);
  }
  function paintFrame() {
    if (!ctx || !scene) return;
    paintSettled();
    const { colors, cols, rows, box } = scene;
    const cell = box.cell;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const lift = popPixels(col, row, elapsed);
        if (!lift) continue;
        const i = (row * cols + col) * 3;
        const rgb = [colors[i], colors[i + 1], colors[i + 2]];
        const x = col * cell;
        const y = row * cell;
        ctx.fillStyle = css(scale(rgb, 0.35));
        ctx.fillRect(x, y, cell, cell);
        paintCube(x, y - lift, rgb, box);
      }
    }
  }
  function halt(settle) {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    if (settle) paintSettled();
    publish();
  }
  function loop(now) {
    if (motionMode() !== "running") {
      raf = 0;
      last = 0;
      if (motionMode() !== "hidden") paintSettled();
      publish();
      return;
    }
    if (!last) last = now;
    const delta = Math.min(34, now - last);
    last = now;
    elapsed += delta;
    raf = requestAnimationFrame(loop);
    paintFrame();
    frames += 1;
    publish();
  }
  function start() {
    if (motionMode() !== "running" || raf) return;
    last = 0;
    raf = requestAnimationFrame(loop);
  }
  function buildScene(width, height, name) {
    const box = metrics(cellSize(width, height));
    const cols = Math.ceil(width / box.cell);
    const rows = Math.ceil(height / box.cell);
    const base = document.createElement("canvas");
    base.width = width;
    base.height = height;
    const baseCtx = base.getContext("2d", { alpha: false });
    const image = baseCtx.createImageData(width, height);
    const colors = new Uint8ClampedArray(cols * rows * 3);
    const data = image.data;
    for (let row = 0; row < rows; row++) {
      const v = (row * box.cell + box.cell / 2) / height;
      for (let col = 0; col < cols; col++) {
        const u = (col * box.cell + box.cell / 2) / width;
        const rgb = sample(name, u, v, col, row);
        const i = (row * cols + col) * 3;
        colors[i] = rgb[0];
        colors[i + 1] = rgb[1];
        colors[i + 2] = rgb[2];
        stamp(data, width, height, col * box.cell, row * box.cell, rgb, box);
      }
    }
    baseCtx.putImageData(image, 0, 0);
    return { base, colors, cols, rows, box, style: name };
  }
  function ensureField() {
    if (field && field.isConnected) return field;
    field = document.createElement("canvas");
    field.id = "wallpaperField";
    field.setAttribute("aria-hidden", "true");
    document.body.prepend(field);
    ctx = field.getContext("2d", { alpha: false });
    return field;
  }
  function clearField() {
    halt(false);
    field?.remove();
    field = null;
    ctx = null;
    scene = null;
    delete document.documentElement.dataset.wallpaper;
    delete document.documentElement.dataset.wallpaperMotion;
  }
  function rebuild() {
    if (style === "off") return;
    ensureField();
    const width = field.clientWidth || window.innerWidth;
    const height = field.clientHeight || window.innerHeight;
    if (width < 2 || height < 2) return;
    if (field.width !== width || field.height !== height || !scene || scene.style !== style) {
      field.width = width;
      field.height = height;
      scene = buildScene(width, height, style);
    }
    const mode = motionMode();
    if (mode === "running") {
      paintFrame();
      start();
    } else if (mode === "hidden") paintFrame();
    else paintSettled();
    publish();
  }
  function pressButtons() {
    for (const [id, value] of BUTTONS) {
      const button = document.getElementById(id);
      if (button) button.setAttribute("aria-pressed", String(style === value));
    }
  }
  function applyStyle(next, persist) {
    style = STYLES.includes(next) ? next : "off";
    if (persist) {
      try { localStorage.setItem(KEY, style); } catch {}
    }
    pressButtons();
    if (style === "off") {
      clearField();
      return;
    }
    document.documentElement.dataset.wallpaper = style;
    ensureField();
    scene = null;
    rebuild();
  }
  for (const [id, value] of BUTTONS) {
    const button = document.getElementById(id);
    if (button) button.addEventListener("click", () => applyStyle(value, true));
  }
  reduce.addEventListener("change", () => {
    if (style === "off") return;
    if (motionMode() === "running") start();
    else halt(motionMode() !== "hidden");
  });
  document.addEventListener("visibilitychange", () => {
    if (style === "off") return;
    if (motionMode() === "running") start();
    else halt(false);
  });
  let resizeTimer = 0;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(rebuild, 80);
  }, { passive: true });
  addEventListener("storage", (event) => {
    if (event.key === KEY || event.key === null) applyStyle(event.key === null ? readStyle() : event.newValue, false);
  });
  applyStyle(readStyle(), false);
})();
