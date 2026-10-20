"use strict";
let modelCatalog = [],
  liveEvents = null,
  liveMessageId = null,
  submitting = false;
let navigationVersion = 0,
  creatingChat = false,
  galleryPending = false;
let preferences = {};
try {
  preferences = JSON.parse(localStorage.getItem("hanzagent-options") || "{}");
} catch {}
const optionDefaults = {
  mode: "auto",
  model: "qwen3-8b",
  thinking: "off",
  temperature: 0.7,
  max_tokens: 2048,
  cfg: 1,
  seed: null,
  ...preferences,
};
const $ = (id) => document.getElementById(id);
let view = "chat",
  trashItems = [],
  galleryItems = [],
  galleryTotal = 0,
  galleryNext = null,
  galleryQuery = "",
  gallerySelection = null,
  galleryLoading = false,
  gallerySignature = "",
  lastDeleted = null,
  trashSignature = "";
let language = "zh";
try {
  language =
    localStorage.getItem("qwen-studio-language") === "en" ? "en" : "zh";
} catch {}
let current = null,
  chats = [],
  reference = null,
  referenceLabel = "参考图片",
  records = [],
  busy = false,
  uploading = false,
  activeId = null,
  runStart = 0,
  elapsedTimer = null;
let dirty = false,
  saveTimer = null,
  saving = null,
  conflict = null,
  baseDraft = {},
  lastMessageSignature = "",
  lastSidebarSignature = "",
  lastStatus = "",
  lastError = false,
  phaseState = null,
  connectionLabel = "连接中",
  refreshing = false,
  saveLabel = "";
const EN = {
  对话操作: "Chat actions",
  画室: "Studio",
  连接中: "Connecting",
  本地已连接: "Connected locally",
  本地连接已断开: "Disconnected",
  服务未连接: "Offline",
  外观主题: "Appearance",
  白天模式: "Light mode",
  黑夜模式: "Dark mode",
  跟随系统: "Follow system",
  切换语言: "Switch language",
  当前图片: "Current image",
  历史图片: "Image history",
  当前参考图片: "Current reference image",
  参考图片: "Reference image",
  移除参考图: "Remove reference",
  "描述 / 修改要求": "Prompt / edit instructions",
  "描述想生成的画面…": "Describe what you want to create…",
  "描述你想修改的地方…": "Describe what you want to change…",
  描述你想看到的画面: "Describe a picture you have in mind",
  上传参考图: "Upload image",
  图片设置: "Image settings",
  尺寸与质量: "Size and quality",
  设置: "Settings",
  画面比例: "Aspect ratio",
  图片尺寸: "Image size",
  "1:1 · 方形": "1:1 · Square",
  "5:3 · 横向": "5:3 · Landscape",
  "3:5 · 竖向": "3:5 · Portrait",
  生成质量: "Quality",
  图片质量: "Image quality",
  标准: "Standard",
  快速: "Quick",
  生成图片: "Generate",
  生成修改结果: "Apply edit",
  停止: "Stop",
  准备生成: "Preparing",
  图片生成进度: "Generation progress",
  正在准备: "Preparing",
  "采样已完成，正在显影": "Sampling complete · decoding",
  正在写入本地磁盘: "Saving to your Mac",
  首次加载可能需要一些时间: "Loading may take a moment",
  继续修改: "Edit",
  保存: "Save",
  保存图片: "Save image",
  查看原图: "View original",
  等待灵感: "Ready to create",
  图片编辑: "Image edit",
  文字生成: "Text to image",
  继续编辑这张图片: "Editing this image",
  "参考图片最大为 20 MB。": "Reference images must be under 20 MB.",
  "请选择 PNG、JPEG 或 WebP 图片。": "Choose a PNG, JPEG or WebP image.",
  读取参考图片: "Reading reference image",
  上传的参考图片: "Uploaded reference image",
  "参考图已就绪，请输入修改要求。": "Image ready. Describe your changes.",
  正在绘制: "Generating",
  加载文本编码器: "Loading text encoder",
  理解图片与修改要求: "Reading image and instructions",
  理解中文描述: "Reading your prompt",
  加载图像模型: "Loading image model",
  绘制图片: "Generating image",
  解码图片: "Decoding image",
  处理图片: "Processing image",
  "系统资源紧张，已安全请求停止。请关闭其他大型应用或释放磁盘空间后重试。":
    "Stopped safely due to resource pressure. Close large apps or free some disk space before trying again.",
  "生成未完成，请重新尝试。": "Generation did not finish. Please try again.",
  "推理完成，但没有返回图片。":
    "Generation finished without returning an image.",
  准备图片编辑: "Preparing image edit",
  准备文生图: "Preparing generation",
  "磁盘空间不足，请至少保留 2 GB 可用空间。":
    "Keep at least 2 GB of free disk space to generate.",
  "ComfyUI 正在执行其他任务，请等当前任务完成。":
    "ComfyUI is busy. Wait for the current task to finish.",
  "已请求停止，正在等待当前计算结束…":
    "Stop requested. Waiting for the current operation…",
};
Object.assign(EN, {
  打开侧边栏: "Open sidebar",
  收起侧边栏: "Close sidebar",
  新对话: "New chat",
  聊天记录: "Chats",
  本地数据库: "Local database",
  既有作品: "Previous work",
  重命名对话: "Rename chat",
  对话名称: "Chat title",
  取消: "Cancel",
  确认: "Save",
  对话: "Conversation",
  描述已保存: "Prompt saved",
  生成中: "Generating",
  生成失败: "Generation failed",
  草稿已保存: "Draft saved",
  "正在保存…": "Saving…",
  另一个对话正在生成图片: "Another chat is generating an image",
  "其他页面已更新此草稿。你的输入仍保留，请选择要使用的版本。":
    "This draft changed in another tab. Your text is still here. Choose which version to keep.",
  保留当前输入: "Keep my draft",
  使用已保存草稿: "Use saved draft",
  "对话已在其他页面更新，请刷新后重试。":
    "This conversation changed in another tab. Refresh and try again.",
  "请求已保存，正在核对生成状态，请稍后查看此对话。":
    "Your request was saved. Checking its status. Return to this chat shortly.",
  "生成已中断，描述已保存，请重试。":
    "Generation was interrupted. Your prompt is saved; you can retry.",
  "生成已停止，描述已保存。": "Generation stopped. Your prompt is saved.",
  重新编辑: "Edit prompt",
  "数据库连接失败，请检查本地服务。":
    "Cannot reach the database. Check the local service.",
  正在保存到本地数据库: "Saving to the local database",
  "无法保存草稿，请稍后重试。": "Could not save the draft. Please try again.",
});
Object.assign(EN, {
  图库: "Gallery",
  回收站: "Trash",
  搜索图片: "Search images",
  暂无图片: "No images yet",
  暂无已删除对话: "Trash is empty",
  删除对话: "Delete chat",
  恢复对话: "Restore chat",
  撤销: "Undo",
  关闭: "Close",
  打开对话: "Open chat",
  加载更多: "Load more",
  "对话已移入回收站，图片仍保留在图库。":
    "Chat moved to Trash. Images remain in Gallery.",
  "此对话正在生成图片，请先停止或等待完成。":
    "This chat is generating. Stop it or wait until it finishes.",
  "对话已删除，请先在回收站恢复。":
    "This chat was deleted. Restore it from Trash first.",
  收起侧边栏: "Collapse sidebar",
  展开侧边栏: "Expand sidebar",
  此对话已移入回收站: "This chat is in Trash",
  图片未删除: "Images are kept",
  对话已恢复: "Chat restored",
  已删除: "Deleted",
  删除对话后仍可在回收站恢复: "Deleted chats can be restored from Trash",
  没有匹配的图片: "No matching images",
});
Object.assign(EN, {
  "聊点什么，或画点什么": "Let’s talk. Or create something.",
  "发消息，或说「帮我画一张…」": "Message, or say “draw me…”",
  发送: "Send",
  自动: "Auto",
  聊天: "Chat",
  生图: "Image",
  对话模型: "Chat model",
  刷新模型: "Refresh models",
  "连接 LM Studio": "Connect LM Studio",
  创造性: "Creativity",
  回答长度: "Response length",
  "简短 · 512": "Short · 512",
  "标准 · 2048": "Standard · 2048",
  "详细 · 4096": "Long · 4096",
  思考模式: "Thinking",
  快速回答: "Quick response",
  深入思考: "Think deeper",
  提示词强度: "Prompt guidance",
  随机种子: "Seed",
  随机: "Random",
  本地对话与生图: "Local chat & images",
  复制: "Copy",
  已复制: "Copied",
  重新生成: "Regenerate",
  编辑后重发: "Edit & resend",
  思考过程: "Reasoning",
  已停止: "Stopped",
  正在停止: "Stopping",
  已请求停止: "Stop requested",
  正在回答: "Responding",
  正在思考: "Thinking",
  加载对话模型: "Loading chat model",
  理解你的请求: "Understanding your request",
  准备图片生成: "Preparing image generation",
  达到回答长度上限: "Response length limit reached",
  模型离线: "Models offline",
  "本地模型正在处理其他任务，请等当前任务完成。":
    "A local model is busy. Please wait.",
  "此对话正在生成内容，请先停止或等待完成。":
    "This chat is generating. Stop it or wait until it finishes.",
  生成与对话设置: "Chat & image settings",
  对话内容: "Conversation",
  图像模型: "Image model",
  "Enter 发送 · Shift+Enter 换行": "Enter to send · Shift+Enter for newline",
  模型不支持思考开关: "This model has no thinking switch",
  仅用于生图编辑: "Used for image editing",
});
Object.assign(EN, {
  交互模式: "Interaction mode",
  你的本地创作空间: "YOUR LOCAL CREATIVE SPACE",
  "聊点什么，": "A little conversation.",
  "或画点什么。": "A little imagination.",
  "整理想法，解答问题，把灵感变成画面。":
    "Make sense of ideas. Find answers. Create something new.",
  开始创作: "Start creating",
  一起理清思路: "Think it through",
  把灵感画出来: "Create an image",
  跳到输入框: "Skip to composer",
  "回到最新消息 ↓": "Latest message ↓",
  图片预览: "Image preview",
  任务进度: "Task progress",
  请输入对话名称: "Enter a chat title",
  "正在加载…": "Loading…",
  "加载失败，请重试。": "Could not load. Please try again.",
  本地模型: "Local models",
  "刷新中…": "Refreshing…",
  "复制失败，请选择文本后复制。": "Copy failed. Select the text and copy it.",
  另一个对话正在生成内容: "Another chat is generating content",
  输入消息后发送: "Write a message to send",
  "正在提交…": "Submitting…",
});
Object.assign(EN, {
  设置: "Settings",
  外观与语言: "Appearance & language",
  个人与数据: "Personal & data",
  全局记忆: "Personal memory",
  "跨对话保留你的偏好与背景，仅存储在本机。你可以随时修改或删除。":
    "Your preferences and background, shared across chats and stored only on this computer. Edit or delete them anytime.",
  使用全局记忆: "Use personal memory",
  记住明确表达的个人信息与偏好:
    "Remember explicit personal facts and preferences",
  "只记录明确陈述或「记住：…」，不猜测，不分析旧对话。关闭记忆后停止记录与引用。":
    "Only explicit statements or ‘Remember…’. No guessing or mining older chats. Turning memory off stops saving and recall.",
  添加或修改记忆: "Add or edit a memory",
  记忆类别: "Memory category",
  偏好: "Preference",
  个人背景: "Background",
  项目: "Project",
  其他: "Other",
  取消编辑: "Cancel edit",
  清空所有记忆: "Clear all memories",
  "例如：我偏好简洁的中文回答。":
    "For example: I prefer concise answers in English.",
  确认删除: "Delete",
  删除图片: "Delete image",
  永久删除: "Delete permanently",
  已删除对话: "Deleted conversation",
  已保留的图片: "Retained image",
  图片已从图库删除: "Image removed from gallery",
  已停止: "Stopped",
  记为全局记忆: "Save as personal memory",
  回到最新消息: "Latest message",
  通用: "General", 外观: "Appearance", 个人: "Personal", 视觉样式: "Visual style",
  模型与生成: "Models & generation", 连接状态: "Connection status", 界面语言: "Language",
  返回对话: "Back to chat", 打开设置导航: "Open settings navigation", 关闭设置导航: "Close settings navigation",
  打开生成与对话参数: "Open generation and chat settings", 打开回收站: "Open trash",
  "温度、思考模式、图像尺寸等参数在输入框旁的生成面板中调整。": "Adjust temperature, thinking and image size in the generation panel.",
});
function t(text) {
  return language === "en" ? EN[text] || text : text;
}
function translate(text) {
  if (language !== "en") return text;
  if (EN[text]) return EN[text];
  if (text.startsWith("生成失败："))
    return "Generation failed: " + translate(text.slice(5));
  return text;
}
const staticText = [],
  staticAttrs = [];
function captureLanguage() {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    if (n.parentElement.closest("script,style,.ambient")) continue;
    const key = n.nodeValue.trim();
    if (EN[key]) staticText.push({ n, key });
  }
  document
    .querySelectorAll("[aria-label],[title],[placeholder],[alt]")
    .forEach((el) => {
      for (const a of ["aria-label", "title", "placeholder", "alt"]) {
        const key = el.getAttribute(a);
        if (EN[key]) staticAttrs.push({ el, a, key });
      }
    });
}
function applyLanguage(next, persist = true) {
  language = next === "en" ? "en" : "zh";
  document.documentElement.lang = language === "en" ? "en" : "zh-CN";
  document.title = "HanzAgent";
  staticText.forEach(({ n, key }) => (n.nodeValue = t(key)));
  staticAttrs.forEach(({ el, a, key }) => el.setAttribute(a, t(key)));
  $("language").textContent = language === "en" ? "中" : "EN";
  $("language").setAttribute(
    "aria-label",
    language === "en" ? "切换到中文" : "Switch to English",
  );
  setConnection(connectionLabel);
  setReference(reference, referenceLabel, false);
  setStatus(lastStatus, lastError);
  setSave(saveLabel);
  if (phaseState) setPhase(...phaseState);
  renderSidebar(true);
  render(true);
  setChatTitle();
  syncSidebar();
  updateSendButton();
  if (lastDeleted)
    $("deleteNotice").textContent = t("对话已移入回收站，图片仍保留在图库。");
  if (view === "gallery") renderGallery(true);
  if (view === "trash") renderTrash(true);
  if (gallerySelection) renderGallerySelection();
  window.dispatchEvent(new Event("hanzlanguage"));
  updateOptions();
  if (modelCatalog.length)
    $("modelStatus").textContent =
      t("本地模型") +
      " · " +
      modelCatalog.length +
      " " +
      (language === "en" ? "models" : "个模型");
  if (persist) {
    try {
      localStorage.setItem("qwen-studio-language", language);
    } catch {}
  }
}
function imageURL(i) {
  return (
    "/view?" +
    new URLSearchParams({
      filename: i.filename,
      subfolder: i.subfolder || "",
      type: i.type || "output",
    })
  );
}
function formatTime(s) {
  const n = Math.max(0, Math.floor(s));
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}
function setStatus(text, error = false) {
  lastStatus = text;
  lastError = error;
  $("status").textContent = translate(text);
  $("status").classList.toggle("error", error);
  $("appStatus").textContent = translate(text);
  $("appStatus").hidden = !(error && view !== "chat");
}
function setSave(text) {
  saveLabel = text;
  $("saveState").textContent = t(text);
}
function setConnection(text) {
  connectionLabel = text;
  $("connection").textContent = t(text);
  $("connection").dataset.state = text === "本地已连接" ? "online" : "offline";
}
async function request(url, options = {}) {
  const r = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
    ...options,
  });
  const txt = await r.text();
  let data;
  try {
    data = txt ? JSON.parse(txt) : {};
  } catch {
    data = { error: txt };
  }
  if (!r.ok) {
    const e = Error(
      typeof data.error === "string"
        ? data.error
        : data.error?.message || JSON.stringify(data.node_errors || data),
    );
    e.status = r.status;
    throw e;
  }
  return data;
}
function json(method, body) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
function setPhase(label, value = null, max = null) {
  phaseState = [label, value, max];
  $("phase").textContent = t(label);
  const measured = Number.isFinite(value) && Number.isFinite(max) && max > 0;
  $("progress").classList.toggle("indeterminate", !measured);
  if (measured) {
    const p = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
    $("progressBar").style.width = p + "%";
    $("progress").setAttribute("aria-valuenow", p);
    $("progress").setAttribute(
      "aria-valuetext",
      language === "en"
        ? `Sampling ${value}/${max}`
        : `采样 ${value}/${max} 步`,
    );
    $("stepDetail").textContent =
      language === "en"
        ? `Sampling ${value}/${max}`
        : `采样 ${value}/${max} 步`;
    $("percent").textContent = p + "%";
  } else {
    $("progress").removeAttribute("aria-valuenow");
    $("progress").setAttribute("aria-valuetext", t(label));
    $("stepDetail").textContent = "";
    $("percent").textContent = "";
  }
}
function setBusy(v) {
  if (busy === v) return;
  busy = v;
  document.body.classList.toggle("busy", v);
  [
    "generate",
    "upload",
    "size",
    "quality",
    "removeRef",
    "prompt",
    "mode",
    "chatModel",
    "thinking",
    "temperature",
    "maxTokens",
    "cfg",
    "seed",
  ].forEach((id) => ($(id).disabled = v));
  $("cancel").hidden = !v || uploading;
  $("generate").hidden = !$("cancel").hidden;
  $("cancel").disabled = !activeId;
  $("activity").hidden = !v;
  document.querySelectorAll(".edit-result").forEach((b) => (b.disabled = v));
  updateOptions();
  clearInterval(elapsedTimer);
  if (v) {
    setStatus("");
    $("elapsed").textContent = formatTime((Date.now() - runStart) / 1000);
    elapsedTimer = setInterval(() => {
      $("elapsed").textContent = formatTime((Date.now() - runStart) / 1000);
    }, 1000);
  } else {
    activeId = null;
    $("progressBar").style.width = "0%";
  }
}
function setReference(i, title = "参考图片", save = true) {
  reference = i;
  referenceLabel = title;
  $("reference").hidden = !i;
  $("generateLabel").textContent = t("发送");
  $("prompt").placeholder = t(
    i ? "描述你想修改的地方…" : "发消息，或说「帮我画一张…」",
  );
  if (i) {
    $("referencePreview").src = imageURL(i);
    $("referenceTitle").textContent = t(title);
  }
  if (save) {
    if (i) {
      $("mode").value = "image";
      updateOptions();
    }
    scheduleSave();
  }
}
function draft() {
  return {
    prompt: $("prompt").value,
    reference,
    size: $("size").value,
    quality: $("quality").value,
    ...readOptions(),
  };
}
function normalized(d) {
  return {
    prompt: d?.prompt || "",
    reference: d?.reference || null,
    size: d?.size || "512,512",
    quality: String(d?.quality || "25"),
    ...Object.fromEntries(
      Object.keys(optionDefaults).map((k) => [k, d?.[k] ?? optionDefaults[k]]),
    ),
  };
}
function same(a, b) {
  return JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));
}
function showDraft(d) {
  const n = normalized(d);
  $("prompt").value = n.prompt;
  $("size").value = n.size;
  $("quality").value = n.quality;
  setReference(n.reference, "参考图片", false);
  showOptions(n);
  resizePrompt();
}
function scheduleSave() {
  resizePrompt();
  updateSendButton();
  if (!current) return;
  dirty = true;
  setSave("正在保存…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(
    () => saveDraft().catch((e) => setStatus(e.message, true)),
    450,
  );
}
async function saveDraft() {
  clearTimeout(saveTimer);
  if (saving) {
    await saving;
    if (dirty && !conflict) return saveDraft();
    return !dirty;
  }
  if (!dirty || !current) return true;
  if (conflict) return false;
  const id = current.id,
    snapshot = draft(),
    oldBase = baseDraft;
  saving = (async () => {
    try {
      let fresh;
      try {
        fresh = await request(
          `/qwen-cn/chats/${id}`,
          json("PATCH", { version: current.draft_version, draft: snapshot }),
        );
      } catch (e) {
        if (e.status !== 409) throw e;
        const remote = await request(`/qwen-cn/chats/${id}`);
        if (!same(remote.draft, oldBase) && !same(remote.draft, snapshot)) {
          conflict = remote;
          $("draftConflict").hidden = false;
          setStatus(
            "其他页面已更新此草稿。你的输入仍保留，请选择要使用的版本。",
            true,
          );
          return false;
        }
        fresh = await request(
          `/qwen-cn/chats/${id}`,
          json("PATCH", { version: remote.draft_version, draft: snapshot }),
        );
      }
      if (current?.id === id) {
        current = fresh;
        baseDraft = normalized(fresh.draft);
        if (same(draft(), snapshot)) dirty = false;
        setSave(dirty ? "正在保存…" : "草稿已保存");
      }
      return true;
    } catch (e) {
      setSave("");
      setStatus("无法保存草稿，请稍后重试。", true);
      throw e;
    } finally {
      saving = null;
    }
  })();
  return saving;
}
async function resolveConflict(keep) {
  if (!conflict) return;
  const remote = conflict;
  conflict = null;
  current = remote;
  baseDraft = normalized(remote.draft);
  $("draftConflict").hidden = true;
  if (keep) {
    dirty = true;
    if (await saveDraft()) setStatus("");
  } else {
    dirty = false;
    showDraft(remote.draft);
    setStatus("");
    setSave("草稿已保存");
  }
}
function setChatTitle() {
  $("chatTitle").textContent =
    view === "gallery"
      ? t("图库")
      : view === "trash"
        ? t("回收站")
        : current
          ? t(current.title)
          : t("新对话");
  $("renameChat").disabled = view !== "chat" || !current;
  $("deleteCurrent").hidden = view !== "chat" || !current;
}
function renderSidebar(force = false) {
  const signature =
    JSON.stringify(chats) + language + view + (current?.id || "");
  if (!force && signature === lastSidebarSignature) return;
  lastSidebarSignature = signature;
  const list = $("chatList");
  const opened = list.querySelector(".chat-row-menu:popover-open");
  const menuState = opened && opened.contains(document.activeElement)
    ? { id: opened.id, index: [...opened.querySelectorAll("button")].indexOf(document.activeElement) }
    : null;
  list.replaceChildren();
  $("galleryNav").setAttribute("aria-current", String(view === "gallery"));
  $("trashNav").setAttribute("aria-current", String(view === "trash"));
  for (const chat of chats) {
    const row = document.createElement("div");
    row.className = "chat-row";
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chat-item";
    b.setAttribute(
      "aria-current",
      String(view === "chat" && chat.id === current?.id),
    );
    b.title = t(chat.title);
    const label = document.createElement("span");
    label.textContent = t(chat.title);
    b.append(label);
    if (chat.active) {
      const dot = document.createElement("span");
      dot.className = "chat-running";
      dot.setAttribute("aria-label", t("生成中"));
      b.append(dot);
    }
    b.onclick = () =>
      selectChat(chat.id).catch((e) => setStatus(e.message, true));
    const menuTrigger = document.createElement("button");
    menuTrigger.type = "button";
    menuTrigger.className = "chat-menu-trigger chrome-button";
    menuTrigger.innerHTML = icon("more");
    menuTrigger.setAttribute("aria-label", t("对话操作") + " · " + t(chat.title));
    menuTrigger.setAttribute("aria-haspopup", "menu");
    menuTrigger.setAttribute("aria-expanded", "false");
    const menu = document.createElement("div");
    menu.id = "chat-menu-" + chat.id;
    menu.className = "chat-row-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("popover", "auto");
    menuTrigger.setAttribute("aria-controls", menu.id);
    const rename = document.createElement("button");
    rename.type = "button";
    rename.setAttribute("role", "menuitem");
    rename.innerHTML = icon("edit") + "<span>" + t("重命名对话") + "</span>";
    rename.onclick = async () => {
      menu.hidePopover();
      try {
        await selectChat(chat.id);
        $("renameChat").click();
      } catch (e) {
        setStatus(e.message, true);
      }
    };
    const del = document.createElement("button");
    del.type = "button";
    del.className = "chat-delete danger-link";
    del.setAttribute("role", "menuitem");
    del.innerHTML = icon("trash") + "<span>" + t("删除对话") + "</span>";
    del.setAttribute("aria-label", t("删除对话") + " · " + t(chat.title));
    del.title = t("删除对话");
    del.disabled = !!chat.active;
    del.onclick = () => {
      menu.hidePopover();
      deleteChat(chat.id).catch((e) => setStatus(e.message, true));
    };
    menu.append(rename, del);
    menuTrigger.onclick = () => {
      if (menu.matches(":popover-open")) {
        menu.hidePopover();
        menuTrigger.setAttribute("aria-expanded", "false");
        return;
      }
      menu.showPopover();
      menuTrigger.setAttribute("aria-expanded", "true");
      const origin = menuTrigger.getBoundingClientRect();
      const box = menu.getBoundingClientRect();
      menu.style.left = Math.max(8, Math.min(origin.right - box.width, innerWidth - box.width - 8)) + "px";
      menu.style.top = Math.max(8, Math.min(origin.bottom + 6, innerHeight - box.height - 8)) + "px";
      rename.focus();
    };
    menu.addEventListener("toggle", () => {
      menuTrigger.setAttribute("aria-expanded", String(menu.matches(":popover-open")));
    });
    menu.addEventListener("keydown", (e) => {
      const items = [...menu.querySelectorAll("button:not(:disabled)")];
      const index = items.indexOf(document.activeElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 :
          (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next].focus();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        menu.hidePopover();
        menuTrigger.setAttribute("aria-expanded", "false");
        menuTrigger.focus();
      }
    });
    row.append(b, menuTrigger, menu);
    list.append(row);
  }
  if (menuState) {
    const restored = document.getElementById(menuState.id);
    if (restored) {
      restored.parentElement.querySelector(".chat-menu-trigger").click();
      const selected = restored.querySelectorAll("button")[menuState.index];
      if (selected && !selected.disabled) selected.focus({ preventScroll: true });
    }
  }
}
function icon(name) {
  const paths = {
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6m4-6v6"/>',
    edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14v6Z"/>',
    download: '<path d="M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    retry: '<path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
}
function messageAction(button, name, label) {
  button.classList.add("message-action");
  button.dataset.actionIcon = name;
  button.innerHTML = icon(name) + '<span class="sr-only">' + escapeHTML(t(label)) + "</span>";
  button.title = t(label);
  button.setAttribute("aria-label", t(label));
}
function render(force = false) {
  if (view !== "chat") return;
  records = current?.messages || [];
  const signature =
    JSON.stringify(
      records.map((m) => [
        m.id,
        m.status,
        m.image,
        m.error,
        m.answer,
        m.reasoning,
        m.kind,
        m.phase,
        m.memory,
        m.image_deleted,
      ]),
    ) +
    language +
    (current?.id || "");
  if (!force && signature === lastMessageSignature) return;
  lastMessageSignature = signature;
  const root = $("conversation"),
    canvas = $("chatScroll"),
    oldTop = canvas.scrollTop;
  const atBottom =
    canvas.scrollHeight - canvas.scrollTop - canvas.clientHeight < 100;
  const openReasoning = new Set(
    [...root.querySelectorAll(".entry")]
      .filter((e) => e.querySelector(".reasoning[open]"))
      .map((e) => e.dataset.messageId),
  );
  const oldEntries = new Map(
    [...root.children].map((el) => [el.dataset.messageId, el]),
  );
  let position = 0;
  $("intro").hidden = records.length > 0;
  $("history").hidden = true;
  for (const m of records) {
    const key = JSON.stringify(m) + language;
    const existing = oldEntries.get(m.id);
    oldEntries.delete(m.id);
    if (existing?.dataset.renderKey === key) {
      if (root.children[position] !== existing)
        root.insertBefore(existing, root.children[position] || null);
      position++;
      continue;
    }
    const entry = document.createElement("article");
    entry.dataset.renderKey = key;
    entry.className = "entry";
    entry.dataset.messageId = m.id;
    const prompt = document.createElement("p");
    prompt.className = "user-message";
    prompt.textContent = m.prompt;
    entry.append(prompt);
    if (m.status === "completed" || m.status === "stopped") {
      const remember = document.createElement("button");
      remember.type = "button";
      remember.className = "remember-message action";
      remember.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4V3Z"/></svg>';
      remember.title = t("记为全局记忆");
      remember.setAttribute("aria-label", t("记为全局记忆"));
      remember.onclick = () => window.HanzFeatures?.remember(m);
      entry.append(remember);
    }
    if (m.reference?.filename) {
      const ref = document.createElement("img");
      ref.className = "message-reference";
      ref.src = imageURL(m.reference);
      ref.alt = t("参考图片");
      entry.append(ref);
    }
    if (m.kind === "chat" || m.kind === "routing") {
      renderAnswer(entry, m);
    } else if (m.image) {
      const result = document.createElement("div");
      result.className = "result";
      const stage = document.createElement("div");
      stage.className = "image-stage";
      const full = document.createElement("a");
      full.href = imageURL(m.image);
      full.target = "_blank";
      full.rel = "noopener";
      full.setAttribute("aria-label", t("查看原图"));
      const img = document.createElement("img");
      img.src = imageURL(m.image);
      img.alt = m.prompt;
      img.width = m.image.metadata?.width || m.width;
      img.height = m.image.metadata?.height || m.height;
      // Reserve the output dimensions before decoding so follow-scroll uses the final height.
      if (img.width > 0 && img.height > 0) {
        stage.style.width = `${img.width}px`;
        img.style.width = "100%";
        img.style.aspectRatio = `auto ${img.width} / ${img.height}`;
      }
      img.loading = "lazy";
      full.append(img);
      stage.append(full);
      result.append(stage);
      const actions = document.createElement("div");
      actions.className = "actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "action edit-result";
      edit.innerHTML = icon("edit") + t("继续修改");
      edit.disabled = busy;
      edit.onclick = () => {
        if (busy) return;
        setReference(m.image, "继续编辑这张图片");
        $("prompt").focus();
      };
      actions.append(edit);
      const dl = document.createElement("a");
      dl.className = "action";
      dl.href =
        "/qwen-cn/download?" +
        new URLSearchParams({
          filename: m.image.filename,
          subfolder: m.image.subfolder || "",
        });
      dl.download = m.image.filename;
      dl.innerHTML = icon("download") + t("保存");
      dl.setAttribute("aria-label", t("保存图片"));
      actions.append(dl);
      result.append(actions);
      entry.append(result);
    } else {
      const pending = document.createElement("p");
      pending.className = "message-state";
      pending.textContent = m.image_deleted
        ? t("图片已从图库删除")
        : m.status === "stopped"
          ? t("已停止")
          : m.status === "failed"
            ? translate(m.error || "生成失败")
            : t("生成中");
      if (m.status === "failed") {
        pending.classList.add("error");
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "action";
        retry.textContent = t("重新编辑");
        retry.onclick = () => {
          if (busy) return;
          $("prompt").value = m.prompt;
          setReference(m.reference?.filename ? m.reference : null);
          scheduleSave();
          $("prompt").focus();
        };
        entry.append(retry);
      }
      entry.append(pending);
    }
    if (openReasoning.has(m.id) && entry.querySelector(".reasoning"))
      entry.querySelector(".reasoning").open = true;
    if (existing) existing.replaceWith(entry);
    else root.insertBefore(entry, root.children[position] || null);
    position++;
  }
  for (const stale of oldEntries.values()) stale.remove();
  if (atBottom || force)
    requestAnimationFrame(() => {
      canvas.scrollTop = canvas.scrollHeight;
    });
  else canvas.scrollTop = oldTop;
  updateJumpButton();
}
async function selectChat(id) {
  if (id === current?.id && view === "chat") return;
  const version = ++navigationVersion;
  if (!(await saveDraft())) return;
  const fresh = await request(`/qwen-cn/chats/${id}`);
  if (version !== navigationVersion) return;
  if (fresh.deleted_at) {
    await setView("trash");
    return;
  }
  current = fresh;
  dirty = false;
  conflict = null;
  $("draftConflict").hidden = true;
  baseDraft = normalized(fresh.draft);
  showDraft(fresh.draft);
  setSave("");
  setStatus("");
  view = "chat";
  showView();
  history.replaceState(null, "", "#chat=" + encodeURIComponent(id));
  setChatTitle();
  renderSidebar(true);
  updateActivity();
  render(true);
  if (innerWidth < 761) setSidebar(false);
}
async function newChat() {
  if (creatingChat) return;
  creatingChat = true;
  $("newChat").disabled = true;
  try {
    if (!(await saveDraft())) return;
    const chat = await request("/qwen-cn/chats", json("POST", {}));
    chats = await request("/qwen-cn/chats");
    await selectChat(chat.id);
    $("prompt").focus();
  } finally {
    creatingChat = false;
    $("newChat").disabled = false;
  }
}
function updateActivity() {
  const active = current?.messages.find((m) =>
    ["running", "submitting"].includes(m.status),
  );
  uploading = !!uploading;
  runStart = active ? active.created * 1000 : Date.now();
  setBusy(!!active || uploading || submitting);
  watchMessage(active);
  $("cancel").disabled = !active;
  if (active) {
    activeId = active.id;
    setPhase(active.phase, active.step, active.total);
  }
  document.querySelectorAll(".edit-result").forEach((b) => (b.disabled = busy));
  updateSendButton();
}
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    chats = await request("/qwen-cn/chats");
    setConnection("本地已连接");
    if (lastStatus === "数据库连接失败，请检查本地服务。") setStatus("");
    if (current) {
      const refreshId = current.id;
      const fresh = await request(`/qwen-cn/chats/${refreshId}`);
      if (current?.id !== refreshId) return;
      if (fresh.deleted_at) {
        if (dirty) await saveDraft();
        current = null;
        dirty = false;
        conflict = null;
        showDraft({});
        if (view === "chat") {
          if (chats.length) await selectChat(chats[0].id);
          else await setView("trash");
        }
      } else {
        if (
          !dirty &&
          !saving &&
          !conflict &&
          fresh.draft_version !== current.draft_version
        ) {
          showDraft(fresh.draft);
          baseDraft = normalized(fresh.draft);
        }
        if (!saving) {
          current = {
            ...fresh,
            draft_version: dirty ? current.draft_version : fresh.draft_version,
          };
          if (!dirty) baseDraft = normalized(fresh.draft);
        }
      }
    }
    setChatTitle();
    updateActivity();
    if (view === "chat") render();
    else if (view === "gallery" && galleryItems.length <= 60)
      await loadGallery();
    else if (view === "trash") await loadTrash();
    renderSidebar();
  } catch (e) {
    setConnection("服务未连接");
    setStatus("数据库连接失败，请检查本地服务。", true);
  } finally {
    refreshing = false;
  }
}
function syncSidebar() {
  const open = document.body.classList.contains("sidebar-open");
  $("sidebarToggle").setAttribute("aria-expanded", String(open));
  $("sidebarToggle").setAttribute(
    "aria-label",
    t(open ? "收起侧边栏" : "展开侧边栏"),
  );
  $("sidebarToggle").title = t(open ? "收起侧边栏" : "展开侧边栏");
  $("mobileMenu").setAttribute("aria-expanded", String(open));
  const modal = open && innerWidth <= 760;
  $("mainContent").inert = modal;
  $("sidebar").inert = !open && innerWidth <= 760;
}
function setSidebar(open) {
  const wasOpen = document.body.classList.contains("sidebar-open");
  document.body.classList.toggle("sidebar-open", open);
  syncSidebar();
  if (innerWidth <= 760) {
    if (open) $("sidebarToggle").focus();
    else if (wasOpen) $("mobileMenu").focus();
  }
  try {
    localStorage.setItem("qwen-studio-sidebar", open ? "open" : "closed");
  } catch {}
}
$("sidebarToggle").onclick = () =>
  setSidebar(!document.body.classList.contains("sidebar-open"));
$("sidebarShade").onclick = () => setSidebar(false);
$("newChat").onclick = () => newChat().catch((e) => setStatus(e.message, true));
$("keepDraft").onclick = () =>
  resolveConflict(true).catch((e) => setStatus(e.message, true));
$("useRemoteDraft").onclick = () =>
  resolveConflict(false).catch((e) => setStatus(e.message, true));
$("renameChat").onclick = () => {
  if (!current) return;
  $("chatName").value = current.title;
  $("renameError").hidden = true;
  LiquidLayers.open($("renameDialog"));
  $("chatName").focus();
  $("chatName").select();
};
$("renameForm").onsubmit = async (e) => {
  e.preventDefault();
  const name = $("chatName").value.trim();
  if (!name) {
    $("renameError").textContent = t("请输入对话名称");
    $("renameError").hidden = false;
    $("chatName").focus();
    return;
  }
  const button = e.submitter;
  button.disabled = true;
  try {
    if (!(await saveDraft())) return;
    const latest = await request(`/qwen-cn/chats/${current.id}`);
    current = await request(
      `/qwen-cn/chats/${current.id}`,
      json("PATCH", { version: latest.draft_version, title: name }),
    );
    await LiquidLayers.close($("renameDialog"));
    setChatTitle();
    await refresh();
  } catch (e) {
    $("renameError").textContent = translate(e.message);
    $("renameError").hidden = false;
  } finally {
    button.disabled = false;
  }
};
$("closeRename").onclick = () => LiquidLayers.close($("renameDialog"));
$("prompt").addEventListener("input", scheduleSave);
$("size").onchange = scheduleSave;
$("quality").onchange = scheduleSave;
$("removeRef").onclick = () => setReference(null);
$("upload").onclick = () => $("file").click();
$("file").onchange = async () => {
  const f = $("file").files[0];
  if (!f || busy) return;
  if (f.size > 20 * 1024 * 1024) {
    $("file").value = "";
    setStatus("参考图片最大为 20 MB。", true);
    return;
  }
  if (!["image/png", "image/jpeg", "image/webp"].includes(f.type)) {
    $("file").value = "";
    setStatus("请选择 PNG、JPEG 或 WebP 图片。", true);
    return;
  }
  uploading = true;
  runStart = Date.now();
  setBusy(true);
  setPhase("读取参考图片");
  try {
    const form = new FormData();
    const suffix =
      f.type === "image/jpeg"
        ? "jpg"
        : f.type === "image/webp"
          ? "webp"
          : "png";
    form.append("image", f, `参考图_${crypto.randomUUID()}.${suffix}`);
    form.append("type", "input");
    const result = await request("/upload/image", {
      method: "POST",
      body: form,
    });
    setReference(
      {
        filename: result.name,
        subfolder: result.subfolder,
        type: result.type || "input",
      },
      "上传的参考图片",
    );
    await saveDraft();
    setStatus("参考图已就绪，请输入修改要求。");
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    uploading = false;
    setBusy(false);
    updateActivity();
    $("file").value = "";
  }
};
$("form").onsubmit = async (e) => {
  e.preventDefault();
  await sendTurn();
};
$("cancel").onclick = async () => {
  if (!activeId) return;
  $("cancel").disabled = true;
  try {
    await request(`/qwen-cn/messages/${activeId}/stop`, json("POST", {}));
    setStatus("已请求停止，正在等待当前计算结束…");
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    $("cancel").disabled = false;
  }
};
window.addEventListener("pagehide", () => {
  if (dirty && current && !conflict) {
    const body = JSON.stringify({
      version: current.draft_version,
      draft: draft(),
    });
    navigator.sendBeacon(
      `/qwen-cn/chats/${current.id}/draft`,
      new Blob([body], { type: "application/json" }),
    );
  }
});
window.addEventListener("focus", () => refresh());
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});
const systemTheme = matchMedia("(prefers-color-scheme: dark)");
let themePreference =
  document.documentElement.dataset.themePreference || "system";
function applyTheme(preference, persist = false) {
  themePreference = ["light", "dark", "system"].includes(preference)
    ? preference
    : "system";
  const theme =
    themePreference === "system"
      ? systemTheme.matches
        ? "dark"
        : "light"
      : themePreference;
  document.documentElement.dataset.themePreference = themePreference;
  document.documentElement.dataset.theme = theme;
  for (const [id, value] of [
    ["themeLight", "light"],
    ["themeDark", "dark"],
    ["themeSystem", "system"],
  ])
    $(id).setAttribute("aria-pressed", String(themePreference === value));
  document.querySelector('meta[name="theme-color"]').content = getComputedStyle(
    document.documentElement,
  )
    .getPropertyValue("--bg")
    .trim();
  if (persist) {
    try {
      localStorage.setItem("qwen-studio-theme", themePreference);
    } catch {}
  }
}
$("themeLight").onclick = () => applyTheme("light", true);
$("themeDark").onclick = () => applyTheme("dark", true);
$("themeSystem").onclick = () => applyTheme("system", true);
systemTheme.addEventListener("change", () => {
  if (themePreference === "system") applyTheme("system");
});
window.addEventListener("storage", (e) => {
  if (e.key === "qwen-studio-theme" || e.key === null) applyTheme(e.newValue);
});
applyTheme(themePreference);

function showView() {
  $("jumpLatest").hidden = true;
  document.querySelector(".settings").open = false;
  $("appStatus").hidden = true;
  $("chatScroll").hidden = view !== "chat";
  $("form").hidden = view !== "chat";
  $("galleryView").hidden = view !== "gallery";
  $("trashView").hidden = view !== "trash";
  setChatTitle();
}
async function setView(next) {
  const version = ++navigationVersion;
  if (!(await saveDraft()) || version !== navigationVersion) return;
  setStatus("");
  view = next;
  showView();
  history.replaceState(
    null,
    "",
    next === "chat"
      ? "#chat=" + encodeURIComponent(current?.id || "")
      : "#" + next,
  );
  renderSidebar(true);
  if (next === "gallery") await loadGallery();
  else if (next === "trash") await loadTrash();
  else render(true);
  if (innerWidth < 761) setSidebar(false);
}
async function deleteChat(id) {
  if (id === current?.id && !(await saveDraft())) return;
  await request(`/qwen-cn/chats/${id}`, json("DELETE", {}));
  lastDeleted = id;
  $("deleteToast").hidden = false;
  $("deleteNotice").textContent = t("对话已移入回收站，图片仍保留在图库。");
  chats = await request("/qwen-cn/chats");
  if (id === current?.id) {
    current = null;
    dirty = false;
    conflict = null;
    $("draftConflict").hidden = true;
    showDraft({});
    setBusy(false);
    if (view === "chat") {
      if (chats.length) await selectChat(chats[0].id);
      else await setView("trash");
    }
  }
  renderSidebar(true);
  if (view === "gallery") await loadGallery();
  if (view === "trash") await loadTrash();
}
async function restoreChat(id, open = false) {
  await request(`/qwen-cn/chats/${id}/restore`, json("POST", {}));
  chats = await request("/qwen-cn/chats");
  renderSidebar(true);
  await loadTrash();
  if (view === "gallery") await loadGallery();
  if (open) await selectChat(id);
  $("deleteToast").hidden = true;
}
async function loadTrash() {
  trashItems = await request("/qwen-cn/trash");
  renderTrash();
}
function renderTrash(force = false) {
  const sig = JSON.stringify(trashItems) + language;
  if (!force && sig === trashSignature) return;
  trashSignature = sig;
  const root = $("trashList");
  root.replaceChildren();
  $("trashEmpty").hidden = !!trashItems.length;
  for (const chat of trashItems) {
    const row = document.createElement("div");
    row.className = "trash-row";
    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = t(chat.title);
    const meta = document.createElement("p");
    meta.textContent =
      (language === "en" ? `${chat.count} messages` : `${chat.count} 条记录`) +
      " · " +
      t("图片未删除");
    info.append(title, meta);
    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "action";
    restore.textContent = t("恢复对话");
    restore.onclick = () =>
      restoreChat(chat.id, true).catch((e) => setStatus(e.message, true));
    const purge = document.createElement("button");
    purge.type = "button";
    purge.className = "action danger-link";
    purge.textContent = t("永久删除");
    purge.onclick = () => window.HanzFeatures?.purge(chat, purge);
    row.append(info, restore, purge);
    root.append(row);
  }
}
async function loadGallery(more = false) {
  if (galleryLoading) {
    if (!more) galleryPending = true;
    return;
  }
  galleryLoading = true;
  const q = $("gallerySearch").value.trim(),
    offset = more ? galleryNext : 0;
  if (more && offset === null) {
    galleryLoading = false;
    return;
  }
  $("galleryGrid").setAttribute("aria-busy", "true");
  $("loadMore").disabled = true;
  if (!galleryItems.length && (!gallerySignature || q !== galleryQuery)) {
    $("galleryEmpty").hidden = false;
    $("galleryEmpty").textContent = t("正在加载…");
  }
  try {
    const page = await request(
      "/qwen-cn/gallery?" +
        new URLSearchParams({ q, offset: String(offset), limit: "60" }),
    );
    if (q !== $("gallerySearch").value.trim()) {
      galleryPending = true;
      return;
    }
    galleryQuery = q;
    galleryItems = more ? [...galleryItems, ...page.items] : page.items;
    galleryTotal = page.total;
    galleryNext = page.next_offset;
    if (gallerySelection) {
      const latest = galleryItems.find(
        (item) => item.id === gallerySelection.id,
      );
      if (latest) {
        gallerySelection = latest;
        renderGallerySelection();
      }
    }
    renderGallery();
  } catch (e) {
    if (!galleryItems.length) {
      $("galleryEmpty").textContent = t("加载失败，请重试。");
      $("galleryEmpty").hidden = false;
    }
    throw e;
  } finally {
    galleryLoading = false;
    $("galleryGrid").setAttribute("aria-busy", "false");
    $("loadMore").disabled = false;
    if (galleryPending) {
      galleryPending = false;
      loadGallery().catch((e) => setStatus(e.message, true));
    }
  }
}
function renderGallery(force = false) {
  $("galleryEmpty").hidden = !!galleryItems.length;
  $("galleryEmpty").textContent = t(
    galleryQuery ? "没有匹配的图片" : "暂无图片",
  );
  const sig =
    JSON.stringify(
      galleryItems.map((m) => [m.id, m.chat_deleted, m.chat_title]),
    ) +
    galleryTotal +
    galleryQuery +
    galleryNext +
    language;
  if (!force && sig === gallerySignature) return;
  gallerySignature = sig;
  const root = $("galleryGrid");
  root.replaceChildren();
  $("galleryCount").textContent =
    language === "en" ? `${galleryTotal} images` : `${galleryTotal} 张图片`;
  $("galleryEmpty").hidden = !!galleryItems.length;
  $("galleryEmpty").textContent = t(
    galleryQuery ? "没有匹配的图片" : "暂无图片",
  );
  $("loadMore").hidden = galleryNext === null;
  for (const item of galleryItems) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "gallery-card";
    card.setAttribute(
      "aria-label",
      (language === "en" ? "Preview: " : "预览：") + item.prompt,
    );
    const img = document.createElement("img");
    img.src = imageURL(item.image);
    img.alt = item.prompt;
    img.loading = "lazy";
    img.width = item.image.metadata?.width || item.width;
    img.height = item.image.metadata?.height || item.height;
    const text = document.createElement("span");
    const caption = document.createElement("span");
    caption.textContent = item.prompt;
    text.append(caption);
    card.append(img, text);
    card.onclick = () => {
      gallerySelection = item;
      renderGallerySelection();
      LiquidLayers.open($("imageDialog"));
    };
    const tile = document.createElement("div");
    tile.className = "gallery-tile";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "gallery-remove glass-control chrome-button";
    remove.innerHTML = icon("trash");
    remove.title = t("删除图片");
    remove.setAttribute("aria-label", t("删除图片"));
    remove.onclick = () => window.HanzFeatures?.deleteImage(item, remove);
    tile.append(card, remove);
    root.append(tile);
  }
}
function renderGallerySelection() {
  const item = gallerySelection;
  if (!item) return;
  $("galleryPreview").src = imageURL(item.image);
  $("galleryPreview").alt = item.prompt;
  $("galleryPrompt").textContent = item.prompt;
  $("galleryMeta").textContent =
    t(item.chat_title) +
    (item.chat_deleted ? " · " + t("此对话已移入回收站") : "");
  $("galleryDownload").href =
    "/qwen-cn/download?" +
    new URLSearchParams({
      filename: item.image.filename,
      subfolder: item.image.subfolder || "",
    });
  $("galleryDownload").download = item.image.filename;
  $("galleryOpenChat").hidden = !!item.chat_deleted;
  $("galleryRestore").hidden = !item.chat_deleted || !!item.chat_purged;
}
$("galleryNav").onclick = () =>
  setView("gallery").catch((e) => setStatus(e.message, true));
$("trashNav").onclick = async () => {
  await LiquidLayers.close($("preferencesDialog"));
  setView("trash").catch((e) => setStatus(e.message, true));
};
$("deleteCurrent").onclick = () => {
  if (current) deleteChat(current.id).catch((e) => setStatus(e.message, true));
};
$("undoDelete").onclick = () => {
  if (lastDeleted)
    restoreChat(lastDeleted, true).catch((e) => setStatus(e.message, true));
};
$("dismissToast").onclick = () => ($("deleteToast").hidden = true);
$("loadMore").onclick = () =>
  loadGallery(true).catch((e) => setStatus(e.message, true));
let searchTimer;
$("gallerySearch").oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(
    () => loadGallery().catch((e) => setStatus(e.message, true)),
    250,
  );
};
$("closeImage").onclick = () => {
  LiquidLayers.close($("imageDialog"));
  gallerySelection = null;
};
$("imageDialog").addEventListener("close", () => (gallerySelection = null));
$("galleryOpenChat").onclick = async () => {
  const item = gallerySelection;
  await LiquidLayers.close($("imageDialog"));
  selectChat(item.chat_id).catch((e) => setStatus(e.message, true));
};
$("galleryRestore").onclick = async () => {
  const item = gallerySelection;
  await LiquidLayers.close($("imageDialog"));
  restoreChat(item.chat_id, true).catch((e) => setStatus(e.message, true));
};
$("galleryEdit").onclick = async () => {
  try {
    const item = gallerySelection;
    await LiquidLayers.close($("imageDialog"));
    if (item.chat_deleted) await newChat();
    else await selectChat(item.chat_id);
    setReference(item.image, "继续编辑这张图片");
    await saveDraft();
    $("prompt").focus();
  } catch (e) {
    setStatus(e.message, true);
  }
};
let initialized = false;
async function init() {
  if (!initialized) {
    captureLanguage();
    initialized = true;
  }
  $("language").onclick = () => applyLanguage(language === "en" ? "zh" : "en");
  applyLanguage(language, false);
  try {
    let open = innerWidth > 760;
    try {
      const pref = localStorage.getItem("qwen-studio-sidebar");
      if (pref) open = pref === "open" && innerWidth > 760;
    } catch {}
    setSidebar(open);
    const health = await request("/qwen-cn/health");
    $("databasePath").title = health.database || "";
    chats = await request("/qwen-cn/chats");
    if (!chats.length)
      chats = [await request("/qwen-cn/chats", json("POST", {}))];
    const id = new URLSearchParams(location.hash.slice(1)).get("chat");
    if (location.hash === "#gallery") await setView("gallery");
    else if (location.hash === "#trash") await setView("trash");
    else await selectChat(chats.some((c) => c.id === id) ? id : chats[0].id);
    setConnection("本地已连接");
    loadModels();
    setInterval(() => {
      if (!document.hidden) refresh();
    }, 3000);
  } catch (e) {
    setConnection("服务未连接");
    setStatus(e.message, true);
    setTimeout(init, 5000);
  }
}

function readOptions() {
  return {
    mode: $("mode").value,
    model: $("chatModel").value || optionDefaults.model,
    thinking: $("thinking").value,
    temperature: Number($("temperature").value),
    max_tokens: Number($("maxTokens").value),
    cfg: Number($("cfg").value),
    seed: $("seed").value === "" ? null : Number($("seed").value),
  };
}
function showOptions(o) {
  for (const [id, key] of [
    ["mode", "mode"],
    ["thinking", "thinking"],
    ["temperature", "temperature"],
    ["maxTokens", "max_tokens"],
    ["cfg", "cfg"],
    ["seed", "seed"],
  ])
    $(id).value = o[key] ?? "";
  if (![...$("chatModel").options].some((x) => x.value === o.model))
    $("chatModel").add(new Option(o.model, o.model));
  $("chatModel").value = o.model;
  updateOptions();
}
function updateOptions() {
  const model = modelCatalog.find((m) => m.key === $("chatModel").value);
  const imageMode = $("mode").value === "image";
  $("chatModel").hidden = imageMode;
  $("modeHint").classList.toggle("image-model-hint", imageMode);
  const supports = model?.architecture === "qwen3";
  $("thinking").disabled = busy || !supports;
  $("thinking").title = supports ? "" : t("模型不支持思考开关");
  if (model && !supports) $("thinking").value = "off";
  $("temperatureValue").textContent = Number($("temperature").value).toFixed(1);
  $("cfgValue").textContent = Number($("cfg").value).toFixed(1);
  $("modeHint").textContent =
    $("mode").value === "image"
      ? "Qwen Image 2.1"
      : $("mode").value === "chat"
        ? model?.display_name || $("chatModel").value
        : t("本地对话与生图");
}
async function loadModels() {
  if ($("refreshModels").disabled) return;
  $("refreshModels").disabled = true;
  $("modelStatus").textContent = t("刷新中…");
  try {
    const data = await request("/qwen-cn/models");
    modelCatalog = data.models;
    const selected = $("chatModel").value || optionDefaults.model;
    $("modelStatus").textContent = data.online
      ? t("本地模型") +
        " · " +
        modelCatalog.length +
        " " +
        (language === "en" ? "models" : "个模型")
      : t("模型离线");
    $("connectLM").hidden = data.online;
    if (data.online) {
      $("chatModel").replaceChildren();
      for (const m of [...modelCatalog].sort((a, b) =>
        a.key === "qwen3-8b"
          ? -1
          : b.key === "qwen3-8b"
            ? 1
            : a.size_bytes - b.size_bytes,
      )) {
        $("chatModel").add(
          new Option(
            (m.display_name || m.key) +
              (Number.isFinite(m.size_bytes)
                ? " · " + (m.size_bytes / 1024 ** 3).toFixed(1) + " GB"
                : ""),
            m.key,
          ),
        );
      }
      if (modelCatalog.some((m) => m.key === selected))
        $("chatModel").value = selected;
      else if (selected) {
        $("chatModel").add(new Option(selected + " · unavailable", selected));
        $("chatModel").value = selected;
      }
    }
    updateOptions();
  } catch (e) {
    $("modelStatus").textContent = t("模型离线");
    $("connectLM").hidden = false;
  } finally {
    $("refreshModels").disabled = false;
  }
}
$("refreshModels").onclick = loadModels;
$("connectLM").onclick = async () => {
  try {
    $("connectLM").disabled = true;
    await request("/qwen-cn/lm/start", json("POST", {}));
    await loadModels();
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    $("connectLM").disabled = false;
  }
};
for (const id of [
  "mode",
  "chatModel",
  "thinking",
  "temperature",
  "maxTokens",
  "cfg",
  "seed",
])
  $(id).addEventListener("input", () => {
    updateOptions();
    try {
      localStorage.setItem("hanzagent-options", JSON.stringify(readOptions()));
    } catch {}
    scheduleSave();
  });
$("prompt").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (!busy) $("form").requestSubmit();
  }
});
function watchMessage(m) {
  if (!m) {
    liveEvents?.close();
    liveEvents = null;
    liveMessageId = null;
    return;
  }
  if (liveMessageId === m.id) return;
  liveEvents?.close();
  liveMessageId = m.id;
  const events = new EventSource(`/qwen-cn/messages/${m.id}/events`);
  liveEvents = events;
  events.onmessage = (e) => {
    const updated = JSON.parse(e.data);
    if (current?.id !== updated.chat_id) return;
    const i = current.messages.findIndex((x) => x.id === updated.id);
    if (i >= 0) current.messages[i] = updated;
    render();
    if (["running", "submitting"].includes(updated.status))
      setPhase(updated.phase, updated.step, updated.total);
    else {
      events.close();
      liveMessageId = null;
      liveEvents = null;
      updateActivity();
      refresh();
      loadModels();
    }
  };
  events.onerror = () => {
    events.close();
    if (liveEvents === events) {
      liveEvents = null;
      liveMessageId = null;
    }
  };
}
async function sendTurn(overrides) {
  if (busy || submitting || chats.some((c) => c.active && c.id !== current?.id))
    return;
  const input = overrides?.prompt ?? $("prompt").value;
  if (!input.trim()) return;
  submitting = true;
  updateSendButton();
  try {
    if (!(await saveDraft())) return;
    if (!current) await newChat();
    const payload = {
      ...draft(),
      ...overrides,
      prompt: input,
      request_key: crypto.randomUUID(),
    };
    const id = current.id;
    runStart = Date.now();
    setBusy(true);
    setPhase("理解你的请求");
    document.querySelector("#form .settings").open = false;
    await request(`/qwen-cn/chats/${id}/send`, json("POST", payload));
    if (current?.id !== id) {
      await refresh();
      return;
    }
    const submitted = await request(`/qwen-cn/chats/${id}`);
    if (current?.id !== id) return;
    dirty = false;
    current = submitted;
    baseDraft = normalized(current.draft);
    showDraft(current.draft);
    await refresh();
    render(true);
  } catch (e) {
    setStatus("生成失败：" + e.message, true);
  } finally {
    submitting = false;
    updateActivity();
  }
}
function escapeHTML(text) {
  return text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function inlineMarkdown(text) {
  return escapeHTML(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}
function markdown(target, text) {
  const parts = text.split(/```([^\n`]*)\n([\s\S]*?)(?:```|$)/g);
  for (let i = 0; i < parts.length; i += 3) {
    const plain = parts[i];
    let paragraph = [], list = null;
    const flushParagraph = () => {
      if (!paragraph.length) return;
      const p = document.createElement("p");
      p.innerHTML = inlineMarkdown(paragraph.join("\n"));
      target.append(p);
      paragraph = [];
    };
    for (const line of plain.split("\n")) {
      if (!line.trim()) {
        flushParagraph();
        list = null;
        continue;
      }
      const heading = /^(#{1,4})\s+(.+)$/.exec(line);
      const item = /^\s*(?:([-*])|(\d+)[.)])\s+(.+)$/.exec(line);
      if (heading) {
        flushParagraph();
        list = null;
        const el = document.createElement("h" + Math.min(4, heading[1].length + 1));
        el.innerHTML = inlineMarkdown(heading[2]);
        target.append(el);
      } else if (item) {
        flushParagraph();
        const tag = item[2] ? "OL" : "UL";
        if (!list || list.tagName !== tag) {
          list = document.createElement(tag.toLowerCase());
          if (item[2]) list.start = Number(item[2]);
          target.append(list);
        }
        const li = document.createElement("li");
        li.innerHTML = inlineMarkdown(item[3]);
        list.append(li);
      } else {
        list = null;
        paragraph.push(line);
      }
    }
    flushParagraph();
    if (i + 2 < parts.length) {
      const block = document.createElement("div");
      block.className = "code-block";
      const label = document.createElement("span");
      label.textContent = parts[i + 1] || "code";
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "action";
      copy.textContent = t("复制");
      copy.onclick = () => copyText(parts[i + 2], copy);
      const pre = document.createElement("pre"),
        code = document.createElement("code");
      code.textContent = parts[i + 2];
      pre.append(code);
      block.append(label, copy, pre);
      target.append(block);
    }
  }
}
async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    if (button.classList.contains("message-action")) {
      messageAction(button, "check", "已复制");
      setTimeout(() => messageAction(button, "copy", "复制"), 1400);
    } else {
      button.textContent = t("已复制");
      setTimeout(() => (button.textContent = t("复制")), 1400);
    }
  } catch (e) {
    setStatus("复制失败，请选择文本后复制。", true);
  }
}
function renderAnswer(entry, m) {
  const answer = document.createElement("div");
  answer.className = "assistant-message";
  const meta = document.createElement("div");
  meta.className = "assistant-meta";
  meta.textContent =
    "HanzAgent · " +
    (modelCatalog.find((x) => x.key === m.model)?.display_name ||
      m.model ||
      "Local");
  answer.append(meta);
  if (m.reasoning) {
    const details = document.createElement("details");
    details.className = "reasoning";
    const summary = document.createElement("summary");
    summary.textContent = t("思考过程");
    const text = document.createElement("div");
    text.textContent = m.reasoning;
    details.append(summary, text);
    answer.append(details);
  }
  if (m.answer) {
    const body = document.createElement("div");
    body.className = "markdown";
    markdown(body, m.answer);
    answer.append(body);
  }
  if (["submitting", "running"].includes(m.status)) {
    const status = document.createElement("p");
    status.className = "stream-status";
    status.textContent = t(m.phase);
    answer.append(status);
  }
  if (
    m.status === "failed" ||
    m.status === "stopped" ||
    m.phase === "达到回答长度上限"
  ) {
    const status = document.createElement("p");
    status.className =
      "message-state" + (m.status === "failed" ? " error" : "");
    status.textContent = translate(m.error || m.phase);
    answer.append(status);
  }
  if (!["submitting", "running"].includes(m.status)) {
    const actions = document.createElement("div");
    actions.className = "actions";
    if (m.answer) {
      const copy = document.createElement("button");
      copy.className = "action";
      copy.type = "button";
      messageAction(copy, "copy", "复制");
      copy.onclick = () => copyText(m.answer, copy);
      actions.append(copy);
    }
    const retry = document.createElement("button");
    retry.className = "action edit-result";
    retry.type = "button";
    messageAction(retry, "retry", "重新生成");
    retry.disabled = busy;
    retry.onclick = () =>
      sendTurn({
        ...m.settings,
        prompt: m.prompt,
        reference: m.reference,
        mode: m.kind === "chat" ? "chat" : m.settings.mode,
      });
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "action edit-result";
    messageAction(edit, "edit", "编辑后重发");
    edit.disabled = busy;
    edit.onclick = () => {
      showDraft({ ...m.settings, prompt: m.prompt, reference: m.reference });
      scheduleSave();
      $("prompt").focus();
    };
    actions.append(retry, edit);
    answer.append(actions);
  }
  entry.append(answer);
}

function updateSendButton() {
  const other = chats.some((c) => c.active && c.id !== current?.id);
  $("generate").disabled =
    busy || submitting || other || !$("prompt").value.trim();
  $("generate").title = other
    ? t("另一个对话正在生成内容")
    : !$("prompt").value.trim()
      ? t("输入消息后发送")
      : "";
  $("generateLabel").textContent = t(submitting ? "正在提交…" : "发送");
}
function resizePrompt() {
  const el = $("prompt");
  el.style.height = "auto";
  el.style.height =
    Math.min(el.scrollHeight, innerHeight < 650 ? 100 : 180) + "px";
}
function updateJumpButton() {
  const el = $("chatScroll");
  $("jumpLatest").hidden =
    view !== "chat" || el.scrollHeight - el.scrollTop - el.clientHeight < 160;
}
$("chatScroll").addEventListener("scroll", updateJumpButton, { passive: true });
$("jumpLatest").onclick = () => {
  $("chatScroll").scrollTo({
    top: $("chatScroll").scrollHeight,
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "instant"
      : "smooth",
  });
};
$("mobileMenu").onclick = () => setSidebar(true);
const settings = document.querySelector(".settings"),
  settingsSummary = settings.querySelector("summary");
function closeSettings() {
  LiquidLayers.closeSettings();
}
settings.addEventListener("toggle", () => {
  document.body.classList.toggle("settings-open", settings.open);
  settingsSummary.setAttribute("aria-expanded", String(settings.open));
  if (settings.open) $("closeSettings").focus();
});
$("closeSettings").onclick = closeSettings;
$("form").addEventListener(
  "invalid",
  (e) => {
    if (settings.contains(e.target)) {
      LiquidLayers.openSettings();
      requestAnimationFrame(() => e.target.focus());
    }
  },
  true,
);
document.addEventListener("pointerdown", (e) => {
  if (settings.open && !settings.contains(e.target))
    LiquidLayers.closeSettings({ focus: false });
});
document.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.target.closest?.("dialog[open]")) return;
  if (e.key === "Escape" && settings.open) {
    e.preventDefault();
    closeSettings();
    return;
  }
  const sidebarModal =
    innerWidth <= 760 && document.body.classList.contains("sidebar-open");
  if (e.key === "Escape" && sidebarModal) {
    setSidebar(false);
    return;
  }
  const scope = sidebarModal
    ? $("sidebar")
    : settings.open
      ? $("settingsPanel")
      : null;
  if (e.key === "Tab" && scope) {
    const focusable = [
      ...scope.querySelectorAll(
        "button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),summary",
      ),
    ].filter((el) => el.getClientRects().length);
    const first = focusable[0],
      last = focusable.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});
matchMedia("(max-width:760px)").addEventListener("change", () => {
  setSidebar(false);
  settings.open = false;
});
window.addEventListener("resize", () => {
  document.querySelectorAll(".chat-row-menu:popover-open").forEach(menu => menu.hidePopover());
  syncSidebar();
  resizePrompt();
});
for (const button of document.querySelectorAll("[data-suggestion]"))
  button.onclick = () => {
    if (busy) return;
    const kind = button.dataset.suggestion;
    $("mode").value = kind;
    $("prompt").value =
      kind === "chat"
        ? language === "en"
          ? "Help me organize an idea: "
          : "帮我梳理一个想法："
        : language === "en"
          ? "Draw a quiet garden in soft morning light, as a minimalist illustration."
          : "画一座晨光中的安静花园，简洁插画，柔和色彩。";
    updateOptions();
    scheduleSave();
    $("prompt").focus();
  };
window.addEventListener("hashchange", () => {
  const hash = location.hash;
  if (hash === "#gallery" || hash === "#trash")
    setView(hash.slice(1)).catch((e) => setStatus(e.message, true));
  else {
    const id = new URLSearchParams(hash.slice(1)).get("chat");
    if (id) selectChat(id).catch((e) => setStatus(e.message, true));
  }
});
init();
