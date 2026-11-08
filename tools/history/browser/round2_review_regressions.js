// Focused independent-review regressions; synthetic demo only, no model calls.
async page => {
  await page.setViewportSize({width:1440,height:900});
  await page.goto('http://127.0.0.1:8193/qwen-cn/');
  const health=await(await page.request.get('http://127.0.0.1:8193/qwen-cn/health')).json();
  if(!health.demo)throw Error('Synthetic demo required');
  const check=(ok,msg)=>{if(!ok)throw Error(msg);};
  await page.route('**/qwen-cn/models',async route=>{
    const response=await route.fetch(),data=await response.json();
    data.models.push({key:'review-alt',display_name:'Review alternate · Synthetic',type:'llm',loaded_instances:[]});
    await route.fulfill({response,json:data});
  });
  await page.reload();await page.locator('#newChat').click();await page.locator('#intro').waitFor({state:'visible'});
  await page.locator('#prompt').fill('Synthetic review options draft');
  await page.locator('#modelMenuTrigger').click();await page.locator('[data-kind=mode][data-value=chat]').click();
  await page.locator('#modelMenuTrigger').click();await page.locator('[data-kind=model][data-value=review-alt]').click();
  check(await page.evaluate(()=>JSON.parse(localStorage.getItem('hanzagent-options')).model==='review-alt'),'Model options not persisted');
  await page.waitForFunction(()=>document.querySelector('#saveState').textContent.includes('草稿已保存'));
  await page.reload();await page.waitForFunction(()=>document.querySelector('#chatModel').value==='review-alt');
  check((await page.locator('#modeHint').innerText()).includes('Review alternate'),'Model dependent hint stale');
  await page.locator('#modelMenuTrigger').click();await page.locator('#modelMenuTrigger').focus();await page.keyboard.press('Escape');
  check(!await page.locator('#modelMenu').isVisible(),'Escape from trigger did not close menu');
  await page.locator('#modelMenuTrigger').click();
  const settingsFocused=await page.evaluate(()=>{
    window.LiquidLayers.openSettings();
    return document.activeElement.id==='closeSettings';
  });
  check(settingsFocused,'Parameter panel did not synchronously move focus out of the hidden menu');
  check(!await page.locator('#modelMenu').isVisible(),'Parameter panel left a menu open behind it');
  await page.keyboard.press('Escape');
  check(!await page.locator('.settings').evaluate(e=>e.open),'First Escape did not close parameter panel');
  if(await page.locator('#sidebarToggle').getAttribute('aria-expanded')!=='true')await page.locator('#sidebarToggle').click();
  const id=new URLSearchParams(new URL(page.url()).hash.slice(1)).get('chat');
  await page.locator(`#chat-menu-${id}`).locator('..').locator('.chat-menu-trigger').click();
  const latest=await(await page.request.get('http://127.0.0.1:8193/qwen-cn/chats/'+id)).json();
  await page.request.patch('http://127.0.0.1:8193/qwen-cn/chats/'+id,{data:{version:latest.draft_version,title:'Synthetic refreshed menu'}});
  await page.evaluate(()=>dispatchEvent(new Event('focus')));
  await page.waitForFunction(()=>document.querySelector('#chatTitle').textContent==='Synthetic refreshed menu');
  check(await page.locator(`#chat-menu-${id}`).evaluate(e=>e.matches(':popover-open')&&e.contains(document.activeElement)),'Sidebar refresh lost open-menu focus');
  await page.keyboard.press('Escape');
  await page.unroute('**/qwen-cn/models');
  await page.locator('#modelMenuTrigger').click();await page.locator('[data-kind=model][data-value="qwen3-8b"]').click();
  const markdown=await page.evaluate(()=>{
    const box=document.createElement('div');box.className='markdown';document.body.append(box);
    window.markdown(box,'First line\nSecond line\n\n# Section');
    const result={space:getComputedStyle(box.querySelector('p')).whiteSpace,h1:box.querySelectorAll('h1').length,h2:box.querySelectorAll('h2').length};box.remove();return result;
  });
  check(markdown.space==='pre-line'&&markdown.h1===0&&markdown.h2===1,'Message line breaks or heading hierarchy regressed');
  await page.route('**/qwen-cn/chats/'+id,async route=>{
    const response=await route.fetch(),data=await response.json();
    data.messages.push({id:'review-unknown-size',kind:'image',status:'completed',prompt:'Synthetic legacy image without dimensions',image:{filename:'fixture.svg',subfolder:'',type:'output'}});
    data.messages.push({id:'review-stale-size',kind:'image',status:'completed',prompt:'Synthetic legacy image with stale square metadata',width:512,height:512,image:{filename:'review-wide.svg',subfolder:'',type:'output'}});
    await route.fulfill({response,json:data});
  });
  await page.route('**/view?*',async route=>{
    if(new URL(route.request().url()).searchParams.get('filename')!=='review-wide.svg')return route.continue();
    await route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320"><rect width="640" height="320" fill="#c4cec0"/></svg>'});
  });
  await page.reload();
  const legacy=page.locator('[data-message-id="review-unknown-size"] .result img');
  await legacy.waitFor();await legacy.evaluate(e=>e.decode());
  const legacySize=await legacy.boundingBox();check(legacySize.width>0&&legacySize.height>0,'Unknown image dimensions collapsed legacy output');
  const stale=page.locator('[data-message-id="review-stale-size"] .result img');
  await stale.scrollIntoViewIfNeeded();await stale.evaluate(e=>e.decode());
  const staleSize=await stale.boundingBox();check(Math.abs(staleSize.width/staleSize.height-2)<0.01,'Stored dimensions distorted the decoded image');
  await page.screenshot({path:'output/playwright/round2/after/legacy-image-proportions.png',scale:'css',animations:'disabled'});
  await page.unroute('**/view?*');await page.unroute('**/qwen-cn/chats/'+id);await page.reload();
  return {legacySize,staleSize,parameterPanelClosesMenus:true,modelPersistence:true,dependentHint:true,escapeOutsidePanel:true,menuFocusAfterRefresh:true,markdown};
}
