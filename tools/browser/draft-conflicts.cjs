// Current contract adapted from round3_review_regressions.js. Run via tools/validate.py.
// Mason's two MEDIUM findings: empty option changes and conflicting recovery.
module.exports = async page=>{
 const base=process.env.LOCALGPT_TEST_BASE;
 if(!(await(await page.request.get(base+'/qwen-cn/health')).json()).demo)throw Error('Synthetic only');
 const check=(x,m)=>{if(!x)throw Error(m);};
 const count=async()=>(await(await page.request.get(base+'/qwen-cn/chats')).json()).length;
 await page.setViewportSize({width:1440,height:900});await page.goto(base+'/qwen-cn/');await page.locator('#intro').waitFor({state:'visible'});
 const before=await count();
 await page.locator('#upload').click();await page.locator('#attach-image-mode').click();
 await page.waitForFunction(()=>!dirty&&!saving);
 check(await count()===before,'Mode-only change created an empty chat');
 await page.locator('#prompt').fill('discard before autosave');await page.locator('#prompt').fill('');
 await page.waitForFunction(()=>!dirty&&!saving);
 check(await count()===before,'Cleared transient input created an empty chat');
 const receipts=[];
 for(const keep of [false,true]){
  await page.goto(base+'/qwen-cn/');await page.locator('#intro').waitFor({state:'visible'});
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
  await page.unroute('**/qwen-cn/chats/*');await page.reload();await page.locator('#draftConflict').waitFor({state:'visible'});
  check(await page.locator('#prompt').inputValue()==='Local recovery '+keep,'Local input was lost');
  await page.locator('#prompt').fill('Local recovery edited '+keep);
  await page.reload();await page.locator('#draftConflict').waitFor({state:'visible'});
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
 return {noEmptyOptionRows:true,noClearedTransientRows:true,conflictResolution:receipts};
}
