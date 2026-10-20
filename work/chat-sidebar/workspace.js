/* Low-frequency controls and real, server-backed personal data operations. */
(() => {
  const el = (id) => document.getElementById(id);
  const tr = (zh, en) => (language === "en" ? en : zh);
  let memories = [],
    editing = null,
    pending = false;
  const prefs = el("preferencesDialog"),
    memory = el("memoryDialog"),
    confirm = el("confirmDialog");
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
    if (confirm.open) return;
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
    el("memoryContent").focus();
  }
  function renderMemories() {
    const root = el("memoryList");
    root.replaceChildren();
    if (!memories.length) {
      const p = document.createElement("p");
      p.className = "empty-memory";
      p.textContent = tr(
        "还没有记忆。添加一条，或在对话中说「记住：…」。",
        "No memories yet. Add one here, or say “Remember…” in a chat.",
      );
      root.append(p);
    }
    for (const item of memories) {
      const row = document.createElement("article");
      row.className = "memory-item";
      row.dataset.memoryId = item.id;
      const content = document.createElement("p");
      content.textContent = item.content;
      const meta = document.createElement("small");
      meta.textContent =
        {
          profile: tr("个人背景", "Background"),
          preference: tr("偏好", "Preference"),
          project: tr("项目", "Project"),
          note: tr("其他", "Other"),
        }[item.category] +
        " · " +
        (item.source === "manual"
          ? tr("手动保存", "Saved by you")
          : tr("来自明确陈述", "From an explicit statement"));
      const actions = document.createElement("div");
      actions.className = "memory-item-actions";
      actions.append(
        button(tr("编辑", "Edit"), () => edit(item)),
        button(
          tr("删除", "Delete"),
          () =>
            ask(
              tr("删除这条记忆？", "Delete this memory?"),
              tr(
                "删除后，新回答将不再引用它。已有对话不会改写。",
                "New answers will no longer use this memory. Existing conversations stay unchanged.",
              ),
              async () => {
                await request("/qwen-cn/memory/" + item.id, json("DELETE", {}));
                if (editing?.id === item.id) resetEdit();
                await loadMemory();
              },
            ),
          true,
        ),
      );
      row.append(meta, content, actions);
      root.append(row);
    }
    el("clearMemory").disabled = !memories.length;
  }
  async function loadMemory() {
    status(tr("正在加载…", "Loading…"));
    const data = await request("/qwen-cn/memory");
    memories = data.items;
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
  }
  async function showMemory(content) {
    resetEdit();
    if (!memory.open) LiquidLayers.open(memory);
    try {
      await loadMemory();
      if (content) {
        el("memoryContent").value = content;
        el("memoryContent").focus();
      }
    } catch (e) {
      status(e.message, true);
    }
  }
  el("memoryNav").onclick = () => showMemory();
  el("cancelMemoryEdit").onclick = resetEdit;
  el("memoryForm").onsubmit = async (e) => {
    e.preventDefault();
    const b = el("saveMemory");
    if (b.disabled) return;
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
      b.disabled = false;
    }
  };
  for (const [id, key] of [
    ["memoryEnabled", "enabled"],
    ["memoryAutomatic", "auto_capture"],
  ])
    el(id).onchange = async () => {
      const input = el(id),
        value = input.checked;
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
        await loadMemory();
      },
    );
  async function deleteImage(item) {
    ask(
      tr("删除这张图库图片？", "Delete this gallery image?"),
      tr(
        "从图库与对话中移除这张图片。磁盘原图保留在本机输出目录。",
        "Remove this image from the gallery and conversation. The original file remains in the local output folder.",
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
        setStatus(tr("图片已从图库删除。", "Image removed from gallery."));
      },
    );
  }
  el("galleryDelete").onclick = () => {
    if (gallerySelection) deleteImage(gallerySelection);
  };
  window.HanzFeatures = {
    deleteImage,
    remember: (message) => showMemory(message.prompt),
    purge: (chat) =>
      ask(
        tr("永久删除这段对话？", "Permanently delete this conversation?"),
        tr(
          "删除对话、消息及由此保存的全局记忆，无法恢复。生成的图片保留在图库。",
          "Delete the conversation, messages and personal memories saved from it. This cannot be undone. Generated images remain in the gallery.",
        ),
        async () => {
          await request(
            "/qwen-cn/trash/" + chat.id,
            json("DELETE", { confirm: true }),
          );
          if (lastDeleted === chat.id) {
            lastDeleted = null;
            el("deleteToast").hidden = true;
          }
          if (current?.id === chat.id) {
            current = null;
            dirty = false;
            conflict = null;
            showDraft({});
          }
          await loadTrash();
          chats = await request("/qwen-cn/chats");
          renderSidebar(true);
        },
      ),
  };
  window.addEventListener("hanzlanguage", () => {
    el("backMemory").setAttribute(
      "aria-label",
      tr("返回设置", "Back to settings"),
    );
    if (memory.open) renderMemories();
  });
})();
