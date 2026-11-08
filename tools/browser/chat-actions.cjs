// Current contract adapted from round5_header_actions_acceptance.js. Run via tools/validate.py.
// Use tools/round5_demo.py on8194. No production data.
module.exports = async(page)=>{
 const base=process.env.LOCALGPT_TEST_BASE;
 if(!(await(await page.request.get(base+'/qwen-cn/health')).json()).demo)throw Error('Synthetic demo required');
 const check=(x,m)=>{if(!x)throw Error(m)};
 const created=await(await page.request.post(base+'/qwen-cn/chats',{data:{title:'Synthetic header actions'}})).json();
 await page.setViewportSize({width:1440,height:900});await page.goto(base+'/qwen-cn/#chat='+created.id);await page.reload();await page.locator('#chatActions').waitFor();
 await page.locator('#chatActions').click();await page.locator('#renameChat').click();await page.locator('#chatName').fill('Synthetic renamed from header');await page.locator('#renameForm button[type=submit]').click();await page.locator('#renameDialog').waitFor({state:'hidden'});
 check((await(await page.request.get(base+'/qwen-cn/chats/'+created.id)).json()).title==='Synthetic renamed from header','Mouse rename did not persist');
 await page.locator('#chatActions').click();await page.locator('#deleteCurrent').click();await page.locator('#deleteToast').waitFor({state:'visible'});check((await(await page.request.get(base+'/qwen-cn/trash')).json()).some(c=>c.id===created.id),'Mouse trash failed');await page.locator('#undoDelete').click();await page.locator('#deleteToast').waitFor({state:'hidden'});
 const context=await page.context().browser().newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});const mobile=await context.newPage();
 try{await mobile.goto(base+'/qwen-cn/#chat='+created.id);await mobile.locator('#chatActions').tap();await mobile.locator('#renameChat').tap();await mobile.locator('#renameDialog').waitFor({state:'visible'});await mobile.keyboard.press('Escape');await mobile.locator('#chatActions').tap();await mobile.locator('#deleteCurrent').tap();await mobile.locator('#deleteToast').waitFor({state:'visible'});check((await(await mobile.request.get(base+'/qwen-cn/trash')).json()).some(c=>c.id===created.id),'Touch trash failed');await mobile.locator('#undoDelete').tap();await mobile.locator('#deleteToast').waitFor({state:'hidden'});}finally{await context.close()}
 return {mouseRenamePersisted:true,mouseTrashUndo:true,touchRename:true,touchTrashUndo:true};
}
