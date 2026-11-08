// Synthetic demo only. Run with Playwright CLI run-code.
async (page) => {
  const base='http://127.0.0.1:8193', out='output/playwright/round4/';
  if(!(await(await page.request.get(base+'/qwen-cn/health')).json()).demo)throw Error('Synthetic demo required');
  const errors=[],result={};page.on('pageerror',e=>errors.push(e.message));
  const check=(v,m)=>{if(!v)throw Error(m);};
  const shot=n=>page.screenshot({path:out+n+'.png',scale:'css'});
  const state=s=>page.waitForFunction(s=>document.querySelector('#sidebar').dataset.state===s,s);
  const settings=async()=>{await page.locator('#profileButton').click();await page.locator('#appSettings').click();};
  await page.setViewportSize({width:1440,height:900});await page.goto(base+'/qwen-cn/');
  await page.evaluate(()=>{localStorage.setItem('qwen-studio-theme','light');localStorage.setItem('qwen-studio-sidebar','open');});await page.reload();
  await page.locator('#chatList .chat-item').first().waitFor();await state('pinned');
  check(await page.locator('#memoryDialog').isHidden(),'Closed Memory must be hidden');
  const count=(await(await page.request.get(base+'/qwen-cn/chats')).json()).length;
  await page.locator('#newChat').click();await page.locator('#newChat').click();
  check((await(await page.request.get(base+'/qwen-cn/chats')).json()).length===count,'New chat created empty rows');
  await page.locator('#prompt').fill('Synthetic unsent draft');await page.reload();
  await page.waitForFunction(()=>document.querySelector('#prompt').value==='Synthetic unsent draft');
  await page.locator('#prompt').fill('');await shot('1440-light-empty');
  await page.locator('#historyPanel').hover();await page.locator('#sidebarToggle').click();await state('collapsed');
  await page.mouse.move(700,100);await shot('1440-light-collapsed');
  await page.locator('#homeNav').hover();await state('temporary');await page.locator('#historyPanel').hover();await shot('1440-light-hover');
  await page.mouse.move(700,100);await state('collapsed');
  await page.locator('#homeNav').hover();await page.locator('#sidebarToggle').click();await state('pinned');
  await page.mouse.move(700,100);await state('pinned');
  await page.locator('.chat-item').first().hover();await page.locator('.chat-menu-trigger').first().click();
  await shot('1440-light-history-menu');await page.keyboard.press('Escape');
  check(await page.locator('.chat-menu-trigger').first().evaluate(e=>e===document.activeElement),'History focus return');
  await page.locator('#profileButton').click();await shot('1440-light-profile');
  await page.locator('#profileAppearance').click();await shot('1440-light-appearance');await page.keyboard.press('Escape');
  check(await page.locator('#profileButton').evaluate(e=>e===document.activeElement),'Appearance Escape focus return');
  await settings();await shot('1440-light-settings');
  await page.locator('[data-settings-section=diagnostics]').click();await page.locator('#settingsDiagnosticsRefresh').waitFor({state:'visible'});await page.waitForTimeout(300);await shot('1440-light-diagnostics');
  await page.locator('#manageReferenceFiles').click();await shot('1440-light-reference-files');await page.locator('#closePreferences').click();
  await page.locator('#profileButton').click();await page.locator('#profileMemory').click();await page.locator('#memorySearch').fill('');
  await page.locator('#memorySearch').pressSequentially('Synthetic',{delay:30});
  check(await page.locator('#memorySearch').evaluate(e=>e===document.activeElement),'Search lost keyboard focus');
  await shot('1440-light-memory');await page.locator('#memoryAddButton').click();await shot('1440-light-memory-editor');
  await page.keyboard.press('Escape');check(await page.locator('#memoryListView').isVisible(),'Escape should return editor to list');
  await page.keyboard.press('Escape');
  for(const theme of ['light','dark'])for(const [width,height]of[[1280,800],[390,844]]){
    await page.setViewportSize({width,height});await page.evaluate(t=>localStorage.setItem('qwen-studio-theme',t),theme);await page.reload();await page.locator('#prompt').waitFor();
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow');
    if(width===390){await state('mobile-closed');await page.locator('#mobileMenu').click();await state('mobile-overlay');check(await page.locator('#mainContent').evaluate(e=>e.inert),'Mobile main not inert');}
    await shot(`${width}-${theme}-sidebar`);
    await page.locator('#profileButton').click();await shot(`${width}-${theme}-profile`);await page.locator('#appSettings').click();await shot(`${width}-${theme}-settings`);
    if(width===390){await page.locator('#settingsBack').click();}
    await page.locator('[data-settings-section=memory]').click();await page.locator('#memoryNav').click();await shot(`${width}-${theme}-memory`);
    check((await page.locator('#memoryDialog').boundingBox()).width<=width,'Memory overflow');await page.locator('#closeMemory').click();
    if(await page.locator('#preferencesDialog').isVisible())await page.locator('#closePreferences').click();
    if(width===390){await page.keyboard.press('Escape');await state('mobile-closed');check(!(await page.locator('#mainContent').evaluate(e=>e.inert)),'Mobile close left main inert');}
  }
  await page.setViewportSize({width:1440,height:900});await page.reload();await page.locator('#prompt').waitFor();
  await page.route('**/qwen-cn/chats',r=>r.request().method()==='GET'?r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'database_unavailable',error:'Synthetic SQLite unavailable'})}):r.continue());
  await page.reload();await page.locator('#retryConnection').waitFor({state:'visible'});await shot('database-unavailable');
  check((await page.locator('#connection').textContent()).includes('数据库'),'Database error not distinguished');
  await page.unroute('**/qwen-cn/chats');await page.locator('#retryConnection').click();await page.locator('#retryConnection').waitFor({state:'hidden'});
  await page.route('**/qwen-cn/chats',r=>r.abort('connectionrefused'));await page.reload();await page.locator('#retryConnection').waitFor({state:'visible'});
  check(!(await page.locator('#connection').textContent()).includes('数据库'),'Offline incorrectly called database failure');
  await page.unroute('**/qwen-cn/chats');await page.locator('#retryConnection').click();await page.locator('#retryConnection').waitFor({state:'hidden'});
  for(let i=0;i<3;i++){await page.reload();await page.locator('#chatList .chat-item').first().waitFor();}
  check(!errors.length,'JS errors: '+errors.join(';'));
  return {...result,sidebarStates:true,newChatAndDraft:true,menusFocus:true,settingsMemory:true,responsiveThemes:true,errorRecovery:true,repeatedRefresh:true,errors};
}
