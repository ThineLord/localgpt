// Current contract adapted from round5_gallery_integration.js. Run via tools/validate.py.
// Synthetic only. Start tools/round5_demo.py on8194; use Playwright CLI run-code.
module.exports = async(page)=>{
const base=process.env.LOCALGPT_TEST_BASE,out=(process.env.LOCALGPT_TEST_OUTPUT + '/');if(!(await(await page.request.get(base+'/qwen-cn/health')).json()).demo)throw Error('Synthetic demo required');const checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));const check=(x,m)=>{if(!x)throw Error(m)};
for(const [width,height]of[[1440,900],[1280,800],[390,844]])for(const theme of ['light','dark']){
 await page.setViewportSize({width,height});await page.goto(base+'/qwen-cn/');await page.waitForFunction(() => typeof appReady !== 'undefined' && appReady);await page.evaluate(t=>{localStorage.setItem('qwen-studio-theme',t);localStorage.setItem('qwen-studio-sidebar','closed');},theme);await page.reload();await page.locator('#prompt').waitFor();
 await page.goto(base+'/qwen-cn/#gallery');await page.waitForFunction(() => typeof appReady !== 'undefined' && appReady);await page.locator('.gallery-img--loaded').first().waitFor();await page.waitForTimeout(200);
 const measure=await page.evaluate(()=>{const grid=document.getElementById('galleryGrid'),r=grid.getBoundingClientRect(),tiles=[...grid.children].map(e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height,bottom:b.bottom}});let maxGap=0;for(const t of tiles){const prev=tiles.filter(p=>Math.abs(p.x-t.x)<1&&p.y<t.y).sort((a,b)=>b.y-a.y)[0];if(prev)maxGap=Math.max(maxGap,t.y-prev.bottom)}return {cols:Number(grid.dataset.galleryCols),grid:{x:r.x,y:r.y,w:r.width},tiles,maxGap,overflow:document.documentElement.scrollWidth>innerWidth};});
 check(measure.cols===(width===1440?6:width===1280?5:1),'Incorrect columns '+JSON.stringify(measure));check(measure.maxGap<=17,'Masonry gaps');check(!measure.overflow,'Gallery overflow');
 await page.mouse.move(width-10,height-10);await page.screenshot({path:out+`after-${width}-${theme}-gallery.png`,scale:'css'});
 const card=page.locator('.gallery-card').first();await card.click();await page.locator('#imageDialog').waitFor({state:'visible'});const viewer=await page.locator('#imageDialog').boundingBox();check(viewer.width===width-(width>760?52:0),'Viewer main width');
 const img=page.locator('#galleryPreview');await img.evaluate(e=>e.decode());await page.screenshot({path:out+`after-${width}-${theme}-viewer.png`,scale:'css'});
 const link=await page.locator('#galleryDownload').getAttribute('href');check((await page.request.get(base+link)).ok(),'Download failed');await page.keyboard.press('Escape');check(await card.evaluate(e=>e===document.activeElement),'Viewer focus return');
 checks.push({width,theme,cols:measure.cols,grid:measure.grid,maxGap:measure.maxGap,viewer});
}
check(!errors.length,errors.join(';'));return {checks,errors};
}
