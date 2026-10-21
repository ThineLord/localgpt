// Synthetic-only new-chat/draft lifecycle regression, including a failed write.
async page => {
  const base='http://127.0.0.1:8193';
  if(!(await(await page.request.get(base+'/qwen-cn/health')).json()).demo)throw Error('Synthetic demo required');
  const check=(ok,m)=>{if(!ok)throw Error(m);};
  const count=async()=>(await(await page.request.get(base+'/qwen-cn/chats')).json()).length;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:1440,height:900});
  await page.goto(base+'/qwen-cn/');
  await page.locator('#intro').waitFor({state:'visible'});
  if(await page.locator('#sidebarToggle').getAttribute('aria-expanded')==='true')await page.locator('#sidebarToggle').click();
  for(const [id,y] of [['sidebarToggle',8],['newChat',60],['galleryNav',112]]){
    const r=await page.locator('#'+id).boundingBox();
    check(r.x===8&&r.y===y&&r.width===36&&r.height===36,'Rail geometry: '+id);
  }
  const before=await count();
  await page.locator('#newChat').click();await page.locator('#newChat').click();
  check(await count()===before,'Untouched new chats created history rows');
  check(new URL(page.url()).hash==='','Blank page retained an old conversation route');
  await page.locator('#prompt').fill('Synthetic Round 3 saved draft');
  await page.waitForFunction(()=>typeof dirty!=='undefined'&&!dirty&&!!current);
  const id=new URLSearchParams(new URL(page.url()).hash.slice(1)).get('chat');
  check(await count()===before+1,'Draft did not materialize exactly once');
  check((await(await page.request.get(base+'/qwen-cn/chats/'+id)).json()).draft.prompt==='Synthetic Round 3 saved draft','Draft not durable');
  await page.locator('#newChat').click();check(await page.locator('#prompt').inputValue()==='','New chat retained prior text');
  await page.goto(base+'/qwen-cn/#chat='+id);await page.locator('#prompt').waitFor();
  await page.waitForFunction(()=>document.querySelector('#prompt').value==='Synthetic Round 3 saved draft');
  await page.goto(base+'/qwen-cn/');await page.locator('#intro').waitFor({state:'visible'});
  await page.route('**/qwen-cn/chats',async route=>route.request().method()==='POST'?route.fulfill({status:503,contentType:'application/json',body:'{"error":"Synthetic write failure"}'}):route.continue());
  await page.locator('#prompt').fill('Synthetic unsaved draft survives reload');
  await page.waitForFunction(()=>!!sessionStorage.getItem('hanz-transient-draft'));
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#prompt').value==='Synthetic unsaved draft survives reload');
  await page.unroute('**/qwen-cn/chats');
  await page.locator('#prompt').fill('Synthetic recovered draft');
  await page.waitForFunction(()=>typeof dirty!=='undefined'&&!dirty&&!!current);
  check(await page.evaluate(()=>sessionStorage.getItem('hanz-transient-draft')===null),'Recovery copy not cleared after successful save');
  await page.locator('#generate').click();
  await page.waitForFunction(()=>!!current?.messages.length&&!busy,null,{timeout:15000});
  check(await page.locator('.entry').count()>0,'Demo send did not render');
  check(errors.length===0,'Browser errors: '+errors.join(';'));
  return {emptyClicksCreateNoRows:true,durableDraft:true,historySwitch:true,reloadRecovery:true,send:true};
}
