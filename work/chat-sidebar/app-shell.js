/* Round 7 application shell: one navigation rail, settings on the main surface, shared surface tokens. */
(() => {
  const $ = (id) => document.getElementById(id);
  const prefs = $("preferencesDialog");

  function closeSettings() {
    if (prefs?.open) void window.LiquidLayers.close(prefs);
  }

  function openSettings(section = "general", origin = $("appSettings")) {
    window.LiquidLayers.closeSettings({ focus: false });
    window.LiquidLayers.open(prefs, origin);
    document.body.classList.add("settings-surface-open");
    if (section) {
      dispatchEvent(
        new CustomEvent("appshell-settings-section", { detail: section }),
      );
    }
  }

  async function leaveSettingsForNavigation() {
    document.body.classList.remove("settings-surface-open");
    await closeSettings();
  }

  window.AppShell = {
    openSettings,
    closeSettings,
    leaveSettingsForNavigation,
    getPreferencesDialog: () => prefs,
  };

  prefs?.addEventListener("close", () => {
    document.body.classList.remove("settings-surface-open");
  });

  addEventListener("appshell-settings-section", (e) => {
    const name = e.detail;
    const tab = document.querySelector(
      `[data-settings-section="${name}"]`,
    );
    tab?.click();
  });

  for (const id of ["homeNav", "galleryNav", "newChat", "headerNewChat"]) {
    $(id)?.addEventListener(
      "click",
      () => {
        leaveSettingsForNavigation();
      },
      { capture: true },
    );
  }
})();
