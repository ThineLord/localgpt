async(page)=>{
 const base='http://127.0.0.1:8194',out='output/playwright/round6/';
 if(!(await(await page.request.get(base+'/qwen-cn/health')).json()).demo)throw Error('Synthetic demo required');
 const errors=[],results=[];page.on('pageerror',e=>errors.push(e.message));const check=(x,m)=>{if(!x)throw Error(m)};
 const chats=await(await page.request.get(base+'/qwen-cn/chats')).json();const long=chats.find(c=>c.title==='Synthetic long conversation');
 for(const [width,height] of [[1440,900],[1280,800],[390,844]])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height});await page.goto(base+'/qwen-cn/');
  await page.evaluate(t=>{localStorage.setItem('qwen-studio-theme',t);localStorage.setItem('qwen-studio-sidebar','closed');},theme);await page.reload();
  await page.waitForFunction(()=>document.getElementById('connection').dataset.state==='online');
  check(await page.locator('#headerNewChat').isHidden(),'Empty page new button');
  await page.screenshot({path:out+`after-${width}-${theme}-empty.png`});
  const count=async()=>(await(await page.request.get(base+'/qwen-cn/chats')).json()).length;const n=await count();
  if(width<=760)await page.locator('#mobileMenu').click();
  await page.locator('#homeNav').click();check(await count()===n,'Empty Home created DB row');
  await page.goto(base+'/qwen-cn/#chat='+long.id);await page.locator('.user-message').first().waitFor();
  check(await page.locator('#headerNewChat').isVisible(),'Populated page missing new button');
  await page.screenshot({path:out+`after-${width}-${theme}-chat.png`});
  if(width>760){
   await page.mouse.move(width-20,400);await page.locator('#homeNav').hover();await page.waitForFunction(()=>document.body.classList.contains('sidebar-temporary'));
   check(await page.locator('#sidebarToggle').evaluate(e=>getComputedStyle(e).opacity==='1'),'Temporary toggle invisible');
   await page.screenshot({path:out+`after-${width}-${theme}-temporary.png`});
   await page.locator('#sidebarToggle').click();await page.mouse.move(width-20,400);
   const shell=await page.locator('#mainContent').evaluate(e=>({clip:getComputedStyle(e).clipPath,x:e.getBoundingClientRect().x}));
   check(shell.x===340,'Pinned inset');check(shell.clip==='inset(0px round 0px 16px 0px 0px)','Pinned corners '+shell.clip);
   await page.screenshot({path:out+`after-${width}-${theme}-pinned.png`});
   await page.locator('#profileButton').click();await page.locator('#appSettings').click();
   const settings=await page.locator('.settings-page').evaluate(e=>({clip:getComputedStyle(e).clipPath,x:e.getBoundingClientRect().x}));
   check(JSON.stringify(shell)===JSON.stringify(settings),'Settings surface differs');
   await page.screenshot({path:out+`after-${width}-${theme}-settings.png`});
   await page.locator('#closePreferences').click();
   await page.locator('#homeNav').click();check(await page.locator('#intro').isVisible(),'Home did not navigate blank');
   check(await page.locator('#headerNewChat').isHidden(),'Home left header new button');
   check(await page.locator('#sidebar').getAttribute('data-state')==='pinned','Home changed pin');
   await page.locator('#historyPanel').hover();await page.locator('#sidebarToggle').click();
  }else{
   await page.locator('#mobileMenu').click();await page.locator('#homeNav').click();check(await page.locator('#intro').isVisible(),'Mobile Home');
   check(await page.locator('#sidebar').getAttribute('data-state')==='mobile-closed','Mobile Home did not close');
   await page.locator('#mobileMenu').click();await page.locator('#profileButton').click();await page.locator('#appSettings').click();
   await page.screenshot({path:out+`after-${width}-${theme}-settings.png`});await page.locator('#closePreferences').click();
  }
  check(await count()===n,'Navigation created records');
  check(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),'Horizontal overflow');
  results.push({width,height,theme,emptyHome:true,populated:true,surface:true});
 }
 check(!errors.length,errors.join(';'));return {results,errors};
}
