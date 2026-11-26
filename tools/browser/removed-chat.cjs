const assert = require('node:assert/strict');

module.exports = async page => {
  const api = page.request;
  const base = process.env.LOCALGPT_TEST_BASE + '/qwen-cn/';
  assert.equal((await (await api.get(base + 'health')).json()).demo, true);
  const list = async () => (await api.get(base + 'chats')).json();
  const remove = async id => {
    assert.ok((await api.delete(base + 'chats/' + id, {data: {}})).ok());
    assert.ok((await api.delete(base + 'trash/' + id, {data: {confirm: true, include_media: false}})).ok());
  };
  const create = async title => (await (await api.post(base + 'chats', {data: {title}})).json()).id;
  for (const existing of await list()) await remove(existing.id);

  for (const survivor of [true, false]) {
    const other = survivor ? await create('Remaining conversation') : null;
    if (other) {
      const url = base + 'chats/' + other;
      const saved = await (await api.get(url)).json();
      assert.ok((await api.patch(url, {data: {
        version: saved.draft_version, draft: {...saved.draft, prompt: 'Surviving draft'}
      }})).ok());
    }
    const currentId = await create('Deleted conversation');
    await page.goto(base + '#chat=' + currentId);
    await page.waitForFunction(id => appReady && current?.id === id, currentId);
    await page.evaluate(() => clearInterval(refreshTimer));
    await remove(currentId);
    await page.locator('#prompt').fill('Unsent text from deleted chat');
    await page.evaluate(() => refresh());
    const copy = page.locator('#removedDrafts');
    assert.equal(await copy.locator('pre').textContent(), 'Unsent text from deleted chat');
    assert.equal(await page.locator('#connection').getAttribute('data-state'), 'online');
    assert.equal(await page.evaluate(() => current?.id ?? null), other);
    assert.equal(await page.locator('#prompt').inputValue(), survivor ? 'Surviving draft' : '');
    assert.deepEqual((await list()).map(row => row.id), other ? [other] : []);
    await page.reload();
    await copy.locator('pre').waitFor();
    await copy.getByRole('button', {name: /清除此草稿副本|Dismiss this draft copy/}).click();
    await page.reload();
    await page.waitForFunction(() => appReady);
    assert.equal(await copy.isHidden(), true);
    if (other) {
      assert.equal((await (await api.get(base + 'chats/' + other)).json()).draft.prompt, 'Surviving draft');
      await remove(other);
    }
  }
  const fallback = await create('Also being deleted');
  const opened = await create('Open chat');
  await page.goto(base + '#chat=' + opened);
  await page.waitForFunction(id => appReady && current?.id === id, opened);
  await page.evaluate(() => clearInterval(refreshTimer));
  await remove(opened);
  // The fallback was still active when the list was read, then disappeared.
  await page.route(base + 'chats/' + opened, async route => {
    await remove(fallback);
    await route.continue();
  }, {times: 1});
  await page.evaluate(() => refresh());
  assert.equal(await page.locator('#connection').getAttribute('data-state'), 'online');
  assert.equal(await page.evaluate(() => current?.id ?? null), null);
  assert.equal(new URL(page.url()).hash, '');
  return {survivor: true, empty: true, recoverAfterReload: true, dismiss: true};
};
