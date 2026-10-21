/**
 * Round 6 message action chrome: icon-only controls + accessible tooltips.
 * Loaded before app.js as global LocalMessageActions.
 */
(function (global) {
  const TIP_ID = "messageActionTooltip";
  const POINTER_DELAY = 350;
  const GAP = 8;

  const ICON_PATHS = {
    trash:
      '<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M10 11v5"/><path d="M14 11v5"/>',
    edit:
      '<path d="m14.5 4.5 5 5"/><path d="M4 20l4.5-1L19.5 7a2.12 2.12 0 0 0-3-3L5.5 16 4 20Z"/>',
    download:
      '<path d="M12 4v11"/><path d="m8.5 11.5 3.5 3.5 3.5-3.5"/><path d="M5 18h14"/>',
    copy:
      '<rect x="8" y="8" width="11" height="13" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2"/>',
    memory: '<path d="M6 3h12v18l-6-4-6 4V3Z"/>',
    retry:
      '<path d="M20 7v4h-4"/><path d="M4 17v-4h4"/><path d="M6.5 7A7.5 7.5 0 0 1 17 5.5l1.5 2"/><path d="M4 16l1.5 2A7.5 7.5 0 0 0 15.5 19"/>',
    check: '<path d="m6 12.5 3.5 3.5L18 7.5"/>',
    reference:
      '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="8.5" cy="8.5" r="1.25"/><path d="m4 17 5-5 3 3 2.5-2.5 5.5 5.5"/>',
  };

  function iconMarkup(name) {
    const body = ICON_PATHS[name] || ICON_PATHS.copy;
    return (
      '<svg class="message-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      body +
      "</svg>"
    );
  }

  const boundActions = new WeakSet();

  function bindAction(button) {
    if (boundActions.has(button)) return;
    boundActions.add(button);
    button.addEventListener("pointerenter", (e) => {
      if (e.pointerType !== "mouse") return;
      clearTimeout(pointerTimer);
      pointerTimer = setTimeout(() => showTooltip(button), POINTER_DELAY);
    });
    button.addEventListener("pointerleave", (e) => {
      if (button.contains(e.relatedTarget)) return;
      hideTooltip();
    });
    button.addEventListener("focus", () => {
      if (button.matches(":focus-visible")) showTooltip(button);
    });
    button.addEventListener("blur", hideTooltip);
  }

  function configureAction(button, name, label) {
    button.classList.add("message-action", "action");
    button.dataset.actionIcon = name;
    button.removeAttribute("title");
    button.setAttribute("aria-label", label);
    button.innerHTML = iconMarkup(name);
    const text = document.createElement("span"); text.className = "sr-only"; text.textContent = label; button.append(text);
    mountTooltips();
    bindAction(button);
  }

  function refreshAction(button, name, label) {
    configureAction(button, name, label);
    if (owner === button) hideTooltip();
  }

  let tooltip = null;
  let owner = null;
  let pointerTimer = 0;
  let previousDescribedBy = null;
  let mounted = false;

  function ensureTooltip() {
    if (tooltip) return tooltip;
    tooltip = document.createElement("div");
    tooltip.id = TIP_ID;
    tooltip.className = "message-action-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.setAttribute("popover", "manual");
    document.body.append(tooltip);
    return tooltip;
  }

  function hideTooltip(cancelPending = true) {
    if (cancelPending) clearTimeout(pointerTimer);
    const tip = tooltip;
    if (tip?.matches(":popover-open")) tip.hidePopover();
    if (owner) {
      if (previousDescribedBy === null) owner.removeAttribute("aria-describedby");
      else owner.setAttribute("aria-describedby", previousDescribedBy);
    }
    owner = null;
    previousDescribedBy = null;
  }

  function positionTooltip(button) {
    const tip = ensureTooltip();
    const r = button.getBoundingClientRect();
    const b = tip.getBoundingClientRect();
    const userSide = button.closest(".user-message-shell");
    let left = userSide
      ? r.right - b.width
      : r.left + (r.width - b.width) / 2;
    left = Math.max(8, Math.min(left, innerWidth - b.width - 8));
    let top = r.bottom + GAP;
    if (top + b.height > innerHeight - 8) top = Math.max(8, r.top - GAP - b.height);
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  }

  function showTooltip(button) {
    if (
      !button.isConnected || !button.getClientRects().length || button.disabled ||
      button.getAttribute("aria-disabled") === "true" ||
      [...document.querySelectorAll("dialog[open]")].some(dialog => !dialog.contains(button))
    ) {
      return;
    }
    const text = button.getAttribute("aria-label");
    if (!text) return;
    hideTooltip();
    owner = button;
    previousDescribedBy = button.getAttribute("aria-describedby");
    button.setAttribute(
      "aria-describedby",
      [previousDescribedBy, TIP_ID].filter(Boolean).join(" "),
    );
    const tip = ensureTooltip();
    tip.textContent = text;
    tip.showPopover();
    positionTooltip(button);
  }

  function mountTooltips() {
    if (mounted) return;
    mounted = true;
    ensureTooltip();

    document.addEventListener("pointerdown", hideTooltip, true);
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape") hideTooltip();
      },
      true,
    );
    const scrollRoot = document.getElementById("chatScroll");
    if (scrollRoot)
      scrollRoot.addEventListener("scroll", () => hideTooltip(), {
        passive: true,
      });
    addEventListener("resize", hideTooltip);
    addEventListener("liquidlayerchange", hideTooltip);
  }

  global.LocalMessageActions = {
    iconMarkup,
    configureAction,
    refreshAction,
    mountTooltips,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountTooltips, { once: true });
  } else {
    mountTooltips();
  }
})(window);
