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
  await page.locator('#modelMenuTrigger').click();await page.locator('[data-kind=mode][data-value=chat]').click();
  await page.locator('#modelMenuTrigger').click();await page.locator('[data-kind=model][data-value=review-alt]').click();
  check(await page.evaluate(()=>JSON.parse(localStorage.getItem('hanzagent-options')).model==='review-alt'),'Model options not persisted');
  await page.waitForFunction(()=>document.querySelector('#saveState').textContent.includes('草稿已保存'));
  await page.reload();await page.waitForFunction(()=>document.querySelector('#chatModel').value==='review-alt');
  check((await page.locator('#modeHint').innerText()).includes('Review alternate'),'Model dependent hint stale');
  await page.locator('#modelMenuTrigger').click();await page.locator('#modelMenuTrigger').focus();await page.keyboard.press('Escape');
  check(!await page.locator('#modelMenu').isVisible(),'Escape from trigger did not close menu');
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
    await route.fulfill({response,json:data});
  });
  await page.reload();
  const legacy=page.locator('[data-message-id="review-unknown-size"] .result img');
  await legacy.waitFor();await legacy.evaluate(e=>e.decode());
  const legacySize=await legacy.boundingBox();check(legacySize.width>0&&legacySize.height>0,'Unknown image dimensions collapsed legacy output');
  await page.unroute('**/qwen-cn/chats/'+id);await page.reload();
  return {legacySize,modelPersistence:true,dependentHint:true,escapeOutsidePanel:true,menuFocusAfterRefresh:true,markdown};
}
