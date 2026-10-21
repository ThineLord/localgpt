/* Round 7 memory manager. Reads and writes only /qwen-cn/memory. */
(() => {
  const byId = (id) => document.getElementById(id);
  const tr = (zh, en) => {
    EN[zh] = en;
    return language === "en" ? en : zh;
  };
  const dialog = byId("memoryDialog");
  if (!dialog || dialog.dataset.memoryUi === "round7") return;
  dialog.dataset.memoryUi = "round7";

  const UUID_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  let memories = [];
  let snapshot = {
    items: [],
    preferences: { enabled: true, auto_capture: false },
    preferences_version: null,
    collection_revision: null,
    summary: null,
  };
  let editing = null;
  let memoryQuery = "";
  let memoryPending = false;
  let booted = false;
  let memoryLoadState = "idle";
  let paintingHints = false;
  let hintToken = 0;
  let hintTimer = 0;

  function status(message, error = false) {
    const node = byId("memoryStatus");
    if (!node) return;
    node.textContent = message || "";
    node.classList.toggle("error", !!error);
  }

  function settingsStatus(message, error = false) {
    const node = byId("memorySettingsStatus");
    if (!node) return;
    node.textContent = message || "";
    node.classList.toggle("error", !!error);
  }

  function categoryLabel(category) {
    return (
      {
        profile: tr("个人背景", "Background"),
        preference: tr("偏好", "Preference"),
        project: tr("项目", "Project"),
        note: tr("其他", "Other"),
      }[category] || tr("其他", "Other")
    );
  }

  function sourceLabel(source) {
    return (
      {
        manual: tr("手动添加", "Added in settings"),
        explicit: tr("对话指令", "Chat command"),
        statement: tr("明确陈述", "Explicit statement"),
      }[source] || (source ? tr("其他来源", "Other source") : "")
    );
  }

  function topicLabel(topic) {
    return (
      {
        name: tr("名字", "Name"),
        answer_style: tr("回答风格", "Answer style"),
        response_language: tr("回答语言", "Response language"),
        tone: tr("语气", "Tone"),
      }[topic] || ""
    );
  }

  function useLabel(active) {
    return active === false
      ? tr("已暂停", "Paused")
      : tr("使用中", "In use");
  }

  function summarySentence(data) {
    const items = data.items || [];
    const counts = data.summary?.counts || {
      total: items.length,
      active: items.filter((item) => item.active !== false).length,
    };
    const enabled = !!data.preferences?.enabled;
    const auto = !!data.preferences?.auto_capture;
    return [
      tr(
        `共 ${counts.total} 条，${counts.active} 条使用中`,
        `${counts.total} saved, ${counts.active} in use`,
      ),
      enabled
        ? tr("全局记忆已开启", "Personal memory is on")
        : tr("全局记忆已关闭，条目仍保留", "Personal memory is off; entries remain"),
      auto
        ? tr("会记下明确的个人陈述", "Explicit personal statements can be saved")
        : tr("不会自动记下陈述", "Automatic capture is off"),
    ].join(language === "en" ? ". " : "。") + (language === "en" ? "." : "。");
  }

  function renderOverview(data) {
    const sentence = summarySentence(data);
    const summary = byId("memorySummary");
    const settingsSummary = byId("memorySettingsSummary");
    if (summary) summary.textContent = sentence;
    if (settingsSummary) settingsSummary.textContent = sentence;
    const highlights = byId("memorySettingsHighlights");
    if (!highlights) return;
    highlights.replaceChildren();
    for (const item of data.summary?.highlights || []) {
      const line = document.createElement("li");
      line.textContent =
        categoryLabel(item.category) + " · " + (item.preview || "");
      highlights.append(line);
    }
  }

  function showConflict(message, { canAdopt = false } = {}) {
    const node = byId("memoryConflict");
    const actions = byId("memoryConflictActions");
    node.hidden = false;
    node.textContent = message;
    actions.hidden = false;
    byId("memoryAdopt").hidden = !canAdopt;
  }

  function hideConflict() {
    byId("memoryConflict").hidden = true;
    byId("memoryConflict").textContent = "";
    byId("memoryConflictActions").hidden = true;
    byId("memoryAdopt").hidden = true;
  }

  function syncPreferences(preferences) {
    const enabled = byId("memoryEnabled");
    const automatic = byId("memoryAutomatic");
    enabled.checked = !!preferences.enabled;
    automatic.checked = !!preferences.auto_capture;
    automatic.disabled = !preferences.enabled || memoryPending;
    enabled.disabled = memoryPending;
  }

  function filteredMemories() {
    const query = memoryQuery.trim().toLowerCase();
    if (!query) return memories;
    return memories.filter((item) =>
      [
        item.content,
        categoryLabel(item.category),
        sourceLabel(item.source),
        topicLabel(item.topic),
        useLabel(item.active),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }

  function setMemoryView(mode) {
    const editingView = mode === "editor";
    byId("memoryListView").hidden = editingView;
    byId("memoryEditorView").hidden = !editingView;
    const title = editingView
      ? editing
        ? tr("编辑记忆", "Edit memory")
        : tr("添加记忆", "Add memory")
      : tr("已保存的记忆", "Saved memories");
    byId("memoryTitle").textContent = title;
    byId("memoryEditorTitle").textContent = title;
    const note = byId("memoryEditorNote");
    if (!editingView) note.textContent = "";
    else if (editing && editing.active === false)
      note.textContent = tr(
        "这条记忆已暂停。保存只修改文字，不会重新启用。",
        "This memory is paused. Saving changes the text and does not turn it back on.",
      );
    else if (editing)
      note.textContent = tr(
        "保存不会改变使用或暂停状态。",
        "Saving does not change whether this memory is in use.",
      );
    else note.textContent = "";
  }

  function renderListChrome() {
    const scroll = byId("memoryListScroll");
    const root = byId("memoryList");
    scroll.classList.remove("is-loading", "is-error");
    const prior = scroll.querySelector(".memory-list-state");
    if (memoryLoadState === "idle") {
      prior?.remove();
      root.hidden = false;
      return;
    }
    scroll.classList.add(memoryLoadState === "error" ? "is-error" : "is-loading");
    const notice = prior || document.createElement("p");
    notice.className = "memory-list-state";
    notice.textContent =
      memoryLoadState === "error"
        ? byId("memoryStatus").textContent || tr("加载失败", "Could not load")
        : tr("正在加载…", "Loading…");
    if (!prior) scroll.prepend(notice);
    root.hidden = true;
  }

  function renderMemories() {
    renderOverview(snapshot);
    renderListChrome();
    const root = byId("memoryList");
    if (memoryLoadState !== "idle") {
      byId("clearMemory").disabled = !memories.length || memoryPending;
      byId("memoryAddButton").disabled = memoryPending;
      return;
    }
    root.replaceChildren();
    const items = filteredMemories();
    if (!memories.length) {
      const empty = document.createElement("p");
      empty.className = "empty-memory";
      empty.textContent = tr(
        "还没有记忆。添加一条，或在对话中说「记住：…」。",
        "No memories yet. Add one here, or say “Remember…” in a chat.",
      );
      root.append(empty);
    } else if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "empty-memory-search";
      empty.textContent = tr(
        "没有匹配的记忆。试试其他关键词。",
        "No memories match your search. Try different keywords.",
      );
      root.append(empty);
    } else {
      for (const item of items) {
        const row = document.createElement("article");
        row.className = "memory-item" + (item.active === false ? " is-inactive" : "");
        row.dataset.memoryId = item.id;
        row.dataset.active = item.active === false ? "false" : "true";
        row.setAttribute("role", "listitem");
        const meta = document.createElement("small");
        const bits = [categoryLabel(item.category), sourceLabel(item.source), topicLabel(item.topic), useLabel(item.active)].filter(Boolean);
        meta.textContent = bits.join(" · ");
        const content = document.createElement("p");
        content.textContent = item.content;
        const actions = document.createElement("div");
        actions.className = "memory-item-actions";
        const preview = (item.content || "").slice(0, 24);
        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "action";
        editButton.textContent = tr("编辑", "Edit");
        editButton.setAttribute("aria-label", tr("编辑", "Edit") + " · " + preview);
        editButton.onclick = () => openEditor(item);
        const useButton = document.createElement("button");
        useButton.type = "button";
        useButton.className = "action";
        useButton.dataset.memoryAction = "active";
        useButton.textContent =
          item.active === false
            ? tr("恢复使用", "Use again")
            : tr("暂停使用", "Pause");
        useButton.setAttribute("aria-pressed", item.active === false ? "false" : "true");
        useButton.onclick = () => setItemActive(item, item.active === false);
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "action danger-link";
        deleteButton.textContent = tr("删除", "Delete");
        deleteButton.setAttribute("aria-label", tr("删除这条记忆", "Delete this memory") + " · " + preview);
        deleteButton.onclick = () => deleteItem(item);
        actions.append(editButton, useButton, deleteButton);
        row.append(meta, content, actions);
        root.append(row);
      }
    }
    byId("clearMemory").disabled = !memories.length || memoryPending;
    byId("memoryAddButton").disabled = memoryLoadState !== "idle" || memoryPending;
  }

  function applySnapshot(data) {
    snapshot = data;
    memories = data.items || [];
    booted = snapshot.preferences_version != null;
    syncPreferences(data.preferences || {});
    memoryLoadState = "idle";
    renderMemories();
    if (!data.preferences?.enabled)
      status(tr("记忆已暂停。已保存的内容仍可管理。", "Memory is paused. Saved entries can still be managed."));
    else if (!byId("memoryConflict").hidden) status("");
    else status("");
    settingsStatus(
      data.preferences?.enabled
        ? ""
        : tr("全局记忆已关闭。管理页面仍可修改条目。", "Personal memory is off. Entries can still be managed."),
    );
  }

  async function refreshSnapshot() {
    memoryLoadState = memories.length ? "idle" : "loading";
    if (!memories.length) {
      settingsStatus(tr("正在读取记忆概况。", "Loading memory summary."));
      renderMemories();
    }
    const data = await request("/qwen-cn/memory");
    applySnapshot(data);
    return data;
  }

  function resetEditor() {
    editing = null;
    byId("memoryForm").reset();
  }

  function openEditor(item, seed) {
    if (memoryPending) return;
    resetEditor();
    if (item) {
      editing = item;
      byId("memoryContent").value = item.content;
      byId("memoryCategory").value = item.category || "note";
    } else if (seed) byId("memoryContent").value = seed;
    setMemoryView("editor");
    byId("memoryContent").focus();
  }

  function closeEditor() {
    if (memoryPending) return;
    const keepConflict = !byId("memoryConflict").hidden;
    resetEditor();
    setMemoryView("list");
    if (!keepConflict) hideConflict();
    byId("memorySearch").focus();
  }

  async function openMemory(seed, origin) {
    const opener = origin && origin.nodeType === 1 ? origin : byId("memoryNav");
    resetEditor();
    setMemoryView("list");
    memoryQuery = "";
    byId("memorySearch").value = "";
    if (!dialog.open) window.LiquidLayers.open(dialog, opener);
    try {
      await refreshSnapshot();
      if (seed) openEditor(null, seed);
      else byId("memorySearch").focus();
    } catch (error) {
      memoryLoadState = "error";
      status(error.message, true);
      settingsStatus(error.message, true);
      renderMemories();
    }
  }

  function askMemory(title, body, acceptLabel, action) {
    const accept = byId("confirmAccept");
    const previous = accept.textContent;
    accept.textContent = acceptLabel;
    const restore = () => {
      accept.textContent = previous;
      byId("confirmDialog").removeEventListener("close", restore);
    };
    byId("confirmDialog").addEventListener("close", restore);
    window.HanzFeatures.confirm(title, body, action);
  }

  async function setItemActive(item, active) {
    if (memoryPending || item.version == null) return;
    memoryPending = true;
    const version = item.version;
    try {
      await request(
        "/qwen-cn/memory/" + item.id,
        json("PATCH", { active, version }),
      );
      hideConflict();
      await refreshSnapshot();
      status(
        active
          ? tr("已恢复使用。之后相关的新回答可以引用它。", "In use again. Later related answers can receive it.")
          : tr("已暂停使用。条目还在，新回答不会引用它。", "Paused. The entry remains, and new answers will not receive it."),
      );
    } catch (error) {
      if (error.status === 409)
        showConflict(
          tr(
            "暂停或恢复没有执行：这条记忆的版本已变化。请重新加载后再操作，不会自动重试。",
            "Pause or resume did not run because the memory changed. Reload before trying again. It will not retry automatically.",
          ),
        );
      else status(error.message, true);
    } finally {
      memoryPending = false;
      renderMemories();
    }
  }

  function deleteItem(item) {
    const version = item.version;
    askMemory(
      tr("删除这条记忆？", "Delete this memory?"),
      tr(
        "删除后，新回答不会再引用它。已有对话不会改写。这和暂停使用不同。",
        "New answers will no longer receive it. Existing chats stay unchanged. This is not the same as pausing it.",
      ),
      tr("确认删除", "Delete"),
      async () => {
        try {
          await request("/qwen-cn/memory/" + item.id, json("DELETE", { version }));
        } catch (error) {
          if (error.status === 409) {
            showConflict(
              tr(
                "删除没有执行：记忆版本已变化。请重新加载后再删除，不会自动重试。",
                "Nothing was deleted because the memory changed. Reload before deleting again. It will not retry automatically.",
              ),
            );
            return;
          }
          throw error;
        }
        if (editing?.id === item.id) closeEditor();
        await refreshSnapshot();
        status(tr("已删除这条记忆。", "Memory deleted."));
      },
    );
  }

  async function reloadFromServer() {
    const inEditor = !byId("memoryEditorView").hidden;
    const draft = byId("memoryContent").value;
    const category = byId("memoryCategory").value;
    const editingId = editing?.id || null;
    try {
      await refreshSnapshot();
    } catch (error) {
      status(error.message, true);
      return;
    }
    if (!inEditor) {
      hideConflict();
      setMemoryView("list");
      return;
    }
    setMemoryView("editor");
    byId("memoryContent").value = draft;
    byId("memoryCategory").value = category;
    const fresh = memories.find((item) => item.id === editingId);
    showConflict(
      fresh
        ? tr("已重新加载列表。编辑框里的文字未改。服务器上现在是：", "The list was reloaded. The text you typed is unchanged. The saved text is now: ") + fresh.content
        : tr("已重新加载。这条记忆已不在列表中。编辑框里的文字未改。", "Reloaded. This memory is no longer in the list. The text you typed is unchanged."),
      { canAdopt: !!fresh },
    );
  }

  function adoptServer() {
    const fresh = memories.find((item) => item.id === editing?.id);
    if (!fresh || byId("memoryEditorView").hidden) return;
    editing = fresh;
    byId("memoryContent").value = fresh.content;
    byId("memoryCategory").value = fresh.category || "note";
    hideConflict();
    setMemoryView("editor");
    status(tr("已改用服务器上的内容。这还不是一次新的保存。", "Showing the saved text. Nothing new has been saved."));
  }

  byId("memoryReload").onclick = () => reloadFromServer();
  byId("memoryAdopt").onclick = () => adoptServer();
  byId("memoryAddButton").onclick = () => openEditor(null);
  byId("memoryEditorBack").onclick = () => closeEditor();
  byId("cancelMemoryEdit").onclick = () => closeEditor();
  byId("closeMemory").onclick = () => window.LiquidLayers.close(dialog);
  byId("backMemory").onclick = () => window.LiquidLayers.close(dialog);
  byId("memoryNav").onclick = () => openMemory(null, byId("memoryNav"));
  byId("memorySearch").addEventListener("input", (event) => {
    memoryQuery = event.target.value;
    renderMemories();
  });
  dialog.canClose = () => !memoryPending;
  dialog.addEventListener(
    "cancel",
    (event) => {
      if (memoryPending || !byId("memoryEditorView").hidden) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!memoryPending) closeEditor();
      }
    },
    { capture: true },
  );

  byId("memoryForm").onsubmit = async (event) => {
    event.preventDefault();
    const button = byId("saveMemory");
    if (button.disabled || memoryPending) return;
    const item = editing;
    const draft = byId("memoryContent").value;
    const body = { content: draft.trim(), category: byId("memoryCategory").value };
    if (item) {
      if (item.version == null) {
        showConflict(tr("缺少版本号，未保存。请重新加载。", "Missing version, so nothing was saved. Reload first."));
        return;
      }
      body.version = item.version;
    }
    memoryPending = true;
    button.disabled = true;
    try {
      await request("/qwen-cn/memory" + (item ? "/" + item.id : ""), json(item ? "PATCH" : "POST", body));
      hideConflict();
      resetEditor();
      setMemoryView("list");
      await refreshSnapshot();
      status(tr("已保存。相关的新回答可以引用它。", "Saved. Later related answers can receive it."));
    } catch (error) {
      byId("memoryContent").value = draft;
      if (error.status === 409)
        showConflict(
          tr(
            "没有保存：这条记忆已在其他地方更新。编辑框里的文字仍保留。请重新加载查看服务器版本，不会自动覆盖。",
            "Not saved: this memory changed somewhere else. The text you typed is still here. Reload to see the saved version. It will not be overwritten automatically.",
          ),
          { canAdopt: false },
        );
      else status(error.message, true);
    } finally {
      memoryPending = false;
      button.disabled = false;
      renderMemories();
    }
  };

  for (const [id, key] of [
    ["memoryEnabled", "enabled"],
    ["memoryAutomatic", "auto_capture"],
  ]) {
    byId(id).addEventListener("change", async () => {
      const input = byId(id);
      const value = input.checked;
      if (memoryPending) {
        input.checked = !value;
        return;
      }
      if (!booted || snapshot.preferences_version == null) {
        input.checked = !value;
        settingsStatus(tr("还没有读到设置版本，未更改。", "Memory settings were not changed because the version is not loaded yet."), true);
        return;
      }
      const version = snapshot.preferences_version;
      memoryPending = true;
      input.disabled = true;
      try {
        await request(
          "/qwen-cn/memory/preferences",
          json("PATCH", { [key]: value, preferences_version: version }),
        );
        hideConflict();
        await refreshSnapshot();
      } catch (error) {
        input.checked = !value;
        if (error.status === 409)
          showConflict(
            tr(
              "记忆设置没有更改：版本已过期。请重新加载后再切换，不会自动重试。",
              "Memory settings were not changed because the version is stale. Reload before switching again. It will not retry automatically.",
            ),
          );
        else settingsStatus(error.message, true);
        syncPreferences(snapshot.preferences || {});
      } finally {
        memoryPending = false;
        syncPreferences({
          enabled: byId("memoryEnabled").checked,
          auto_capture: byId("memoryAutomatic").checked,
        });
        renderMemories();
      }
    });
  }

  byId("clearMemory").onclick = () => {
    if (snapshot.collection_revision == null) {
      showConflict(tr("还没有读到列表版本，未清空。请先重新加载。", "The list version is not loaded, so nothing was cleared. Reload first."));
      return;
    }
    const revision = snapshot.collection_revision;
    askMemory(
      tr("清空所有全局记忆？", "Clear all personal memory?"),
      tr(
        "此操作无法撤销。已有聊天记录保持不变。如果列表刚刚变化，清空会被拒绝。",
        "This cannot be undone. Chat history stays unchanged. If the list just changed, clearing is refused.",
      ),
      tr("确认清空", "Clear"),
      async () => {
        try {
          await request("/qwen-cn/memory", json("DELETE", { confirm: true, collection_revision: revision }));
        } catch (error) {
          if (error.status === 409) {
            showConflict(
              tr(
                "清空没有执行：记忆列表已变化。请重新加载后再次确认，不会用过期版本自动重试。",
                "Nothing was cleared because the memory list changed. Reload and confirm again. The stale version will not be retried automatically.",
              ),
            );
            return;
          }
          throw error;
        }
        resetEditor();
        setMemoryView("list");
        hideConflict();
        await refreshSnapshot();
        status(tr("已清空全局记忆。", "Personal memory cleared."));
      },
    );
  };

  document.querySelector('[data-settings-section="memory"]')?.addEventListener("click", () => {
    if (!memoryPending) refreshSnapshot().catch((error) => settingsStatus(error.message, true));
  });

  function memorySignal(memory) {
    if (!memory || typeof memory !== "object") return "";
    const state = memory.status || "";
    const blocked = state === "disabled" || state === "rejected" || state === "ambiguous";
    const parts = [];
    if (state === "saved") parts.push(tr("已保存为记忆", "Saved as a memory"));
    else if (state === "updated") parts.push(tr("已更新记忆", "Memory updated"));
    else if (state === "forgotten") parts.push(tr("已删除匹配的记忆", "Matching memory removed"));
    else if (state === "disabled")
      parts.push(tr("记忆已暂停，本轮没有保存或引用", "Memory is paused, so this turn was not saved or recalled"));
    else if (state === "rejected") parts.push(tr("记忆操作没有执行", "The memory action was not applied"));
    else if (state === "ambiguous")
      parts.push(tr("匹配到多条记忆，没有修改", "More than one memory matched, so nothing changed"));
    const notice = typeof memory.notice === "string" ? memory.notice.trim() : "";
    if (notice && blocked && !UUID_TEXT.test(notice)) parts.push(notice);
    const used = blocked
      ? []
      : (Array.isArray(memory.used) ? memory.used.filter((id) => typeof id === "string" && id) : []);
    if (used.length)
      parts.push(
        tr(
          `本轮注入了 ${used.length} 条记忆，仅供参考，不代表回答一定采用`,
          `This turn injected ${used.length} ${used.length === 1 ? "memory" : "memories"} as context. That does not mean the answer relied on them`,
        ),
      );
    const text = parts.filter((part) => part && !UUID_TEXT.test(part)).join(language === "en" ? " " : "。");
    return text && language !== "en" && !text.endsWith("。") ? text + "。" : text;
  }

  function paintEntry(entry, memory) {
    const text = memorySignal(memory);
    let node = entry.querySelector(".memory-turn-hint");
    if (!text) {
      node?.remove();
      return;
    }
    if (!node) {
      node = document.createElement("p");
      node.className = "memory-turn-hint";
      node.setAttribute("role", "note");
    }
    if (node.textContent !== text) node.textContent = text;
    const shell = entry.querySelector(".user-message-shell") || entry;
    if (node.parentElement !== shell) shell.append(node);
  }

  function activeChatId() {
    const fromHash = new URLSearchParams(location.hash.replace(/^#/, "")).get("chat");
    if (fromHash) return fromHash;
    const current = document.querySelector('#chatList .chat-item[aria-current="true"]');
    const menu = current?.parentElement?.querySelector("[id^='chat-menu-']");
    return menu ? menu.id.slice("chat-menu-".length) : "";
  }

  async function renderActions() {
    const root = byId("conversation");
    const id = activeChatId();
    if (!root || !id) return;
    const token = ++hintToken;
    const chat = await request("/qwen-cn/chats/" + encodeURIComponent(id));
    if (token !== hintToken) return;
    const byMessage = new Map((chat.messages || []).map((item) => [item.id, item]));
    paintingHints = true;
    try {
      for (const entry of root.querySelectorAll(".entry"))
        paintEntry(entry, byMessage.get(entry.dataset.messageId)?.memory);
    } finally {
      paintingHints = false;
    }
  }

  function scheduleHints() {
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      renderActions().catch(() => {});
    }, 60);
  }

  const conversation = byId("conversation");
  if (conversation) {
    new MutationObserver(() => {
      if (!paintingHints) scheduleHints();
    }).observe(conversation, { childList: true, subtree: true });
  }

  const openFromShell = (origin) => openMemory(null, origin || byId("memoryNav"));
  window.AppShellRegistrations = window.AppShellRegistrations || {};
  window.AppShellRegistrations.openMemory = openFromShell;
  window.AppShell?.registerOpenMemory?.(openFromShell);
  window.HanzMemory = { open: openMemory, refresh: refreshSnapshot, memorySignal, paintEntry, renderActions };
  window.HanzFeatures = window.HanzFeatures || {};
  window.HanzFeatures.remember = (message) => openMemory(message?.prompt, document.activeElement);
  window.HanzFeatures.showMemory = openFromShell;
  window.HanzFeatures.renderActions = renderActions;
  window.HanzFeatures.memorySignal = memorySignal;

  [
    ["个性化", "Personalization"],
    ["全局记忆只保存在本机。关闭后不再记录或引用，已有条目仍可管理，不会被删除。", "Personal memory stays on this computer. Turning it off stops saving and recall. Saved entries remain and can still be managed."],
    ["正在读取记忆概况。", "Loading memory summary."],
    ["打开记忆管理", "Open memory manager"],
    ["关闭全局记忆、暂停某一条、删除某一条是三件不同的事。清空全部需要当前列表版本，过期时不会强制删除。", "Turning memory off, pausing one entry, and deleting one entry are different. Clearing everything needs the current list version and will not force an outdated delete."],
    ["已保存的记忆", "Saved memories"],
    ["重新加载", "Reload"],
    ["改用服务器上的内容", "Use the saved text"],
    ["只保存明确陈述或「记住：…」。关闭全局记忆后，这里的条目仍可搜索和修改。", "Only explicit statements or “Remember…” are saved. When personal memory is off, entries here can still be searched and edited."],
    ["搜索记忆", "Search memories"],
    ["添加记忆", "Add memory"],
    ["返回记忆列表", "Back to memory list"],
    ["取消编辑", "Cancel edit"],
    ["保存", "Save"],
  ].forEach(([zh, en]) => tr(zh, en));

  addEventListener("hanzlanguage", () => {
    byId("memorySearch").placeholder = tr("搜索记忆", "Search memories");
    byId("backMemory").setAttribute("aria-label", tr("返回设置", "Back to settings"));
    byId("memoryEditorBack").setAttribute("aria-label", tr("返回记忆列表", "Back to memory list"));
    setMemoryView(byId("memoryEditorView").hidden ? "list" : "editor");
    renderMemories();
    scheduleHints();
  });
  captureLanguage(byId("settingsNav"));
  captureLanguage(byId("settingsPanelMemory"));
  captureLanguage(dialog);
  if (language === "en") applyLanguage("en", false);
  refreshSnapshot().catch((error) => settingsStatus(error.message, true));
})();
