// Synthetic demo on8194. Header removal must not shift the established empty layout.
async(page)=>{
 const base='http://127.0.0.1:8194';
 if(!(await(await page.request.get(base+'/qwen-cn/health')).json()).demo)throw Error('Synthetic demo required');
 const result=[];
 for(const [width,height] of [[1440,900],[1280,800],[390,844]])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height});await page.goto(base+'/qwen-cn/');await page.evaluate(t=>{localStorage.setItem('qwen-studio-sidebar','closed');localStorage.setItem('qwen-studio-theme',t);},theme);await page.reload();if(await page.locator('#headerNewChat').isVisible())await page.locator('#headerNewChat').click();await page.locator('#intro').waitFor({state:'visible'});
  const intro=await page.locator('#intro').boundingBox(),composer=await page.locator('#composerCard').boundingBox();
  const padding=await page.locator('#intro').evaluate(e=>parseFloat(getComputedStyle(e).paddingTop));
  if(Math.abs(padding-Math.max(152,height*.4-(width<=760?20:72)))>.1)throw Error('Empty heading position');
  if(width>760&&Math.abs(composer.y-(height*.4+18))>.1)throw Error('Empty composer moved from reference position');
  if(await page.locator('#chatTitle').isVisible())throw Error('Header title returned');
  await page.screenshot({path:`output/playwright/round5/after-${width}-${theme}-empty.png`,scale:'css'});result.push({width,theme,intro,composer});
 }
 return {result};
}
