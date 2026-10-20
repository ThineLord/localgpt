/* Shared top-layer transitions. Geometry moves; readable content never stretches. */
(() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const records = new WeakMap();
  const running = new Map();
  const dialogs = [...document.querySelectorAll("dialog")];
  const details = document.querySelector(".settings");
  const panel = document.getElementById("settingsPanel");
  const summary = details.querySelector("summary");
  const easing = "cubic-bezier(.22,.8,.24,1)";
  const rect = (node) => {
    if (!node?.isConnected || !node.getClientRects().length) return null;
    const r = node.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight)
      return null;
    return {
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
      borderRadius: getComputedStyle(node).borderTopLeftRadius,
    };
  };
  function stop(surface) {
    const current = running.get(surface);
    if (!current) return;
    current.finish();
  }
  function signal() {
    dispatchEvent(new Event("liquidlayerchange"));
  }
  function transition(surface, source, opening, done = () => {}) {
    stop(surface);
    const target = rect(surface);
    if (
      reduced.matches ||
      !source ||
      !target ||
      !HTMLElement.prototype.showPopover
    ) {
      done();
      signal();
      return Promise.resolve();
    }
    const wasInert = surface.inert;
    if (!opening) surface.inert = true;
    const ghost = document.createElement("div");
    ghost.className = "liquid-transfer";
    ghost.setAttribute("popover", "manual");
    ghost.setAttribute("aria-hidden", "true");
    document.body.append(ghost);
    ghost.showPopover();
    const geometry = (r) => ({
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
      borderRadius: r.borderRadius,
    });
    const start = opening ? source : target;
    const end = opening ? target : source;
    Object.assign(ghost.style, geometry(start));
    const duration = opening ? 440 : 320;
    const shape = ghost.animate([geometry(start), geometry(end)], {
      duration,
      easing,
      fill: "both",
    });
    const reflection = ghost.animate(
      [
        { opacity: opening ? 0.86 : 0.4, offset: 0 },
        { opacity: 1, offset: 0.62 },
        { opacity: 0, offset: 1 },
      ],
      { duration, easing: "linear", fill: "both" },
    );
    const content = surface.animate(
      opening
        ? [
            { opacity: 0, transform: "translateY(4px)" },
            { opacity: 1, transform: "translateY(0)" },
          ]
        : [{ opacity: 1 }, { opacity: 0 }],
      {
        duration: opening ? 160 : 90,
        delay: opening ? duration - 160 : 0,
        easing,
        fill: "both",
      },
    );
    surface.dataset.liquidTransition = opening ? "opening" : "closing";
    signal();
    return new Promise((resolve) => {
      let complete = false;
      const finish = () => {
        if (complete) return;
        complete = true;
        shape.cancel();
        reflection.cancel();
        content.cancel();
        ghost.remove();
        surface.inert = wasInert;
        delete surface.dataset.liquidTransition;
        running.delete(surface);
        done();
        signal();
        resolve();
      };
      running.set(surface, { finish });
      shape.finished.then(finish, () => {});
    });
  }
  function sync() {
    for (const dialog of dialogs) {
      const below = dialogs.some(
        (child) => child.open && records.get(child)?.parent === dialog,
      );
      dialog.classList.toggle("liquid-underlay", below);
    }
    const back = document.getElementById("backMemory");
    if (back)
      back.hidden = !records.get(document.getElementById("memoryDialog"))
        ?.parent?.open;
    signal();
  }
  function open(dialog, origin = document.activeElement) {
    if (dialog.open) {
      const wasClosing = dialog.dataset.liquidTransition === "closing";
      stop(dialog);
      if (!wasClosing) return;
    }
    const parent = origin?.closest?.("dialog[open]") || null;
    const source = rect(origin);
    records.set(dialog, { origin, source, parent });
    dialog.showModal();
    sync();
    transition(dialog, source, true);
  }
  function close(dialog, { cascade = false, immediate = false } = {}) {
    if (!dialog.open) return Promise.resolve();
    if (dialog.dataset.liquidTransition === "closing")
      return running.get(dialog)?.promise || Promise.resolve();
    stop(dialog);
    let record = records.get(dialog);
    const ancestors = [];
    if (cascade) {
      while (record?.parent?.open) {
        ancestors.push(record.parent);
        record = records.get(record.parent);
      }
    }
    const parent = records.get(dialog)?.parent;
    parent?.classList.remove("liquid-underlay");
    const origin = record?.origin;
    const target = rect(origin) || record?.source;
    const finish = () => {
      dialog.close();
      for (const ancestor of ancestors) ancestor.close();
      sync();
      if (
        origin?.isConnected &&
        !origin.closest("dialog:not([open])") &&
        !origin.disabled
      ) {
        origin.focus({ preventScroll: true });
      } else {
        const fallback = parent?.open
          ? parent.querySelector("button:not(:disabled):not([hidden])")
          : document.getElementById("appSettings");
        fallback?.focus({ preventScroll: true });
      }
    };
    if (immediate) {
      finish();
      return Promise.resolve();
    }
    const promise = transition(dialog, target, false, finish);
    if (running.has(dialog)) running.get(dialog).promise = promise;
    return promise;
  }
  function placeSettings() {
    if (!details.open || !nativePopover) return;
    const origin = summary.getBoundingClientRect();
    const r = panel.getBoundingClientRect();
    const mobile = innerWidth <= 760;
    const left = mobile
      ? 12
      : Math.max(12, Math.min(origin.left, innerWidth - r.width - 12));
    const top = mobile
      ? innerHeight - r.height - 12
      : Math.max(12, origin.top - r.height - 10);
    panel.style.left = `${left}px`;
    panel.style.top = `${Math.max(12, top)}px`;
  }
  const nativePopover = typeof panel.showPopover === "function";
  if (nativePopover) panel.setAttribute("popover", "manual");
  details.addEventListener("toggle", () => {
    if (!nativePopover) return;
    if (!details.open) {
      stop(panel);
      if (nativePopover && panel.matches(":popover-open")) panel.hidePopover();
    } else if (!panel.matches(":popover-open")) {
      panel.showPopover();
      placeSettings();
    }
  });
  function openSettings() {
    if (details.open) {
      stop(panel);
      return;
    }
    const source = rect(summary);
    details.open = true;
    if (nativePopover) {
      panel.showPopover();
      placeSettings();
    }
    summary.setAttribute("aria-expanded", "true");
    transition(panel, source, true);
  }
  function closeSettings({ focus = true } = {}) {
    if (!details.open || panel.dataset.liquidTransition === "closing") return;
    transition(panel, rect(summary), false, () => {
      if (nativePopover && panel.matches(":popover-open")) panel.hidePopover();
      details.open = false;
      summary.setAttribute("aria-expanded", "false");
      if (focus) summary.focus({ preventScroll: true });
    });
  }
  summary.addEventListener("click", (e) => {
    e.preventDefault();
    if (panel.dataset.liquidTransition === "closing") {
      stop(panel);
      openSettings();
    } else if (details.open) closeSettings();
    else openSettings();
  });
  for (const dialog of dialogs) {
    dialog.addEventListener("cancel", (e) => {
      // The destructive-action handler is registered first and may veto Escape.
      if (e.defaultPrevented) return;
      e.preventDefault();
      close(dialog);
    });
    dialog.addEventListener("close", () => {
      stop(dialog);
      sync();
    });
    dialog.addEventListener("pointerdown", (e) => {
      if (e.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      ) {
        // Confirmations close only through their explicit Cancel or Escape path.
        if (dialog.id !== "confirmDialog") close(dialog);
      }
    });
  }
  function finishAll() {
    for (const { finish } of [...running.values()]) finish();
  }
  addEventListener(
    "resize",
    () => {
      finishAll();
      placeSettings();
    },
    { passive: true },
  );
  reduced.addEventListener("change", finishAll);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) finishAll();
  });
  window.LiquidLayers = { open, close, openSettings, closeSettings };
})();
