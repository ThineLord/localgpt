async(page)=>{
 const base='http://127.0.0.1:8194',out='output/playwright/round6/',file=out+'synthetic-avatar.png';
 if(!(await(await page.request.get(base+'/qwen-cn/health')).json()).demo)throw Error('Synthetic required');
 const check=(x,m)=>{if(!x)throw Error(m)},meta=async()=>(await(await page.request.get(base+'/qwen-cn/profile')).json());
 let m=await meta();if(m.avatar_url)await page.request.delete(base+'/qwen-cn/profile/avatar',{headers:{'If-Match':'"'+m.version+'"'}});
 await page.setViewportSize({width:1440,height:900});await page.goto(base+'/qwen-cn/');await page.reload();
 const open=async()=>{await page.locator('#profileButton').click();await page.locator('#profileAvatar').click();await page.waitForFunction(()=>!document.getElementById('chooseAvatar').disabled);};
 await open();await page.locator('#avatarFile').setInputFiles(file);await page.locator('#avatarPreview img').waitFor();
 check(!(await meta()).avatar_url,'Preview wrote avatar');check(await page.locator('#profileButton img').count()===0,'Preview replaced sidebar');
 await page.screenshot({path:out+'avatar-preview.png'});
 await page.locator('#cancelAvatar').click();check(await page.locator('#avatarPreview img').count()===0,'Cancel failed');
 await page.locator('#avatarFile').setInputFiles(out+'broken-avatar.png');await page.waitForFunction(()=>document.getElementById('avatarStatus').classList.contains('error'));check(await page.locator('#saveAvatar').isDisabled(),'Invalid enabled Save');
 await page.locator('#avatarFile').setInputFiles(file);await page.waitForFunction(()=>!document.getElementById('saveAvatar').disabled);await page.locator('#saveAvatar').click();
 await page.waitForFunction(()=>document.querySelector('#profileButton img')?.complete);m=await meta();check(!!m.avatar_url,'Save failed');
 await page.reload();await page.locator('#profileButton img').waitFor();await open();check((await meta()).version===m.version,'Reload changed saved avatar');
 await page.screenshot({path:out+'avatar-saved.png'});
 await page.locator('#resetAvatar').click();check((await meta()).version===m.version,'Reset preview deleted saved avatar');await page.locator('#cancelAvatar').click();
 await page.locator('#resetAvatar').click();await page.locator('#saveAvatar').click();await page.waitForFunction(()=>!document.querySelector('#profileButton img'));check(!(await meta()).avatar_url,'Reset not persisted');
 await page.locator('#closePreferences').click();
 await page.setViewportSize({width:390,height:844});await page.locator('#mobileMenu').click();await open();await page.screenshot({path:out+'avatar-mobile.png'});
 return {preview:true,cancel:true,invalid:true,save:true,reload:true,reset:true,mobile:true};
}
