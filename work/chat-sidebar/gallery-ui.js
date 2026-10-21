/**
 * Integrable Space→Images style gallery grid (callbacks only; no fetch/delete).
 * Masonry: shortest-column packing; DOM/tab order unchanged.
 */
(function () {
  const COL_CLASSES = [
    "gallery-cols-1",
    "gallery-cols-2",
    "gallery-cols-3",
    "gallery-cols-4",
    "gallery-cols-5",
    "gallery-cols-6",
  ];

  /**
   * Inferred content-width breakpoints (not Space originals):
   * 358→1 col (390 viewport − mobile inset), 1132→5, 1292→6.
   */
  const INFERRED_COL_BREAKPOINTS = [576, 768, 992, 1132, 1292];

  const CARD_BORDER_Y = 2;
  const roots = new WeakMap();

  function trashIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6m4-6v6"/></svg>';
  }

  function previewLabel(language, prompt) {
    const p = prompt || "";
    return (language === "en" ? "Preview: " : "预览：") + p;
  }

  function trashLabel(language) {
    return language === "en" ? "Move to trash" : "移入回收站";
  }

  function metadataAspect(item) {
    const w =
      item.image?.metadata?.width || item.width || item.image?.width || 0;
    const h =
      item.image?.metadata?.height || item.height || item.image?.height || 0;
    if (w > 0 && h > 0) return w / h;
    return 0;
  }

  function hasMetadataSize(item) {
    return metadataAspect(item) > 0;
  }

  function columnsForWidth(width) {
    let cols = 1;
    for (let i = 0; i < INFERRED_COL_BREAKPOINTS.length; i++) {
      if (width >= INFERRED_COL_BREAKPOINTS[i]) cols = i + 2;
    }
    return Math.min(6, cols);
  }

  function gapForWidth(width) {
    return width >= 768 ? 16 : 12;
  }

  function syncColumnDiagnostics(root, cols) {
    for (let i = 0; i < COL_CLASSES.length; i++) {
      root.classList.toggle(COL_CLASSES[i], i + 1 === cols);
    }
    root.dataset.galleryCols = String(cols);
    root.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  }

  function tileAspect(tile) {
    const fromData = Number(tile.dataset.galleryAspect || 0);
    if (fromData > 0) return fromData;
    const media = tile.querySelector(".gallery-media");
    if (!media) return 1;
    const css = getComputedStyle(media).getPropertyValue("--gallery-aspect");
    const parsed = Number(css);
    return parsed > 0 ? parsed : 1;
  }

  function estimateTileHeight(tile, colWidth) {
    const aspect = tileAspect(tile);
    return colWidth / aspect + CARD_BORDER_Y;
  }

  function layoutMasonry(root, state) {
    const width = root.clientWidth;
    if (width <= 0) return;

    const cols = columnsForWidth(width);
    const gap = gapForWidth(width);
    const colWidth = (width - gap * (cols - 1)) / cols;

    syncColumnDiagnostics(root, cols);

    const tiles = state.tiles || [];
    const colHeights = new Array(cols).fill(0);

    for (const tile of tiles) {
      let col = 0;
      for (let c = 1; c < cols; c++) {
        if (colHeights[c] < colHeights[col]) col = c;
      }

      const measured = tile.getBoundingClientRect().height;
      const height =
        measured > CARD_BORDER_Y
          ? measured
          : estimateTileHeight(tile, colWidth);

      const left = col * (colWidth + gap);
      const top = colHeights[col];

      tile.style.width = `${colWidth}px`;
      tile.style.transform = `translate(${left}px, ${top}px)`;

      colHeights[col] += height + gap;
    }

    const maxHeight = colHeights.length
      ? Math.max(...colHeights) - gap
      : 0;
    root.style.height = `${Math.max(0, maxHeight)}px`;
    state.lastCols = cols;
    state.lastGap = gap;
    state.lastColWidth = colWidth;
  }

  function scheduleLayout(root, state) {
    if (state.layoutFrame) cancelAnimationFrame(state.layoutFrame);
    state.layoutFrame = requestAnimationFrame(() => {
      state.layoutFrame = 0;
      layoutMasonry(root, state);
      requestAnimationFrame(() => layoutMasonry(root, state));
    });
  }

  function teardown(root) {
    const state = roots.get(root);
    if (!state) return;
    state.resizeObserver?.disconnect();
    if (state.layoutFrame) cancelAnimationFrame(state.layoutFrame);
    for (const { el, type, handler, options } of state.listeners) {
      el.removeEventListener(type, handler, options);
    }
    roots.delete(root);
  }

  function track(state, el, type, handler, options) {
    el.addEventListener(type, handler, options);
    state.listeners.push({ el, type, handler, options });
  }

  function setTileAspect(tile, media, aspect) {
    const safe = aspect > 0 ? aspect : 1;
    tile.dataset.galleryAspect = String(safe);
    media.style.setProperty("--gallery-aspect", String(safe));
  }

  function createCard(item, options, state, tile, media) {
    const language = options.language === "en" ? "en" : "zh";
    const card = document.createElement("button");
    card.type = "button";
    card.className = "gallery-card";
    card.setAttribute("aria-label", previewLabel(language, item.prompt));

    const metaAspect = metadataAspect(item);
    const initialAspect = metaAspect > 0 ? metaAspect : 1;
    setTileAspect(tile, media, initialAspect);

    const img = document.createElement("img");
    img.className = "gallery-img gallery-img--loading";
    img.alt = item.prompt || "";
    img.loading = "lazy";
    img.decoding = "async";
    if (metaAspect > 0) {
      const w =
        item.image?.metadata?.width || item.width || item.image?.width || 0;
      const h =
        item.image?.metadata?.height || item.height || item.image?.height || 0;
      if (w > 0 && h > 0) {
        img.width = w;
        img.height = h;
      }
    }

    const onLoad = () => {
      img.classList.remove("gallery-img--loading");
      img.classList.add("gallery-img--loaded");
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      if (nw > 0 && nh > 0 && !hasMetadataSize(item)) {
        setTileAspect(tile, media, nw / nh);
      }
      scheduleLayout(state.root, state);
    };
    const onError = () => {
      img.classList.remove("gallery-img--loading");
      img.classList.add("gallery-img--broken");
      media.classList.add("gallery-media--broken");
      scheduleLayout(state.root, state);
    };
    track(state, img, "load", onLoad, false);
    track(state, img, "error", onError, false);

    if (typeof options.imageURL === "function" && item.image) {
      img.src = options.imageURL(item.image);
    }

    media.append(img);
    card.append(media);

    const onOpen = (event) => {
      event.preventDefault();
      options.onOpen?.(item, card);
    };
    track(state, card, "click", onOpen, false);

    return card;
  }

  function createRemove(item, options, state) {
    const language = options.language === "en" ? "en" : "zh";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "gallery-remove";
    remove.innerHTML = trashIcon();
    remove.setAttribute("aria-label", trashLabel(language));

    const onTrash = (event) => {
      event.preventDefault();
      event.stopPropagation();
      options.onTrash?.(item, remove);
    };
    track(state, remove, "click", onTrash, false);

    return remove;
  }

  function render(root, items, options = {}) {
    if (!root || typeof root !== "object") return;
    teardown(root);

    const list = Array.isArray(items) ? items : [];
    const state = {
      root,
      resizeObserver: null,
      layoutFrame: 0,
      listeners: [],
      tiles: [],
    };

    root.replaceChildren();
    root.classList.add("gallery-grid", "gallery-grid--hanz");
    root.setAttribute("role", "list");
    root.style.display = "block";
    root.style.position = "relative";

    for (const item of list) {
      const tile = document.createElement("div");
      tile.className = "gallery-tile";
      tile.setAttribute("role", "listitem");
      const media = document.createElement("div");
      media.className = "gallery-media";
      const card = createCard(item, options, state, tile, media);
      const remove = createRemove(item, options, state);
      tile.append(card, remove);
      root.append(tile);
      state.tiles.push(tile);
    }

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target !== root) continue;
        scheduleLayout(root, state);
      }
    });
    ro.observe(root);
    state.resizeObserver = ro;

    scheduleLayout(root, state);
    roots.set(root, state);
  }

  function destroy(root) {
    if (!root) return;
    teardown(root);
    root.replaceChildren();
    root.classList.remove("gallery-grid", "gallery-grid--hanz", ...COL_CLASSES);
    root.style.height = "";
    root.style.gridTemplateColumns = "";
    root.style.display = "";
    root.style.position = "";
    delete root.dataset.galleryCols;
  }

  window.HanzGallery = { render, destroy };
})();
