// Focused browser evidence for the observed attachment component; synthetic only.
async page => {
  const base='http://127.0.0.1:8193';
  if(!(await(await page.request.get(base+'/qwen-cn/health')).json()).demo)throw Error('Synthetic demo required');
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  const measurements=[];
  await page.goto(base+'/qwen-cn/');
  await page.evaluate(()=>{localStorage.setItem('qwen-studio-theme','dark');localStorage.setItem('qwen-studio-sidebar','closed');});
  await page.reload();
  for(const [width,height] of [[1440,900],[390,844]]){
    await page.setViewportSize({width,height});
    if(width<=760)await page.locator('#mobileMenu').click();
    await page.locator('#newChat').click();
    await page.locator('#intro').waitFor({state:'visible'});
    await page.locator('#upload').click();
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#attach-upload')).backgroundColor==='rgb(56, 56, 56)');
    const metrics=await page.evaluate(()=>{
      const card=document.querySelector('#composerCard').getBoundingClientRect();
      const panel=document.querySelector('#attachmentMenu'),p=panel.getBoundingClientRect();
      const item=document.querySelector('#attach-upload'),r=item.getBoundingClientRect(),s=getComputedStyle(item);
      const icon=item.querySelector('svg').getBoundingClientRect(),label=item.querySelector('span').getBoundingClientRect();
      return {viewport:[innerWidth,innerHeight],composer:{x:card.x,y:card.y,w:card.width,h:card.height},panel:{x:p.x,y:p.y,w:p.width,h:p.height},gap:p.y>=card.bottom?p.y-card.bottom:card.y-p.bottom,row:{x:r.x,y:r.y,w:r.width,h:r.height,background:s.backgroundColor},iconX:icon.x,labelX:label.x,focus:document.activeElement.id};
    });
    check(Math.abs(metrics.panel.w-metrics.composer.w)<1,'Attachment width differs from composer');
    check(Math.abs(metrics.gap-4)<1,'Attachment anchor gap differs from observed 4px');
    check(metrics.focus==='attach-upload','First menu action did not receive focus');
    check(metrics.row.background==='rgb(56, 56, 56)','Focused action lacks reference highlight');
    check(Math.abs(metrics.row.x-metrics.panel.x-8)<1,'Panel inner inset differs');
    check(Math.abs(metrics.iconX-metrics.row.x-8)<1,'Icon inset differs');
    await page.mouse.move(width-1,1);
    await page.screenshot({path:`output/playwright/round3/after/attachment-${width}.png`,scale:'css',animations:'disabled'});
    await page.keyboard.press('ArrowDown');check(await page.locator('#attach-image-mode').evaluate(e=>e===document.activeElement),'Arrow navigation failed');
    await page.keyboard.press('End');check(await page.locator('#attach-generation').evaluate(e=>e===document.activeElement),'End navigation failed');
    await page.keyboard.press('Home');check(await page.locator('#attach-upload').evaluate(e=>e===document.activeElement),'Home navigation failed');
    await page.keyboard.press('Escape');check(!await page.locator('#attachmentMenu').isVisible(),'Escape did not dismiss');
    check(await page.locator('#upload').evaluate(e=>e===document.activeElement),'Escape did not restore trigger focus');
    await page.locator('#upload').click();await page.keyboard.press('Tab');
    check(!await page.locator('#attachmentMenu').isVisible(),'Tab did not dismiss');
    check(!await page.locator('#attachmentMenu').evaluate(e=>e.contains(document.activeElement)),'Tab left focus inside hidden menu');
    await page.locator('#upload').click();await page.locator('#chatTitle').click();check(!await page.locator('#attachmentMenu').isVisible(),'Outside click did not dismiss');
    await page.locator('#upload').click();await page.locator('#attach-generation').click();
    check(await page.locator('.settings').evaluate(e=>e.open),'Generation settings action failed');await page.keyboard.press('Escape');
    await page.locator('#upload').click();await page.locator('#attach-image-mode').click();
    check(await page.locator('#mode').inputValue()==='image'&&await page.locator('#chatModel').evaluate(e=>e.hidden),'Image action lost native input/change contract');
    measurements.push(metrics);
  }
  return {measurements,keyboardDismiss:true,nativeActions:true};
}
