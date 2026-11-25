// Production project routes and chat composition with a disposable local fake model.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function isProjectWrite(request) {
  const url = new URL(request.url());
  if (request.method() === 'POST' && url.pathname === '/qwen-cn/projects') return true;
  return request.method() === 'PATCH' && /^\/qwen-cn\/projects\/[^/]+$/.test(url.pathname);
}

async function projectNames(page, base) {
  const body = await (await page.request.get(base + '/qwen-cn/projects')).json();
  return body.map(project => project.name);
}

async function dispatchNameEnter(page, init) {
  return page.getByRole('textbox', {name: '项目名称', exact: true}).evaluate((input, init) => {
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      isComposing: init.isComposing,
      keyCode: init.keyCode,
      which: init.keyCode,
    });
    if (event.isComposing !== init.isComposing)
      Object.defineProperty(event, 'isComposing', {configurable: true, get: () => init.isComposing});
    if (event.keyCode !== init.keyCode)
      Object.defineProperty(event, 'keyCode', {configurable: true, get: () => init.keyCode});
    input.dispatchEvent(event);
    return {defaultPrevented: event.defaultPrevented, isComposing: event.isComposing, keyCode: event.keyCode, key: event.key};
  }, init);
}

async function expectCandidateIgnored(page, base, init) {
  const before = await projectNames(page, base);
  const value = await page.getByRole('textbox', {name: '项目名称', exact: true}).inputValue();
  const pending = page.waitForRequest(isProjectWrite, {timeout: 800}).then(() => 'wrote').catch(error => {
    if (/Timeout/i.test(String(error && error.message))) return 'quiet';
    throw error;
  });
  const seen = await dispatchNameEnter(page, init);
  assert.deepEqual(seen, {defaultPrevented: false, isComposing: init.isComposing, keyCode: init.keyCode, key: 'Enter'});
  assert.equal(await pending, 'quiet');
  assert.equal(await page.locator('#projectDialog').evaluate(dialog => dialog.open), true);
  assert.equal(await page.getByRole('textbox', {name: '项目名称', exact: true}).inputValue(), value);
  assert.deepEqual(await projectNames(page, base), before);
}

async function expectOneWrite(page, base, action, {method, status, name}) {
  const hits = [];
  const onRequest = request => { if (isProjectWrite(request)) hits.push(request.method()); };
  page.on('request', onRequest);
  try {
    const responsePromise = page.waitForResponse(response => isProjectWrite(response.request()));
    await action();
    const response = await responsePromise;
    assert.equal(response.request().method(), method);
    assert.equal(response.status(), status);
    await page.locator('#projectDialog').waitFor({state: 'hidden'});
    await page.locator('.project-page-heading h1').getByText(name, {exact: true}).waitFor();
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
    assert.deepEqual(hits, [method]);
    assert.equal((await projectNames(page, base)).filter(item => item === name).length, 1);
  } finally {
    page.off('request', onRequest);
  }
}

async function saveWithEnter(page) {
  const seen = await dispatchNameEnter(page, {isComposing: false, keyCode: 13});
  assert.deepEqual(seen, {defaultPrevented: true, isComposing: false, keyCode: 13, key: 'Enter'});
}

async function openEdit(page) {
  await page.locator('.project-heading-actions').getByRole('button', {name: '项目操作', exact: true}).click();
  await page.getByRole('menuitem', {name: '编辑项目', exact: true}).click();
  await page.locator('#projectDialogTitle', {hasText: '编辑项目'}).waitFor();
}

async function expectImeProjectNameSaves(page, base) {
  await page.getByRole('button', {name: '新建项目', exact: true}).last().click();
  await page.locator('#projectDialogTitle', {hasText: '创建项目'}).waitFor();
  await page.getByRole('textbox', {name: '项目名称', exact: true}).fill('合成IME回车');
  await expectCandidateIgnored(page, base, {isComposing: true, keyCode: 13});
  await expectCandidateIgnored(page, base, {isComposing: false, keyCode: 229});
  await expectOneWrite(page, base, () => saveWithEnter(page), {method: 'POST', status: 201, name: '合成IME回车'});

  await openEdit(page);
  await page.getByRole('textbox', {name: '项目名称', exact: true}).fill('合成IME回车已改');
  await expectCandidateIgnored(page, base, {isComposing: true, keyCode: 13});
  await expectCandidateIgnored(page, base, {isComposing: false, keyCode: 229});
  await expectOneWrite(page, base, () => saveWithEnter(page), {method: 'PATCH', status: 200, name: '合成IME回车已改'});

  await page.locator('.project-sidebar-heading').getByRole('button', {name: '新建项目', exact: true}).click();
  await page.locator('#projectDialogTitle', {hasText: '创建项目'}).waitFor();
  await page.getByRole('textbox', {name: '项目名称', exact: true}).fill('合成IME点击');
  await expectCandidateIgnored(page, base, {isComposing: true, keyCode: 13});
  await expectCandidateIgnored(page, base, {isComposing: false, keyCode: 229});
  await expectOneWrite(page, base, () => page.locator('#projectDialog').getByRole('button', {name: '创建项目', exact: true}).click(), {method: 'POST', status: 201, name: '合成IME点击'});

  await openEdit(page);
  await page.getByRole('textbox', {name: '项目名称', exact: true}).fill('合成IME点击已改');
  await expectCandidateIgnored(page, base, {isComposing: true, keyCode: 13});
  await expectCandidateIgnored(page, base, {isComposing: false, keyCode: 229});
  await expectOneWrite(page, base, () => page.locator('#projectDialog').getByRole('button', {name: '保存', exact: true}).click(), {method: 'PATCH', status: 200, name: '合成IME点击已改'});
}

module.exports = async page => {
  const base=process.env.LOCALGPT_TEST_BASE, out=process.env.LOCALGPT_TEST_OUTPUT;
  const health=await (await page.request.get(base+'/qwen-cn/health')).json();
  assert.equal(health.database,path.join(process.env.LOCALGPT_FIXTURE_ROOT,'fixture.sqlite3'));
  await page.addInitScript(()=>{localStorage.setItem('qwen-studio-language','zh');localStorage.setItem('qwen-studio-sidebar','open');});
  await page.goto(base+'/qwen-cn/#projects');await page.waitForFunction(() => typeof appReady !== 'undefined' && appReady);
  await expectImeProjectNameSaves(page, base);
  await page.goto(base+'/qwen-cn/#projects');await page.waitForFunction(() => typeof appReady !== 'undefined' && appReady);
  await page.getByRole('button',{name:'新建项目',exact:true}).last().click();
  await page.getByRole('textbox',{name:'项目名称',exact:true}).fill('合成项目 · 版本验收');
  await page.getByRole('combobox',{name:'记忆范围'}).selectOption('project-only');
  await page.locator('#projectDialog').getByRole('button',{name:'创建项目',exact:true}).click();
  await page.getByRole('button',{name:'添加指令',exact:true}).click();
  await page.getByRole('textbox',{name:'项目指令',exact:true}).fill('Synthetic project instruction: cite the calibration source.');
  await page.locator('#projectDialog').getByRole('button',{name:'保存',exact:true}).click();
  // Upload through the actual hidden file input triggered by the visible Add files button.
  const chooser=page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'添加文件',exact:true}).click();
  await (await chooser).setFiles({name:'calibration.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic source: calibration budget is 452 units. 星环坐标为 ALPHA-452。')});
  await page.locator('.project-source-open').filter({hasText:'calibration.txt'}).waitFor();
  await page.locator('.project-source-open').filter({hasText:'calibration.txt'}).click();
  await page.locator('#projectDialog').getByText(/calibration budget is 452/).waitFor();
  await page.locator('#projectDialog').getByRole('button',{name:'关闭',exact:true}).click();
  const projects=await (await page.request.get(base+'/qwen-cn/projects')).json();
  const project=projects.find(p=>p.name==='合成项目 · 版本验收');
  assert.equal(project.memory_mode,'project-only');
  const sources=await (await page.request.get(base+`/qwen-cn/projects/${project.id}/sources`)).json();
  const source=Array.isArray(sources)?sources[0]:sources.items[0];
  const downloaded=await page.request.get(base+`/qwen-cn/projects/${project.id}/sources/${source.id}/download`);
  assert.equal(downloaded.status(),200);assert.match(await downloaded.text(),/ALPHA-452/);
  await page.screenshot({path:path.join(out,'project-sources.png')});
  await page.locator('#projectTab-chats').click();
  await page.locator('#modelMenuTrigger').click();await page.locator('#modelMenu [data-value="chat"]').click();
  await page.locator('#prompt').fill('What is the calibration budget?');await page.locator('#prompt').press('Enter');
  await page.locator('#cancel').waitFor({state:'visible'});await page.locator('#cancel').waitFor({state:'hidden'});
  await page.getByText('Synthetic UI fixture — not a model-generated answer.',{exact:false}).first().waitFor();
  const payload=JSON.parse(fs.readFileSync(path.join(process.env.LOCALGPT_FIXTURE_ROOT,'last-model-request.json'),'utf8'));
  assert.match(JSON.stringify(payload.messages),/calibration budget is 452/);
  assert.match(payload.messages[0].content,/Synthetic project instruction/);
  await page.reload();await page.waitForFunction(() => typeof appReady !== 'undefined' && appReady);
  await page.getByText('Synthetic UI fixture — not a model-generated answer.',{exact:false}).first().waitFor();
  await page.screenshot({path:path.join(out,'project-chat.png')});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(out,'project-mobile.png')});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  return {projectOnly:true,instructions:true,uploadPreviewDownload:true,actualModelRequestContext:true,refreshPersistence:true,mobile:true,syntheticOnly:true};
};
