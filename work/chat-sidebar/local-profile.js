/* Device-local profile. The server keeps only a normalized avatar, never originals. */
(() => {
  const $ = id => document.getElementById(id);
  const tr = (zh, en) => document.documentElement.lang === 'en' ? en : zh;
  let saved = null, candidate = undefined, preview = null, working = false, selection = 0;
  const defaults = new Map([...document.querySelectorAll('.local-avatar')].map(e => [e, e.innerHTML]));
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('localgpt-profile') : null;
  const say = (text, error = false) => { $('avatarStatus').textContent = text; $('avatarStatus').classList.toggle('error', error); };
  function showAvatar(el, url) {
    if (!url) { el.innerHTML = defaults.get(el); return; }
    const img = document.createElement('img'); img.src = url; img.alt = tr('本地用户头像', 'Local user avatar');
    el.replaceChildren(img);
  }
  function render() {
    for (const el of defaults.keys()) showAvatar(el, el.id === 'avatarPreview' && candidate !== undefined ? preview : saved?.avatar_url);
    $('saveAvatar').disabled = working || !saved || candidate === undefined;
    $('cancelAvatar').disabled = working || candidate === undefined;
    $('chooseAvatar').disabled = working || !saved;
    $('resetAvatar').disabled = working || !saved || (!saved.avatar_url && candidate === undefined);
  }
  function clear() {
    ++selection;
    if (preview) URL.revokeObjectURL(preview);
    preview = null; candidate = undefined; $('avatarFile').value = ''; render();
  }
  async function api(options) {
    const response = await fetch('/qwen-cn/profile' + (options ? '/avatar' : ''), {cache:'no-store', signal:AbortSignal.timeout(15000), ...options});
    const data = await response.json();
    if (!response.ok) { const error = Error(data.error || 'Profile unavailable'); error.status = response.status; throw error; }
    return data;
  }
  async function refresh() {
    if (working || candidate !== undefined) return;
    try { const data = await api(); if (!working && candidate === undefined) { saved = data; render(); } }
    catch { say(tr('无法读取本地头像。重新打开个人资料后重试。', 'Local avatar unavailable. Reopen Profile to retry.'), true); }
  }
  $('chooseAvatar').onclick = () => $('avatarFile').click();
  $('avatarFile').onchange = async () => {
    const file = $('avatarFile').files[0]; if (!file) return;
    clear();
    const ticket = selection;
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024 || !file.size) {
      say(tr('请选择不超过 5 MB 的 PNG、JPEG 或 WebP 图片。', 'Choose a PNG, JPEG or WebP image up to 5 MB.'), true); $('avatarFile').value = ''; return;
    }
    const url = URL.createObjectURL(file), img = new Image(); img.src = url;
    try {
      await img.decode();
      if (img.naturalWidth * img.naturalHeight > 16000000 || Math.max(img.naturalWidth,img.naturalHeight) > 8192) throw Error('dimensions');
      if (ticket !== selection) { URL.revokeObjectURL(url); return; }
      if (preview) URL.revokeObjectURL(preview);
      preview = url; candidate = file; render(); say(tr('预览中，保存后生效。', 'Preview only. Save to apply.'));
    } catch {
      URL.revokeObjectURL(url);
      if (ticket === selection) say(tr('图片无法读取或尺寸过大。', 'Image is invalid or too large.'), true);
    }
  };
  $('resetAvatar').onclick = () => { clear(); candidate = null; render(); say(tr('默认头像预览，保存后生效。', 'Default avatar preview. Save to apply.')); };
  $('cancelAvatar').onclick = () => { clear(); say(''); refresh(); };
  $('saveAvatar').onclick = async () => {
    if (working || !saved || candidate === undefined) return;
    working = true; render();
    try {
      saved = await api({method:candidate === null ? 'DELETE' : 'PUT', headers:{'If-Match':'"'+saved.version+'"', ...(candidate ? {'Content-Type':candidate.type} : {})}, ...(candidate ? {body:candidate} : {})});
      clear(); say(tr('头像已保存。', 'Avatar saved.')); channel?.postMessage('updated');
    } catch (e) { say(e.status === 409 ? tr('头像已在其他窗口更新。取消预览后重新选择。','Avatar changed in another window. Cancel preview and choose again.') : tr('保存失败，请检查图片或本地服务后重试。','Save failed. Check the image or local service and retry.'),true); }
    finally { working = false; render(); }
  };
  $('preferencesDialog').addEventListener('close', () => { if (!working) { clear(); say(''); } });
  $('profileAvatar').addEventListener('click', refresh);
  document.querySelector('[data-settings-section="profile"]').addEventListener('click', refresh);
  addEventListener('focus', refresh);
  if (channel) channel.onmessage = refresh;
  addEventListener('hanzlanguage', render);
  render(); refresh();
})();
