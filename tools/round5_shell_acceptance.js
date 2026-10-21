// Synthetic only. Start tools/round5_demo.py on8194; use Playwright CLI run-code.
async(page)=>{
 const out='output/playwright/round5/',base='http://127.0.0.1:8194';
 if(!(await(await page.request.get(base+'/qwen-cn/health')).json()).demo)throw Error('Synthetic demo required');
 const checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));const check=(v,m)=>{if(!v)throw Error(m)};
 const state=s=>page.waitForFunction(s=>document.querySelector('#sidebar').dataset.state===s,s);
 for(const [width,height]of[[1440,900],[1280,800],[390,844]])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height});await page.goto(base+'/qwen-cn/');
  await page.evaluate(t=>{localStorage.setItem('qwen-studio-theme',t);localStorage.setItem('qwen-studio-sidebar','closed');},theme);await page.reload();await page.locator('#prompt').waitFor();
  const chats=await(await page.request.get(base+'/qwen-cn/chats')).json();
  await page.goto(base+'/qwen-cn/#chat='+chats.find(c=>c.title==='Synthetic long conversation').id);await page.locator('.user-message').first().waitFor();
  await page.locator('#chatScroll').evaluate(e=>e.scrollTop=300);await page.mouse.move(width-40,400);
  const boxes=await page.evaluate(()=>{const box=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right}};return {scroll:box('chatScroll'),main:box('mainContent'),composer:box('composerCard'),conversation:box('conversation'),overflow:document.documentElement.scrollWidth>innerWidth,titleVisible:!!document.getElementById('chatTitle').getClientRects().length};});
  check(Math.abs(boxes.scroll.right-width)<1,'Scrollbar not at viewport right');check(!boxes.overflow,'Horizontal overflow');check(!boxes.titleVisible,'Header title still visible');
  check(Math.abs((boxes.composer.x+boxes.composer.width/2)-(boxes.conversation.x+boxes.conversation.width/2))<1,'Composer and conversation centers differ');
  await page.screenshot({path:out+`after-${width}-${theme}-chat.png`,scale:'css'});
  if(width>760){
   await page.locator('#homeNav').hover();await state('temporary');
   check(await page.locator('#sidebarToggle').evaluate(e=>getComputedStyle(e).opacity==='1'),'Home hover did not reveal Toggle');
   await page.waitForFunction(()=>Math.abs(document.getElementById('historyPanel').getBoundingClientRect().x-56)<.01);const panel=await page.locator('#historyPanel').boundingBox();check(Math.abs(panel.x-56)<.1&&panel.y===4&&Math.abs(panel.width-284)<.1&&panel.height===height-8,'Temporary panel geometry '+JSON.stringify(panel));
   check((await page.locator('#composerCard').boundingBox()).x===boxes.composer.x,'Temporary moved composer');
   await page.screenshot({path:out+`after-${width}-${theme}-temporary.png`,scale:'css'});
   await page.mouse.move(54,25);await state('temporary');await page.locator('#historyPanel').hover();await state('temporary');await page.mouse.move(width-40,400);await state('collapsed');
   await page.locator('#galleryNav').hover();await page.locator('#chromeTooltip').waitFor({state:'visible'});check(!(await page.locator('#galleryNav').getAttribute('title')),'Duplicate native title');await page.screenshot({path:out+`after-${width}-${theme}-tooltip.png`,scale:'css'});
   await page.keyboard.press('Escape');check(await page.locator('#chromeTooltip').isHidden(),'Tooltip Escape');
   await page.locator('#homeNav').hover();await page.locator('#sidebarToggle').click();await state('pinned');await page.mouse.move(width-40,400);check((await page.locator('#mainContent').boundingBox()).x===340,'Pinned main inset');await page.screenshot({path:out+`after-${width}-${theme}-pinned.png`,scale:'css'});
   await page.locator('#historyPanel').hover();await page.locator('#sidebarToggle').click();await state('collapsed');
  }else{
   await state('mobile-closed');await page.locator('#mobileMenu').click();await state('mobile-overlay');check(await page.locator('#mainContent').evaluate(e=>e.inert),'Mobile main should be inert');await page.screenshot({path:out+`after-${width}-${theme}-sidebar.png`,scale:'css'});await page.keyboard.press('Escape');await state('mobile-closed');
  }
  checks.push({width,theme,...boxes});
 }
 check(!errors.length,errors.join(';'));return {checks,errors};
}
