/* Round 7 application shell: one navigation rail, settings as a page surface, shared surface tokens. */
(() => {
  const $ = (id) => document.getElementById(id);
  const prefs = $("preferencesDialog");
  let settingsOrigin = null;
  let memoryOpener = window.AppShellRegistrations?.openMemory || null;
  let closing = null;
  let generation = 0;

  function visible(el) {
    return !!(
      el?.isConnected &&
      !el.disabled &&
      el.getClientRects().length &&
      !el.closest("[inert], dialog:not([open])")
    );
  }

  const settingsNav = $("settingsNav");
  const navHome = settingsNav
    ? { parent: settingsNav.parentElement, next: settingsNav.nextSibling }
    : null;

  function parkSettingsNav(park) {
    const nav = $("settingsNav");
    const sidebar = $("sidebar");
    const history = $("historyPanel");
    if (!nav || !sidebar || !navHome) return;
    if (park && innerWidth > 760) {
      if (nav.parentElement !== sidebar) sidebar.appendChild(nav);
      if (history) {
        history.inert = true;
        history.setAttribute("aria-hidden", "true");
      }
      return;
    }
    if (nav.parentElement !== navHome.parent) navHome.parent.insertBefore(nav, navHome.next);
    if (history?.getAttribute("aria-hidden") === "true") history.removeAttribute("aria-hidden");
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
    document.body.classList.remove("sidebar-temporary");
    parkSettingsNav(false);
    placeMobileMenu();
    dispatchEvent(new CustomEvent("appshell-surface"));
    restoreFocus(origin);
  }

  function dismissMobileDrawer() {
    if (innerWidth > 760) return;
    document.body.classList.remove("sidebar-open", "sidebar-temporary");
  }

  function closeSettings() {
    if (closing) return closing;
    const token = generation;
    const open = !!prefs?.open;
    const marked =
      document.body.classList.contains("settings-surface-open") || !!settingsOrigin;
    if (!open && !marked) return Promise.resolve();
    let resolve;
    const finished = new Promise((done) => {
      resolve = done;
    });
    closing = finished;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      prefs?.removeEventListener("beforetoggle", onDismiss);
      prefs?.removeEventListener("close", onDismiss);
      if (token === generation) applyClosed();
      if (closing === finished) closing = null;
      resolve();
    };
    function onDismiss(event) {
      if (event.type === "beforetoggle" && event.newState !== "closed") return;
      finish();
    }
    if (!open) {
      finish();
      return finished;
    }
    prefs.addEventListener("beforetoggle", onDismiss);
    prefs.addEventListener("close", onDismiss);
    prefs.close();
    if (!prefs.open) finish();
    return finished;
  }

  function openSettings(section = "general", origin = $("appSettings")) {
    generation += 1;
    closing = null;
    window.LiquidLayers?.closeSettings({ focus: false });
    dismissMobileDrawer();
    document.body.classList.remove("sidebar-temporary");
    if (origin instanceof Element) settingsOrigin = origin;
    document.body.classList.add("settings-surface-open");
    parkSettingsNav(true);
    placeMobileMenu();
    if (prefs && !prefs.open) prefs.show();
    dispatchEvent(new CustomEvent("appshell-surface"));
    if (section) {
      dispatchEvent(new CustomEvent("appshell-settings-section", { detail: section }));
    }
    // Enter the page at its heading; Tab then reaches the selected category.
    // Focusing the category here can inherit focus-visible from the composer.
    const target = [$("preferencesTitle"), $("settingsSectionTitle"), $("closePreferences")].find(visible);
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
    const token = generation;
    queueMicrotask(() => {
      if (token !== generation || closing || prefs?.open) return;
      if (!document.body.classList.contains("settings-surface-open") && !settingsOrigin) return;
      applyClosed();
    });
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

  const memoryButton = $("memoryNav");
  if (memoryButton && window.HanzMemory) {
    memoryButton.onclick = () => {
      window.HanzMemory.open(null, memoryButton);
    };
  }

  addEventListener("appshell-surface", () => {
    parkSettingsNav(document.body.classList.contains("settings-surface-open"));
  });
  addEventListener("resize", () => {
    parkSettingsNav(document.body.classList.contains("settings-surface-open"));
    placeMobileMenu();
  }, { passive: true });
})();
