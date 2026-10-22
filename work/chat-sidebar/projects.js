/* Local project UI. All content is rendered as text; identity comes from SQLite. */
(() => {
  const tr = (zh, en) => (language === "en" ? en : zh);
  const paths = {
    folder:
      '<path d="M3 7V5a2 2 0 0 1 2-2h5l3 3h6a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 3h18"/>',
    book: '<path d="M6 3h13v18H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm-3 15a3 3 0 0 1 3-3h13"/>',
    briefcase:
      '<rect x="3" y="7" width="18" height="14" rx="3"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18"/>',
    graduation: '<path d="m2 8 10-5 10 5-10 5L2 8Zm4 3v7q6 5 12 0v-7m4-3v9"/>',
    globe:
      '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
    heart: '<path d="M12 21 3 12C-3 3 8-1 12 6 16-1 27 3 21 12Z"/>',
    lightbulb: '<path d="M9 18v-2a7 7 0 1 1 6 0v2m-6 0h6m-6 3h6M12 1V0"/>',
    chart: '<path d="M3 3v18h18M7 16v-4m5 4V6m5 10V9"/>',
    pen: '<path d="m16 3 5 5-12 12-6 1 1-6L16 3Zm-2 2 5 5"/>',
    plane: '<path d="m22 2-7 20-4-9-9-4L22 2ZM11 13 22 2"/>',
    coffee:
      '<path d="M3 8h13v8a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8Zm13 1h2a3 3 0 0 1 0 6h-2M6 2v2m4-2v2m4-2v2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    file: '<path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10l-7-7Zm0 0v7h7M8 15h8m-8 3h5"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    pin: '<path d="m8 3 8 0-1 6 4 4v2h-6v7m-2-7H5v-2l4-4-1-6Z"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6m4-6v6"/>',
    memory:
      '<path d="M9 3a4 4 0 0 0-4 4v1a4 4 0 0 0 0 8v1a4 4 0 0 0 7 3V4a3 3 0 0 0-3-1Zm6 0a4 4 0 0 1 4 4v1a4 4 0 0 1 0 8v1a4 4 0 0 1-7 3M8 8h4m0 7h4"/>',
  };
  const colors = {
    default: "currentColor",
    gray: "#8e8e93",
    blue: "#3b8ef3",
    green: "#42bb78",
    yellow: "#d9a625",
    orange: "#e89038",
    red: "#e65a5a",
    pink: "#e75da1",
    purple: "#a178e6",
  };
  let projects = [],
    detail = null,
    section = "chats",
    query = "",
    pageSignature = "";
  let expanded = new Set(),
    collapsed = false,
    modalOrigin = null,
    menuOrigin = null,
    pendingFilesProject = null;
  try {
    expanded = new Set(
      JSON.parse(localStorage.getItem("localgpt-projects-expanded") || "[]"),
    );
  } catch {}
  const el = (tag, className = "", text = "") => {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  };
  const svg = (name) =>
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    (paths[name] || paths.folder) +
    "</svg>";
  function glyph(project) {
    const node = el("span", "project-glyph");
    node.innerHTML = svg(project.icon);
    node.style.color = colors[project.color] || colors.default;
    return node;
  }
  function button(label, name, handler, className = "project-button") {
    const node = el("button", className);
    node.type = "button";
    if (name) node.innerHTML = svg(name);
    if (label) node.append(el("span", "", label));
    node.onclick = () => Promise.resolve().then(handler).catch(report);
    return node;
  }
  function iconButton(label, name, handler, className = "chrome-button") {
    const node = button("", name, handler, className);
    node.setAttribute("aria-label", label);
    node.title = label;
    return node;
  }
  function report(error) {
    const target = modal.open
      ? modal.querySelector(".project-modal-error")
      : !pane.hidden
        ? $("projectStatus")
        : null;
    if (target) {
      target.textContent = error.message || String(error);
      target.hidden = false;
    } else setStatus(error.message, true);
  }
  const pane = el("section", "project-view");
  pane.id = "projectView";
  pane.hidden = true;
  pane.innerHTML =
    '<div class="project-page"><div id="projectPageHeader"></div><div id="projectComposer"></div><div id="projectPageBody"></div><p id="projectStatus" role="status" hidden></p></div>';
  document.querySelector(".workspace").append(pane);
  const formHome = {
    parent: $("form").parentElement,
    next: $("form").nextSibling,
  };
  const breadcrumb = button(
    "",
    null,
    () => open(activeProjectId),
    "project-breadcrumb",
  );
  breadcrumb.id = "projectBreadcrumb";
  breadcrumb.hidden = true;
  document.querySelector(".chat-heading").prepend(breadcrumb);
  const modal = el("dialog", "project-dialog");
  modal.id = "projectDialog";
  document.body.append(modal);
  modal.addEventListener("close", () => {
    if (modalOrigin?.isConnected) modalOrigin.focus({ preventScroll: true });
  });
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      const b = modal.getBoundingClientRect();
      if (
        event.clientX < b.left ||
        event.clientX > b.right ||
        event.clientY < b.top ||
        event.clientY > b.bottom
      )
        modal.close();
    }
  });
  const popover = el("div", "project-menu");
  popover.id = "projectMenu";
  popover.setAttribute("popover", "auto");
  popover.setAttribute("role", "menu");
  document.body.append(popover);
  popover.addEventListener("keydown", (e) => {
    const items = [...popover.querySelectorAll("button:not(:disabled)")],
      index = items.indexOf(document.activeElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      items[
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? items.length - 1
            : (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
              items.length
      ]?.focus();
    } else if (e.key === "Escape") {
      popover.hidePopover();
      menuOrigin?.focus();
    }
  });
  function closeMenu() {
    if (popover.matches(":popover-open")) popover.hidePopover();
  }
  function showModal(title, wide = false) {
    closeMenu();
    if (modal.open) modal.close();
    modalOrigin = document.activeElement;
    modal.replaceChildren();
    modal.classList.toggle("project-dialog-wide", wide);
    const heading = el("div", "project-modal-heading"),
      h = el("h2", "", title);
    h.id = "projectDialogTitle";
    heading.append(
      h,
      iconButton(tr("关闭", "Close"), "close", () => modal.close()),
    );
    const content = el("div", "project-modal-content"),
      error = el("p", "project-modal-error");
    error.setAttribute("role", "alert");
    error.hidden = true;
    modal.append(heading, content, error);
    modal.setAttribute("aria-labelledby", h.id);
    modal.showModal();
    return content;
  }
  function field(labelText, control) {
    const label = el("label", "project-field");
    label.append(el("span", "", labelText), control);
    return label;
  }
  function footer(content, label, callback) {
    const bar = el("div", "project-modal-footer"),
      save = button(
        label,
        null,
        async () => {
          save.disabled = true;
          modal.querySelector(".project-modal-error").hidden = true;
          try {
            await callback();
          } finally {
            save.disabled = false;
          }
        },
        "project-primary",
      );
    bar.append(save);
    content.append(bar);
    return { bar, save };
  }
  const projectForChat = (id) => projects.find((p) => p.chat_ids.includes(id));
  async function refreshProjects() {
    projects = await request("/qwen-cn/projects");
    if (current && view === "chat")
      activeProjectId = projectForChat(current.id)?.id || null;
    if (detail && view === "project") {
      if (projects.some((p) => p.id === detail.id))
        detail = await request("/qwen-cn/projects/" + detail.id);
      else {
        detail = null;
        await newChat();
        report(
          new Error(
            tr("项目已移入回收站。", "This project was moved to trash."),
          ),
        );
      }
    }
  }
  async function changed() {
    await refreshProjects();
    chats = await request("/qwen-cn/chats");
    renderSidebar(true);
    refreshView(true);
    syncHeading();
  }
  function appendSidebar(list, appendChatRow) {
    const heading = el("div", "project-sidebar-heading");
    const title = button(
      tr("项目", "Projects"),
      null,
      openIndex,
      "sidebar-label project-section-link",
    );
    const collapse = iconButton(
      tr("展开或折叠项目", "Expand or collapse projects"),
      "chevron",
      () => {
        collapsed = !collapsed;
        renderSidebar(true);
      },
    );
    collapse.classList.toggle("expanded", !collapsed);
    collapse.setAttribute("aria-expanded", String(!collapsed));
    heading.append(
      title,
      collapse,
      iconButton(tr("新建项目", "New project"), "plus", () => editProject()),
    );
    list.append(heading);
    if (collapsed) return;
    for (const project of projects) {
      const row = el("div", "project-sidebar-row");
      row.dataset.projectId = project.id;
      const toggle = iconButton(
        tr("展开聊天", "Expand chats") + " · " + project.name,
        "chevron",
        () => {
          if (expanded.has(project.id)) expanded.delete(project.id);
          else expanded.add(project.id);
          try {
            localStorage.setItem(
              "localgpt-projects-expanded",
              JSON.stringify([...expanded]),
            );
          } catch {}
          renderSidebar(true);
        },
        "project-expand",
      );
      toggle.setAttribute("aria-expanded", String(expanded.has(project.id)));
      toggle.classList.toggle("expanded", expanded.has(project.id));
      const link = button(
        project.name,
        null,
        () => open(project.id),
        "project-sidebar-link",
      );
      link.prepend(glyph(project));
      link.setAttribute(
        "aria-current",
        String(
          activeProjectId === project.id &&
            (view === "chat" || view === "project"),
        ),
      );
      const menu = iconButton(
        tr("项目操作", "Project actions") + " · " + project.name,
        "more",
        () => projectMenu(project, menu),
        "chrome-button project-row-action",
      );
      const add = iconButton(
        tr("在项目中新建聊天", "New chat in project") + " · " + project.name,
        "pen",
        () => newChat(project.id),
        "chrome-button project-row-action",
      );
      row.append(toggle, link, menu, add);
      installDrop(row, project.id);
      list.append(row);
      if (expanded.has(project.id)) {
        const group = el("div", "project-sidebar-chats");
        group.setAttribute("aria-label", project.name);
        const entries = chats.filter((c) => project.chat_ids.includes(c.id));
        for (const chat of entries.slice(0, 5)) appendChatRow(chat, group);
        if (entries.length > 5)
          group.append(
            button(
              tr("显示更多", "Show more"),
              null,
              () => open(project.id),
              "project-show-more",
            ),
          );
        if (!entries.length)
          group.append(
            button(
              tr("新建聊天", "New chat"),
              "plus",
              () => newChat(project.id),
              "project-show-more",
            ),
          );
        list.append(group);
      }
    }
    if (!projects.length)
      list.append(
        button(
          tr("新建项目", "New project"),
          "folder",
          () => editProject(),
          "project-empty-sidebar",
        ),
      );
  }
  function editProject(project = null) {
    const content = showModal(
      project
        ? tr("编辑项目", "Edit project")
        : tr("创建项目", "Create project"),
    );
    const name = el("input");
    name.type = "text";
    name.maxLength = 100;
    name.placeholder = tr("哥本哈根之旅", "Copenhagen Trip");
    name.value = project?.name || "";
    name.setAttribute("aria-label", tr("项目名称", "Project name"));
    let selected = {
      icon: project?.icon || "folder",
      color: project?.color || "default",
    };
    const nameBox = el("div", "project-name-input"),
      picker = el("div", "project-icon-picker");
    picker.hidden = true;
    const choose = iconButton(
      tr("更改图标和颜色", "Change icon and color"),
      "folder",
      () => {
        picker.hidden = !picker.hidden;
        choose.setAttribute("aria-expanded", String(!picker.hidden));
      },
    );
    const update = () => {
      choose.replaceChildren(glyph(selected));
      picker
        .querySelectorAll("[data-icon]")
        .forEach((b) =>
          b.setAttribute(
            "aria-pressed",
            String(b.dataset.icon === selected.icon),
          ),
        );
      picker
        .querySelectorAll("[data-color]")
        .forEach((b) =>
          b.setAttribute(
            "aria-pressed",
            String(b.dataset.color === selected.color),
          ),
        );
    };
    const palette = el("div", "project-colors");
    for (const [color, value] of Object.entries(colors)) {
      const b = iconButton(
        color,
        "",
        () => {
          selected.color = color;
          update();
        },
        "project-swatch",
      );
      b.replaceChildren();
      b.style.setProperty("--swatch", value);
      b.dataset.color = color;
      palette.append(b);
    }
    const icons = el("div", "project-icons");
    for (const name of Object.keys(paths).slice(0, 12)) {
      const b = iconButton(name, name, () => {
        selected.icon = name;
        update();
      });
      b.dataset.icon = name;
      icons.append(b);
    }
    picker.append(palette, icons);
    update();
    nameBox.append(choose, name);
    content.append(field(tr("项目名称", "Project name"), nameBox), picker);
    if (!project) {
      const note = el("div", "project-create-note");
      note.innerHTML = svg("lightbulb");
      note.append(
        el(
          "p",
          "",
          tr(
            "项目将聊天、文件和自定义指令集中在一起。用它推进长期工作，或让一切井井有条。",
            "Projects keep chats, files, and custom instructions in one place. Use them for ongoing work, or just to keep things tidy.",
          ),
        ),
      );
      content.append(note);
    }
    const mode = el("select", "project-memory-select");
    mode.setAttribute("aria-label", tr("记忆范围", "Memory scope"));
    for (const [value, label] of [
      ["default", tr("默认记忆", "Default memory")],
      ["project-only", tr("仅项目记忆", "Project-only memory")],
    ]) {
      const o = el("option", "", label);
      o.value = value;
      mode.append(o);
    }
    mode.value = project?.memory_mode || "default";
    mode.disabled = !!project;
    const help = el("p", "project-memory-help");
    const updateHelp = () => {
      help.textContent =
        mode.value === "project-only"
          ? tr(
              "仅使用此项目的聊天、文件和专属记忆。创建后无法更改。",
              "Uses only this project’s chats, files and saved memories. Cannot be changed after creation.",
            )
          : tr(
              "使用全局已保存记忆，以及此项目的聊天和文件。",
              "Uses your saved memories, plus chats and files in this project.",
            );
    };
    mode.onchange = updateHelp;
    updateHelp();
    const { bar, save } = footer(
      content,
      project ? tr("保存", "Save") : tr("创建项目", "Create project"),
      async () => {
        const data = { name: name.value.trim(), ...selected };
        const saved = await request(
          "/qwen-cn/projects" + (project ? "/" + project.id : ""),
          json(
            project ? "PATCH" : "POST",
            project
              ? { ...data, version: project.version }
              : { ...data, memory_mode: mode.value },
          ),
        );
        modal.close();
        expanded.add(saved.id);
        await refreshProjects();
        await open(saved.id);
      },
    );
    bar.prepend(mode);
    content.append(help);
    name.oninput = () => {
      save.disabled = !name.value.trim();
    };
    name.oninput();
    name.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !save.disabled) {
        e.preventDefault();
        save.click();
      }
    });
    name.focus();
  }
  async function open(id) {
    const version = ++navigationVersion;
    if (!(await saveDraft()) || version !== navigationVersion) return;
    await window.AppShell?.leaveSettingsForNavigation?.();
    let fresh;
    try {
      fresh = await request("/qwen-cn/projects/" + id);
    } catch (error) {
      if (version !== navigationVersion) return;
      if (error.status !== 404) throw error;
      await openIndex();
      report(
        new Error(
          tr(
            "此项目不存在或已移入回收站。",
            "This project is missing or in trash.",
          ),
        ),
      );
      return;
    }
    if (version !== navigationVersion) return;
    const draftChat = fresh.chats.find((c) => c.count === 0);
    const saved = draftChat
      ? await request("/qwen-cn/chats/" + draftChat.id)
      : null;
    if (version !== navigationVersion) return;
    detail = fresh;
    section = "chats";
    query = "";
    activeProjectId = id;
    current = saved;
    dirty = false;
    conflict = null;
    $("draftConflict").hidden = true;
    baseDraft = normalized(saved?.draft);
    showDraft(saved?.draft);
    setSave("");
    setStatus("");
    $("projectStatus").hidden = true;
    view = "project";
    showView();
    updateActivity();
    history.replaceState(null, "", "#project=" + encodeURIComponent(id));
    expanded.add(id);
    renderSidebar(true);
    refreshView(true);
    if (innerWidth <= 760) setSidebar(false);
  }
  async function openIndex() {
    const version = ++navigationVersion;
    if (!(await saveDraft()) || version !== navigationVersion) return;
    await window.AppShell?.leaveSettingsForNavigation?.();
    await refreshProjects();
    if (version !== navigationVersion) return;
    view = "projects";
    query = "";
    showView();
    $("projectStatus").hidden = true;
    history.replaceState(null, "", "#projects");
    renderSidebar(true);
    refreshView(true);
    if (innerWidth <= 760) setSidebar(false);
  }
  function syncHeading() {
    const project = projects.find((p) => p.id === activeProjectId);
    breadcrumb.hidden = !(view === "chat" && project);
    if (!breadcrumb.hidden) {
      breadcrumb.replaceChildren(glyph(project), el("span", "", project.name));
    }
    if (view === "project" || view === "projects") {
      $("chatTitle").hidden = true;
      document.title =
        (detail && view === "project" ? detail.name : tr("项目", "Projects")) +
        " · LocalGPT";
    }
  }
  function syncView() {
    pane.hidden = !["project", "projects"].includes(view);
    document.body.classList.toggle("project-surface", !pane.hidden);
    if (view === "project" && detail) {
      $("projectComposer").append($("form"));
      $("form").hidden = section !== "chats";
      $("intro").hidden = true;
    } else if ($("form").parentElement !== formHome.parent)
      formHome.parent.insertBefore($("form"), formHome.next);
    syncHeading();
  }
  function refreshView(force = false) {
    if (!["project", "projects"].includes(view)) return;
    const signature = JSON.stringify([
      view,
      detail,
      projects,
      section,
      language,
    ]);
    if (!force && signature === pageSignature) return;
    pageSignature = signature;
    const header = $("projectPageHeader"),
      body = $("projectPageBody");
    header.replaceChildren();
    body.replaceChildren();
    if (view === "projects") {
      const row = el("div", "project-page-heading");
      row.append(
        el("h1", "", tr("项目", "Projects")),
        button(
          tr("新建项目", "New project"),
          "plus",
          () => editProject(),
          "project-primary",
        ),
      );
      header.append(row);
      const tools = el("div", "project-index-tools");
      const search = el("input", "project-search");
      search.type = "search";
      search.value = query;
      search.placeholder = tr("搜索项目", "Search projects");
      search.setAttribute("aria-label", search.placeholder);
      tools.append(
        search,
        button(tr("已删除项目", "Deleted projects"), "trash", showTrash),
      );
      header.append(tools);
      const grid = el("div", "project-grid");
      body.append(grid);
      const draw = () => {
        grid.replaceChildren();
        for (const p of projects.filter((p) =>
          p.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
        )) {
          const card = el("div", "project-card");
          const main = button(
            p.name,
            null,
            () => open(p.id),
            "project-card-open",
          );
          main.prepend(glyph(p));
          const menu = iconButton(
            tr("项目操作", "Project actions") + " · " + p.name,
            "more",
            () => projectMenu(p, menu),
          );
          card.append(
            main,
            el(
              "p",
              "",
              p.chat_ids.length +
                " " +
                tr("个聊天", "chats") +
                " · " +
                p.source_count +
                " " +
                tr("个来源", "sources"),
            ),
            menu,
          );
          installDrop(card, p.id);
          grid.append(card);
        }
        if (!grid.children.length)
          grid.append(
            el(
              "p",
              "project-empty",
              projects.length
                ? tr("未找到项目", "No projects found")
                : tr(
                    "将聊天、文件和指令放进同一个项目。",
                    "Keep chats, files, and instructions together in a project.",
                  ),
            ),
          );
      };
      search.oninput = () => {
        query = search.value;
        draw();
      };
      draw();
    } else if (detail) {
      const row = el("div", "project-page-heading"),
        h = el("h1");
      h.append(glyph(detail), el("span", "", detail.name));
      const actions = el("div", "project-heading-actions");
      const more = iconButton(tr("项目操作", "Project actions"), "more", () =>
        projectMenu(detail, more),
      );
      actions.append(
        button(tr("添加文件", "Add files"), "plus", () =>
          chooseFiles(detail.id),
        ),
        more,
      );
      row.append(h, actions);
      header.append(row);
      const instructions = button(
        detail.instructions
          ? tr("编辑指令", "Edit instructions")
          : tr("添加指令", "Add instructions"),
        "pen",
        () => editInstructions(detail),
        "project-instructions-link",
      );
      header.append(instructions);
      const tabs = el("div", "project-tabs");
      tabs.setAttribute("role", "tablist");
      tabs.setAttribute("aria-label", tr("项目内容", "Project contents"));
      for (const [key, label] of [
        ["chats", tr("聊天", "Chats")],
        ["sources", tr("来源", "Sources")],
      ]) {
        const b = button(
          label +
            (key === "sources" && detail.sources.length
              ? " " + detail.sources.length
              : ""),
          null,
          () => {
            section = key;
            query = "";
            refreshView(true);
            syncView();
          },
          "project-tab",
        );
        b.id = "projectTab-" + key;
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", String(section === key));
        b.setAttribute("aria-controls", "projectTabPanel");
        b.tabIndex = section === key ? 0 : -1;
        b.onkeydown = (e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            section = key === "chats" ? "sources" : "chats";
            refreshView(true);
            syncView();
            $("projectTab-" + section).focus();
          }
        };
        tabs.append(b);
      }
      body.append(tabs);
      const content = el("div", "project-tab-panel");
      content.id = "projectTabPanel";
      content.setAttribute("role", "tabpanel");
      content.setAttribute("aria-labelledby", "projectTab-" + section);
      body.append(content);
      if (section === "chats") renderChats(content);
      else renderSources(content);
    }
    syncView();
  }
  function renderChats(target) {
    const tools = el("div", "project-list-tools"),
      search = el("input", "project-search");
    search.type = "search";
    search.value = query;
    search.placeholder = tr(
      "搜索此项目中的聊天",
      "Search chats in this project",
    );
    search.setAttribute("aria-label", search.placeholder);
    tools.append(
      search,
      button(tr("新建聊天", "New chat"), "pen", () => newChat(detail.id)),
    );
    target.append(tools);
    const list = el("div", "project-chat-list");
    target.append(list);
    let searchToken = 0,
      searchTimer;
    const draw = (rows = detail.chats) => {
      list.replaceChildren();
      for (const chat of rows) {
        const row = el("div", "project-chat-row");
        const link = button(
          chat.title,
          null,
          () => selectChat(chat.id),
          "project-chat-link",
        );
        if (chat.preview)
          link.append(el("span", "project-chat-preview", chat.preview));
        link.append(
          el(
            "small",
            "",
            chat.count +
              " " +
              tr("条消息", chat.count === 1 ? "message" : "messages") +
              " · " +
              new Date(chat.updated * 1000).toLocaleDateString(
                language === "en" ? "en-US" : "zh-CN",
                { month: "short", day: "numeric" },
              ),
          ),
        );
        const more = iconButton(
          tr("对话操作", "Chat actions") + " · " + chat.title,
          "more",
          () => chatMenu(chat, more),
        );
        row.append(link, more);
        makeDraggable(row, chat);
        list.append(row);
      }
      if (!rows.length) {
        const empty = el("div", "project-empty");
        empty.append(
          el(
            "h3",
            "",
            query
              ? tr("未找到聊天", "No chats found")
              : tr(
                  "开启项目的第一段对话",
                  "Start your first chat in this project",
                ),
          ),
          el(
            "p",
            "",
            tr(
              "此处的聊天可以使用项目文件和指令。",
              "Chats here can use this project’s files and instructions.",
            ),
          ),
        );
        list.append(empty);
      }
    };
    search.oninput = () => {
      query = search.value;
      clearTimeout(searchTimer);
      const token = ++searchToken;
      searchTimer = setTimeout(async () => {
        try {
          const rows = await request(
            "/qwen-cn/projects/" +
              detail.id +
              "/search?q=" +
              encodeURIComponent(query),
          );
          if (token === searchToken && list.isConnected) draw(rows);
        } catch (error) {
          report(error);
        }
      }, 180);
    };
    if (query) search.oninput();
    else draw();
  }
  function renderSources(target) {
    const tools = el("div", "project-list-tools");
    tools.append(
      el(
        "p",
        "project-muted",
        tr(
          "此项目中的所有聊天都可以使用这些来源。",
          "Available to every chat in this project.",
        ),
      ),
      button(tr("添加来源", "Add source"), "plus", () =>
        sourceChoices(detail.id),
      ),
    );
    target.append(tools);
    for (const source of detail.sources) {
      const row = el("div", "project-source-row"),
        openButton = button(
          source.name,
          "file",
          () => previewSource(detail.id, source.id),
          "project-source-open",
        );
      openButton.append(
        el(
          "small",
          "",
          Math.max(1, Math.ceil(source.size / 1024)) +
            " KB · " +
            (source.kind === "note"
              ? tr("笔记", "Note")
              : source.name.split(".").pop().toUpperCase()),
        ),
      );
      row.append(
        openButton,
        iconButton(
          tr("移除来源", "Remove source") + " · " + source.name,
          "close",
          () => removeSource(detail.id, source),
        ),
      );
      target.append(row);
    }
    if (!detail.sources.length) {
      const empty = el("div", "project-empty project-source-empty");
      empty.innerHTML = svg("file");
      empty.append(
        el("h3", "", tr("为项目添加知识", "Give your project context")),
        el(
          "p",
          "",
          tr(
            "上传文件或粘贴文字，让每段对话从同一份资料出发。",
            "Upload files or paste text to give every chat the same context.",
          ),
        ),
        button(tr("添加来源", "Add source"), "plus", () =>
          sourceChoices(detail.id),
        ),
      );
      target.append(empty);
    }
    target.append(
      button(
        tr("已移除的来源", "Removed sources"),
        null,
        () => removedSources(detail.id),
        "project-text-link",
      ),
    );
  }
  function showMenu(origin, items) {
    closeMenu();
    menuOrigin = origin;
    popover.replaceChildren();
    for (const [label, name, handler, danger] of items) {
      const b = button(label, name, () => {
        closeMenu();
        return handler();
      });
      b.setAttribute("role", "menuitem");
      if (danger) b.classList.add("danger-link");
      popover.append(b);
    }
    popover.showPopover();
    const anchor = origin.getBoundingClientRect(),
      box = popover.getBoundingClientRect();
    popover.style.left =
      Math.max(
        8,
        Math.min(anchor.right - box.width, innerWidth - box.width - 8),
      ) + "px";
    popover.style.top =
      Math.max(8, Math.min(anchor.bottom + 6, innerHeight - box.height - 8)) +
      "px";
    popover.querySelector("button")?.focus();
  }
  async function projectMenu(project, origin) {
    const fresh = await request("/qwen-cn/projects/" + project.id);
    showMenu(origin, [
      [tr("打开项目", "Open project"), "folder", () => open(fresh.id)],
      [tr("新建聊天", "New chat"), "pen", () => newChat(fresh.id)],
      [tr("编辑项目", "Edit project"), "pen", () => editProject(fresh)],
      [
        tr("项目指令", "Project instructions"),
        "file",
        () => editInstructions(fresh),
      ],
      [tr("项目记忆", "Project memory"), "memory", () => showMemory(fresh)],
      [
        fresh.pinned
          ? tr("取消固定", "Unpin project")
          : tr("固定项目", "Pin project"),
        "pin",
        async () => {
          await request(
            "/qwen-cn/projects/" + fresh.id,
            json("PATCH", { version: fresh.version, pinned: !fresh.pinned }),
          );
          await changed();
        },
      ],
      [
        tr("删除项目", "Delete project"),
        "trash",
        () => deleteProject(fresh),
        true,
      ],
    ]);
  }
  async function editInstructions(project) {
    const fresh = await request("/qwen-cn/projects/" + project.id),
      content = showModal(tr("项目指令", "Project instructions"));
    content.append(
      el(
        "p",
        "project-muted",
        tr(
          "LocalGPT 在此项目中应该如何回答？这些指令会应用到项目中的每段聊天。",
          "How should LocalGPT respond in this project? These instructions apply to every chat in the project.",
        ),
      ),
    );
    const text = el("textarea", "project-instructions-input");
    text.rows = 9;
    text.maxLength = 4000;
    text.value = fresh.instructions;
    text.placeholder = tr(
      "例如：用中文回答。先给结论，并引用项目来源。",
      "For example: Be concise. Lead with the answer and cite project sources.",
    );
    text.setAttribute("aria-label", tr("项目指令", "Project instructions"));
    content.append(text);
    const count = el("small", "project-character-count");
    const updateCount = () => {
      count.textContent = text.value.length + " / 4000";
    };
    text.oninput = updateCount;
    updateCount();
    content.append(count);
    footer(content, tr("保存", "Save"), async () => {
      await request(
        "/qwen-cn/projects/" + fresh.id,
        json("PATCH", { version: fresh.version, instructions: text.value }),
      );
      modal.close();
      await changed();
    });
    text.focus();
  }
  function deleteProject(project) {
    const content = showModal(tr("删除项目？", "Delete project?"));
    content.append(
      el("p", "", project.name),
      el(
        "p",
        "project-muted",
        tr(
          "项目及其中的聊天将移入回收站。文件和记忆会保留，可在「项目 → 已删除项目」一起恢复。",
          "This project and its chats will move to trash. Files and memories are retained. Restore them from Projects → Deleted projects.",
        ),
      ),
    );
    const { bar, save } = footer(
      content,
      tr("删除项目", "Delete project"),
      async () => {
        await request(
          "/qwen-cn/projects/" + project.id,
          json("DELETE", { version: project.version, confirm: true }),
        );
        modal.close();
        if (activeProjectId === project.id) {
          dirty = false;
          current = null;
          activeProjectId = null;
          showDraft({});
          detail = null;
          await openIndex();
        }
        await changed();
      },
    );
    save.classList.add("project-danger");
    bar.prepend(button(tr("取消", "Cancel"), null, () => modal.close()));
  }
  async function showTrash() {
    const deleted = await request("/qwen-cn/projects?deleted=true"),
      content = showModal(tr("已删除项目", "Deleted projects"));
    if (!deleted.length)
      content.append(
        el("p", "project-empty", tr("没有已删除项目", "No deleted projects")),
      );
    for (const project of deleted) {
      const row = el("div", "project-restore-row");
      row.append(
        glyph(project),
        el("span", "", project.name),
        button(tr("恢复", "Restore"), null, async () => {
          await request(
            "/qwen-cn/projects/" + project.id + "/restore",
            json("POST", { version: project.version }),
          );
          modal.close();
          await changed();
          await open(project.id);
        }),
      );
      content.append(row);
    }
  }
  function sourceChoices(projectId) {
    const content = showModal(tr("添加来源", "Add source"));
    content.append(
      button(
        tr("上传文件", "Upload files"),
        "file",
        () => {
          modal.close();
          chooseFiles(projectId);
        },
        "project-source-choice",
      ),
      button(
        tr("粘贴文字", "Paste text"),
        "pen",
        () => noteSource(projectId),
        "project-source-choice",
      ),
      el(
        "p",
        "project-muted",
        tr(
          "PDF、DOCX、文本、Markdown、CSV 和代码 · 每个文件最多 10 MB。扫描 PDF 需要先 OCR。",
          "PDF, DOCX, text, Markdown, CSV and code · Up to 10 MB each. Scanned PDFs require OCR.",
        ),
      ),
    );
  }
  const uploadInput = el("input");
  uploadInput.type = "file";
  uploadInput.multiple = true;
  uploadInput.hidden = true;
  uploadInput.id = "projectFileInput";
  uploadInput.accept =
    ".pdf,.docx,.txt,.md,.csv,.tsv,.json,.py,.js,.ts,.html,.css,.yaml,.yml,.xml,.log,.sql,.tex";
  document.body.append(uploadInput);
  function chooseFiles(projectId) {
    pendingFilesProject = projectId;
    uploadInput.value = "";
    uploadInput.click();
  }
  uploadInput.onchange = () =>
    uploadSources(pendingFilesProject, [...uploadInput.files]).catch(report);
  async function uploadSources(projectId, files) {
    const status = $("projectStatus");
    status.hidden = false;
    const failures = [];
    for (const file of files) {
      status.textContent = tr("正在读取 ", "Reading ") + file.name;
      try {
        const data = new FormData();
        data.append("file", file);
        await request("/qwen-cn/projects/" + projectId + "/sources", {
          method: "POST",
          body: data,
        });
      } catch (error) {
        failures.push(file.name + ": " + error.message);
      }
    }
    await changed();
    status.hidden = false;
    status.textContent = failures.length
      ? failures.join("\n")
      : tr("已添加到项目来源。", "Added to project sources.");
    if (detail?.id === projectId && view === "project") {
      section = "sources";
      refreshView(true);
    }
  }
  function noteSource(projectId, initial = "", title = "") {
    const content = showModal(tr("添加文字来源", "Add text source"));
    const name = el("input");
    name.maxLength = 170;
    name.value = title;
    name.placeholder = tr("来源标题", "Source title");
    name.setAttribute("aria-label", name.placeholder);
    const text = el("textarea", "project-instructions-input");
    text.rows = 10;
    text.maxLength = 200000;
    text.value = initial;
    text.setAttribute("aria-label", tr("来源内容", "Source content"));
    text.placeholder = tr(
      "在这里粘贴资料…",
      "Paste your reference material here…",
    );
    content.append(
      field(tr("标题", "Title"), name),
      field(tr("内容", "Content"), text),
    );
    const { save } = footer(
      content,
      tr("添加到项目", "Add to project"),
      async () => {
        await request(
          "/qwen-cn/projects/" + projectId + "/sources",
          json("POST", { name: name.value.trim(), text: text.value }),
        );
        modal.close();
        await changed();
      },
    );
    const validate = () => {
      save.disabled = !name.value.trim() || !text.value.trim();
    };
    name.oninput = text.oninput = validate;
    validate();
    name.focus();
  }
  async function previewSource(projectId, sourceId) {
    const source = await request(
        "/qwen-cn/projects/" + projectId + "/sources/" + sourceId,
      ),
      content = showModal(source.name, true);
    const meta = el("div", "project-source-meta");
    meta.append(
      el("span", "project-muted", tr("提取文字预览", "Extracted text preview")),
    );
    const download = el(
      "a",
      "project-button",
      tr("下载原文件", "Download original"),
    );
    download.href =
      "/qwen-cn/projects/" + projectId + "/sources/" + sourceId + "/download";
    download.download = source.name;
    meta.append(download);
    content.append(meta, el("pre", "project-source-preview", source.text));
  }
  async function removeSource(projectId, source) {
    await request(
      "/qwen-cn/projects/" + projectId + "/sources/" + source.id,
      json("DELETE", {}),
    );
    await changed();
    const status = $("projectStatus");
    status.hidden = false;
    status.replaceChildren(
      el("span", "", tr("已移除来源。", "Source removed.")),
      button(tr("撤销", "Undo"), null, async () => {
        await request(
          "/qwen-cn/projects/" +
            projectId +
            "/sources/" +
            source.id +
            "/restore",
          json("POST", {}),
        );
        await changed();
        status.hidden = true;
      }),
    );
  }
  async function removedSources(projectId) {
    const sources = await request(
        "/qwen-cn/projects/" + projectId + "/sources?deleted=true",
      ),
      content = showModal(tr("已移除的来源", "Removed sources"));
    if (!sources.length)
      content.append(
        el("p", "project-empty", tr("没有已移除来源", "No removed sources")),
      );
    for (const source of sources) {
      const row = el("div", "project-restore-row");
      row.append(
        el("span", "", source.name),
        button(tr("恢复", "Restore"), null, async () => {
          await request(
            "/qwen-cn/projects/" +
              projectId +
              "/sources/" +
              source.id +
              "/restore",
            json("POST", {}),
          );
          modal.close();
          await changed();
        }),
      );
      content.append(row);
    }
  }
  async function showMemory(project) {
    const snapshot = await request(
        "/qwen-cn/projects/" + project.id + "/memory",
      ),
      content = showModal(tr("项目记忆", "Project memory"));
    content.append(
      el(
        "p",
        "project-muted",
        project.memory_mode === "project-only"
          ? tr(
              "仅项目记忆：保存的记忆不会出现在其他项目或普通聊天中。相关的项目内聊天也会作为上下文。",
              "Project-only memory: saved memories stay inside this project. Related project chats can also provide context.",
            )
          : tr(
              "默认记忆：使用全局已保存记忆和相关的项目内聊天。",
              "Default memory: uses global saved memories and related project chats.",
            ),
      ),
    );
    if (project.memory_mode === "project-only") {
      const label = el("label", "project-memory-toggle"),
        toggle = el("input");
      toggle.type = "checkbox";
      toggle.checked = snapshot.preferences?.enabled !== false;
      label.append(
        el(
          "span",
          "",
          tr(
            "使用项目记忆和相关聊天",
            "Use project memories and related chats",
          ),
        ),
        toggle,
      );
      content.append(label);
      toggle.onchange = async () => {
        toggle.disabled = true;
        try {
          await request(
            "/qwen-cn/projects/" + project.id + "/memory/preferences",
            json("PATCH", {
              enabled: toggle.checked,
              preferences_version: snapshot.preferences_version,
            }),
          );
          await showMemory(project);
        } catch (error) {
          toggle.checked = !toggle.checked;
          report(error);
          toggle.disabled = false;
        }
      };
    }
    const items = snapshot.items || snapshot.memories || [];
    if (!items.length)
      content.append(
        el(
          "p",
          "project-empty",
          tr(
            "还没有已保存的记忆。你可以在项目聊天中说「记住：…」。",
            "No saved memories yet. Say “Remember: …” in a project chat.",
          ),
        ),
      );
    for (const item of items) {
      const row = el("div", "project-memory-row");
      row.append(el("p", "", item.content));
      if (project.memory_mode === "project-only")
        row.append(
          button(tr("删除", "Delete"), null, async () => {
            await request(
              "/qwen-cn/projects/" + project.id + "/memory/" + item.id,
              json("DELETE", { version: item.version }),
            );
            await showMemory(project);
          }),
        );
      content.append(row);
    }
    if (project.memory_mode === "default")
      content.append(
        button(tr("管理全局记忆", "Manage saved memories"), null, () => {
          modal.close();
          window.AppShell?.openMemory?.();
        }),
      );
  }
  async function chooseProject(title, callback, allowOutside = false) {
    await refreshProjects();
    const content = showModal(title),
      search = el("input", "project-search");
    search.type = "search";
    search.placeholder = tr("搜索项目", "Search projects");
    search.setAttribute("aria-label", search.placeholder);
    content.append(search);
    const list = el("div", "project-picker-list");
    content.append(list);
    const draw = () => {
      list.replaceChildren();
      if (allowOutside)
        list.append(
          button(tr("移出项目", "Remove from project"), "folder", () =>
            callback(null),
          ),
        );
      for (const project of projects.filter((p) =>
        p.name.toLowerCase().includes(search.value.toLowerCase()),
      )) {
        const b = button(project.name, null, () => callback(project.id));
        b.prepend(glyph(project));
        list.append(b);
      }
      if (!projects.length)
        list.append(
          button(
            tr("先创建一个项目", "Create your first project"),
            "plus",
            () => editProject(),
          ),
        );
    };
    search.oninput = draw;
    draw();
    search.focus();
  }
  async function moveChat(chat, projectId) {
    if (chat.id === current?.id && !(await saveDraft())) return;
    const membership = await request("/qwen-cn/chats/" + chat.id + "/project");
    if (membership.project_id === projectId) {
      modal.close();
      return;
    }
    await request(
      "/qwen-cn/chats/" + chat.id + "/project",
      json("PATCH", { project_id: projectId, version: membership.version }),
    );
    if (modal.open) modal.close();
    if (chat.id === current?.id) activeProjectId = projectId;
    await changed();
    syncHeading();
    render(true);
  }
  async function chooseMove(chat) {
    await chooseProject(
      tr("移动对话", "Move chat"),
      async (id) => {
        const old = projectForChat(chat.id);
        if (old?.memory_mode === "project-only" && old.id !== id) {
          const content = showModal(tr("移动此对话？", "Move this chat?"));
          content.append(
            el(
              "p",
              "project-muted",
              tr(
                "对话内容将进入目标上下文，原项目的专属记忆不会随之移动。",
                "The transcript will enter the destination context. The original project’s saved memories will stay in that project.",
              ),
            ),
          );
          footer(content, tr("移动", "Move"), () => moveChat(chat, id));
        } else await moveChat(chat, id);
      },
      !!projectForChat(chat.id),
    );
  }
  function extendChatMenu(menu, chat) {
    const move = button(tr("移动到项目", "Move to project"), "folder", () => {
      menu.hidePopover();
      return chooseMove(chat);
    });
    move.setAttribute("role", "menuitem");
    move.disabled = !!chat.active;
    menu.insertBefore(move, menu.lastElementChild);
  }
  function chatMenu(chat, origin) {
    showMenu(origin, [
      [tr("打开聊天", "Open chat"), "pen", () => selectChat(chat.id)],
      [tr("移动到项目", "Move to project"), "folder", () => chooseMove(chat)],
      [
        tr("重命名", "Rename"),
        "pen",
        async () => {
          await selectChat(chat.id);
          $("renameChat").click();
        },
      ],
      [
        tr("删除聊天", "Delete chat"),
        "trash",
        async () => {
          await deleteChat(chat.id);
          await changed();
        },
        true,
      ],
    ]);
  }
  function makeDraggable(row, chat) {
    row.draggable = !chat.active;
    row.addEventListener("dragstart", (e) => {
      if (e.target.closest("button")?.classList.contains("chat-menu-trigger")) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData("application/x-localgpt-chat", chat.id);
      e.dataTransfer.effectAllowed = "move";
    });
  }
  function installDrop(target, projectId) {
    target.addEventListener("dragover", (e) => {
      if (e.dataTransfer.types.includes("application/x-localgpt-chat")) {
        e.preventDefault();
        target.classList.add("project-drop-target");
      }
    });
    target.addEventListener("dragleave", () =>
      target.classList.remove("project-drop-target"),
    );
    target.addEventListener("drop", (e) => {
      target.classList.remove("project-drop-target");
      const chat = chats.find(
        (c) => c.id === e.dataTransfer.getData("application/x-localgpt-chat"),
      );
      if (!chat) return;
      e.preventDefault();
      if (projectForChat(chat.id)?.memory_mode === "project-only")
        chooseMove(chat).catch(report);
      else moveChat(chat, projectId).catch(report);
    });
  }
  pane.addEventListener("dragover", (e) => {
    if (view === "project" && e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      pane.classList.add("project-files-drop");
    }
  });
  pane.addEventListener("dragleave", (e) => {
    if (!pane.contains(e.relatedTarget))
      pane.classList.remove("project-files-drop");
  });
  pane.addEventListener("drop", (e) => {
    pane.classList.remove("project-files-drop");
    if (view === "project" && detail && e.dataTransfer.files.length) {
      e.preventDefault();
      uploadSources(detail.id, [...e.dataTransfer.files]).catch(report);
    }
  });
  function extendAnswer(actions, message) {
    if (message.answer) {
      const save = iconButton(
        tr("保存到项目来源", "Save to project sources"),
        "folder",
        () =>
          chooseProject(tr("保存到项目来源", "Save to project sources"), (id) =>
            noteSource(id, message.answer, message.prompt.slice(0, 80)),
          ),
        "action message-action",
      );
      actions.append(save);
    }
    const used = message.memory?.project;
    if (used && (used.source_ids.length || used.chat_ids.length)) {
      const badge = button(
        tr("项目上下文", "Project context"),
        "file",
        async () => {
          const p = await request("/qwen-cn/projects/" + used.id);
          const content = showModal(
            tr(
              "本轮使用的项目上下文",
              "Project context used for this response",
            ),
          );
          for (const id of used.source_ids) {
            const source = p.sources.find((s) => s.id === id);
            content.append(
              source
                ? button(source.name, "file", () => previewSource(used.id, id))
                : el(
                    "p",
                    "project-muted",
                    tr("一个来源已被移除", "A source has been removed"),
                  ),
            );
          }
          for (const id of used.chat_ids) {
            const chat = p.chats.find((c) => c.id === id);
            if (chat)
              content.append(
                button(chat.title, "pen", () => {
                  modal.close();
                  return selectChat(id);
                }),
              );
          }
        },
        "project-context-badge",
      );
      actions.append(badge);
    }
  }
  function prepareRemember(control, message) {
    const project = projects.find((p) => p.id === activeProjectId);
    if (project?.memory_mode !== "project-only") return;
    LocalMessageActions.configureAction(
      control,
      "memory",
      tr("保存为项目记忆", "Save as project memory"),
    );
    control.onclick = () => {
      const content = showModal(tr("保存为项目记忆", "Save as project memory")),
        text = el("textarea", "project-instructions-input");
      text.rows = 5;
      text.maxLength = 1000;
      text.value = message.prompt;
      text.setAttribute("aria-label", tr("记忆内容", "Memory content"));
      content.append(
        el(
          "p",
          "project-muted",
          tr(
            "这条记忆仅用于此项目。请确认要记住的内容。",
            "This memory stays inside this project. Review the content to remember.",
          ),
        ),
        text,
      );
      footer(content, tr("保存", "Save"), async () => {
        await request(
          "/qwen-cn/projects/" + project.id + "/memory",
          json("POST", { content: text.value, message_id: message.id }),
        );
        await showMemory(project);
      });
      text.focus();
    };
  }
  const moveCurrent = button(
    tr("移动到项目", "Move to project"),
    "folder",
    () => current && chooseMove(current),
  );
  moveCurrent.id = "moveChatToProject";
  moveCurrent.setAttribute("role", "menuitem");
  $("chatActionsMenu").insertBefore(moveCurrent, $("deleteCurrent"));
  window.addEventListener("hanzlanguage", () => {
    moveCurrent.querySelector("span").textContent = tr(
      "移动到项目",
      "Move to project",
    );
    renderSidebar(true);
    refreshView(true);
    syncHeading();
  });
  window.ProjectWorkspace = {
    appendSidebar,
    projectForChat,
    refresh: refreshProjects,
    open,
    openIndex,
    syncView,
    syncHeading,
    refreshView,
    extendChatMenu,
    extendAnswer,
    prepareRemember,
    makeDraggable,
    signature: () => JSON.stringify([projects, [...expanded], collapsed]),
    chatCreated: (chat, id) => {
      const p = projects.find((p) => p.id === id);
      if (p && !p.chat_ids.includes(chat.id)) p.chat_ids.unshift(chat.id);
    },
  };
})();
