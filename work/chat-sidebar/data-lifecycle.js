/* Explicit lifecycle controls; no operation runs without a user action. */
(() => {
  const $=id=>document.getElementById(id), tr=(zh,en)=>{EN[zh]=en;return language==='en'?en:zh;};
  let trashSignature='',filePending=false;
  const button=(text,action,danger=false)=>{const b=document.createElement('button');b.type='button';b.className='action'+(danger?' danger-link':'');b.textContent=text;b.onclick=()=>Promise.resolve(action()).catch(e=>setStatus(e.message,true));return b;};
  async function renderMediaTrash(){
    const data=await request('/qwen-cn/media/trash'),signature=JSON.stringify(data)+language;
    if(signature===trashSignature)return;trashSignature=signature;
    const root=$('imageTrashList');root.replaceChildren();
    if(!data.items.length){const empty=document.createElement('p');empty.className='empty-collection';empty.textContent=tr('暂无已删除图片','No trashed images');root.append(empty);}
    for(const item of data.items){
      const row=document.createElement('article');row.className='trash-row';row.dataset.mediaId=item.id;
      const thumb=document.createElement('img');thumb.src=imageURL(item.image);thumb.alt=tr('回收站图片','Trashed image');thumb.className='trash-thumbnail';
      const label=document.createElement('div');label.textContent=item.image.filename;
      const note=document.createElement('small');note.textContent=tr('可恢复 · 原文件保留','Recoverable · Original file retained');label.append(note);
      const restore=button(tr('恢复','Restore'),async()=>{await request('/qwen-cn/media/trash/'+item.id+'/restore',json('POST',{}));await renderMediaTrash();});
      const purge=button(tr('永久删除','Delete permanently'),()=>HanzFeatures.confirm(tr('永久删除图片及原文件？','Permanently delete image and file?'),tr('将移除选定消息中的图片与本地原文件，无法恢复。若其他聊天、草稿或回收站记录仍引用它，操作会被阻止。独立备份与旧迁移文件不会被清理。','Removes the selected message image and original file permanently. Other chat, draft or Trash references block deletion. Independent backups and legacy migration files are not removed.'),async()=>{
        const result=await request('/qwen-cn/media/trash/'+item.id,json('DELETE',{confirm:true}));
        await renderMediaTrash();if(current){current=await request('/qwen-cn/chats/'+current.id);render(true);}
        setStatus(tr(`原文件已删除：${result.deleted_files}；此前已不存在：${result.already_missing}。`,`Files deleted: ${result.deleted_files}; already absent: ${result.already_missing}.`));
      }),true);
      row.append(thumb,label,restore,purge);root.append(row);
    }
    $('mediaDeleteStatus').textContent=data.pending_deletions.length?tr('有未完成的文件删除。原记录保留，请使用相同范围重试。','File deletion is incomplete. Original records remain; retry the same operation.') : '';
  }
  window.HanzMedia={render:renderMediaTrash};
  const diag=$('settingsPanelDiagnostics');
  const controls=document.createElement('div');controls.className='settings-group storage-controls';
  const files=button(tr('管理上传的参考图','Manage uploaded references'),showFiles);
  files.id='manageReferenceFiles';controls.append(files);diag?.append(controls);
  const retained=document.createElement('p');retained.id='retainedCopies';retained.className='dialog-note';diag?.append(retained);
  const filesView=document.createElement('section');filesView.id='referenceFilesView';filesView.hidden=true;
  const back=button(tr('‹ 返回本地服务','‹ Back to local services'),()=>{filesView.hidden=true;for(const c of [...diag.children])if(c!==filesView)c.hidden=false;files.focus();});
  const fileTitle=document.createElement('h3');fileTitle.textContent=tr('上传的参考图','Uploaded references');fileTitle.className='settings-panel-title';
  const note=document.createElement('p');note.className='dialog-note';note.textContent=tr('这里只管理本版本上传并登记的文件。旧版或外部参考图不自动删除；仍被聊天或草稿引用的文件不能删除。','Only uploads registered by this version are managed here. Older/external references are retained. Referenced files cannot be deleted.');
  const fileList=document.createElement('div');fileList.id='referenceFilesList';filesView.append(back,fileTitle,note,fileList);diag?.append(filesView);
  async function showFiles(){
    if(filePending)return;filePending=true;
    try{
      for(const c of [...diag.children])if(c!==filesView)c.hidden=true;filesView.hidden=false;fileList.textContent=tr('正在加载…','Loading…');
      const data=await request('/qwen-cn/uploads');fileList.replaceChildren();
      if(!data.items.length)fileList.textContent=tr('没有本版本登记的上传文件。','No uploads registered by this version.');
      for(const item of data.items){
        const row=document.createElement('article');row.className='trash-row';const label=document.createElement('div');label.textContent=item.image.filename;
        const count=document.createElement('small');count.textContent=tr(`有效引用：${item.reference_count}`,`References: ${item.reference_count}`);label.append(count);
        const del=button(tr('永久删除原文件','Delete original permanently'),()=>HanzFeatures.confirm(tr('永久删除上传文件？','Permanently delete uploaded file?'),tr('仅删除此应用登记的原文件。仍有引用时会拒绝删除，失败时保留登记记录供重试。','Only this registered original is deleted. References block deletion; failed operations remain retryable.'),async()=>{await request('/qwen-cn/uploads/'+item.id,json('DELETE',{confirm:true}));await showFiles();}),true);
        row.append(label,del);fileList.append(row);
      }
      const recovery=await request('/qwen-cn/uploads/recovery');
      if(recovery.items.length){
        const heading=document.createElement('h4');heading.textContent=tr('未完成的上传','Incomplete uploads');fileList.append(heading);
        for(const item of recovery.items){
          const row=document.createElement('article');row.className='trash-row';row.dataset.recoveryId=item.id;
          const label=document.createElement('div');label.textContent=item.image.filename;
          const detail=document.createElement('small');detail.textContent=item.file_present?tr('文件保留在本机，尚未登记。完成登记后可在此管理或永久删除。','The local file is retained but unregistered. Register it to manage or permanently delete it here.'):tr('上传结果待确认，尚未发现文件。可稍后重试登记。','Upload outcome is unresolved; no file found yet. Retry registration later.');label.append(detail);
          const retry=button(tr('重试登记','Retry registration'),async()=>{await request('/qwen-cn/uploads/recovery/'+item.id+'/register',json('POST',{}));await showFiles();});
          row.append(label,retry);fileList.append(row);
        }
      }
    } catch(e){fileList.textContent=e.message;}finally{filePending=false;}
  }
  async function diagnostics(){
    const b=$('settingsDiagnosticsRefresh');b.disabled=true;
    try{
      const h=await request('/qwen-cn/health');connectionRecovered();$('databasePath').title=h.database||'';$('settingsDatabasePathDisplay').textContent=h.database||'';
      const copies=await request('/qwen-cn/storage/retained-copies');
      retained.textContent=tr('保留副本（需手动确认清理，不自动删除）：','Retained copies (manual cleanup; never removed automatically): ')+(copies.legacy_migration||'')+' '+copies.backup_directories.filter(d=>d.count).map(d=>`${d.path} (${d.count})`).join(' · ');
    }catch(e){connectionError(e);}finally{b.disabled=false;}
  }
  addEventListener('hanz-diagnostics-refresh',diagnostics);
  document.querySelector('[data-settings-section=diagnostics]')?.addEventListener('click',diagnostics);
  const about=$('settingsPanelAbout');
  if(about){const mark=document.createElement('span');mark.className='about-mark';mark.ariaLabel='LocalGPT';mark.style.maskImage=`url("${document.querySelector('link[rel="icon"]').href}")`;about.prepend(mark);}
  $('galleryDelete').textContent=tr('移至图片回收站','Move image to Trash');
  captureLanguage(diag);
  addEventListener('hanzlanguage',()=>{
    $('galleryDelete').textContent=tr('移至图片回收站','Move image to Trash');
    if(view==='trash')renderMediaTrash().catch(e=>setStatus(e.message,true));
    if(!filesView.hidden)showFiles();
  });
})();
