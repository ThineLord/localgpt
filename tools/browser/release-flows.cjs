// User-visible release flow: chat stop/retry, PNG generation, versions and diagnostics.
const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async page => {
  const base = process.env.LOCALGPT_TEST_BASE, out = process.env.LOCALGPT_TEST_OUTPUT;
  const health = await (await page.request.get(base+'/qwen-cn/health')).json();
  assert.equal(health.demo, true);
  await page.addInitScript(()=>{localStorage.setItem('qwen-studio-language','zh');localStorage.setItem('qwen-studio-sidebar','open');});
  await page.reload();
  await page.locator('#prompt').fill('合成演示：请展示新的本地聊天流程。');
  await page.locator('#modelMenuTrigger').click();
  await page.locator('#modelMenu [data-value="chat"]').click();
  await page.locator('#prompt').press('Enter');
  await page.locator('#cancel').waitFor({state:'visible'});
  await page.locator('#cancel').click();
  await page.locator('#cancel').waitFor({state:'hidden'});
  const chatId = new URLSearchParams(new URL(page.url()).hash.slice(1)).get('chat');
  let chat = await (await page.request.get(base+'/qwen-cn/chats/'+chatId)).json();
  assert.equal(chat.messages.at(-1).status, 'stopped');
  await page.getByRole('button',{name:'重新生成',exact:true}).last().click();
  await page.locator('#cancel').waitFor({state:'visible'});
  await page.locator('#cancel').waitFor({state:'hidden',timeout:15000});
  await page.getByText('这是一个用于界面验收的模拟回答，不是模型推理结果。',{exact:false}).first().waitFor();
  await page.screenshot({path:path.join(out,'chat-retry.png')});
  await page.locator('#modelMenuTrigger').click();
  await page.locator('#modelMenu [data-value="image"]').click();
  await page.locator('#prompt').fill('生成一张明确标注为模拟素材的演示图片');
  await page.locator('#prompt').press('Enter');
  await page.locator('#cancel').waitFor({state:'visible'});
  await page.locator('#cancel').waitFor({state:'hidden',timeout:15000});
  chat = await (await page.request.get(base+'/qwen-cn/chats/'+chatId)).json();
  const generated = chat.messages.at(-1);
  assert.equal(generated.status,'completed');
  const query = new URLSearchParams(generated.image).toString();
  for(const route of ['/view?','/qwen-cn/download?']){
    const response = await page.request.get(base+route+query);
    assert.equal(response.status(),200);assert.match(response.headers()['content-type'],/image\/png/);
    assert.deepEqual(Array.from((await response.body()).subarray(0,8)),[137,80,78,71,13,10,26,10]);
  }
  await page.locator('#galleryNav').click();
  await page.locator('.gallery-card').first().click();
  await page.locator('#galleryPreview').evaluate(img=>img.decode());
  await page.screenshot({path:path.join(out,'image-preview.png')});
  await page.keyboard.press('Escape');
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:900});
    await page.goto(base+'/qwen-cn/');
    if(!await page.locator('#profileButton').isVisible()) await page.locator('#mobileMenu').click();
    await page.locator('#profileButton').click();await page.locator('#profileAbout').click();
    await page.locator('#settingsBuildIdentity').waitFor({state:'visible'});
    assert.match(await page.locator('#settingsBuildIdentity').innerText(),new RegExp(health.version.replaceAll('.','\\.')));
    assert.ok((await page.locator('#settingsServerIdentity').innerText()).includes(health.build_sha.slice(0,12)));
    await page.screenshot({path:path.join(out,`about-${width}.png`)});
    if(width<=760)await page.locator('#settingsBack').click();
    await page.locator('[data-settings-section="diagnostics"]').click();
    await page.locator('#settingsDiagnosticsRefresh').click();
    await page.waitForFunction(()=>document.getElementById('settingsLMStatus').textContent==='模拟服务');
    assert.equal(await page.locator('#settingsComfyStatus').innerText(),'模拟服务');
    await page.screenshot({path:path.join(out,`diagnostics-${width}.png`)});
  }
  return {chatStopRetry:true,pngPreviewDownload:true,buildIdentity:true,diagnostics:[1440,390],syntheticOnly:true};
};
