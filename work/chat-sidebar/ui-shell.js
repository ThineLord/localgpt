/* UI-only adapters. Native controls retain every business handler and value. */
(() => {
  const $ = id => document.getElementById(id);
  const tr = (zh, en) => document.documentElement.lang === "en" ? en : zh;
  const glyph = path => `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
  const focus = el => { if (el?.getClientRects().length && !el.disabled) el.focus({preventScroll:true}); };
  const changed = el => {
    el.dispatchEvent(new Event("input", {bubbles:true}));
    el.dispatchEvent(new Event("change", {bubbles:true}));
  };
  const controllers = [];
  const composerObserver=new ResizeObserver(()=>{
    document.querySelector('.workspace').style.setProperty('--composer-block-height', $('form').getBoundingClientRect().height+'px');
  });
  composerObserver.observe($('form'));


  class Menu {
    constructor(trigger, panel, render, anchor = trigger, width = 254, gap = 8) {
      Object.assign(this, {trigger,panel,render,anchor,width,gap});
      controllers.push(this);
      trigger.addEventListener("click", e => { e.preventDefault(); this.open ? this.close() : this.show(); });
      trigger.addEventListener("keydown", e => {
        if (["ArrowDown","ArrowUp"].includes(e.key)) {
          e.preventDefault(); this.show(); const items=this.items();
          focus(e.key==="ArrowUp" ? items.at(-1) : items[0]);
        }
      });
      panel.addEventListener("keydown", e => {
        const items=this.items(), index=items.indexOf(document.activeElement);
        if (["ArrowDown","ArrowUp","Home","End"].includes(e.key)) {
          e.preventDefault();
          const next=e.key==="Home"?0:e.key==="End"?items.length-1:
            (index+(e.key==="ArrowDown"?1:-1)+items.length)%items.length;
          focus(items[next]);
        } else if(e.key==="Escape"&&this.open) { e.preventDefault();e.stopPropagation();this.close(); }
        else if(e.key==="Tab") this.close(false);
      });
      document.addEventListener("pointerdown",e=>{
        if(this.open&&!panel.contains(e.target)&&!trigger.contains(e.target))this.close(false);
      });
      document.addEventListener("keydown",e=>{
        if(e.key==="Escape"&&this.open&&!panel.contains(e.target)){
          e.preventDefault();e.stopPropagation();this.close();
        }
      },{capture:true});
      addEventListener("resize",()=>{if(this.open)this.place();},{passive:true});
    }
    items(){return [...this.panel.querySelectorAll('button:not(:disabled):not([hidden])')].filter(e=>e.getClientRects().length);}
    show(){
      if(this.trigger.disabled)return;
      for(const menu of controllers)if(menu!==this)menu.close(false);
      this.render?.();this.panel.hidden=false;
      if(!this.panel.matches(':popover-open'))this.panel.showPopover();
      this.open=true;this.trigger.setAttribute('aria-expanded','true');this.place();focus(this.items()[0]);
    }
    close(restore=true){
      if(!this.open)return;this.open=false;
      if(this.panel.matches(':popover-open'))this.panel.hidePopover();
      this.panel.hidden=true;this.trigger.setAttribute('aria-expanded','false');
      if(restore)focus(this.trigger.getClientRects().length ? this.trigger : this.anchor);
    }
    place(){
      const r=this.anchor.getBoundingClientRect(), p=this.panel;
      p.style.inset='auto';p.style.width=Math.min(typeof this.width==='function'?this.width():this.width,innerWidth-24)+'px';
      p.style.maxHeight=Math.max(100,innerHeight-24)+'px';
      const gap=this.gap ?? 8, b=p.getBoundingClientRect();
      const aboveGap=r.top-gap, belowGap=innerHeight-r.bottom-gap;
      const horizontal=this.trigger.getBoundingClientRect();
      const left=this.trigger.id==='upload'?r.left:horizontal.right-b.width;
      p.style.left=Math.max(12,Math.min(left,innerWidth-b.width-12))+'px';
      // Use the whole composer edge so mobile menus never cover the text row.
      p.style.top=Math.max(12,Math.min(belowGap>=b.height?r.bottom+gap:aboveGap-b.height,innerHeight-b.height-12))+'px';
    }
  }
  const mode=$('mode'), model=$('chatModel'), modelTrigger=$('modelMenuTrigger');
  const modelMenu=new Menu(modelTrigger,$('modelMenu'),()=>{
    const root=$('modelMenu');root.replaceChildren();
    for(const [kind,native] of [['mode',mode],['model',model]]) {
      if(kind==='model'&&(mode.value==='image'||model.hidden))continue;
      const group=document.createElement('div');group.className='model-menu-section';group.setAttribute('role','group');
      group.setAttribute('aria-label',kind==='mode'?tr('交互模式','Mode'):tr('对话模型','Model'));
      if(kind==='model'){const sep=document.createElement('div');sep.className='model-menu-divider';sep.setAttribute('role','separator');root.append(sep);}
      for(const opt of native.options){
        const b=document.createElement('button');b.type='button';b.className='model-menu-item';
        b.dataset.kind=kind;b.dataset.value=opt.value;b.setAttribute('role','menuitemradio');
        b.setAttribute('aria-checked',String(opt.value===native.value));b.textContent=opt.textContent;
        b.hidden=opt.hidden;b.disabled=native.disabled||opt.disabled;
        b.onclick=()=>{native.value=opt.value;changed(native);modelMenu.close();syncModel();};group.append(b);
      }
      root.append(group);
    }
  },$('composerCard'));
  function syncModel(){
    $('modelMenuLabel').textContent=mode.options[mode.selectedIndex]?.textContent||mode.value;
    modelTrigger.title=mode.value==='image'?$('modeHint').textContent:model.options[model.selectedIndex]?.textContent||'';
    modelTrigger.disabled=mode.disabled;
    if(modelTrigger.disabled)modelMenu.close(false);
  }
  for(const select of [mode,model]){
    select.tabIndex=-1;select.addEventListener('change',syncModel);
    new MutationObserver(syncModel).observe(select,{attributes:true,childList:true,subtree:true});
  }
  new MutationObserver(syncModel).observe($('modeHint'),{childList:true,characterData:true,subtree:true});
  syncModel();

  const attachment=new Menu($('upload'),$('attachmentMenu'),()=>{
    const definitions=[
      ['attach-upload',tr('添加参考图片','Add reference image'),'<path d="M8 8v9a4 4 0 0 0 8 0V6a3 3 0 0 0-6 0v10a1 1 0 0 0 2 0V8"/>',()=>$('file').click()],
      ['attach-image-mode',tr('创建图片','Create image'),'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><path d="m3 16 5-5 5 6 3-4 5 5"/>',()=>{mode.value='image';changed(mode);focus($('prompt'));}],
      ['attach-generation',tr('生成与对话参数','Generation and chat settings'),'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',()=>window.LiquidLayers.openSettings()],
    ];
    $('attachmentMenu').replaceChildren();
    for(const [id,label,path,action] of definitions){
      const b=document.createElement('button');b.id=id;b.type='button';b.className='attachment-menu-item';b.setAttribute('role','menuitem');
      b.innerHTML=glyph(path);const text=document.createElement('span');text.textContent=label;b.append(text);
      b.onclick=()=>{attachment.close();action();};$('attachmentMenu').append(b);
    }
  },$('composerCard'),()=>$('composerCard').getBoundingClientRect().width,4);
  $('upload').onclick=null; // The original file input/change handler stays intact.
  const chatMenu=new Menu($('chatActions'),$('chatActionsMenu'),null,$('chatActions'),196);
  $('chatActionsMenu').addEventListener('click',event=>{if(event.target.closest('button'))chatMenu.close();},{capture:true});
  new MutationObserver(()=>{$('chatActions').hidden=$('deleteCurrent').hidden;}).observe($('deleteCurrent'),{attributes:true,attributeFilter:['hidden']});
  addEventListener('liquidlayerchange',()=>{for(const menu of controllers)menu.close(false);});

  const profile = new Menu($('profileButton'),$('profileMenu'),null,$('profileButton'),228,8);
  profile.place=()=>{
    const r=$('profileButton').getBoundingClientRect(),p=profile.panel;
    p.style.inset='auto';p.style.width=Math.min(228,innerWidth-24)+'px';p.style.maxHeight=(innerHeight-24)+'px';
    const b=p.getBoundingClientRect();p.style.left=Math.min(r.right+5,innerWidth-b.width-12)+'px';
    p.style.top=Math.max(12,Math.min(r.bottom-b.height,innerHeight-b.height-8))+'px';
  };
  $('appSettings').addEventListener('click',()=>{profile.close(false);window.AppShell?.openSettings('general',$('appSettings'));},{capture:true});
  $('profileAbout').addEventListener('click',()=>{profile.close(false);window.AppShell?.openSettings(tabs.some(b=>b.dataset.settingsSection==='about')?'about':'general',$('profileAbout'));},{capture:true});
  const dialog=$('preferencesDialog'), nav=$('settingsNav'), toggle=$('settingsBack');
  const panels=[...dialog.querySelectorAll('[data-settings-panel]')];
  const tabs=[...nav.querySelectorAll('[data-settings-section]')];
  function title(){
    const mobile=innerWidth<=760, open=dialog.classList.contains('settings-nav-open');
    toggle.setAttribute('aria-label',open?tr('关闭设置分类','Close settings categories'):tr('打开设置分类','Open settings categories'));
    $('preferencesTitle').textContent=tr('设置','Settings');
    $('settingsSectionTitle').textContent=panels.find(p=>!p.hidden)?.querySelector('.settings-panel-title')?.textContent||tr('设置','Settings');
    dialog.setAttribute('aria-labelledby',mobile&&!open?'settingsSectionTitle':'preferencesTitle');
  }
  function drawer(open){
    dialog.classList.toggle('settings-nav-open',open);
    toggle.setAttribute('aria-expanded',String(open));$('settingsNavShade').hidden=!open;
    if(innerWidth<=760){
      nav.inert=!open;
      dialog.querySelector('.settings-panels').inert=open;
    }
    title();
    if(open)focus(tabs.find(b=>b.getAttribute('aria-selected')==='true'));else focus(toggle);
  }
  function section(name){
    panels.forEach(p=>p.hidden=p.dataset.settingsPanel!==name);
    tabs.forEach(b=>{const selected=b.dataset.settingsSection===name;b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;});
    $('settingsSectionSelect').value=name;
    if(innerWidth<=760)drawer(false);else title();
  }
  tabs.forEach((button,index)=>{
    const name=button.dataset.settingsSection,panel=panels.find(p=>p.dataset.settingsPanel===name);
    button.id='settings-tab-'+name;button.setAttribute('aria-controls',panel.id);
    panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',button.id);
    button.addEventListener('click',()=>section(name));
    button.addEventListener('keydown',e=>{
      if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;e.preventDefault();
      const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowDown'?1:-1)+tabs.length)%tabs.length;
      section(tabs[next].dataset.settingsSection);focus(tabs[next]);
    });
  });
  toggle.onclick=()=>drawer(!dialog.classList.contains('settings-nav-open'));
  $('settingsNavShade').onclick=()=>drawer(false);
  dialog.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&dialog.classList.contains('settings-nav-open')){e.preventDefault();e.stopPropagation();drawer(false);}
  });
  $('openGenerationSettings').onclick=async()=>{await window.LiquidLayers.close(dialog);window.LiquidLayers.openSettings();};
  function responsive(){
    const mobile=innerWidth<=760;title();
    if(!mobile){nav.inert=false;dialog.querySelector('.settings-panels').inert=false;}
    else if(!dialog.classList.contains('settings-nav-open')){nav.inert=true;}
  }
  addEventListener('hanzlanguage',title);
  section('general');responsive();addEventListener('resize',responsive,{passive:true});
  const resetSettingsChrome=()=>{if(dialog.open)return;drawer(false);responsive();};
  dialog.addEventListener('close',resetSettingsChrome);
  dialog.addEventListener('beforetoggle',event=>{
    if(event.newState!=='closed')return;
    queueMicrotask(resetSettingsChrome);
  });
})();

/* Shared top-layer tooltips. Native title bubbles are removed for these controls. */
(() => {
  const tip=document.createElement('div');tip.id='chromeTooltip';tip.className='chrome-tooltip';
  tip.setAttribute('role','tooltip');tip.setAttribute('popover','manual');document.body.append(tip);
  let owner=null,timer=0,previousDescription=null;
  function hide(){
    clearTimeout(timer);
    if(tip.matches(':popover-open'))tip.hidePopover();
    if(owner){if(previousDescription===null)owner.removeAttribute('aria-describedby');else owner.setAttribute('aria-describedby',previousDescription);}
    owner=null;
  }
  function show(button){
    hide();
    if(button.disabled||button.getAttribute('aria-expanded')==='true'||document.querySelector('dialog[open]:not(#preferencesDialog)'))return;
    const text=button.getAttribute('aria-label');if(!text)return;
    owner=button;previousDescription=button.getAttribute('aria-describedby');
    button.setAttribute('aria-describedby',[previousDescription,tip.id].filter(Boolean).join(' '));
    tip.textContent=text;tip.showPopover();
    const r=button.getBoundingClientRect(),b=tip.getBoundingClientRect();
    const rail=button.closest('.app-rail');
    tip.style.left=Math.max(8,Math.min(rail?r.right+8:r.left+(r.width-b.width)/2,innerWidth-b.width-8))+'px';
    tip.style.top=Math.max(8,Math.min(rail?r.top+(r.height-b.height)/2:r.bottom+8,innerHeight-b.height-8))+'px';
  }
  for(const button of document.querySelectorAll('.app-rail .chrome-button, #sidebarToggle, #headerNewChat, #mobileMenu, #chatActions')){
    button.removeAttribute('title');
    button.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'){hide();timer=setTimeout(()=>show(button),350);}});
    button.addEventListener('pointerleave',hide);
    button.addEventListener('focus',()=>{if(button.matches(':focus-visible'))show(button);});
    button.addEventListener('blur',hide);
    new MutationObserver(()=>{button.removeAttribute('title');if(owner===button)hide();}).observe(button,{attributes:true,attributeFilter:['title','aria-expanded','aria-label']});
  }
  document.addEventListener('pointerdown',hide,true);document.addEventListener('keydown',e=>{if(e.key==='Escape')hide();},true);
  document.addEventListener('scroll',hide,true);addEventListener('resize',hide);addEventListener('liquidlayerchange',hide);
  const language=()=>{document.getElementById('imageInfoLabel').textContent=document.documentElement.lang==='en'?'Image information':'图片信息';document.getElementById('galleryRetry').textContent=document.documentElement.lang==='en'?'Retry':'重试';};
  language();addEventListener('hanzlanguage',language);
})();
