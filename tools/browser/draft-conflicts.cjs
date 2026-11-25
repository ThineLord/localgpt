// Current contract adapted from round3_review_regressions.js. Run via tools/validate.py.
// Mason's two MEDIUM findings: empty option changes and conflicting recovery.
// An already saved chat must keep an unresolved conflict across same-tab reloads.
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
 return {noEmptyOptionRows:true,noClearedTransientRows:true,conflictResolution:receipts,existingChatConflictResolution:existingChoices,existingChatIsolation:isolation};
}
