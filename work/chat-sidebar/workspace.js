/* Low-frequency controls and real, server-backed personal data operations. */
(() => {
  const el = (id) => document.getElementById(id);
  const tr = (zh, en) => { EN[zh] = en; return language === "en" ? en : zh; };
  const glyph = (path) =>
    `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;

  (function injectRound4Assets() {
    const navList = document.querySelector(".settings-nav-list");
    const select = el("settingsSectionSelect");
    const panelsRoot = document.querySelector(".settings-panels");
    if (navList && select && panelsRoot && !el("settingsPanelAbout")) {
      const aboutTab = document.createElement("button");
      aboutTab.type = "button";
      aboutTab.className = "settings-nav-item";
      aboutTab.dataset.settingsSection = "about";
      aboutTab.setAttribute("role", "tab");
      aboutTab.innerHTML =
        glyph('<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>') +
        `<span>${tr("关于", "About")}</span>`;
      const diagTab = document.createElement("button");
      diagTab.type = "button";
      diagTab.className = "settings-nav-item";
      diagTab.dataset.settingsSection = "diagnostics";
      diagTab.setAttribute("role", "tab");
      diagTab.innerHTML =
        glyph('<path d="M4 7h16M6 11h12M8 15h8"/><circle cx="12" cy="19" r="1"/>') +
        `<span>${tr("本地服务", "Local services")}</span>`;
      const trashTab = navList.querySelector('[data-settings-section="trash"]');
      navList.insertBefore(aboutTab, trashTab);
      navList.insertBefore(diagTab, trashTab);
      for (const [value, label] of [
        ["about", tr("关于", "About")],
        ["diagnostics", tr("本地服务", "Local services")],
      ]) {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        const trashOpt = [...select.options].find((o) => o.value === "trash");
        select.insertBefore(opt, trashOpt);
      }
      const aboutPanel = document.createElement("section");
      aboutPanel.className = "settings-panel";
      aboutPanel.dataset.settingsPanel = "about";
      aboutPanel.id = "settingsPanelAbout";
      aboutPanel.hidden = true;
      aboutPanel.innerHTML = `<h3 class="settings-panel-title">${tr("关于", "About")}</h3>
        <div class="settings-group">
          <p class="settings-about-copy">${tr(
            "HanzAgent 是一款在本机运行的创作与对话工具。数据保存在你的设备上，不会上传到第三方云服务。",
            "HanzAgent is a local creative and chat workspace. Your data stays on this device and is not uploaded to third-party clouds.",
          )}</p>
          <p class="settings-about-copy">${tr(
            "本项目为社区/个人作品，与任何商业聊天或 AI 产品无官方隶属或背书关系。界面布局仅作体验参考，不代表合作或授权。",
            "This project is an independent local app. It is not affiliated with, endorsed by, or officially related to any commercial chat or AI product. Layout references are for UX only.",
          )}</p>
        </div>`;
      const diagPanel = document.createElement("section");
      diagPanel.className = "settings-panel";
      diagPanel.dataset.settingsPanel = "diagnostics";
      diagPanel.id = "settingsPanelDiagnostics";
      diagPanel.hidden = true;
      diagPanel.innerHTML = `<h3 class="settings-panel-title">${tr(
        "本地服务与诊断",
        "Local services & diagnostics",
      )}</h3>
        <div class="settings-group" id="settingsDiagnosticsGroup">
          <div class="settings-row" id="settingsDiagnosticsConnectionRow">
            <span class="settings-row-label">${tr("连接状态", "Connection")}</span>
            <span class="settings-diagnostics-value" id="settingsDiagnosticsConnectionHook" data-settings-hook="connection"></span>
          </div>
          <div class="settings-row" id="settingsDiagnosticsDatabaseRow">
            <span class="settings-row-label" id="databasePath">${tr("数据库路径", "Database path")}</span>
            <span class="settings-diagnostics-value" id="settingsDatabasePathDisplay" data-settings-hook="database-path" title="">—</span>
          </div>
          <button type="button" id="settingsDiagnosticsRefresh" class="settings-row-button preference-link" data-settings-hook="diagnostics-refresh">
            <span>${tr("刷新诊断信息", "Refresh diagnostics")}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 13.5-5.7L20 8V4h-4l1.8 1.8A6 6 0 1 0 18 12"/></svg>
          </button>
        </div>
        <p class="dialog-note" style="margin:16px 0 0">${tr(
          "数据库健康状态独立于 LM Studio 和 ComfyUI。关闭模型服务不会删除聊天。",
          "Database health is independent of LM Studio and ComfyUI. Stopping a model service does not delete chats.",
        )}</p>`;
      const trashPanel = panelsRoot.querySelector('[data-settings-panel="trash"]');
      panelsRoot.insertBefore(aboutPanel, trashPanel);
      panelsRoot.insertBefore(diagPanel, trashPanel);
      const generalGroup = el("settingsPanelGeneral")?.querySelector(".settings-group");
      const connBadge = el("connection");
      const connRow = connBadge?.closest(".settings-row");
      const hook = el("settingsDiagnosticsConnectionHook");
      if (connRow && hook && connBadge) {
        hook.replaceChildren(connBadge);
        connRow.remove();
      }
      const syncDatabasePath = () => {
        const source = el("databasePath");
        const target = el("settingsDatabasePathDisplay");
        if (!source || !target) return;
        const path = source.title || source.textContent?.trim() || "—";
        target.textContent = path;
        target.title = path;
      };
      syncDatabasePath();
      el("settingsDiagnosticsRefresh")?.addEventListener("click", () => {
        syncDatabasePath();
        dispatchEvent(new Event("hanz-diagnostics-refresh"));
      });
      addEventListener("hanzlanguage", syncDatabasePath);
    }
  })();

  let memories = [],
    editing = null,
    pending = false,
    memoryQuery = "",
    listFocusIndex = -1,
    memoryLoadState = "idle";
  const prefs = el("preferencesDialog"),
    memory = el("memoryDialog"),
    confirm = el("confirmDialog");

  (function enhanceMemoryDialog() {
    if (!memory || memory.dataset.round4Enhanced) return;
    memory.dataset.round4Enhanced = "1";
    memory.classList.add("memory-dialog--round4");
    const heading = memory.querySelector(".dialog-heading");
    const closeBtn = el("closeMemory");
    const notes = [...memory.querySelectorAll(":scope > .dialog-note")];
    const switches = memory.querySelector(".memory-switches");
    const statusNode = el("memoryStatus");
    const list = el("memoryList");
    const form = el("memoryForm");
    const clearBtn = el("clearMemory");
    const body = document.createElement("div");
    body.className = "memory-dialog--body";
    const listView = document.createElement("div");
    listView.id = "memoryListView";
    const editorView = document.createElement("div");
    editorView.id = "memoryEditorView";
    editorView.hidden = true;
    const toolbar = document.createElement("div");
    toolbar.className = "memory-list-toolbar";
    const searchWrap = document.createElement("div");
    searchWrap.className = "memory-search-wrap";
    searchWrap.innerHTML =
      glyph(
        '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
      ) +
      `<input type="search" id="memorySearch" autocomplete="off" placeholder="${tr(
        "搜索记忆",
        "Search memories",
      )}" />`;
    toolbar.append(searchWrap);
    const listScroll = document.createElement("div");
    listScroll.className = "memory-list-scroll";
    listScroll.id = "memoryListScroll";
    list.parentElement?.removeChild(list);
    listScroll.append(list);
    list.setAttribute("role", "listbox");
    list.setAttribute(
      "aria-label",
      tr("已保存的记忆", "Saved memories"),
    );
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.id = "memoryAddButton";
    addBtn.textContent = tr("添加记忆", "Add memory");
    const editorHeading = document.createElement("div");
    editorHeading.className = "memory-editor-heading";
    const editorBack = document.createElement("button");
    editorBack.type = "button";
    editorBack.id = "memoryEditorBack";
    editorBack.className = "chrome-button";
    editorBack.setAttribute(
      "aria-label",
      tr("返回记忆列表", "Back to memory list"),
    );
    editorBack.innerHTML = glyph('<path d="m14 6-6 6 6 6"/>');
    const editorTitle = document.createElement("h3");
    editorTitle.id = "memoryEditorTitle";
    editorTitle.textContent = tr("添加记忆", "Add memory");
    editorHeading.append(editorBack, editorTitle);
    listView.append(...notes, switches, statusNode, toolbar, listScroll, addBtn);
    editorView.append(editorHeading, form);
    body.append(statusNode, listView, editorView);
    const footer = document.createElement("div");
    footer.className = "memory-dialog--footer";
    footer.append(clearBtn);
    [...memory.children].forEach((node) => {
      if (node !== heading) node.remove();
    });
    memory.append(heading, body, footer);
    el("memoryTitle").textContent = tr("已保存的记忆", "Saved memories");
    closeBtn?.setAttribute("aria-label", tr("关闭", "Close"));
    addBtn.onclick = () => openMemoryEditor(null);
    editorBack.onclick = () => closeMemoryEditor();
    el("memorySearch").addEventListener("input", (e) => {
      memoryQuery = e.target.value.trim().toLowerCase();
      renderMemories();
    });
    list.addEventListener("keydown", (e) => {
      const rows = visibleMemoryRows();
      if (!rows.length) return;
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        let next = listFocusIndex;
        if (e.key === "Home") next = 0;
        else if (e.key === "End") next = rows.length - 1;
        else
          next =
            (listFocusIndex +
              (e.key === "ArrowDown" ? 1 : -1) +
              rows.length) %
            rows.length;
        focusMemoryRow(next);
      } else if (e.key === "Escape") {
        e.stopPropagation();
        const menu = document.querySelector(".memory-row-menu:popover-open");
        if (menu) menu.hidePopover();
      }
    });
  })();

  const rowMenus = [];
  class MemoryRowMenu {
    constructor(trigger, panel) {
      this.events = new AbortController();
      this.trigger = trigger;
      this.panel = panel;
      rowMenus.push(this);
      trigger.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.open ? this.close() : this.show();
      }, {signal:this.events.signal});
      trigger.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          this.show();
          const items = this.items();
          items[e.key === "ArrowUp" ? items.length - 1 : 0]?.focus({
            preventScroll: true,
          });
        }
      }, {signal:this.events.signal});
      panel.addEventListener("keydown", (e) => {
        const items = this.items();
        const index = items.indexOf(document.activeElement);
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          const next =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? items.length - 1
                : (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
                  items.length;
          items[next]?.focus({ preventScroll: true });
        } else if (e.key === "Escape" && this.open) {
          e.preventDefault();
          e.stopPropagation();
          this.close();
        } else if (e.key === "Tab") this.close(false);
      }, {signal:this.events.signal});
      document.addEventListener(
        "pointerdown",
        (e) => {
          if (
            this.open &&
            !panel.contains(e.target) &&
            !trigger.contains(e.target)
          )
            this.close(false);
        },
        {capture:true, signal:this.events.signal},
      );
      addEventListener("liquidlayerchange", () => this.close(false), {signal:this.events.signal});
    }
    items() {
      return [...this.panel.querySelectorAll("button")];
    }
    show() {
      for (const menu of rowMenus) if (menu !== this) menu.close(false);
      this.panel.hidden = false;
      if (!this.panel.matches(":popover-open")) this.panel.showPopover();
      this.open = true;
      this.trigger.setAttribute("aria-expanded", "true");
      const r = this.trigger.getBoundingClientRect();
      this.panel.style.inset = "auto";
      this.panel.style.left = Math.max(12, r.right - 180) + "px";
      const box=this.panel.getBoundingClientRect();
      this.panel.style.top = Math.max(12,Math.min(r.bottom+6,innerHeight-box.height-12))+"px";
      this.items()[0]?.focus({ preventScroll: true });
    }
    close(restore = true) {
      if (!this.open) return;
      this.open = false;
      if (this.panel.matches(":popover-open")) this.panel.hidePopover();
      this.panel.hidden = true;
      this.trigger.setAttribute("aria-expanded", "false");
      if (restore) this.trigger.focus({ preventScroll: true });
    }
  }

  const status = (message, error = false) => {
    el("memoryStatus").textContent = message;
    el("memoryStatus").classList.toggle("error", error);
  };
  const button = (label, onClick, danger = false) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "action" + (danger ? " danger-link" : "");
    b.textContent = label;
    b.onclick = onClick;
    return b;
  };
  function ask(title, body, action) {
    if (confirm.open || pending) return;
    el("confirmTitle").textContent = title;
    el("confirmBody").textContent = body;
    el("confirmError").hidden = true;
    el("confirmAccept").disabled = false;
    el("confirmCancel").disabled = false;
    pending = false;
    LiquidLayers.open(confirm);
    el("confirmCancel").focus();
    el("confirmAccept").onclick = async () => {
      if (pending) return;
      pending = true;
      el("confirmAccept").disabled = true;
      el("confirmCancel").disabled = true;
      try {
        await action();
        pending = false;
        await LiquidLayers.close(confirm);
      } catch (e) {
        el("confirmError").textContent = e.message;
        el("confirmError").hidden = false;
      } finally {
        pending = false;
        el("confirmAccept").disabled = false;
        el("confirmCancel").disabled = false;
      }
    };
  }
  el("confirmCancel").onclick = () => LiquidLayers.close(confirm);
  confirm.addEventListener("cancel", (e) => {
    if (pending) e.preventDefault();
  });
  el("appSettings").onclick = () => {
    LiquidLayers.closeSettings({ focus: false });
    LiquidLayers.open(prefs, el("appSettings"));
  };
  el("closePreferences").onclick = () => LiquidLayers.close(prefs);
  el("closeMemory").onclick = () =>
    LiquidLayers.close(memory, { cascade: true });
  el("backMemory").onclick = () => LiquidLayers.close(memory);

  function categoryLabel(category) {
    return (
      {
        profile: tr("个人背景", "Background"),
        preference: tr("偏好", "Preference"),
        project: tr("项目", "Project"),
        note: tr("其他", "Other"),
      }[category] || category
    );
  }
  function sourceLabel(item) {
    return item.source === "manual"
      ? tr("手动保存", "Saved by you")
      : tr("来自明确陈述", "From an explicit statement");
  }
  function filteredMemories() {
    if (!memoryQuery) return memories;
    return memories.filter((item) =>
      (item.content + " " + categoryLabel(item.category))
        .toLowerCase()
        .includes(memoryQuery),
    );
  }
  function visibleMemoryRows() {
    return [...el("memoryList").querySelectorAll(".memory-item")];
  }
  function focusMemoryRow(index, moveFocus = true) {
    const rows = visibleMemoryRows();
    if (!rows.length) {
      listFocusIndex = -1;
      return;
    }
    listFocusIndex = Math.max(0, Math.min(index, rows.length - 1));
    rows.forEach((row, i) => {
      row.tabIndex = i === listFocusIndex ? 0 : -1;
      row.setAttribute("aria-selected", String(i === listFocusIndex));
    });
    if (moveFocus) rows[listFocusIndex].focus({ preventScroll: true });
  }
  function setMemoryView(mode) {
    const listView = el("memoryListView");
    const editorView = el("memoryEditorView");
    if (!listView || !editorView) return;
    const editingList = mode === "editor";
    listView.hidden = editingList;
    editorView.hidden = !editingList;
    el("memoryTitle").textContent = editingList
      ? editing
        ? tr("编辑记忆", "Edit memory")
        : tr("添加记忆", "Add memory")
      : tr("已保存的记忆", "Saved memories");
    const editorTitleEl = el("memoryEditorTitle");
    if (editorTitleEl) editorTitleEl.textContent = el("memoryTitle").textContent;
  }
  function openMemoryEditor(item, seed) {
    if (pending) return;
    resetEdit();
    if (item) edit(item);
    else if (seed) el("memoryContent").value = seed;
    setMemoryView("editor");
    el("memoryContent").focus();
  }
  memory.canClose = confirm.canClose = () => !pending;
  memory.addEventListener("cancel",e=>{if(pending || !el("memoryEditorView").hidden){e.preventDefault();e.stopImmediatePropagation();if(!pending)closeMemoryEditor();}},{capture:true});
  function closeMemoryEditor() {
    if (pending) return;
    resetEdit();
    setMemoryView("list");
    focusMemoryRow(0);
  }
  function resetEdit() {
    editing = null;
    el("memoryForm").reset();
    el("cancelMemoryEdit").hidden = true;
  }
  function edit(item) {
    editing = item;
    el("memoryContent").value = item.content;
    el("memoryCategory").value = item.category;
    el("cancelMemoryEdit").hidden = false;
  }
  function renderListChrome() {
    const scroll = el("memoryListScroll");
    const root = el("memoryList");
    if (!scroll || !root) return;
    scroll.classList.remove("is-loading", "is-error");
    let notice = scroll.querySelector(".memory-list-state");
    if (memoryLoadState === "loading") {
      scroll.classList.add("is-loading");
      if (!notice) {
        notice = document.createElement("p");
        notice.className = "memory-list-state";
        scroll.prepend(notice);
      }
      notice.textContent = tr("正在加载…", "Loading…");
      notice.hidden = false;
      root.hidden = true;
      return;
    }
    if (memoryLoadState === "error") {
      scroll.classList.add("is-error");
      if (!notice) {
        notice = document.createElement("p");
        notice.className = "memory-list-state";
        scroll.prepend(notice);
      }
      notice.textContent =
        el("memoryStatus").textContent || tr("加载失败", "Could not load");
      notice.hidden = false;
      root.hidden = true;
      return;
    }
    notice?.remove();
    root.hidden = false;
  }
  function renderMemories() {
    for (const menu of document.querySelectorAll(".memory-row-menu")) {
      menu._controller?.close(false);
      menu._controller?.events.abort();
      menu.remove();
    }
    rowMenus.length = 0;
    const root = el("memoryList");
    const scroll = el("memoryListScroll");
    if (!root) return;
    if (memoryLoadState !== "idle") {
      if (scroll && !scroll.contains(root)) scroll.append(root);
      renderListChrome();
      return;
    }
    renderListChrome();
    scroll?.classList.remove("is-loading", "is-error");
    if (scroll && !scroll.contains(root)) scroll.append(root);
    root.replaceChildren();
    const items = filteredMemories();
    if (!memories.length) {
      const p = document.createElement("p");
      p.className = "empty-memory";
      p.textContent = tr(
        "还没有记忆。添加一条，或在对话中说「记住：…」。",
        "No memories yet. Add one here, or say “Remember…” in a chat.",
      );
      root.append(p);
    } else if (!items.length) {
      const p = document.createElement("p");
      p.className = "empty-memory-search";
      p.textContent = tr(
        "没有匹配的记忆。试试其他关键词。",
        "No memories match your search. Try different keywords.",
      );
      root.append(p);
    } else {
      for (const item of items) {
        const row = document.createElement("article");
        row.className = "memory-item";
        row.dataset.memoryId = item.id;
        row.setAttribute("role", "option");
        row.tabIndex = -1;
        const meta = document.createElement("small");
        meta.textContent = categoryLabel(item.category) + " · " + sourceLabel(item);
        const content = document.createElement("p");
        content.textContent = item.content;
        const more = document.createElement("button");
        more.type = "button";
        more.className = "memory-item-more chrome-button";
        more.setAttribute("aria-label", tr("更多操作", "More actions"));
        more.setAttribute("aria-haspopup", "menu");
        more.setAttribute("aria-expanded", "false");
        more.innerHTML = glyph('<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>');
        const menu = document.createElement("div");
        menu.className = "memory-row-menu";
        menu.setAttribute("popover", "manual");
        menu.setAttribute("role", "menu");
        menu.hidden = true;
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.setAttribute("role", "menuitem");
        editBtn.textContent = tr("编辑", "Edit");
        editBtn.onclick = () => {
          menu._controller?.close(false);
          openMemoryEditor(item);
        };
        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "danger-link";
        deleteBtn.setAttribute("role", "menuitem");
        deleteBtn.textContent = tr("删除", "Delete");
        deleteBtn.onclick = () => {
          menu._controller?.close(false);
          ask(
            tr("删除这条记忆？", "Delete this memory?"),
            tr(
              "删除后，新回答将不再引用它。已有对话不会改写。",
              "New answers will no longer use this memory. Existing conversations stay unchanged.",
            ),
            async () => {
              await request(
                "/qwen-cn/memory/" + item.id,
                json("DELETE", {}),
              );
              if (editing?.id === item.id) resetEdit();
              await loadMemory();
            },
          );
        };
        menu.append(editBtn, deleteBtn);
        memory.append(menu);
        menu._controller = new MemoryRowMenu(more, menu);
        row.append(meta, content, more);
        row.addEventListener("click", (e) => {
          if (e.target.closest(".memory-item-more")) return;
          openMemoryEditor(item);
        });
        row.addEventListener("keydown",e=>{if(e.target===row && ["Enter"," "].includes(e.key)){e.preventDefault();openMemoryEditor(item);}});
        root.append(row);
      }
      focusMemoryRow(Math.min(listFocusIndex, items.length - 1), false);
    }
    el("clearMemory").disabled = !memories.length;
    el("memoryAddButton")?.toggleAttribute(
      "disabled",
      memoryLoadState !== "idle",
    );
  }
  async function loadMemory() {
    memoryLoadState = "loading";
    status(tr("正在加载…", "Loading…"));
    renderMemories();
    try {
      const data = await request("/qwen-cn/memory");
      memories = data.items;
      memoryLoadState = "idle";
      el("memoryEnabled").checked = data.preferences.enabled;
      el("memoryAutomatic").checked = data.preferences.auto_capture;
      el("memoryAutomatic").disabled = !data.preferences.enabled;
      renderMemories();
      status(
        data.preferences.enabled
          ? ""
          : tr(
              "记忆已暂停，已保存的内容仍可管理。",
              "Memory is paused. You can still manage saved entries.",
            ),
      );
    } catch (e) {
      memoryLoadState = "error";
      status(e.message, true);
      renderMemories();
      throw e;
    }
  }
  let memoryOpener = null;
  async function showMemory(content, origin) {
    memoryOpener = origin || memoryOpener || el("memoryNav");
    resetEdit();
    setMemoryView("list");
    memoryQuery = "";
    const search = el("memorySearch");
    if (search) search.value = "";
    if (!memory.open) LiquidLayers.open(memory, memoryOpener);
    try {
      await loadMemory();
      if (content) openMemoryEditor(null, content);
    } catch (e) {
      status(e.message, true);
    }
  }
  el("memoryNav").onclick = () => showMemory(null, el("preferencesDialog").open ? el("memoryNav") : el("profileButton"));
  el("cancelMemoryEdit").onclick = closeMemoryEditor;
  el("memoryForm").onsubmit = async (e) => {
    e.preventDefault();
    const b = el("saveMemory");
    if (b.disabled || pending) return;
    pending = true;
    b.disabled = true;
    const item = editing;
    const body = {
      content: el("memoryContent").value.trim(),
      category: el("memoryCategory").value,
    };
    if (item) body.version = item.version;
    try {
      await request(
        "/qwen-cn/memory" + (item ? "/" + item.id : ""),
        json(item ? "PATCH" : "POST", body),
      );
      resetEdit();
      setMemoryView("list");
      await loadMemory();
      status(
        tr(
          "记忆已保存，将用于相关的新回答。",
          "Memory saved for relevant future answers.",
        ),
      );
    } catch (error) {
      status(error.message, true);
    } finally {
      pending = false;
      b.disabled = false;
    }
  };
  for (const [id, key] of [
    ["memoryEnabled", "enabled"],
    ["memoryAutomatic", "auto_capture"],
  ])
    el(id).onchange = async () => {
      if (pending) return;
      const input = el(id),
        value = input.checked;
      pending = true;
      input.disabled = true;
      try {
        await request(
          "/qwen-cn/memory/preferences",
          json("PATCH", { [key]: value }),
        );
        await loadMemory();
      } catch (e) {
        input.checked = !value;
        status(e.message, true);
      } finally {
        pending = false;
        input.disabled =
          id === "memoryAutomatic" && !el("memoryEnabled").checked;
      }
    };
  el("clearMemory").onclick = () =>
    ask(
      tr("清空所有全局记忆？", "Clear all personal memory?"),
      tr(
        "此操作无法撤销。已有聊天记录保持不变。",
        "This cannot be undone. Your chat history stays unchanged.",
      ),
      async () => {
        await request("/qwen-cn/memory", json("DELETE", { confirm: true }));
        resetEdit();
        setMemoryView("list");
        await loadMemory();
      },
    );
  async function deleteImage(item) {
    ask(
      tr("移至图片回收站？", "Move image to Trash?"),
      tr(
        "仅从图库移至回收站，可恢复。聊天中的图片及磁盘原图保留。永久删除需在回收站另行确认。",
        "Hide from Gallery reversibly. Chat images and files remain. Permanent file deletion requires separate confirmation in Trash.",
      ),
      async () => {
        await request(
          "/qwen-cn/gallery/" + item.id,
          json("DELETE", { confirm: true }),
        );
        if (el("imageDialog").open)
          LiquidLayers.close(el("imageDialog"), { immediate: true });
        gallerySelection = null;
        await loadGallery();
        if (current) {
          current = await request("/qwen-cn/chats/" + current.id);
          render(true);
        }
        setStatus(tr("图片已移至回收站，可恢复。", "Image moved to Trash; it can be restored."));
      },
    );
  }
  el("galleryDelete").onclick = () => {
    if (gallerySelection) deleteImage(gallerySelection);
  };
  window.HanzFeatures = {
    confirm: ask,
    deleteImage,
    remember: (message) => showMemory(message.prompt),
    purge: (chat) => {
      ask(tr('永久删除这段对话？','Permanently delete this conversation?'),tr('聊天记录将无法恢复。独立记忆保留。默认将生成图片保留在图库；勾选后仅删除没有其他引用的生成原文件。旧迁移 JSON 和手动安全备份不在此操作范围内。','Chat records cannot be restored. Memory is retained. Images stay in Gallery unless the option below is selected; shared files are always retained. Legacy migration JSON and explicit safety backups are outside this operation.'),async()=>{
        const result=await request('/qwen-cn/trash/'+chat.id,json('DELETE',{confirm:true,include_media:!!el('purgeMedia')?.checked}));
        if(lastDeleted===chat.id){lastDeleted=null;el('deleteToast').hidden=true;}
        if(current?.id===chat.id){current=null;dirty=false;conflict=null;showDraft({});}
        await loadTrash();chats=await request('/qwen-cn/chats');renderSidebar(true);
        setStatus(tr(`已删除。删除原文件 ${result.deleted_files}；保留共享图片 ${result.retained_shared}、参考图 ${result.retained_inputs}。`,`Deleted. Files removed: ${result.deleted_files}; shared images retained: ${result.retained_shared}; reference files retained: ${result.retained_inputs}.`));
      });
      const label=document.createElement('label');label.className='delete-scope';
      const check=document.createElement('input');check.type='checkbox';check.id='purgeMedia';label.append(check,document.createTextNode(tr('同时删除未被其他记录引用的生成原文件','Also delete generated files without other references')));el('confirmBody').append(label);
    },
  };
  captureLanguage(prefs);
  captureLanguage(memory);
  window.addEventListener("hanzlanguage", () => {
    el("backMemory").setAttribute(
      "aria-label",
      tr("返回设置", "Back to settings"),
    );
    if (memory.open) {
      setMemoryView(el("memoryEditorView").hidden ? "list" : "editor");
      renderMemories();
      el("memorySearch")?.setAttribute(
        "placeholder",
        tr("搜索记忆", "Search memories"),
      );
    }
  });
})();
