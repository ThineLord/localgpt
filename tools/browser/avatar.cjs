// Current contract adapted from round6_avatar_acceptance.js. Run via tools/validate.py.
module.exports = async(page)=>{
 const base=process.env.LOCALGPT_TEST_BASE,out=(process.env.LOCALGPT_TEST_OUTPUT + '/');
 if(!(await(await page.request.get(base+'/qwen-cn/health')).json()).demo)throw Error('Synthetic required');
 const check=(x,m)=>{if(!x)throw Error(m)},meta=async()=>(await(await page.request.get(base+'/qwen-cn/profile')).json());
 let m=await meta();if(m.avatar_url)await page.request.delete(base+'/qwen-cn/profile/avatar',{headers:{'If-Match':'"'+m.version+'"'}});
 await page.setViewportSize({width:1440,height:900});await page.goto(base+'/qwen-cn/');await page.waitForFunction(() => typeof appReady !== 'undefined' && appReady);await page.reload();await page.waitForFunction(() => typeof appReady !== 'undefined' && appReady);
 const open=async()=>{await page.locator('#profileButton').click();await page.locator('#appSettings').click();if(page.viewportSize().width<=760)await page.locator('#settingsBack').click();await page.locator('[data-settings-section="profile"]').click();await page.waitForFunction(()=>!document.getElementById('chooseAvatar').disabled);};
 const encoded=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=96;const x=c.getContext('2d');x.fillStyle='#9cbcb0';x.fillRect(0,0,96,96);x.fillStyle='#233c35';x.beginPath();x.arc(48,48,26,0,Math.PI*2);x.fill();return c.toDataURL('image/png').split(',')[1];});
 const file={name:'synthetic-avatar.png',mimeType:'image/png',buffer:Buffer.from(encoded,'base64')};
 await open();await page.locator('#avatarFile').setInputFiles(file);await page.locator('#avatarPreview img').waitFor();
 check(!(await meta()).avatar_url,'Preview wrote avatar');check(await page.locator('#profileButton img').count()===0,'Preview replaced sidebar');
 await page.screenshot({path:out+'avatar-preview.png'});
 await page.locator('#cancelAvatar').click();check(await page.locator('#avatarPreview img').count()===0,'Cancel failed');
 await page.locator('#avatarFile').setInputFiles({name:'broken-avatar.png',mimeType:'image/png',buffer:Buffer.from('not an image')});await page.waitForFunction(()=>document.getElementById('avatarStatus').classList.contains('error'));check(await page.locator('#saveAvatar').isDisabled(),'Invalid enabled Save');
 await page.locator('#avatarFile').setInputFiles(file);await page.waitForFunction(()=>!document.getElementById('saveAvatar').disabled);await page.locator('#saveAvatar').click();
 await page.waitForFunction(()=>document.querySelector('#profileButton img')?.complete);m=await meta();check(!!m.avatar_url,'Save failed');
 await page.reload();await page.waitForFunction(() => typeof appReady !== 'undefined' && appReady);await page.locator('#profileButton img').waitFor();await open();check((await meta()).version===m.version,'Reload changed saved avatar');
 await page.screenshot({path:out+'avatar-saved.png'});
 await page.locator('#resetAvatar').click();check((await meta()).version===m.version,'Reset preview deleted saved avatar');await page.locator('#cancelAvatar').click();
 await page.locator('#resetAvatar').click();await page.locator('#saveAvatar').click();await page.waitForFunction(()=>!document.querySelector('#profileButton img'));check(!(await meta()).avatar_url,'Reset not persisted');
 await page.locator('#closePreferences').click();
 await page.setViewportSize({width:390,height:844});await page.locator('#mobileMenu').click();await open();await page.screenshot({path:out+'avatar-mobile.png'});
 return {preview:true,cancel:true,invalid:true,save:true,reload:true,reset:true,mobile:true};
}
