/* Round 7 application shell: one navigation rail, settings as a page surface, shared surface tokens. */
(() => {
  const $ = (id) => document.getElementById(id);
  const prefs = $("preferencesDialog");
  let settingsOrigin = null;
  let memoryOpener = window.AppShellRegistrations?.openMemory || null;
  let closing = null;

  function visible(el) {
    return !!(
      el?.isConnected &&
      !el.disabled &&
      el.getClientRects().length &&
      !el.closest("[inert], dialog:not([open])")
    );
  }

  function placeMobileMenu() {
    const menu = $("mobileMenu");
    const shellHeader = document.querySelector(".shell > header");
    const settingsHeader = document.querySelector(".settings-layout-header");
    if (!menu || !shellHeader || !settingsHeader) return;
    const parkInSettings =
      innerWidth <= 760 &&
      document.body.classList.contains("settings-surface-open");
    const parent = parkInSettings ? settingsHeader : shellHeader;
    const before = parkInSettings ? $("settingsBack") : shellHeader.firstChild;
    if (menu.parentElement !== parent) parent.insertBefore(menu, before);
  }

  function restoreFocus(origin) {
    if (visible(origin)) origin.focus({ preventScroll: true });
    else {
      const fallback = [$("mobileMenu"), $("profileButton"), $("prompt")].find(visible);
      fallback?.focus({ preventScroll: true });
    }
  }

  function applyClosed() {
    const origin = settingsOrigin;
    settingsOrigin = null;
    document.body.classList.remove("settings-surface-open");
    placeMobileMenu();
    dispatchEvent(new CustomEvent("appshell-surface"));
    restoreFocus(origin);
  }

  function closeSettings() {
    if (closing) return closing;
    const open = !!(prefs?.open);
    const marked = document.body.classList.contains("settings-surface-open");
    if (!open && !marked) return Promise.resolve();
    let resolve;
    closing = new Promise((done) => {
      resolve = done;
    });
    const finished = closing;
    if (open) prefs.close();
    else applyClosed();
    resolve();
    queueMicrotask(() => {
      if (closing === finished) closing = null;
    });
    return finished;
  }

  function openSettings(section = "general", origin = $("appSettings")) {
    window.LiquidLayers?.closeSettings({ focus: false });
    if (origin instanceof Element) settingsOrigin = origin;
    if (prefs && !prefs.open) prefs.show();
    document.body.classList.add("settings-surface-open");
    placeMobileMenu();
    dispatchEvent(new CustomEvent("appshell-surface"));
    if (section) {
      dispatchEvent(new CustomEvent("appshell-settings-section", { detail: section }));
    }
    const selected = document.querySelector(`[data-settings-section="${section}"]`);
    const target = selected?.getClientRects().length ? selected : $("closePreferences");
    target?.focus({ preventScroll: true });
  }

  function leaveSettingsForNavigation() {
    return closeSettings();
  }

  function registerOpenMemory(fn) {
    if (typeof fn !== "function") throw new TypeError("openMemory registrar expects a function");
    memoryOpener = fn;
    window.AppShellRegistrations = window.AppShellRegistrations || {};
    window.AppShellRegistrations.openMemory = fn;
  }

  function openMemory(origin) {
    if (!memoryOpener) throw new Error("AppShell.openMemory is not registered");
    return memoryOpener(origin);
  }

  window.AppShell = {
    openSettings,
    closeSettings,
    leaveSettingsForNavigation,
    openMemory,
    registerOpenMemory,
    getPreferencesDialog: () => prefs,
  };
  if (memoryOpener) registerOpenMemory(memoryOpener);

  function noteSettingsClosed() {
    if (!document.body.classList.contains("settings-surface-open") && !settingsOrigin) return;
    applyClosed();
  }
  // Chrome 156 fires beforetoggle and does not fire close for dialog.close().
  prefs?.addEventListener("close", noteSettingsClosed);
  prefs?.addEventListener("beforetoggle", (event) => {
    if (event.newState === "closed") noteSettingsClosed();
  });

  addEventListener("appshell-settings-section", (e) => {
    const tab = document.querySelector(`[data-settings-section="${e.detail}"]`);
    tab?.click();
  });

  addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented || !prefs?.open) return;
    if (prefs.classList.contains("settings-nav-open")) return;
    if ([...document.querySelectorAll("dialog[open]")].some((dialog) => dialog !== prefs)) return;
    if (document.body.classList.contains("sidebar-temporary")) return;
    if (innerWidth <= 760 && document.body.classList.contains("sidebar-open")) return;
    e.preventDefault();
    closeSettings();
  });

  addEventListener("resize", () => placeMobileMenu(), { passive: true });
})();
