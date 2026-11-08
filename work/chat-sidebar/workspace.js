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
            "LocalGPT 是一款在本机运行的创作与对话工具。数据保存在你的设备上，不会上传到第三方云服务。",
            "LocalGPT is a local creative and chat workspace. Your data stays on this device and is not uploaded to third-party clouds.",
          )}</p>
          <p class="settings-about-copy">${tr(
            "本项目为社区/个人作品，与任何商业聊天或 AI 产品无官方隶属或背书关系。界面布局仅作体验参考，不代表合作或授权。",
            "This project is an independent local app. It is not affiliated with, endorsed by, or officially related to any commercial chat or AI product. Layout references are for UX only.",
          )}</p>
          <p class="settings-about-copy" id="settingsBuildIdentity"></p>
          <p class="settings-about-copy" id="settingsServerIdentity" aria-live="polite"></p>
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
          <div class="settings-row"><span class="settings-row-label">LM Studio</span><span class="settings-diagnostics-value" id="settingsLMStatus">—</span></div>
          <div class="settings-row"><span class="settings-row-label">ComfyUI</span><span class="settings-diagnostics-value" id="settingsComfyStatus">—</span></div>
          <p class="dialog-note" id="settingsDiagnosticsResult" aria-live="polite"></p>
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
      let lastHealth = null;
      let lastDiagnostics = null;
      let diagnosticResult = null;
      const meta = name => document.querySelector(`meta[name="localgpt-${name}"]`)?.content || 'unknown';
      const uiBuild = {version:meta('version'), build_sha:meta('build-sha'), build_dirty:meta('build-dirty') === 'true'};
      const describe = build => `${build?.version || 'unknown'} · ${(build?.build_sha || 'unknown').slice(0, 12)}${build?.build_dirty ? tr('（有本地修改）', ' (local changes)') : ''}`;
      const renderIdentity = () => {
        el('settingsBuildIdentity').textContent = tr('界面版本：', 'Interface: ') + describe(uiBuild);
        const mismatch = lastHealth && (lastHealth.version !== uiBuild.version || lastHealth.build_sha !== uiBuild.build_sha);
        el('settingsServerIdentity').textContent = tr('运行服务：', 'Running server: ') + describe(lastHealth) + (mismatch ? tr(' · 版本不同，请按升级说明重启服务', ' · Build differs; follow the coordinated upgrade guide') : '');
      };
      const renderDiagnostics = () => {
        const results = {checking:tr('正在检查…', 'Checking…'), available:tr('应用数据库可用', 'Application database is available'), unknown:tr('应用数据库状态未知', 'Application database status is unknown'), failed:tr('诊断请求失败，请检查应用服务', 'Diagnostics failed; check the application server'), health_failed:tr('应用状态检查失败；模型服务检查已返回', 'Application health check failed; model service results are available'), services_failed:(lastHealth?.database_ready ? tr('应用数据库可用', 'Application database is available') : tr('应用数据库状态未知', 'Application database status is unknown')) + ' · ' + tr('模型服务检查失败', 'Model service checks failed')};
        el('settingsDiagnosticsResult').textContent = results[diagnosticResult] || '';
        if (!lastDiagnostics) {
          el('settingsLMStatus').textContent = el('settingsComfyStatus').textContent = '—';
          return;
        }
        const labels = {available:tr('可连接', 'Reachable'), unavailable:tr('未连接', 'Unreachable'), http_error:tr('响应异常', 'HTTP error'), blocked:tr('非本地地址，未检测', 'Non-local address; not probed'), synthetic:tr('模拟服务', 'Synthetic fixture')};
        for (const [id, key] of [['settingsLMStatus','lm_studio'], ['settingsComfyStatus','comfyui']]) {
          const state = lastDiagnostics[key] || {};
          el(id).textContent = (labels[state.status] || tr('未知', 'Unknown')) + (state.http_status && state.http_status !== 200 ? ` (${state.http_status})` : '');
        }
      };
      renderIdentity();
      addEventListener('hanz-health', event => {lastHealth = event.detail; renderIdentity();});
      addEventListener('hanz-diagnostics-refresh', async () => {
        const button = el('settingsDiagnosticsRefresh');
        if (button.disabled) return;
        button.disabled = true;
        diagnosticResult = 'checking'; renderDiagnostics();
        try {
          const [health, diagnostic] = await Promise.allSettled([request('/qwen-cn/health'), request('/qwen-cn/diagnostics')]);
          lastHealth = health.status === 'fulfilled' ? health.value : null;
          lastDiagnostics = diagnostic.status === 'fulfilled' ? diagnostic.value : null;
          diagnosticResult = !lastHealth ? (lastDiagnostics ? 'health_failed' : 'failed')
            : !lastDiagnostics ? 'services_failed' : lastHealth.database_ready ? 'available' : 'unknown';
          renderIdentity(); renderDiagnostics();
        } catch {
          lastDiagnostics = null;
          el('settingsLMStatus').textContent = el('settingsComfyStatus').textContent = '—';
          diagnosticResult = 'failed'; renderDiagnostics();
        } finally {button.disabled = false;}
      });
      addEventListener("hanzlanguage", () => {syncDatabasePath(); renderIdentity(); renderDiagnostics();});
    }
  })();

  let pending = false;
  const prefs = el("preferencesDialog"),
    confirm = el("confirmDialog");
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
  confirm.canClose = () => !pending;
  confirm.addEventListener("cancel", (e) => {
    if (pending) e.preventDefault();
  });
  el("closePreferences").onclick = () => window.AppShell?.closeSettings();

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
    remember: (message) => window.HanzMemory?.open(message?.prompt, document.activeElement),
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
})();
