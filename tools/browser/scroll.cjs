// Current contract adapted from round5_scroll_acceptance.js. Run via tools/validate.py.
// Synthetic only. Start tools/round5_demo.py on8194; use Playwright CLI run-code.
module.exports = async(page)=>{
 const base=process.env.LOCALGPT_TEST_BASE,check=(x,m)=>{if(!x)throw Error(m)};
 if(!(await(await page.request.get(base+'/qwen-cn/health')).json()).demo)throw Error('Synthetic demo required');
 await page.setViewportSize({width:390,height:844});await page.goto(base+'/qwen-cn/');await page.locator('#prompt').waitFor();
 const chats=await(await page.request.get(base+'/qwen-cn/chats')).json();await page.goto(base+'/qwen-cn/#chat='+chats.find(x=>x.title==='Synthetic long conversation').id);await page.locator('.user-message').first().waitFor();
 await page.locator('#chatScroll').evaluate(e=>e.scrollTop=e.scrollHeight);
 await page.locator('#modelMenuTrigger').click();await page.locator('#modelMenu [data-value=chat]').click();await page.locator('#prompt').fill('Synthetic streaming scroll check');await page.locator('#prompt').press('Enter');
 await page.waitForFunction(()=>records.at(-1)?.status==='running'&&records.at(-1)?.answer?.length>16);
 const bottom=await page.locator('#chatScroll').evaluate(e=>e.scrollHeight-e.scrollTop-e.clientHeight);check(bottom<120,'Stream not following bottom');
 await page.locator('#chatScroll').evaluate(e=>e.scrollTop=0);const partial=await page.evaluate(()=>records.at(-1).answer.length);await page.waitForFunction(n=>records.at(-1).answer.length>n,partial);
 check((await page.locator('#chatScroll').evaluate(e=>e.scrollTop))<2,'Manual review pulled to bottom');await page.locator('#jumpLatest').waitFor({state:'visible'});
 const jump=await page.locator('#jumpLatest').boundingBox(),composer=await page.locator('#composerCard').boundingBox();check(jump.y+jump.height<composer.y,'Jump overlaps composer');await page.locator('#jumpLatest').click();await page.locator('#cancel').waitFor({state:'hidden'});
 await page.waitForFunction(()=>{const e=document.getElementById('chatScroll');return e.scrollHeight-e.scrollTop-e.clientHeight<120;});
 return {streamedPartial:true,autoFollow:true,manualReviewPreserved:true,jumpClearOfComposer:true,completed:true};
}
