// Current contract adapted from round4_media_acceptance.js. Run via tools/validate.py.
// Destructive checks are strictly limited to demo.py's temporary database/files.
module.exports = async(page)=>{
  const base=process.env.LOCALGPT_TEST_BASE,api=page.request;
  if(!(await(await api.get(base+'/qwen-cn/health')).json()).demo)throw Error('Synthetic demo required');
  const check=(v,m)=>{if(!v)throw Error(m);}, errors=[];page.on('pageerror',e=>errors.push(e.message));
  const json=async(method,path,data)=>{const r=await api[method](base+path,{data});check(r.ok(),`${method} ${path}: ${r.status()} ${await r.text()}`);return r.json();};
  await page.setViewportSize({width:1440,height:900});await page.goto(base+'/qwen-cn/');await page.waitForFunction(() => typeof appReady !== 'undefined' && appReady);await page.locator('#prompt').waitFor();
  await page.locator('#newChat').click();await page.locator('#modelMenuTrigger').click();await page.locator('#modelMenu [data-value=image]').click();
  await page.locator('#prompt').fill('Synthetic Round4 deletion fixture');await page.locator('#prompt').press('Enter');
  await page.locator('#cancel').waitFor({state:'visible'});await page.locator('#cancel').waitFor({state:'hidden',timeout:15000});
  const chatId=new URLSearchParams(new URL(page.url()).hash.slice(1)).get('chat');
  const chat=await json('get','/qwen-cn/chats/'+chatId),message=chat.messages.at(-1),image=message.image;
  check(image,'Demo image not produced');const url=base+'/view?'+new URLSearchParams(image);
  check((await api.get(url)).ok(),'Generated image unavailable');
  await page.locator('#galleryNav').click();await page.locator('.gallery-card').first().click();
  await page.locator('#galleryDelete').click();await page.locator('#confirmDialog').waitFor({state:'visible'});await page.screenshot({path:(process.env.LOCALGPT_TEST_OUTPUT + '/image-trash-confirm.png')});await page.locator('#confirmAccept').click();await page.locator('#confirmDialog').waitFor({state:'hidden'});
  check((await api.get(url)).ok(),'Trash removed file');check((await json('get','/qwen-cn/chats/'+chatId)).messages.at(-1).image,'Trash removed chat reference');
  await page.goto(base+'/qwen-cn/#trash');await page.waitForFunction(() => typeof appReady !== 'undefined' && appReady);await page.locator('#imageTrashList .trash-row').first().waitFor();await page.screenshot({path:(process.env.LOCALGPT_TEST_OUTPUT + '/image-trash.png')});
  const row=page.locator(`[data-media-id="${message.id}"]`);await row.getByRole('button',{name:'恢复',exact:true}).click();await row.waitFor({state:'hidden'});
  await json('delete','/qwen-cn/gallery/'+message.id,{confirm:true});
  const other=await json('post','/qwen-cn/chats',{title:'Synthetic shared reference'});
  await json('patch','/qwen-cn/chats/'+other.id,{version:0,draft:{reference:image,prompt:'Synthetic shared draft'}});
  await page.reload();await row.getByRole('button',{name:'永久删除',exact:true}).click();await page.locator('#confirmAccept').click();await page.locator('#confirmError').waitFor({state:'visible'});
  check((await api.get(url)).ok(),'Shared file deleted');await page.screenshot({path:(process.env.LOCALGPT_TEST_OUTPUT + '/shared-image-blocked.png')});await page.locator('#confirmCancel').click();
  const remote=await json('get','/qwen-cn/chats/'+other.id);await json('patch','/qwen-cn/chats/'+other.id,{version:remote.draft_version,draft:{}});
  await row.getByRole('button',{name:'永久删除',exact:true}).click();await page.locator('#confirmAccept').click();await page.locator('#confirmDialog').waitFor({state:'hidden'});
  check((await api.get(url)).status()===404,'Original file survived permanent delete');check(!(await json('get','/qwen-cn/chats/'+chatId)).messages.at(-1).image,'Deleted image reference survived');
  await page.goto(base+'/qwen-cn/');await page.waitForFunction(() => typeof appReady !== 'undefined' && appReady);await page.locator('#newChat').click();
  await page.locator('#file').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=','base64')});
  await page.locator('#reference').waitFor({state:'visible'});
  const uploads=await json('get','/qwen-cn/uploads');check(uploads.items.length>0,'Upload not registered');const uploaded=uploads.items.at(-1);
  // Persist an explicit reference, proving deletion guards apply to drafts too.
  const c=await json('post','/qwen-cn/chats',{title:'Synthetic upload owner'});await json('patch','/qwen-cn/chats/'+c.id,{version:0,draft:{reference:uploaded.image}});
  const blocked=await api.delete(base+'/qwen-cn/uploads/'+uploaded.id,{data:{confirm:true}});check(blocked.status()===409,'Referenced upload deletion was not blocked');
  await json('patch','/qwen-cn/chats/'+c.id,{version:1,draft:{}});
  await page.locator('#removeRef').click();await page.waitForFunction(()=>typeof dirty!=='undefined'&&!dirty);await page.locator('#profileButton').click();await page.locator('#appSettings').click();await page.locator('[data-settings-section=diagnostics]').click();await page.locator('#manageReferenceFiles').click();
  await page.locator('#referenceFilesList .trash-row').filter({hasText:uploaded.image.filename}).getByRole('button').click();await page.locator('#confirmAccept').click();await page.locator('#confirmDialog').waitFor({state:'hidden'});
  check((await api.get(base+'/view?'+new URLSearchParams(uploaded.image))).status()===404,'Uploaded file not deleted');
  check(!errors.length,errors.join(';'));return {trashRestore:true,chatReferencePreserved:true,sharedFileBlocked:true,permanentFile404:true,registeredUpload:true,uploadReferenceGuard:true,uploadFile404:true,errors};
}
