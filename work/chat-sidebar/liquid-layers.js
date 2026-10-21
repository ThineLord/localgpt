/* Flat dialogs. open / close / openSettings / closeSettings keep the existing call shapes. */
(() => {
  const records = new WeakMap();
  const dialogs = [...document.querySelectorAll("dialog")];
  const details = document.querySelector(".settings");
  const panel = document.getElementById("settingsPanel");
  const summary = details.querySelector("summary");
  const settingsAnchor = () =>
    summary.getClientRects().length ? summary : document.getElementById("upload");
  const nativePopover = typeof panel.showPopover === "function";
  if (nativePopover) panel.setAttribute("popover", "manual");

  function signal() {
    dispatchEvent(new Event("liquidlayerchange"));
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
    if (dialog.open) return;
    const parent = origin?.closest?.("dialog[open]") || null;
    records.set(dialog, { origin, parent });
    dialog.showModal();
    sync();
  }
  function focusReturn(dialog) {
    const record = records.get(dialog);
    const origin = record?.origin;
    const parent = record?.parent;
    if (
      origin?.isConnected &&
      !origin.closest("dialog:not([open])") &&
      origin.getClientRects().length > 0 &&
      !origin.disabled
    ) {
      origin.focus({ preventScroll: true });
    } else {
      const fallback = parent?.open
        ? [...parent.querySelectorAll("button:not(:disabled):not([hidden])")]
            .find((button) => button.getClientRects().length)
        : document.getElementById("profileButton");
      fallback?.focus({ preventScroll: true });
    }
  }
  function close(dialog, { cascade = false, immediate = false } = {}) {
    if (!dialog.open || dialog.canClose?.() === false) return Promise.resolve();
    void immediate;
    let record = records.get(dialog);
    const ancestors = [];
    if (cascade) {
      while (record?.parent?.open) {
        ancestors.push(record.parent);
        record = records.get(record.parent);
      }
    }
    if (dialog.open) dialog.close();
    for (const ancestor of ancestors) if (ancestor.open) ancestor.close();
    sync();
    focusReturn(dialog);
    return Promise.resolve();
  }
  function placeSettings() {
    if (!details.open || !nativePopover) return;
    const origin = settingsAnchor().getBoundingClientRect();
    const mobile = innerWidth <= 760;
    const above = Math.max(0, origin.top - 22);
    const below = Math.max(0, innerHeight - origin.bottom - 22);
    const placeAbove = above >= below;
    if (mobile) panel.style.removeProperty("max-height");
    else panel.style.maxHeight = `min(70dvh, 520px, ${placeAbove ? above : below}px)`;
    const r = panel.getBoundingClientRect();
    const left = mobile
      ? 12
      : Math.max(12, Math.min(origin.left, innerWidth - r.width - 12));
    const top = mobile
      ? Math.max(12, innerHeight - r.height - 12)
      : placeAbove
        ? Math.max(12, origin.top - r.height - 10)
        : origin.bottom + 10;
    panel.style.inset = "auto";
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }
  function openSettings() {
    if (details.open) return;
    signal();
    details.open = true;
    if (nativePopover && !panel.matches(":popover-open")) panel.showPopover();
    placeSettings();
    summary.setAttribute("aria-expanded", "true");
    document.getElementById("closeSettings")?.focus({ preventScroll: true });
  }
  function closeSettings({ focus = true } = {}) {
    if (!details.open) return;
    if (nativePopover && panel.matches(":popover-open")) panel.hidePopover();
    details.open = false;
    summary.setAttribute("aria-expanded", "false");
    if (focus) settingsAnchor().focus({ preventScroll: true });
  }
  details.addEventListener("toggle", () => {
    if (!nativePopover) return;
    if (!details.open) {
      if (panel.matches(":popover-open")) panel.hidePopover();
    } else if (!panel.matches(":popover-open")) {
      panel.showPopover();
      placeSettings();
    }
  });
  summary.addEventListener("click", (event) => {
    event.preventDefault();
    if (details.open) closeSettings();
    else openSettings();
  });
  for (const dialog of dialogs) {
    dialog.addEventListener("cancel", (event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      close(dialog);
    });
    dialog.addEventListener("close", sync);
    dialog.addEventListener("pointerdown", (event) => {
      if (event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      const outside =
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom;
      if (outside && dialog.id !== "confirmDialog") close(dialog);
    });
  }
  addEventListener("resize", () => placeSettings(), { passive: true });
  window.LiquidLayers = { open, close, openSettings, closeSettings };
})();
