// Current contract adapted from round3_review_regressions.js. Run via tools/validate.py.
// Mason's two MEDIUM findings: empty option changes and conflicting recovery.
// An already saved chat must keep an unresolved conflict across same-tab reloads.
// A waiting choice also survives a return to the original base, sidebar selectChat,
// project entry, and a second chat's own conflict in the same sessionStorage key.
// An unsaved new chat also survives a same-tab load of an existing chat before
// the 450ms autosave, including after that existing chat is typed and saved.
module.exports = async page=>{
 const base=process.env.LOCALGPT_TEST_BASE;
 if(!(await(await page.request.get(base+'/qwen-cn/health')).json()).demo)throw Error('Synthetic only');
 const check=(x,m)=>{if(!x)throw Error(m);};
 const count=async()=>(await(await page.request.get(base+'/qwen-cn/chats')).json()).length;
 await page.setViewportSize({width:1440,height:900});await page.goto(base+'/qwen-cn/');await page.waitForFunction(() => typeof appReady !== 'undefined' && appReady);await page.locator('#intro').waitFor({state:'visible'});
 const before=await count();
 await page.locator('#upload').click();await page.locator('#attach-image-mode').click();
 await page.waitForFunction(()=>!dirty&&!saving);
 check(await count()===before,'Mode-only change created an empty chat');
 await page.locator('#prompt').fill('discard before autosave');await page.locator('#prompt').fill('');
 await page.waitForFunction(()=>!dirty&&!saving);
 check(await count()===before,'Cleared transient input created an empty chat');
 const receipts=[];
 for(const keep of [false,true]){
  await page.goto(base+'/qwen-cn/');await page.waitForFunction(() => typeof appReady !== 'undefined' && appReady);await page.locator('#intro').waitFor({state:'visible'});
  let failed=0;
  await page.route('**/qwen-cn/chats/*',async route=>{
   if(route.request().method()==='PATCH'){failed++;await route.fulfill({status:503,contentType:'application/json',body:'{"error":"Synthetic failed draft save"}'});}else await route.continue();
  });
  await page.locator('#prompt').fill('Local recovery '+keep);
  await page.waitForFunction(()=>!!current&&!saving&&dirty);
  check(failed>0,'Failure injection did not execute');
  const id=new URLSearchParams(new URL(page.url()).hash.slice(1)).get('chat');
  const original=await(await page.request.get(base+'/qwen-cn/chats/'+id)).json();
  const remoteDraft={...original.draft,prompt:'Newer remote draft '+keep};
  const remote=await page.request.patch(base+'/qwen-cn/chats/'+id,{data:{version:original.draft_version,draft:remoteDraft}});check(remote.ok(),'Remote edit setup failed');
  await page.unroute('**/qwen-cn/chats/*');await page.reload();await page.waitForFunction(() => typeof appReady !== 'undefined' && appReady);await page.locator('#draftConflict').waitFor({state:'visible'});
  check(await page.locator('#prompt').inputValue()==='Local recovery '+keep,'Local input was lost');
  await page.locator('#prompt').fill('Local recovery edited '+keep);
  await page.reload();await page.waitForFunction(() => typeof appReady !== 'undefined' && appReady);await page.locator('#draftConflict').waitFor({state:'visible'});
  check(await page.locator('#prompt').inputValue()==='Local recovery edited '+keep,'Repeated recovery lost edits');
  const unchanged=await(await page.request.get(base+'/qwen-cn/chats/'+id)).json();
  check(unchanged.draft.prompt===remoteDraft.prompt,'Recovery silently overwrote newer remote content');
  await page.locator(keep?'#keepDraft':'#useRemoteDraft').click();
  await page.waitForFunction(()=>!dirty&&!conflict&&!saving);
  const result=await(await page.request.get(base+'/qwen-cn/chats/'+id)).json();
  check(result.draft.prompt===(keep?'Local recovery edited '+keep:remoteDraft.prompt),'Explicit resolution failed');
  check(await page.evaluate(()=>sessionStorage.getItem('hanz-transient-draft')===null),'Resolved recovery copy remained');
  receipts.push({keepLocal:keep,remotePreservedUntilChoice:true});
 }
 const ready=async target=>{await target.waitForFunction(()=>typeof appReady!=='undefined'&&appReady);};
 const chatFrom=target=>new URLSearchParams(new URL(target.url()).hash.slice(1)).get('chat');
 const transient=async target=>target.evaluate(()=>sessionStorage.getItem('hanz-transient-draft'));
 const readTransient=async target=>target.evaluate(()=>{const raw=sessionStorage.getItem('hanz-transient-draft');return raw?JSON.parse(raw):null;});
 const readRecords=async target=>target.evaluate(()=>{
  const raw=sessionStorage.getItem('hanz-transient-draft');
  if(!raw)return [];
  const parsed=JSON.parse(raw);
  if(Array.isArray(parsed.records))return parsed.records;
  return parsed&&(Object.prototype.hasOwnProperty.call(parsed,'chatId')||parsed.draft)?[parsed]:[];
 });
 const draftOf=async id=>(await(await page.request.get(base+'/qwen-cn/chats/'+id)).json());
 async function holdPatch(id){
  let release=()=>{};
  const gate=new Promise(resolve=>{release=resolve;});
  let opened=()=>{};
  const pending=new Promise(resolve=>{opened=resolve;});
  const matches=url=>{const path=typeof url==='string'?new URL(url).pathname:url.pathname;return path==='/qwen-cn/chats/'+id;};
  const handler=async route=>{
   if(route.request().method()==='PATCH'){opened();await gate;}
   await route.continue();
  };
  await page.route(matches,handler);
  return {pending,release:()=>release(),async stop(){release();await page.unroute(matches,handler).catch(()=>{});}};
 }
 async function openOther(){
  const context=await page.context().browser().newContext();
  const other=await context.newPage();
  other.setDefaultTimeout(12000);
  return {context,other};
 }
 async function savedChat(prompt){
  await page.goto(base+'/qwen-cn/');await ready(page);
  await page.locator('#prompt').fill(prompt);
  await page.waitForFunction(()=>!!current&&!dirty&&!saving);
  const id=chatFrom(page);check(!!id,'Existing chat was not created');
  await page.reload();await ready(page);
  check(await transient(page)===null,'Reopened existing chat already had a transient draft');
  check(await page.locator('#prompt').inputValue()===prompt,'Saved draft was not restored from the server');
  check(chatFrom(page)===id,'Reload left the saved chat');
  return id;
 }
 async function openSaved(title,prompt){
  const created=await(await page.request.post(base+'/qwen-cn/chats',{data:{title}})).json();
  const patched=await page.request.patch(base+'/qwen-cn/chats/'+created.id,{data:{version:created.draft_version,draft:{prompt}}});
  check(patched.ok(),'Saved chat setup failed');
  await page.goto(base+'/qwen-cn/?open='+encodeURIComponent(created.id)+'#chat='+encodeURIComponent(created.id));await ready(page);
  check(await page.locator('#prompt').inputValue()===prompt,'Saved draft was not shown');
  check(!(await readRecords(page)).some(record=>record.chatId===created.id),'Opened chat already had its own transient draft');
  return created.id;
 }
 async function causeConflict(id,localPrompt,remotePrompt){
  let other,otherContext,held;
  try{
   held=await holdPatch(id);
   ({context:otherContext,other}=await openOther());
   await other.goto(base+'/qwen-cn/#chat='+encodeURIComponent(id));await ready(other);
   await page.locator('#prompt').fill(localPrompt);
   await held.pending;
   await other.locator('#prompt').fill(remotePrompt);
   await other.waitForFunction(expected=>!dirty&&!saving&&current?.draft?.prompt===expected,remotePrompt);
   const remote=await draftOf(id);
   check(remote.draft.prompt===remotePrompt,'Conflict remote save failed');
   held.release();
   await page.locator('#draftConflict').waitFor({state:'visible'});
   check(await page.locator('#prompt').inputValue()===localPrompt,'Conflict cleared the local input');
   await held.stop();held=null;
   await otherContext.close();otherContext=null;
   return remote;
  }finally{
   if(held)await held.stop();
   if(otherContext)await otherContext.close().catch(()=>{});
  }
 }
 const existingChoices=[];
 for(const keep of [false,true]){
  let other;
  let otherContext;
  let held;
  try{
   const basePrompt='Existing base '+keep, localPrompt='Local existing '+keep, remotePrompt='Remote existing '+keep;
   const id=await savedChat(basePrompt);
   held=await holdPatch(id);
   ({context:otherContext,other}=await openOther());
   const otherErrors=[];other.on('pageerror',error=>otherErrors.push(error.message));
   await other.goto(base+'/qwen-cn/#chat='+encodeURIComponent(id));await ready(other);
   check(await other.locator('#prompt').inputValue()===basePrompt,'Second page did not open the saved draft');
   check(await other.evaluate(()=>sessionStorage.getItem('hanz-transient-draft'))===null,'Second page inherited the transient draft');
   await page.locator('#prompt').fill(localPrompt);
   await held.pending;
   await other.locator('#prompt').fill(remotePrompt);
   await other.waitForFunction(expected=>!dirty&&!saving&&current?.draft?.prompt===expected,remotePrompt);
   check(!otherErrors.length,'Second page error: '+otherErrors.join('; '));
   const remote=await draftOf(id);
   check(remote.draft.prompt===remotePrompt,'Second page did not save');
   held.release();
   await page.locator('#draftConflict').waitFor({state:'visible'});
   check(await page.locator('#prompt').inputValue()===localPrompt,'Conflict cleared the local input');
   const afterConflict=await draftOf(id);
   check(afterConflict.draft.prompt===remotePrompt&&afterConflict.draft_version===remote.draft_version,'Conflict overwrote the saved draft');
   const stored=await readTransient(page);
   check(stored&&stored.chatId===id&&stored.draft.prompt===localPrompt&&stored.baseDraft.prompt===basePrompt,'Conflict did not keep the local draft and original base');
   check((stored.projectId||null)===null,'Ordinary chat conflict stored a project id');
   check(await page.evaluate(()=>localStorage.getItem('hanz-transient-draft'))===null,'Draft recovery used localStorage');
   await held.stop();held=null;
   await otherContext.close();otherContext=null;other=null;
   await page.reload();await ready(page);await page.locator('#draftConflict').waitFor({state:'visible'});
   check(await page.locator('#prompt').inputValue()===localPrompt,'Reload dropped the local draft');
   let unchanged=await draftOf(id);
   check(unchanged.draft.prompt===remotePrompt&&unchanged.draft_version===remote.draft_version,'Reload overwrote the saved draft');
   const edited='Local existing edited '+keep;
   await page.locator('#prompt').fill(edited);
   await page.reload();await ready(page);await page.locator('#draftConflict').waitFor({state:'visible'});
   check(await page.locator('#prompt').inputValue()===edited,'Repeated recovery lost edits');
   unchanged=await draftOf(id);
   check(unchanged.draft.prompt===remotePrompt&&unchanged.draft_version===remote.draft_version,'Repeated refresh overwrote the saved draft');
   const remembered=await readTransient(page);
   check(remembered&&remembered.draft.prompt===edited&&remembered.baseDraft.prompt===basePrompt,'Repeated refresh replaced the original base');
   await page.reload();await ready(page);await page.locator('#draftConflict').waitFor({state:'visible'});
   check(await page.locator('#prompt').inputValue()===edited,'Another refresh dropped the edited local draft');
   unchanged=await draftOf(id);
   check(unchanged.draft_version===remote.draft_version,'Another refresh wrote a new draft version');
   await page.locator(keep?'#keepDraft':'#useRemoteDraft').click();
   await page.waitForFunction(()=>!dirty&&!conflict&&!saving);
   await page.locator('#draftConflict').waitFor({state:'hidden'});
   const chosen=keep?edited:remotePrompt;
   const result=await draftOf(id);
   check(result.draft.prompt===chosen,'Explicit resolution failed for an existing chat');
   check(keep?result.draft_version>remote.draft_version:result.draft_version===remote.draft_version,'Explicit resolution changed the saved draft unexpectedly');
   check(await transient(page)===null,'Resolved recovery copy remained');
   check(await page.locator('#prompt').inputValue()===chosen,'The composer did not show the chosen draft');
   await page.reload();await ready(page);
   check(await page.locator('#draftConflict').isHidden(),'A resolved conflict returned after refresh');
   check(await transient(page)===null,'Refresh restored a resolved recovery copy');
   check(await page.locator('#prompt').inputValue()===chosen,'Refresh did not keep the chosen draft');
   check((await draftOf(id)).draft.prompt===chosen,'Refresh replaced the chosen draft');
   existingChoices.push({keepLocal:keep,remotePreservedUntilChoice:true});
  }finally{
   if(held)await held.stop();
   if(otherContext)await otherContext.close().catch(()=>{});
  }
 }
 let otherPage;
 let heldIsolation;
 let otherContext;
 const isolation={};
 try{
  const id=await savedChat('Isolation base');
  const created=await(await page.request.post(base+'/qwen-cn/chats',{data:{title:'隔离对话'}})).json();
  const seeded=await page.request.patch(base+'/qwen-cn/chats/'+created.id,{data:{version:created.draft_version,draft:{prompt:'Isolation other'}}});
  check(seeded.ok(),'Isolation chat setup failed');
  heldIsolation=await holdPatch(id);
  ({context:otherContext,other:otherPage}=await openOther());
  await otherPage.goto(base+'/qwen-cn/#chat='+encodeURIComponent(id));await ready(otherPage);
  await page.locator('#prompt').fill('Isolation local');
  await heldIsolation.pending;
  await otherPage.locator('#prompt').fill('Isolation remote');
  await otherPage.waitForFunction(expected=>!dirty&&!saving&&current?.draft?.prompt===expected,'Isolation remote');
  const remote=await draftOf(id);
  check(remote.draft.prompt==='Isolation remote','Isolation remote save failed');
  heldIsolation.release();
  await page.locator('#draftConflict').waitFor({state:'visible'});
  await heldIsolation.stop();heldIsolation=null;
  await otherContext.close();otherContext=null;otherPage=null;
  const record=await transient(page);
  await page.goto(base+'/qwen-cn/?scope=other#chat='+encodeURIComponent(created.id));await ready(page);
  check(await page.locator('#prompt').inputValue()==='Isolation other','Another chat showed the unresolved draft');
  check(await page.locator('#draftConflict').isHidden(),'Another chat showed this conflict');
  check(await transient(page)===record,'Opening another chat changed the recovery record');
  check((await draftOf(id)).draft_version===remote.draft_version,'Opening another chat wrote the conflicted chat');
  await page.locator('#prompt').fill('Isolation other typed');
  await page.waitForFunction(()=>!dirty&&!saving);
  check(await page.locator('#prompt').inputValue()==='Isolation other typed','The other chat did not keep its own draft');
  const still=await readTransient(page);
  check(still&&still.chatId===id&&still.draft.prompt==='Isolation local'&&still.baseDraft.prompt==='Isolation base','Typing in another chat replaced the recovery record');
  check((await draftOf(id)).draft_version===remote.draft_version,'Typing in another chat overwrote the conflicted draft');
  await page.goto(base+'/qwen-cn/?scope=fresh');await ready(page);
  check(await page.locator('#prompt').inputValue()==='','A new chat showed the unresolved draft');
  check(await page.locator('#draftConflict').isHidden(),'A new chat showed this conflict');
  check((await readTransient(page))?.chatId===id,'A new chat deleted the recovery record');
  await page.goto(base+'/qwen-cn/?scope=return#chat='+encodeURIComponent(id));await ready(page);
  await page.locator('#draftConflict').waitFor({state:'visible'});
  check(await page.locator('#prompt').inputValue()==='Isolation local','Returning to the chat dropped the local draft');
  const mismatched=JSON.parse(record);mismatched.projectId='synthetic-other-project';
  await page.evaluate(value=>sessionStorage.setItem('hanz-transient-draft',value),JSON.stringify(mismatched));
  await page.reload();await ready(page);
  check(await page.locator('#draftConflict').isHidden(),'A different project showed this conflict');
  check(await page.locator('#prompt').inputValue()==='Isolation remote','A different project applied the local draft');
  const parked=await readTransient(page);
  check(parked&&parked.projectId==='synthetic-other-project'&&parked.chatId===id&&parked.draft.prompt==='Isolation local','A different project deleted the recovery record');
  check((await draftOf(id)).draft_version===remote.draft_version,'A different project overwrote the saved draft');
  await page.evaluate(value=>sessionStorage.setItem('hanz-transient-draft',value),record);
  await page.reload();await ready(page);await page.locator('#draftConflict').waitFor({state:'visible'});
  check(await page.locator('#prompt').inputValue()==='Isolation local','Restoring the record did not restore the choice');
  await page.reload();await ready(page);await page.locator('#draftConflict').waitFor({state:'visible'});
  check(await page.locator('#prompt').inputValue()==='Isolation local','Repeated refresh dropped the isolated local draft');
  const finalDraft=await draftOf(id);
  check(finalDraft.draft.prompt==='Isolation remote'&&finalDraft.draft_version===remote.draft_version,'Repeated refresh overwrote the isolated draft');
  check(await transient(page)!==null,'Repeated refresh cleared the unresolved record');
  Object.assign(isolation,{otherChat:true,otherChatTyping:true,newChat:true,projectMismatch:true,repeatedReload:true});
 }finally{
  if(heldIsolation)await heldIsolation.stop();
  if(otherContext)await otherContext.close().catch(()=>{});
 }
 await page.locator('#useRemoteDraft').click();
 await page.waitForFunction(()=>!dirty&&!conflict&&!saving);
 check(await transient(page)===null,'Isolation choice did not clear the recovery record');
 const returnedToBase={};
 {
  const id=await openSaved('回到基线','baseOne');
  const remote=await causeConflict(id,'localOne','remoteOne');
  const stored=await readTransient(page);
  check(stored&&!stored.records&&stored.awaitingChoice&&stored.chatId===id&&stored.baseDraft.prompt==='baseOne'&&stored.draft.prompt==='localOne','Conflict did not persist a single-record choice');
  const reverted=await page.request.patch(base+'/qwen-cn/chats/'+id,{data:{version:remote.draft_version,draft:stored.baseDraft}});
  check(reverted.ok(),'Returning the remote draft to the original base failed');
  const before=await draftOf(id);
  check(before.draft.prompt==='baseOne'&&before.draft_version===remote.draft_version+1,'Remote base was not restored before refresh');
  check(before.draft_version===3,'Expected baseOne at draft version 3 before refresh');
  await page.reload();await ready(page);
  await page.locator('#draftConflict').waitFor({state:'visible'});
  await page.waitForTimeout(700);
  check(await page.locator('#prompt').inputValue()==='localOne','Refresh dropped the local draft after the remote returned to the base');
  check(await page.locator('#draftConflict').isVisible(),'Refresh dismissed the choice after the remote returned to the base');
  const after=await draftOf(id);
  check(after.draft.prompt==='baseOne'&&after.draft_version===before.draft_version,'Refresh auto-saved when the server text matched the original base');
  check(await page.evaluate(()=>{
   const pending=JSON.parse(sessionStorage.getItem('hanz-transient-draft'));
   return !!pending&&!pending.records&&pending.awaitingChoice&&same(current.draft,pending.baseDraft)&&!same(draft(),pending.baseDraft);
  }),'The waiting choice was not the original base versus the local draft');
  check(await page.evaluate(()=>localStorage.getItem('hanz-transient-draft'))===null,'Draft recovery used localStorage');
  await page.locator('#keepDraft').click();
  await page.waitForFunction(()=>!dirty&&!conflict&&!saving);
  check(await transient(page)===null,'Explicit save left the recovery copy');
  check((await draftOf(id)).draft.prompt==='localOne','Explicit save did not keep the local draft');
  Object.assign(returnedToBase,{versionBeforeRefresh:before.draft_version,keptChoice:true,explicitSaveCleared:true});
 }
 const sidebarReturn={};
 {
  const idA=await openSaved('侧栏甲','navBase');
  const idB=await openSaved('侧栏乙','navB');
  await page.goto(base+'/qwen-cn/?scope=sidebar-a#chat='+encodeURIComponent(idA));await ready(page);
  const remote=await causeConflict(idA,'navLocal','navRemote');
  const record=await transient(page);
  await page.goto(base+'/qwen-cn/?scope=sidebar-b#chat='+encodeURIComponent(idB));await ready(page);
  check(await page.locator('#prompt').inputValue()==='navB','The other chat showed the conflicted draft');
  check(await page.locator('#draftConflict').isHidden(),'The other chat showed this conflict');
  check(await transient(page)===record,'Opening the other chat changed the recovery record');
  await page.locator('#chatList button.chat-item',{hasText:'侧栏甲'}).click();
  await page.locator('#draftConflict').waitFor({state:'visible'});
  check(chatFrom(page)===idA,'Sidebar selectChat did not return to the conflicted chat');
  check(await page.locator('#prompt').inputValue()==='navLocal','selectChat showed the remote draft');
  check((await draftOf(idA)).draft_version===remote.draft_version,'selectChat wrote the conflicted chat');
  await page.locator('#prompt').fill('navLocal edited');
  await page.waitForTimeout(700);
  check(await page.locator('#draftConflict').isVisible(),'An edit after selectChat dismissed the choice');
  const still=await readTransient(page);
  check(still&&!still.records&&still.chatId===idA&&still.awaitingChoice&&still.baseDraft.prompt==='navBase'&&still.draft.prompt==='navLocal edited','An edit after selectChat cleared the recovery copy');
  const saved=await draftOf(idA);
  check(saved.draft.prompt==='navRemote'&&saved.draft_version===remote.draft_version,'An edit after selectChat overwrote the saved draft');
  await page.locator('#useRemoteDraft').click();
  await page.waitForFunction(()=>!dirty&&!conflict&&!saving);
  check(await transient(page)===null,'Discarding the sidebar choice left the recovery copy');
  check(await page.locator('#prompt').inputValue()==='navRemote','Discard did not show the saved draft');
  Object.assign(sidebarReturn,{selectChat:true,editKeptChoice:true,discardCleared:true});
 }
 const projectEntry={};
 {
  const project=await(await page.request.post(base+'/qwen-cn/projects',{data:{name:'合成项目',memory_mode:'default'}})).json();
  const created=await(await page.request.post(base+'/qwen-cn/chats',{data:{title:'项目草稿',project_id:project.id}})).json();
  const patched=await page.request.patch(base+'/qwen-cn/chats/'+created.id,{data:{version:created.draft_version,draft:{prompt:'projectBase'}}});
  check(patched.ok(),'Project chat setup failed');
  await page.goto(base+'/qwen-cn/#project='+encodeURIComponent(project.id));await ready(page);
  check(chatFrom(page)===null,'Project entry put the chat id in the address');
  check(await page.evaluate(()=>current?.id)===created.id,'Project entry did not open the saved chat');
  check(await page.locator('#prompt').inputValue()==='projectBase','Project entry did not show the saved draft');
  const remote=await causeConflict(created.id,'projectLocal','projectRemote');
  const stored=await readTransient(page);
  check(stored&&stored.chatId===created.id&&stored.projectId===project.id&&stored.awaitingChoice&&stored.draft.prompt==='projectLocal'&&stored.baseDraft.prompt==='projectBase','Project conflict was not stored in its own scope');
  await page.goto(base+'/qwen-cn/?scope=leave-project');await ready(page);
  check(await page.locator('#prompt').inputValue()==='','Leaving the project showed its local draft');
  check(await page.locator('#draftConflict').isHidden(),'Leaving the project showed its conflict');
  check((await readRecords(page)).some(record=>record.chatId===created.id&&record.draft.prompt==='projectLocal'),'Leaving the project deleted its recovery copy');
  await page.evaluate(id=>window.ProjectWorkspace.open(id),project.id);
  await page.locator('#draftConflict').waitFor({state:'visible'});
  check(await page.evaluate(()=>current?.id)===created.id,'Project open did not return to the conflicted chat');
  check(await page.locator('#prompt').inputValue()==='projectLocal','Project open showed the remote draft');
  check((await draftOf(created.id)).draft_version===remote.draft_version,'Project open wrote the conflicted chat');
  await page.reload();await ready(page);
  await page.locator('#draftConflict').waitFor({state:'visible'});
  check(await page.locator('#prompt').inputValue()==='projectLocal','Startup project entry dropped the local draft');
  check((await draftOf(created.id)).draft.prompt==='projectRemote'&&(await draftOf(created.id)).draft_version===remote.draft_version,'Startup project entry overwrote the saved draft');
  await page.locator('#useRemoteDraft').click();
  await page.waitForFunction(()=>!dirty&&!conflict&&!saving);
  check(await transient(page)===null,'Project discard left the recovery copy');
  Object.assign(projectEntry,{open:true,startup:true,projectScope:true});
 }
 const twoConflicts={};
 {
  const idA=await openSaved('双稿甲','baseA');
  const idB=await openSaved('双稿乙','baseB');
  await page.goto(base+'/qwen-cn/?scope=two-a#chat='+encodeURIComponent(idA));await ready(page);
  const remoteA=await causeConflict(idA,'local1','remote1');
  await page.goto(base+'/qwen-cn/?scope=two-b#chat='+encodeURIComponent(idB));await ready(page);
  check(await page.locator('#prompt').inputValue()==='baseB','Chat B showed chat A\'s local draft');
  check(await page.locator('#draftConflict').isHidden(),'Chat B showed chat A\'s conflict');
  check((await readRecords(page)).some(record=>record.chatId===idA&&record.awaitingChoice&&record.draft.prompt==='local1'),'Opening chat B dropped chat A\'s pending choice');
  const remoteB=await causeConflict(idB,'local2','remote2');
  const both=await readRecords(page);
  check(both.length===2,'The second conflict replaced the first pending choice');
  check(both.some(record=>record.chatId===idA&&record.projectId===null&&record.awaitingChoice&&record.draft.prompt==='local1'&&record.baseDraft.prompt==='baseA'),'Chat A\'s pending choice was lost when chat B conflicted');
  check(both.some(record=>record.chatId===idB&&record.projectId===null&&record.awaitingChoice&&record.draft.prompt==='local2'&&record.baseDraft.prompt==='baseB'),'Chat B\'s conflict was not stored');
  await page.goto(base+'/qwen-cn/?scope=two-b-refresh#chat='+encodeURIComponent(idB));await ready(page);
  await page.locator('#draftConflict').waitFor({state:'visible'});
  check(await page.locator('#prompt').inputValue()==='local2','Refreshing chat B showed the remote draft');
  check((await draftOf(idB)).draft.prompt==='remote2'&&(await draftOf(idB)).draft_version===remoteB.draft_version,'Refreshing chat B overwrote its saved draft');
  await page.goto(base+'/qwen-cn/?scope=two-a-return#chat='+encodeURIComponent(idA));await ready(page);
  await page.locator('#draftConflict').waitFor({state:'visible'});
  check(await page.locator('#prompt').inputValue()==='local1','Opening chat A showed only chat B\'s recovery');
  check((await draftOf(idA)).draft.prompt==='remote1'&&(await draftOf(idA)).draft_version===remoteA.draft_version,'Opening chat A overwrote its saved draft');
  await page.locator('#useRemoteDraft').click();
  await page.waitForFunction(()=>!dirty&&!conflict&&!saving);
  const left=await readRecords(page);
  check(left.length===1&&left[0].chatId===idB&&left[0].draft.prompt==='local2'&&left[0].awaitingChoice,'Discarding chat A cleared chat B');
  check((await draftOf(idA)).draft.prompt==='remote1','Discarding chat A changed its saved draft unexpectedly');
  await page.goto(base+'/qwen-cn/?scope=two-b-kept#chat='+encodeURIComponent(idB));await ready(page);
  await page.locator('#draftConflict').waitFor({state:'visible'});
  check(await page.locator('#prompt').inputValue()==='local2','Chat B\'s choice was gone after chat A was discarded');
  await page.locator('#keepDraft').click();
  await page.waitForFunction(()=>!dirty&&!conflict&&!saving);
  check(await transient(page)===null,'Saving chat B left a recovery copy');
  const keptB=await draftOf(idB);
  check(keptB.draft.prompt==='local2'&&keptB.draft_version>remoteB.draft_version,'Saving chat B did not keep its local draft');
  check((await draftOf(idA)).draft.prompt==='remote1'&&(await draftOf(idA)).draft_version===remoteA.draft_version,'Saving chat B wrote chat A');
  Object.assign(twoConflicts,{bothRestored:true,discardClearedOnlyThatScope:true,saveClearedOnlyThatScope:true});
 }
 const unsentNewChat={};
 {
  const idA=await openSaved('未发送甲','basePark');
  await page.goto(base+'/qwen-cn/?scope=park-a#chat='+encodeURIComponent(idA));await ready(page);
  const remoteA=await causeConflict(idA,'localA','remoteA');
  await page.goto(base+'/qwen-cn/?scope=unsent-new');await ready(page);
  check(await page.locator('#prompt').inputValue()==='','A new chat showed the parked draft');
  check(await page.locator('#draftConflict').isHidden(),'A new chat showed the parked conflict');
  const before=await count();
  await page.evaluate(()=>{
   const native=window.setTimeout;
   window.setTimeout=(fn,delay,...args)=>delay===450?0:native(fn,delay,...args);
  });
  await page.locator('#prompt').fill('unsentNewB');
  await page.waitForTimeout(800);
  check(await count()===before,'Autosave created a chat before the refresh');
  const parked=await readRecords(page);
  check(parked.some(record=>record.chatId===idA&&record.awaitingChoice&&record.draft.prompt==='localA'&&record.baseDraft.prompt==='basePark'),'Typing a new chat replaced the parked choice');
  check(parked.some(record=>(record.chatId||null)===null&&!record.awaitingChoice&&record.draft.prompt==='unsentNewB'),'The new chat was not stored before autosave');
  await page.reload();await ready(page);
  check(await page.locator('#prompt').inputValue()==='unsentNewB','Refresh dropped the new chat text saved before autosave');
  check(await page.locator('#draftConflict').isHidden(),'The unsaved new chat showed a conflict');
  await page.waitForFunction(()=>!!current&&!dirty&&!saving);
  check(await page.locator('#prompt').inputValue()==='unsentNewB','Immediate recovery replaced the new chat text');
  check(await count()===before+1,'Immediate recovery did not save the new chat');
  const created=chatFrom(page);
  check((await draftOf(created)).draft.prompt==='unsentNewB','The recovered new chat was not saved');
  const remaining=await readRecords(page);
  check(remaining.length===1&&remaining[0].chatId===idA&&remaining[0].awaitingChoice&&remaining[0].draft.prompt==='localA','Saving the new chat cleared or replaced the parked choice');
  check((await draftOf(idA)).draft.prompt==='remoteA'&&(await draftOf(idA)).draft_version===remoteA.draft_version,'Recovering the new chat wrote the parked chat');
  await page.goto(base+'/qwen-cn/?scope=park-return#chat='+encodeURIComponent(idA));await ready(page);
  await page.locator('#draftConflict').waitFor({state:'visible'});
  check(await page.locator('#prompt').inputValue()==='localA','The parked chat lost its local draft after the new chat was recovered');
  Object.assign(unsentNewChat,{restoredBeforeAutosave:true,parkedChoiceKept:true});
 }
 const navigateBeforeAutosave={};
 {
  const idB=await openSaved('已有对话乙','');
  await page.evaluate(()=>sessionStorage.removeItem('hanz-transient-draft'));
  const before=await count();
  await page.goto(base+'/qwen-cn/?scope=unsent-a');await ready(page);
  check(chatFrom(page)===null,'The new chat already had an id');
  check(await page.locator('#prompt').inputValue()==='','The new chat did not start empty');
  const text='尚未获得聊天编号的新草稿 A';
  const next=base+'/qwen-cn/?scope=existing-b#chat='+encodeURIComponent(idB);
  await page.locator('#prompt').fill(text);
  await page.goto(next);await ready(page);
  check(await count()===before,'The 450ms autosave created a chat before navigation');
  check(chatFrom(page)===idB,'Navigation did not open existing chat B');
  check(await page.locator('#prompt').inputValue()==='','Chat B opened with the unsaved new draft');
  check(await page.locator('#draftConflict').isHidden(),'Chat B showed a conflict');
  const parked=await readRecords(page);
  check(parked.length===1&&(parked[0].chatId||null)===null&&!parked[0].awaitingChoice&&parked[0].draft.prompt===text,'Navigation did not keep the unsaved new draft: '+JSON.stringify(parked));
  const typed='已有对话乙的正常保存';
  await page.locator('#prompt').fill(typed);
  await page.waitForFunction(()=>!dirty&&!saving);
  check(await page.locator('#prompt').inputValue()===typed,'Chat B did not keep its own typed draft');
  const savedB=await draftOf(idB);
  check(savedB.draft.prompt===typed,'Chat B normal save did not persist its own text');
  const afterSave=await readRecords(page);
  check(afterSave.length===1&&(afterSave[0].chatId||null)===null&&afterSave[0].draft.prompt===text&&!afterSave[0].awaitingChoice,'Saving chat B claimed the unsaved new draft: '+JSON.stringify(afterSave));
  check(!afterSave.some(record=>record.chatId===idB),'Ordinary save of chat B stored a transient record');
  await page.goto(base+'/qwen-cn/?scope=return-unsent-a');await ready(page);
  check(chatFrom(page)===null,'Returning did not open the new chat');
  check(await page.locator('#prompt').inputValue()===text,'Returning to the new chat did not restore A');
  check(await page.locator('#draftConflict').isHidden(),'The restored new chat showed a conflict');
  const stillB=await draftOf(idB);
  check(stillB.draft.prompt===typed&&stillB.draft_version===savedB.draft_version,'Returning to the new chat changed chat B');
  Object.assign(navigateBeforeAutosave,{restoredA:true,existingSaveLeftA:true,existingDataKept:true});
 }
 return {noEmptyOptionRows:true,noClearedTransientRows:true,conflictResolution:receipts,existingChatConflictResolution:existingChoices,existingChatIsolation:isolation,returnedToBase,sidebarReturn,projectEntry,twoConflicts,unsentNewChat,navigateBeforeAutosave};
}
