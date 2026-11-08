// Playwright CLI run-code, synthetic demo only. Evidence stays outside Git.
async page => {
  if(!['8191','8193'].includes(new URL(page.url()).port))throw Error('Demo required');
  const health=await(await page.request.get(new URL('/qwen-cn/health',page.url()).href)).json();
  if(!health.demo)throw Error('Synthetic guard failed');
  const baseline=new URL(page.url()).port==='8191';
  const folder=`output/playwright/round2/${baseline?'before':'after'}`;
  const records=[];
  const shot=async name=>{
    await page.mouse.move(1,1);
    await page.screenshot({path:`${folder}/${name}.png`,scale:'css',animations:'disabled',caret:'hide'});
  };
  for(const theme of ['light','dark'])for(const [width,height] of [[1440,900],[1280,800],[390,844]]){
    await page.setViewportSize({width,height});
    await page.evaluate(theme=>{localStorage.setItem('qwen-studio-theme',theme);localStorage.setItem('qwen-studio-sidebar','closed');},theme);
    await page.reload();
    if(!await page.locator('#newChat').isVisible())await page.locator('#mobileMenu').click();
    await page.locator('#newChat').click();await page.locator('#intro').waitFor({state:'visible'});
    await shot(`empty-${theme}-${width}`);
    records.push(await page.locator(baseline?'.prompt-wrap':'#composerCard').evaluate((e,meta)=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {...meta,x:r.x,y:r.y,w:r.width,h:r.height,radius:s.borderRadius,bg:s.backgroundColor};},{theme,width,height}));
    if(!baseline){
      await page.locator('#upload').click();await shot(`attachment-${theme}-${width}`);await page.keyboard.press('Escape');
      await page.locator('#modelMenuTrigger').click();await shot(`model-${theme}-${width}`);await page.keyboard.press('Escape');
    }
    if(!await page.locator('#appSettings').isVisible())await page.locator('#mobileMenu').click();
    await page.locator('#appSettings').click();
    if(!baseline){
      if(width<=760)await page.locator('#settingsBack').click();
      await page.locator('[data-settings-section=general]').click();
    }
    await shot(`settings-${theme}-${width}`);
    if(!baseline){
      if(width<=760)await page.locator('#settingsBack').click();
      await page.locator('[data-settings-section=appearance]').click();await shot(`appearance-${theme}-${width}`);
      if(width<=760){await page.locator('#settingsBack').click();await shot(`settings-nav-${theme}-${width}`);await page.keyboard.press('Escape');}
    }
    await page.locator('#closePreferences').click();
  }
  return {baseline,records};
}
