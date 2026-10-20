// Playwright CLI run-code. Synthetic demo only; never point at the personal API.
async (page) => {
  if (!["8191", "8193"].includes(new URL(page.url()).port))
    throw Error("Use the isolated synthetic demo");
  const health = await (await page.request.get(new URL("/qwen-cn/health", page.url()).href)).json();
  if (!health.demo) throw Error("Synthetic data guard failed");
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const shot = name => page.screenshot({
    path: `output/playwright/round2/after/${name}.png`, scale: "css",
  });
  const idle = () => page.waitForFunction(() =>
    document.getElementById("cancel").hidden &&
    document.getElementById("activity").hidden);
  const mode = async value => {
    await page.locator("#modelMenuTrigger").click();
    await page.locator(`#modelMenu [data-kind=mode][data-value="${value}"]`).click();
    check(await page.locator("#mode").inputValue() === value, "Mode bridge failed");
  };
  const settings = async section => {
    if (!await page.locator("#preferencesDialog").isVisible()) {
      if (!await page.locator("#appSettings").isVisible())
        await page.locator("#mobileMenu").click();
      await page.locator("#appSettings").click();
    }
    await page.locator(`[data-settings-section="${section}"]`).click();
  };
  const metrics = async () => page.evaluate(() => {
    const measure = selector => {
      const e = document.querySelector(selector), r = e.getBoundingClientRect(), s = getComputedStyle(e);
      return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,
        font:s.fontFamily,fontSize:s.fontSize,lineHeight:s.lineHeight,
        radius:s.borderRadius,background:s.backgroundColor};
    };
    return {viewport:[innerWidth,innerHeight], sidebar:measure("#sidebar"),
      composer:measure("#composerCard"), prompt:measure("#prompt"),
      overflow:document.documentElement.scrollWidth>innerWidth};
  });
  await page.setViewportSize({width:1440,height:900});
  await page.evaluate(() => {
    localStorage.setItem("qwen-studio-theme","light");
    localStorage.setItem("qwen-studio-language","zh");
    localStorage.setItem("qwen-studio-sidebar","closed");
  });
  await page.reload();
  await page.locator("#newChat").click();
  const empty = await metrics();
  check(!empty.overflow && Math.abs(empty.sidebar.width-52)<1, "Desktop rail geometry");
  check(Math.abs(empty.composer.width-768)<1 && Math.abs(empty.composer.height-52)<1,
    "Desktop composer must be 768×52");
  await shot("empty-1440");
  await page.locator("#modelMenuTrigger").click();
  await page.keyboard.press("ArrowDown");
  check(await page.locator("#modelMenu").evaluate(el=>el.contains(document.activeElement)),
    "Model menu keyboard focus");
  await shot("model-1440");
  await page.keyboard.press("Escape");
  check(await page.locator("#modelMenuTrigger").evaluate(el=>el===document.activeElement),
    "Model menu focus return");
  await mode("chat");
  await page.locator("#upload").click();
  await shot("attachment-1440");
  await page.locator("#attach-generation").click();
  await page.locator("#settingsPanel").waitFor({state:"visible"});
  const generation = await page.locator("#settingsPanel").boundingBox();
  check(generation.x>=0 && generation.y>=0 && generation.y+generation.height<=900,
    "Generation panel is outside viewport");
  await shot("generation-1440");
  await page.keyboard.press("Escape");
  await page.locator("#file").setInputFiles({
    name:"synthetic-reference.png", mimeType:"image/png",
    buffer:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=","base64"),
  });
  await page.locator("#reference").waitFor({state:"visible"});
  await shot("reference-upload");
  await page.locator("#removeRef").click();
  await page.locator("#prompt").fill("第二轮合成验收：中英混排、列表与代码。Please explain clearly.");
  await page.locator("#prompt").press("Enter");
  await page.locator("#cancel").waitFor({state:"visible"});
  await page.waitForFunction(()=>document.querySelector(".markdown")?.textContent.length>20);
  await shot("streaming");
  await idle();
  check(await page.locator(".markdown ul>li").count()===3, "Semantic Markdown list");
  await shot("chat-1440");
  await page.context().grantPermissions(["clipboard-read","clipboard-write"]);
  await page.locator(".assistant-message .message-action[aria-label='复制']").last().click();
  check((await page.evaluate(()=>navigator.clipboard.readText())).includes("Hello, local workspace"),
    "Message copy failed");
  await page.locator(".assistant-message [aria-label='编辑后重发']").last().click();
  check((await page.locator("#prompt").inputValue()).includes("第二轮"), "Edit draft failed");
  await page.locator("#prompt").fill("合成停止与重试测试");
  await page.locator("#prompt").press("Enter");
  await page.locator("#cancel").waitFor({state:"visible"});
  await page.locator("#cancel").click();
  await idle();
  check((await page.locator("#conversation").innerText()).includes("已停止"), "Stop result missing");
  await page.locator(".assistant-message [aria-label='重新生成']").last().click();
  await page.locator("#cancel").waitFor({state:"visible"});
  await idle();
  await page.locator("#prompt").fill("长输入与草稿恢复。".repeat(55));
  await page.waitForTimeout(900);
  await page.reload();
  await page.waitForFunction(()=>document.querySelector("#prompt").value.length>200);
  await shot("long-input");
  await page.locator("#prompt").fill("");
  await settings("general"); await shot("settings-1440");
  await settings("appearance"); await shot("appearance-1440");
  await page.locator("#themeDark").click(); await shot("appearance-dark-1440");
  await page.locator("#closePreferences").click(); await shot("chat-dark-1440");
  await settings("appearance");
  await page.locator("#themeSystem").click();
  await page.emulateMedia({colorScheme:"light"});
  await page.waitForFunction(()=>document.documentElement.dataset.theme==="light");
  await page.emulateMedia({colorScheme:"dark"});
  await page.waitForFunction(()=>document.documentElement.dataset.theme==="dark");
  await page.locator("#themeLight").click();
  await settings("memory"); await page.locator("#memoryNav").click();
  await page.locator("#memoryContent").fill("合成视觉验收偏好：简洁中文。");
  await page.locator("#saveMemory").click();
  await page.locator(".memory-item").filter({hasText:"合成视觉验收偏好"}).waitFor();
  await shot("memory");
  await page.locator(".memory-item").filter({hasText:"合成视觉验收偏好"}).getByRole("button",{name:"删除",exact:true}).click();
  await shot("confirmation");
  await page.locator("#confirmCancel").click();
  await page.locator("#backMemory").click();
  await page.locator("#closePreferences").click();
  await mode("image");
  await page.locator("#prompt").fill("合成图像：圆形与柔和山丘");
  await page.locator("#prompt").press("Enter");
  await page.locator("#cancel").waitFor({state:"visible"});
  await shot("image-progress");
  await idle();
  await page.locator(".result img").last().waitFor();
  check(await page.locator(".result img").last().evaluate(e=>e.complete&&e.naturalWidth>0),"Image load");
  await shot("image-result");
  const downloadPromise=page.waitForEvent("download");
  await page.locator(".result a[download]").last().click();
  check(await (await downloadPromise).failure()===null,"Download failed");
  await page.locator("#galleryNav").click(); await shot("gallery");
  await page.locator(".gallery-card").first().click(); await shot("image-preview");
  await page.locator("#galleryEdit").click();
  await page.locator("#reference").waitFor({state:"visible"});
  await page.locator("#removeRef").click();
  if(await page.locator("#sidebarToggle").getAttribute("aria-expanded")==="false")
    await page.locator("#sidebarToggle").click();
  await page.locator(".chat-menu-trigger").first().click(); await shot("history-menu");
  await page.getByRole("menuitem",{name:"重命名对话",exact:true}).click();
  await shot("rename");
  await page.locator("#chatName").fill("第二轮验收对话");
  await page.locator("#renameForm button[type=submit]").click();
  await page.locator(".chat-menu-trigger").first().click();
  await page.getByRole("menuitem",{name:/删除对话/}).click();
  await page.locator("#undoDelete").click();
  await page.waitForFunction(()=>document.querySelector("#chatTitle").textContent==="第二轮验收对话");
  await page.setViewportSize({width:390,height:844});
  await page.locator("#mobileMenu").click();
  check(await page.locator("#mainContent").evaluate(e=>e.inert),"Mobile drawer inert");
  await shot("sidebar-390");
  await page.locator(".chat-menu-trigger").first().click();
  await page.keyboard.press("Escape");
  check(await page.locator("#sidebarToggle").getAttribute("aria-expanded")==="true",
    "Menu Escape must not close its parent drawer");
  await page.keyboard.press("Escape");
  check(!await page.locator("#mainContent").evaluate(e=>e.inert),"Drawer focus isolation release");
  await shot("chat-390");
  await settings("appearance"); await shot("appearance-390");
  await page.locator("#closePreferences").click();
  const widths=[];
  for(const [width,height] of [[390,844],[1280,800],[1440,900]]) {
    await page.setViewportSize({width,height});
    if(width>760 && await page.locator("#sidebarToggle").getAttribute("aria-expanded")==="true")
      await page.locator("#sidebarToggle").click();
    if(!await page.locator("#newChat").isVisible()) await page.locator("#mobileMenu").click();
    await page.locator("#newChat").click();
    const value=await metrics(); widths.push(value);
    check(!value.overflow && value.composer.bottom<=height,"Responsive overflow");
    await shot(`empty-${width}`);
  }
  check(errors.length===0, errors.join("; "));
  return {passed:true,empty,widths,browserErrors:errors};
}
