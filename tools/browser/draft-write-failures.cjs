const assert = require('node:assert/strict');

module.exports = async page => {
  const base = process.env.LOCALGPT_TEST_BASE + '/qwen-cn/';
  assert.equal((await (await page.request.get(base + 'health')).json()).demo, true);
  // The browser cannot deliver its last write during this fixture outage.
  await page.addInitScript(() => { navigator.sendBeacon = () => false; });
  for (const changedRemotely of [false, true]) {
    const create = await page.request.post(base + 'chats', {data: {title: 'Draft recovery'}});
    const chat = await create.json();
    const url = base + 'chats/' + chat.id;
    const read = async () => (await page.request.get(url)).json();
    await page.goto(base + '#chat=' + chat.id);
    await page.waitForFunction(id => appReady && current?.id === id, chat.id);

    await page.route(url, route => route.request().method() === 'PATCH'
      ? route.fulfill({status: 503, json: {error: 'Synthetic write failure'}})
      : route.continue());
    const failed = page.waitForResponse(r => r.url() === url && r.status() === 503);
    await page.locator('#prompt').fill('Local unsent text');
    await failed;
    await page.waitForFunction(() => dirty && !saving);
    await page.unroute(url);
    if (changedRemotely) {
      const row = await read();
      const response = await page.request.patch(url, {data: {
        version: row.draft_version, draft: {...row.draft, prompt: 'Other tab'}
      }});
      assert.ok(response.ok());
    }
    await page.reload();
    await page.waitForFunction(id => appReady && current?.id === id, chat.id);
    assert.equal(await page.locator('#prompt').inputValue(), 'Local unsent text');
    if (changedRemotely) {
      assert.equal((await read()).draft.prompt, 'Other tab');
      await page.locator('#useRemoteDraft').click();
    }
    await page.waitForFunction(() => !dirty && !saving);
    assert.equal((await read()).draft.prompt, changedRemotely ? 'Other tab' : 'Local unsent text');
  }
  return {retry: true, conflict: true};
};
