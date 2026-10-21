// Playwright run-code function. Synthetic port 8193 only; recovery receipt is mocked.
async(page)=>{
 const base='http://127.0.0.1:8193';if(!(await(await page.request.get(base+'/qwen-cn/health')).json()).demo)throw Error('Synthetic only');
 const check=(x,m)=>{if(!x)throw Error(m);};await page.setViewportSize({width:1440,height:900});await page.goto(base+'/qwen-cn/');await page.evaluate(()=>localStorage.setItem('qwen-studio-language','zh'));await page.reload();await page.locator('#prompt').waitFor();
 const open=async()=>{await page.locator('#profileButton').click();await page.locator('#appSettings').click();};
 await open();await page.locator('#language').click();check((await page.locator('[data-settings-section=about]').textContent()).trim()==='About','Injected About label did not translate');check((await page.locator('#settingsPanelDiagnostics > h3').textContent()).includes('Local services'),'Injected diagnostic title did not translate');
 await page.locator('[data-settings-section=diagnostics]').click();check((await page.locator('#manageReferenceFiles').textContent()).includes('Manage uploaded'),'Upload controls did not translate');
 await page.locator('[data-settings-section=memory]').click();await page.locator('#memoryNav').click();check(await page.locator('#memorySearch').getAttribute('placeholder')==='Search memories','Memory search did not translate');check(await page.locator('#memoryAddButton').textContent()==='Add memory','Memory Add label did not translate');await page.locator('#closeMemory').click();
 await page.reload();await page.locator('#prompt').waitFor();await open();await page.locator('#language').click();check((await page.locator('[data-settings-section=about]').textContent()).trim()==='关于','English startup -> Chinese failed');check((await page.locator('#settingsPanelDiagnostics > h3').textContent()).includes('本地服务'),'Chinese diagnostic title failed');
 await page.locator('[data-settings-section=diagnostics]').click();
 let recovered=false;
 await page.route('**/qwen-cn/uploads/recovery',route=>route.fulfill({json:{items:recovered?[]:[{id:'synthetic-recovery',image:{filename:'synthetic-reference.png'},file_present:true,state:'retained'}]}}));
 await page.route('**/qwen-cn/uploads/recovery/synthetic-recovery/register',route=>{recovered=true;return route.fulfill({json:{registered:true}});});
 await page.locator('#manageReferenceFiles').click();
 await page.locator('[data-recovery-id="synthetic-recovery"] button').click();
 await page.locator('[data-recovery-id="synthetic-recovery"]').waitFor({state:'detached'});check(recovered,'Recovery action not dispatched');
 await page.unroute('**/qwen-cn/uploads/recovery');await page.unroute('**/qwen-cn/uploads/recovery/synthetic-recovery/register');
 return {chineseToEnglish:true,englishStartupToChinese:true,settings:true,uploads:true,memory:true,syntheticRecoveryAction:true};
}
