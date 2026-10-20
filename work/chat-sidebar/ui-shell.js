/* Round 2 shell: custom popovers backed by native controls; no business logic duplication. */
(() => {
  const $ = (id) => document.getElementById(id);

  function focusVisible(el) {
    el?.focus({ preventScroll: true });
  }

  function dispatchChange(select) {
    select.dispatchEvent(new Event("change", { bubbles: true }));
    select.dispatchEvent(new Event("input", { bubbles: true }));
  }

  class PopoverController {
    constructor({ trigger, panel, onOpen, onClose }) {
      this.trigger = trigger;
      this.panel = panel;
      this.onOpen = onOpen;
      this.onClose = onClose;
      this.open = false;
      this.usePopover =
        typeof panel.showPopover === "function" &&
        panel.hasAttribute("popover");
      trigger.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.toggle();
      });
      panel.addEventListener("click", (e) => e.stopPropagation());
      document.addEventListener("pointerdown", (e) => {
        if (!this.open) return;
        if (this.panel.contains(e.target) || this.trigger.contains(e.target))
          return;
        this.close();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && this.open) {
          e.preventDefault();
          e.stopPropagation();
          this.close();
        }
      });
    }
    toggle() {
      if (this.open) this.close();
      else this.openPanel();
    }
    openPanel() {
      if (this.open) return;
      PopoverController.closeAll(this);
      this.open = true;
      this.panel.hidden = false;
      this.trigger.setAttribute("aria-expanded", "true");
      if (this.usePopover && !this.panel.matches(":popover-open"))
        this.panel.showPopover();
      this.onOpen?.();
      this.place?.();
    }
    close() {
      if (!this.open) return;
      this.open = false;
      this.panel.hidden = true;
      this.trigger.setAttribute("aria-expanded", "false");
      if (this.usePopover && this.panel.matches(":popover-open"))
        this.panel.hidePopover();
      this.onClose?.();
      focusVisible(this.trigger);
    }
    static stack = [];
    static closeAll(except) {
      for (const ctrl of [...PopoverController.stack]) {
        if (ctrl !== except) ctrl.close();
      }
    }
    register() {
      PopoverController.stack.push(this);
    }
  }

  function syncSelectOptionStates(native, mirrorRoot) {
    const buttons = [...mirrorRoot.querySelectorAll("[data-value]")];
    for (const btn of buttons) {
      const opt = native.querySelector(`option[value="${CSS.escape(btn.dataset.value)}"]`);
      const missing = !opt;
      btn.hidden = missing || opt.hidden;
      btn.disabled = missing || opt.disabled;
      btn.setAttribute("aria-selected", native.value === btn.dataset.value ? "true" : "false");
      if (opt) btn.textContent = opt.textContent;
    }
  }

  function buildModelMenu() {
    const mode = $("mode");
    const chatModel = $("chatModel");
    const menu = $("modelMenu");
    const trigger = $("modelMenuTrigger");
    const label = $("modelMenuLabel");
    if (!mode || !chatModel || !menu || !trigger) return;

    const render = () => {
      menu.replaceChildren();
      const sectionMode = document.createElement("div");
      sectionMode.className = "model-menu-section";
      sectionMode.setAttribute("role", "presentation");
      for (const opt of mode.options) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "model-menu-item";
        btn.dataset.value = opt.value;
        btn.dataset.kind = "mode";
        btn.setAttribute("role", "option");
        btn.textContent = opt.textContent;
        btn.hidden = opt.hidden;
        btn.disabled = opt.disabled;
        btn.setAttribute("aria-selected", mode.value === opt.value ? "true" : "false");
        btn.addEventListener("click", () => {
          if (mode.value !== opt.value) {
            mode.value = opt.value;
            dispatchChange(mode);
          }
          modelPopover.close();
          focusVisible(trigger);
        });
        sectionMode.append(btn);
      }
      menu.append(sectionMode);
      if (mode.value !== "image" && !chatModel.hidden) {
        const sep = document.createElement("div");
        sep.className = "model-menu-divider";
        sep.setAttribute("role", "separator");
        menu.append(sep);
        const sectionModel = document.createElement("div");
        sectionModel.className = "model-menu-section";
        for (const opt of chatModel.options) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "model-menu-item";
          btn.dataset.value = opt.value;
          btn.dataset.kind = "model";
          btn.setAttribute("role", "option");
          btn.textContent = opt.textContent;
          btn.hidden = opt.hidden;
          btn.disabled = opt.disabled;
          btn.setAttribute("aria-selected", chatModel.value === opt.value ? "true" : "false");
          btn.addEventListener("click", () => {
            if (chatModel.value !== opt.value) {
              chatModel.value = opt.value;
              dispatchChange(chatModel);
            }
            modelPopover.close();
            focusVisible(trigger);
          });
          sectionModel.append(btn);
        }
        menu.append(sectionModel);
      }
      updateModelTriggerLabel();
    };

    const updateModelTriggerLabel = () => {
      const hint = $("modeHint");
      label.textContent =
        hint && !hint.classList.contains("image-model-hint") && hint.textContent
          ? hint.textContent.trim()
          : mode.options[mode.selectedIndex]?.textContent || mode.value;
    };

    const modelPopover = new PopoverController({
      trigger,
      panel: menu,
      onOpen: () => {
        render();
        modelPopover.place = () => placeAnchored(menu, trigger, { width: 254 });
        modelPopover.place();
      },
    });
    modelPopover.register();

    const observer = new MutationObserver(render);
    observer.observe(mode, { childList: true, attributes: true, subtree: true });
    observer.observe(chatModel, { childList: true, attributes: true, subtree: true });
    mode.addEventListener("change", () => {
      render();
      updateModelTriggerLabel();
    });
    chatModel.addEventListener("change", updateModelTriggerLabel);
    new MutationObserver(updateModelTriggerLabel).observe($("modeHint"), {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
    });
    updateModelTriggerLabel();
    render();
  }

  function buildAttachmentMenu() {
    const upload = $("upload");
    const menu = $("attachmentMenu");
    const file = $("file");
    const mode = $("mode");
    if (!upload || !menu) return;

    const items = [
      {
        id: "attach-upload",
        label: "上传参考图",
        action: () => file?.click(),
      },
      {
        id: "attach-image-mode",
        label: "切换到生图模式",
        action: () => {
          if (mode.value !== "image") {
            mode.value = "image";
            dispatchChange(mode);
          }
        },
      },
      {
        id: "attach-generation",
        label: "生成与对话参数",
        action: () => window.LiquidLayers?.openSettings(),
      },
    ];

    menu.replaceChildren();
    for (const item of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "attachment-menu-item";
      btn.id = item.id;
      btn.setAttribute("role", "menuitem");
      btn.textContent = item.label;
      btn.addEventListener("click", () => {
        attachPopover.close();
        item.action();
      });
      menu.append(btn);
    }

    const attachPopover = new PopoverController({
      trigger: upload,
      panel: menu,
      onOpen: () => {
        attachPopover.place = () =>
          placeAnchored(menu, upload, {
            width: Math.min(768, $("composerCard")?.getBoundingClientRect().width || 768),
            gap: 8,
            preferAbove: true,
          });
        attachPopover.place();
      },
    });
    attachPopover.register();

    const nativeUpload = upload.onclick;
    upload.onclick = null;
  }

  function placeAnchored(panel, anchor, { width, gap = 8, preferAbove = false }) {
    const card = $("composerCard");
    const cardBox = card?.getBoundingClientRect();
    const origin = anchor.getBoundingClientRect();
    panel.style.width = `${width}px`;
    panel.style.inset = "auto";
    const rect = panel.getBoundingClientRect();
    const left = cardBox
      ? Math.max(cardBox.left, Math.min(cardBox.right - width, origin.left))
      : Math.max(12, Math.min(origin.left, innerWidth - width - 12));
    const spaceAbove = origin.top - gap;
    const spaceBelow = innerHeight - origin.bottom - gap;
    const above = preferAbove ? spaceAbove >= rect.height : spaceAbove >= spaceBelow;
    const top = above
      ? Math.max(12, origin.top - rect.height - gap)
      : Math.min(innerHeight - rect.height - 12, origin.bottom + gap);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function initSettingsSurface() {
    const dialog = $("preferencesDialog");
    if (!dialog) return;
    const navButtons = [...dialog.querySelectorAll("[data-settings-section]")];
    const panels = [...dialog.querySelectorAll("[data-settings-panel]")];
    const select = $("settingsSectionSelect");
    const back = $("settingsBack");

    const showSection = (name, { mobileDetail = false } = {}) => {
      for (const btn of navButtons) {
        const active = btn.dataset.settingsSection === name;
        btn.setAttribute("aria-selected", String(active));
        btn.classList.toggle("is-active", active);
      }
      for (const panel of panels) {
        panel.hidden = panel.dataset.settingsPanel !== name;
      }
      if (select && select.value !== name) select.value = name;
      const mobile = innerWidth <= 760;
      const detail = mobile && mobileDetail;
      dialog.classList.toggle("settings-mobile-detail", detail);
      if (back) back.hidden = !detail;
    };

    for (const btn of navButtons) {
      btn.addEventListener("click", () =>
        showSection(btn.dataset.settingsSection, { mobileDetail: true }),
      );
    }
    select?.addEventListener("change", () =>
      showSection(select.value, { mobileDetail: true }),
    );
    back?.addEventListener("click", () => {
      dialog.classList.remove("settings-mobile-detail");
      if (back) back.hidden = true;
      for (const panel of panels) panel.hidden = true;
    });

    $("openGenerationSettings")?.addEventListener("click", () => {
      if (dialog.open) window.LiquidLayers?.close(dialog);
      window.LiquidLayers?.openSettings();
    });

    showSection("general");
    addEventListener("resize", () => showSection(select?.value || "general"), {
      passive: true,
    });
  }

  function wireNativeSelectVisibility() {
    const host = document.querySelector(".native-select-host");
    if (!host) return;
    for (const sel of host.querySelectorAll("select")) {
      sel.classList.add("native-backed-select");
    }
  }

  buildAttachmentMenu();
  buildModelMenu();
  initSettingsSurface();
  wireNativeSelectVisibility();
})();
