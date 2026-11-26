// A reference image selected on a saved chat, or on a project chat that still
// has no id, must not be written into another project. Equal empty chat ids are
// not the same composer. A new chat that gains an id from the 450ms autosave
// before the upload finishes, without the user leaving, still keeps the text
// and receives the image. Run via tools/validate.py --case upload-ownership.
const fs = require("node:fs");
const path = require("node:path");

module.exports = async (page) => {
  const base = process.env.LOCALGPT_TEST_BASE;
  if (!(await (await page.request.get(base + "/qwen-cn/health")).json()).database)
    throw Error("Synthetic projects fixture required");
  page.setDefaultTimeout(20000);
  const check = (ok, message) => {
    if (!ok) throw Error(message);
  };
  const root = process.env.LOCALGPT_FIXTURE_ROOT;
  const imageName = "synthetic-reference.png";
  fs.mkdirSync(path.join(root, "input"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "input", imageName),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  const file = {
    name: "ref.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  };
  let armed = null;
  await page.route("**/qwen-cn/uploads", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "POST" || url.pathname !== "/qwen-cn/uploads") {
      await route.continue();
      return;
    }
    const hold = armed;
    armed = null;
    if (hold) {
      hold.arrived();
      await hold.gate;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ name: imageName, subfolder: "", type: "input" }),
    });
  });
  function holdUpload() {
    let release;
    let arrived;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const ready = new Promise((resolve) => {
      arrived = resolve;
    });
    armed = { gate, arrived: () => arrived() };
    return {
      release: () => release(),
      ready: Promise.race([
        ready,
        new Promise((_, reject) =>
          setTimeout(() => reject(Error("timed out waiting for the image upload")), 8000),
        ),
      ]),
    };
  }
  async function createProject(name) {
    const response = await page.request.post(base + "/qwen-cn/projects", {
      data: { name, memory_mode: "default" },
    });
    if (!response.ok()) throw Error("create project failed " + (await response.text()));
    return response.json();
  }
  async function readProject(id) {
    const response = await page.request.get(base + "/qwen-cn/projects/" + id);
    if (!response.ok()) throw Error("read project failed " + (await response.text()));
    return response.json();
  }
  async function readChat(id) {
    const response = await page.request.get(base + "/qwen-cn/chats/" + id);
    if (!response.ok()) throw Error("read chat failed " + (await response.text()));
    return response.json();
  }
  async function listChats() {
    const response = await page.request.get(base + "/qwen-cn/chats");
    if (!response.ok()) throw Error("list chats failed " + (await response.text()));
    return response.json();
  }
  async function prepare() {
    await page.evaluate(() => {
      localStorage.setItem("qwen-studio-sidebar", "open");
      localStorage.setItem("qwen-studio-language", "zh");
    });
    await page.goto(base + "/qwen-cn/");
    await page.waitForFunction(() => typeof appReady !== "undefined" && appReady && !refreshing);
    await page.evaluate(() => clearInterval(refreshTimer));
  }
  async function openProject(project) {
    await page.evaluate((id) => {
      location.hash = "#project=" + id;
    }, project.id);
    await page.waitForFunction(
      (expected) => document.title === expected + " · LocalGPT" && !saving && navigationFlight === 0,
      project.name,
    );
  }
  async function composer() {
    return page.evaluate(() => ({
      prompt: document.getElementById("prompt").value,
      mode: document.getElementById("mode").value,
      referenceHidden: document.getElementById("reference").hidden,
      status: document.getElementById("status").textContent,
      chatId: current?.id || null,
      projectId: activeProjectId || null,
    }));
  }
  const missed =
    "已离开选择图片时的对话，参考图没有加入当前草稿。";

  const saved = await (await page.request.post(base + "/qwen-cn/chats", {
    data: { title: "Saved source" },
  })).json();
  const seeded = await page.request.patch(base + "/qwen-cn/chats/" + saved.id, {
    data: {
      version: saved.draft_version,
      draft: { prompt: "A base", mode: "chat", reference: null },
    },
  });
  check(seeded.ok(), "saved chat setup failed " + (await seeded.text()));
  const projectB = await createProject("Upload Dest");
  const kept = await (await page.request.post(base + "/qwen-cn/chats", {
    data: { title: "Dest draft", project_id: projectB.id },
  })).json();
  const keptDraft = await page.request.patch(base + "/qwen-cn/chats/" + kept.id, {
    data: {
      version: kept.draft_version,
      draft: { prompt: "B draft stays", mode: "chat", reference: null },
    },
  });
  check(keptDraft.ok(), "destination draft setup failed " + (await keptDraft.text()));
  const beforeCount = (await listChats()).length;

  await prepare();
  await page.evaluate((id) => {
    location.hash = "#chat=" + id;
  }, saved.id);
  await page.waitForFunction(
    (expected) =>
      current?.id === expected &&
      document.getElementById("prompt").value === "A base" &&
      !saving &&
      navigationFlight === 0,
    saved.id,
  );
  await page.locator("#prompt").fill("A concurrent input");
  const savedHold = holdUpload();
  const savedChoose = page.locator("#file").setInputFiles(file);
  await savedHold.ready;
  await openProject(projectB);
  const onDest = await composer();
  check(onDest.prompt === "B draft stays", "destination prompt changed before upload finished: " + onDest.prompt);
  check(onDest.mode === "chat", "destination mode changed before upload finished: " + onDest.mode);
  check(onDest.chatId === kept.id, "destination opened a different chat " + onDest.chatId);
  savedHold.release();
  await savedChoose;
  await page.waitForFunction(() => !uploading && !saving);
  const afterSaved = await composer();
  check(afterSaved.prompt === "B draft stays", "upload wrote the destination prompt: " + afterSaved.prompt);
  check(afterSaved.mode === "chat", "upload wrote the destination mode: " + afterSaved.mode);
  check(afterSaved.referenceHidden, "upload showed the image on the destination");
  check(afterSaved.status === missed, "upload result was " + afterSaved.status);
  check(afterSaved.chatId === kept.id, "upload replaced the destination chat");
  const sourceChat = await readChat(saved.id);
  check(sourceChat.draft.prompt === "A concurrent input", "source lost concurrent input: " + JSON.stringify(sourceChat.draft));
  check(!sourceChat.draft.reference, "leaving wrote the image back onto the source: " + JSON.stringify(sourceChat.draft.reference));
  const destChat = await readChat(kept.id);
  check(destChat.draft.prompt === "B draft stays", "destination draft prompt changed");
  check(destChat.draft.mode === "chat", "destination draft mode changed: " + destChat.draft.mode);
  check(!destChat.draft.reference, "destination draft received the image");
  check((await readProject(projectB.id)).chats.length === 1, "destination project gained a chat");
  check((await listChats()).length === beforeCount, "a chat was created for the abandoned image");

  const bareA = await createProject("Upload Bare A");
  const bareB = await createProject("Upload Bare B");
  check((await readProject(bareA.id)).chats.length === 0, "project A was not empty");
  check((await readProject(bareB.id)).chats.length === 0, "project B was not empty");
  const bareBefore = (await listChats()).length;
  await openProject(bareA);
  await page.waitForFunction(
    (id) => !current && activeProjectId === id && view === "project" && !saving && navigationFlight === 0,
    bareA.id,
  );
  const bareHold = holdUpload();
  const bareChoose = page.locator("#file").setInputFiles(file);
  await bareHold.ready;
  check(await page.evaluate(() => !current), "selecting an image created a chat before upload finished");
  await openProject(bareB);
  await page.waitForFunction(
    (id) => !current && activeProjectId === id && !saving && navigationFlight === 0,
    bareB.id,
  );
  bareHold.release();
  await bareChoose;
  await page.waitForFunction(() => !uploading && !saving);
  const afterBare = await composer();
  check(!afterBare.chatId, "empty destination gained a current chat " + afterBare.chatId);
  check(afterBare.projectId === bareB.id, "left the destination project");
  check(afterBare.prompt === "", "empty destination gained prompt text: " + afterBare.prompt);
  check(afterBare.mode !== "image", "empty destination mode became image");
  check(afterBare.referenceHidden, "empty destination showed the image");
  check(afterBare.status === missed, "empty-id upload result was " + afterBare.status);
  check((await readProject(bareA.id)).chats.length === 0, "source project gained a chat");
  check((await readProject(bareB.id)).chats.length === 0, "destination project gained a chat carrying the image");
  check((await listChats()).length === bareBefore, "an empty-id image upload created a chat");
  for (const chat of await listChats()) {
    const full = await readChat(chat.id);
    check(!full.draft?.reference, "image landed on " + chat.id);
  }

  await page.evaluate(() => {
    location.hash = "";
  });
  await page.waitForFunction(
    () => !current && view === "chat" && !activeProjectId && !saving && navigationFlight === 0,
  );
  const bornBefore = (await listChats()).length;
  await page.locator("#prompt").fill("Keep this prompt");
  const sameHold = holdUpload();
  const sameChoose = page.locator("#file").setInputFiles(file);
  await sameHold.ready;
  await page.waitForFunction(() => !!current?.id && document.getElementById("prompt").value === "Keep this prompt");
  const bornId = await page.evaluate(() => current.id);
  check(await page.evaluate(() => navigationFlight === 0 && !activeProjectId), "autosave left the new chat");
  check(await page.evaluate(() => document.getElementById("reference").hidden), "image attached before upload finished");
  sameHold.release();
  await sameChoose;
  await page.waitForFunction(
    (name) =>
      !uploading &&
      !saving &&
      !dirty &&
      current?.id &&
      reference?.filename === name &&
      document.getElementById("prompt").value === "Keep this prompt",
    imageName,
  );
  const afterSame = await composer();
  check(afterSame.chatId === bornId, "autosave chat was replaced: " + afterSame.chatId + " vs " + bornId);
  check(afterSame.prompt === "Keep this prompt", "autosave path lost the text");
  check(!afterSame.referenceHidden, "autosave path did not show the image");
  check(afterSame.status === "参考图已就绪，请输入修改要求。", "autosave upload result was " + afterSame.status);
  const born = await readChat(bornId);
  check(born.draft.prompt === "Keep this prompt", "saved text changed: " + JSON.stringify(born.draft));
  check(born.draft.reference?.filename === imageName, "image was not saved on the autosaved chat: " + JSON.stringify(born.draft.reference));
  check((await listChats()).length === bornBefore + 1, "autosave path created an extra chat");

  return {
    savedChatStaysOffDestination: true,
    emptyIdsDoNotCreateDestinationChat: true,
    autosaveSameChatKeepsTextAndImage: true,
  };
};
