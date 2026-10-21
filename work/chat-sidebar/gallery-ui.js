/**
 * Integrable Space→Images style gallery grid (callbacks only; no fetch/delete).
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

  /** Adapter column thresholds (px); not measured — see ROUND5-REFERENCE.md */
  const ADAPTER_COL_BREAKPOINTS = [384, 576, 768, 1024, 1280];

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

  function itemAspect(item) {
    const w =
      item.image?.metadata?.width || item.width || item.image?.width || 0;
    const h =
      item.image?.metadata?.height || item.height || item.image?.height || 0;
    if (w > 0 && h > 0) return w / h;
    return 1;
  }

  function columnsForWidth(width) {
    let cols = 1;
    for (let i = 0; i < ADAPTER_COL_BREAKPOINTS.length; i++) {
      if (width >= ADAPTER_COL_BREAKPOINTS[i]) cols = i + 2;
    }
    return Math.min(6, cols);
  }

  function syncColumnClass(root, width) {
    const cols = columnsForWidth(width);
    for (let i = 0; i < COL_CLASSES.length; i++) {
      root.classList.toggle(COL_CLASSES[i], i + 1 === cols);
    }
    root.dataset.galleryCols = String(cols);
  }

  function teardown(root) {
    const state = roots.get(root);
    if (!state) return;
    state.resizeObserver?.disconnect();
    state.abortController?.abort();
    for (const { el, type, handler, options } of state.listeners) {
      el.removeEventListener(type, handler, options);
    }
    roots.delete(root);
  }

  function track(state, el, type, handler, options) {
    el.addEventListener(type, handler, options);
    state.listeners.push({ el, type, handler, options });
  }

  function createCard(item, options, state) {
    const language = options.language === "en" ? "en" : "zh";
    const card = document.createElement("button");
    card.type = "button";
    card.className = "gallery-card";
    card.setAttribute("aria-label", previewLabel(language, item.prompt));

    const media = document.createElement("div");
    media.className = "gallery-media";
    const aspect = itemAspect(item);
    media.style.setProperty("--gallery-aspect", String(aspect));

    const img = document.createElement("img");
    img.className = "gallery-img gallery-img--loading";
    img.alt = item.prompt || "";
    img.loading = "lazy";
    img.decoding = "async";
    const iw =
      item.image?.metadata?.width || item.width || item.image?.width || 0;
    const ih =
      item.image?.metadata?.height || item.height || item.image?.height || 0;
    if (iw > 0 && ih > 0) {
      img.width = iw;
      img.height = ih;
    }

    const onLoad = () => {
      img.classList.remove("gallery-img--loading");
      img.classList.add("gallery-img--loaded");
    };
    const onError = () => {
      img.classList.remove("gallery-img--loading");
      img.classList.add("gallery-img--broken");
      media.classList.add("gallery-media--broken");
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
      resizeObserver: null,
      abortController: null,
      listeners: [],
    };

    root.replaceChildren();
    root.classList.add("gallery-grid", "gallery-grid--hanz");
    root.setAttribute("role", "list");

    for (const item of list) {
      const tile = document.createElement("div");
      tile.className = "gallery-tile";
      tile.setAttribute("role", "listitem");
      const card = createCard(item, options, state);
      const remove = createRemove(item, options, state);
      tile.append(card, remove);
      root.append(tile);
    }

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
        syncColumnClass(root, w);
      }
    });
    ro.observe(root);
    state.resizeObserver = ro;
    syncColumnClass(root, root.clientWidth);

    roots.set(root, state);
  }

  function destroy(root) {
    if (!root) return;
    teardown(root);
    root.replaceChildren();
    root.classList.remove("gallery-grid", "gallery-grid--hanz", ...COL_CLASSES);
    delete root.dataset.galleryCols;
  }

  window.HanzGallery = { render, destroy };
})();
