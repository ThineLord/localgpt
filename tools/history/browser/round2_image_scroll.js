// Regression for image decode changing scroll height. Synthetic demo only.
async page=>{
 await page.setViewportSize({width:1440,height:900});await page.goto('http://127.0.0.1:8193/qwen-cn/');
 const health=await(await page.request.get('http://127.0.0.1:8193/qwen-cn/health')).json();if(!health.demo)throw Error('Synthetic demo required');
 if(await page.locator('#sidebarToggle').getAttribute('aria-expanded')==='true')await page.locator('#sidebarToggle').click();
 await page.locator('#newChat').click();await page.locator('#intro').waitFor({state:'visible'});
 const mode=async v=>{await page.locator('#modelMenuTrigger').click();await page.locator(`#modelMenu [data-kind=mode][data-value=${v}]`).click();};
 const idle=()=>page.waitForFunction(()=>document.querySelector('#cancel').hidden&&document.querySelector('#activity').hidden);
 await mode('chat');await page.locator('#prompt').fill('合成图片占位与自动滚动测试');await page.locator('#prompt').press('Enter');await page.locator('#cancel').waitFor({state:'visible'});await idle();
 await page.route('**/view?*',async route=>{await new Promise(r=>setTimeout(r,3000));await route.continue();});
 await mode('image');await page.locator('#prompt').fill('合成图像延迟解码测试');await page.locator('#prompt').press('Enter');await page.locator('#cancel').waitFor({state:'visible'});
 const img=page.locator('.result img').last();await img.waitFor({state:'attached'});
 const before=await img.evaluate(e=>({loaded:e.complete,rect:{width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}}));
 if(before.rect.height<300)throw Error('Image space not reserved');
 await img.evaluate(e=>e.decode());await idle();
 const gap=await page.locator('#chatScroll').evaluate(e=>e.scrollHeight-e.scrollTop-e.clientHeight);
 if(gap>8)throw Error('Auto follow lost after image decode: '+gap);
 await page.screenshot({path:'output/playwright/round2/after/image-result.png',scale:'css',animations:'disabled'});
 await page.reload();await page.locator('.result img').waitFor({state:'attached'});
 await page.locator('#chatScroll').evaluate(e=>e.scrollTop=0);
 await page.locator('.result img').last().evaluate(e=>e.decode());
 const held=await page.locator('#chatScroll').evaluate(e=>e.scrollTop);
 if(held>5)throw Error('Image decode stole manual scroll position');
 await page.unroute('**/view?*');return {reserved:before,followGap:gap,manualPosition:held};
}
