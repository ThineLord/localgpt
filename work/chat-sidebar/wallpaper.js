/* Programmatic micro-cube wallpaper. No image or font fetches. */
(() => {
  "use strict";
  const KEY = "qwen-studio-wallpaper";
  const PAUSE_KEY = "qwen-studio-wallpaper-paused";
  const STYLES = ["off", "graphite", "starry", "lilies"];
  const BUTTONS = [
    ["wallpaperOff", "off"],
    ["wallpaperGraphite", "graphite"],
    ["wallpaperStarry", "starry"],
    ["wallpaperLilies", "lilies"],
  ];
  if (!document.getElementById("wallpaperOff")) return;

  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  let style = "off";
  let paused = false;
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
  function mix(a, b, t) {
    const k = t < 0 ? 0 : t > 1 ? 1 : t;
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  }
  function clampRgb(channels) {
    return channels.map((n) => Math.max(0, Math.min(255, Math.round(n))));
  }
  function starry(u, v) {
    const navy = [8, 22, 72];
    const blue = [25, 62, 148];
    const cyan = [70, 140, 196];
    const cream = [236, 226, 186];
    const gold = [244, 196, 72];
    const yellow = [255, 230, 120];
    const s1 = Math.sin(u * 10.5 + Math.sin(v * 9) * 2.2 + v * 2);
    const s2 = Math.sin(v * 12 + Math.cos(u * 7.5) * 1.8);
    const s3 = Math.sin((u + v) * 16 + Math.sin(u * 5) * 3);
    let color = mix(navy, blue, 0.5 + 0.5 * s1);
    color = mix(color, cyan, Math.max(0, s2) ** 2 * 0.55);
    color = mix(color, cream, Math.max(0, s3) ** 3 * 0.35);
    for (const [sx, sy, amount] of [
      [0.33, 0.18, 1], [0.52, 0.12, 0.8], [0.67, 0.24, 1.15], [0.8, 0.14, 0.7],
      [0.46, 0.34, 0.85], [0.22, 0.3, 0.55], [0.74, 0.4, 0.6], [0.58, 0.22, 0.45],
    ]) {
      const d = Math.hypot((u - sx) * 1.15, (v - sy) * 1.35);
      color = mix(color, yellow, Math.min(1, Math.exp(-d * d * 900 / amount) * 1.3));
      color = mix(color, gold, Math.min(1, Math.exp(-(((d - 0.035 * amount) * 28) ** 2)) * 0.85));
      color = mix(color, cream, Math.min(1, Math.exp(-(((d - 0.06 * amount) * 22) ** 2)) * 0.45));
    }
    const moon = Math.hypot((u - 0.86) * 1.1, v - 0.1);
    color = mix(color, [255, 236, 170], Math.exp(-moon * moon * 500));
    color = mix(color, gold, Math.exp(-(((moon - 0.045) * 40) ** 2)));
    const flame = Math.abs(u - (0.07 + Math.sin(v * 22) * 0.012 + Math.sin(v * 7) * 0.02));
    const flameWidth = 0.055 * (1.15 - v * 0.4) + Math.max(0, Math.sin(v * 30)) * 0.01;
    if (v < 0.86 && flame < flameWidth) color = mix([6, 20, 18], [12, 42, 36], v);
    const hill = 0.66 + Math.sin(u * 7.5) * 0.035 + Math.sin(u * 2.2 + 1) * 0.02;
    if (v > hill) {
      color = mix([16, 48, 86], [8, 24, 52], (v - hill) / (1 - hill));
      color = mix(color, [20, 70, 90], Math.max(0, Math.sin(u * 18 + v * 4)) * 0.25);
    }
    if (v > 0.74 && u > 0.22 && u < 0.78) {
      const roof = 0.78 + ((Math.floor(u * 28) % 3) - 1) * 0.015;
      if (v > roof) {
        color = mix([18, 36, 78], [30, 48, 90], 0.4);
        const wx = Math.abs((u * 36) % 1 - 0.5);
        const wy = Math.abs((v * 28) % 1 - 0.5);
        if (wx < 0.12 && wy < 0.14 && (Math.floor(u * 36) + Math.floor(v * 28)) % 2 === 0) color = [255, 186, 64];
      }
      if (u > 0.47 && u < 0.52 && v > 0.62 && v < 0.8) color = [12, 28, 64];
    }
    return clampRgb(color);
  }
  function lilies(u, v) {
    const rip = Math.sin(v * 48 + Math.sin(u * 10) * 1.4);
    const rip2 = Math.sin(u * 16 + v * 5);
    let color = mix([28, 78, 74], [64, 122, 104], 0.5 + 0.5 * rip);
    color = mix(color, [168, 196, 176], Math.max(0, rip2) * 0.22);
    if (v < 0.22 && (u < 0.2 || u > 0.82)) {
      const edge = u < 0.5 ? u : 1 - u;
      if (edge < 0.16 && Math.abs(Math.sin(u * 40 + v * 8)) > 0.2) color = mix(color, [16, 48, 32], 0.75 * (1 - v / 0.22));
    }
    for (const [px, py, rx, ry] of [
      [0.32, 0.42, 0.11, 0.045], [0.48, 0.5, 0.13, 0.05], [0.62, 0.4, 0.1, 0.04],
      [0.4, 0.62, 0.12, 0.046], [0.7, 0.6, 0.09, 0.038], [0.22, 0.58, 0.08, 0.034], [0.55, 0.72, 0.1, 0.04],
    ]) {
      const ellipse = ((u - px) / rx) ** 2 + ((v - py) / ry) ** 2;
      if (ellipse < 1) {
        color = mix(ellipse > 0.72 ? [18, 70, 40] : [36, 110, 62], [120, 168, 90], ellipse < 0.45 ? 0.55 : 0.2);
        if (Math.abs(Math.atan2(v - py, u - px) - 0.8) < 0.25 && ellipse > 0.2) color = mix(color, [64, 122, 104], 0.7);
      }
    }
    for (const [fx, fy] of [[0.34, 0.4], [0.5, 0.48], [0.63, 0.38], [0.42, 0.6], [0.24, 0.55], [0.58, 0.7]]) {
      for (let petal = 0; petal < 6; petal++) {
        const angle = petal / 6 * Math.PI * 2 + fx;
        const dx = u - (fx + Math.cos(angle) * 0.02);
        const dy = v - (fy + Math.sin(angle) * 0.012);
        if (dx * dx / 0.00035 + dy * dy / 0.00018 < 1) color = mix(color, petal % 2 ? [214, 132, 154] : [244, 236, 228], 0.9);
      }
      if ((u - fx) ** 2 / 0.00012 + (v - fy) ** 2 / 0.00006 < 1) color = [232, 186, 84];
      const reflection = v - (fy + 0.08);
      if (reflection > 0 && reflection < 0.12 && Math.abs(u - fx) < 0.03) {
        color = mix(color, [214, 132, 154], 0.35 * (1 - reflection / 0.12) * (1 - Math.abs(u - fx) / 0.03));
      }
    }
    return clampRgb(color);
  }
  function sample(name, u, v, col, row) {
    if (name === "graphite") return graphite(u, v, col, row);
    if (name === "starry") return starry(u, v);
    if (name === "lilies") return lilies(u, v);
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
  function readPaused() {
    try { return localStorage.getItem(PAUSE_KEY) === "1"; } catch { return false; }
  }
  function motionMode() {
    if (style === "off") return "off";
    if (reduce.matches) return "reduced";
    if (document.hidden) return "hidden";
    if (paused) return "paused";
    return "running";
  }
  function syncMotion() {
    const row = document.getElementById("wallpaperMotionRow");
    const button = document.getElementById("wallpaperMotion");
    const label = document.getElementById("wallpaperMotionLabel");
    if (row) row.hidden = style === "off";
    if (!button || !label) return;
    const key = paused ? "继续壁纸动效" : "暂停壁纸动效";
    const text = tr(key);
    button.setAttribute("aria-pressed", String(paused));
    button.setAttribute("aria-label", text);
    label.textContent = text;
  }
  function applyMotion() {
    syncMotion();
    if (style === "off") return;
    if (motionMode() === "running") start();
    else halt(motionMode() !== "hidden");
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
    if (style === "off") clearField();
    else {
      document.documentElement.dataset.wallpaper = style;
      ensureField();
      scene = null;
      rebuild();
    }
    syncMotion();
  }
  for (const [id, value] of BUTTONS) {
    const button = document.getElementById(id);
    if (button) button.addEventListener("click", () => applyStyle(value, true));
  }
  document.getElementById("wallpaperMotion")?.addEventListener("click", () => {
    paused = !paused;
    try { localStorage.setItem(PAUSE_KEY, paused ? "1" : "0"); } catch {}
    applyMotion();
  });
  reduce.addEventListener("change", applyMotion);
  document.addEventListener("visibilitychange", () => {
    if (style === "off") return;
    if (motionMode() === "running") start();
    else halt(false);
  });
  addEventListener("hanzlanguage", syncMotion);
  let resizeTimer = 0;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(rebuild, 80);
  }, { passive: true });
  addEventListener("storage", (event) => {
    if (event.key === KEY || event.key === null) applyStyle(event.key === null ? readStyle() : event.newValue, false);
    if (event.key === PAUSE_KEY || event.key === null) {
      paused = readPaused();
      applyMotion();
    }
  });
  paused = readPaused();
  applyStyle(readStyle(), false);
})();
