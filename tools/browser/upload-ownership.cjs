// A reference image selected on a saved chat, or on a project chat that still
// has no id, must not be written into another project. Equal empty chat ids are
// not the same composer. A new chat that gains an id from the 450ms autosave
// before the upload finishes, without the user leaving, still keeps the text
// and receives the image. A sidebar open that fails and leaves the same chat,
// address, and draft on screen uses the finished upload there and keeps the
// open failure. Leaving and returning before the upload finishes does not
// attach it. A no-id upload that finishes while another chat's read is still
// in flight does not create a chat or replace that open when the read
// succeeds, and still attaches once, without uploading again, when the read
// fails. Run via tools/validate.py --case upload-ownership.
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
  let uploadCount = 0;
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
    uploadCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ name: imageName, subfolder: "", type: "input" }),
    });
  });
  let blockedRead = null;
  let heldRead = null;
  await page.route("**/qwen-cn/chats/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      request.method() === "GET" &&
      heldRead &&
      url.pathname === "/qwen-cn/chats/" + heldRead.id
    ) {
      const hold = heldRead;
      heldRead = null;
      hold.arrived();
      await hold.gate;
      if (hold.failure) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: hold.failure, code: "unavailable" }),
        });
        return;
      }
    }
    if (
      request.method() === "GET" &&
      blockedRead &&
      url.pathname === "/qwen-cn/chats/" + blockedRead.id
    ) {
      const message = blockedRead.message;
      blockedRead = null;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: message, code: "unavailable" }),
      });
      return;
    }
    await route.continue();
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
  function holdRead(id, failure = "") {
    let release;
    let arrived;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const ready = new Promise((resolve) => {
      arrived = resolve;
    });
    heldRead = { id, failure, gate, arrived: () => arrived() };
    return {
      release: () => release(),
      ready: Promise.race([
        ready,
        new Promise((_, reject) =>
          setTimeout(() => reject(Error("timed out waiting for the chat read")), 8000),
        ),
      ]),
    };
  }
  function isCreate(request) {
    return request.method() === "POST" && new URL(request.url()).pathname === "/qwen-cn/chats";
  }
  function armCreateWatch() {
    let mark;
    const seen = new Promise((resolve) => {
      mark = resolve;
    });
    page.waitForRequest(isCreate).then(() => mark("created"), () => mark("closed"));
    return seen;
  }
  function quietWindow(seen) {
    return Promise.race([
      seen,
      page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300))).then(() => "quiet"),
    ]);
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
  async function clickChat(title) {
    await page.locator(`#chatList button.chat-item[title="${title}"]`).click();
  }
  async function showChats(titles) {
    await page.evaluate(() => refresh());
    for (const title of titles)
      await page.locator(`#chatList button.chat-item[title="${title}"]`).waitFor();
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

  const stay = await (await page.request.post(base + "/qwen-cn/chats", {
    data: { title: "Stay Source" },
  })).json();
  const stayDraft = await page.request.patch(base + "/qwen-cn/chats/" + stay.id, {
    data: {
      version: stay.draft_version,
      draft: { prompt: "Stay on A", mode: "chat", reference: null },
    },
  });
  check(stayDraft.ok(), "stay source setup failed " + (await stayDraft.text()));
  const blocked = await (await page.request.post(base + "/qwen-cn/chats", {
    data: { title: "Stay Other" },
  })).json();
  const blockedDraft = await page.request.patch(base + "/qwen-cn/chats/" + blocked.id, {
    data: {
      version: blocked.draft_version,
      draft: { prompt: "Other stays unread", mode: "chat", reference: null },
    },
  });
  check(blockedDraft.ok(), "blocked chat setup failed " + (await blockedDraft.text()));
  const stayBefore = (await listChats()).length;
  await showChats(["Stay Source", "Stay Other"]);
  await page.evaluate((id) => {
    location.hash = "#chat=" + id;
  }, stay.id);
  await page.waitForFunction(
    ({ id, text }) =>
      current?.id === id &&
      location.hash === "#chat=" + id &&
      document.getElementById("prompt").value === text &&
      document.getElementById("mode").value === "chat" &&
      document.getElementById("reference").hidden &&
      !saving &&
      navigationFlight === 0 &&
      !uploading,
    { id: stay.id, text: "Stay on A" },
  );
  const stayHash = await page.evaluate(() => location.hash);
  const openFailure = "暂时无法打开这个对话。";
  const stayHold = holdUpload();
  const stayChoose = page.locator("#file").setInputFiles(file);
  await stayHold.ready;
  blockedRead = { id: blocked.id, message: openFailure };
  await clickChat("Stay Other");
  await page.waitForFunction(
    ({ id, text, hash, failure }) =>
      current?.id === id &&
      location.hash === hash &&
      document.getElementById("prompt").value === text &&
      document.getElementById("mode").value === "chat" &&
      document.getElementById("reference").hidden &&
      document.getElementById("status").textContent === failure &&
      document.getElementById("status").classList.contains("error") &&
      !saving &&
      navigationFlight === 0,
    { id: stay.id, text: "Stay on A", hash: stayHash, failure: openFailure },
  );
  check(blockedRead === null, "the sidebar read was not the failed open");
  stayHold.release();
  await stayChoose;
  await page.waitForFunction(
    ({ name, text, failure }) =>
      !uploading &&
      !saving &&
      !dirty &&
      reference?.filename === name &&
      document.getElementById("prompt").value === text &&
      document.getElementById("status").textContent === failure &&
      document.getElementById("status").classList.contains("error"),
    { name: imageName, text: "Stay on A", failure: openFailure },
  );
  const afterStay = await composer();
  check(afterStay.chatId === stay.id, "failed open left the source chat " + afterStay.chatId);
  check(afterStay.prompt === "Stay on A", "failed open replaced the source prompt: " + afterStay.prompt);
  check(afterStay.mode === "image", "failed open did not keep the uploaded image mode");
  check(!afterStay.referenceHidden, "failed open did not show the uploaded image");
  check(afterStay.status === openFailure, "failed open status became " + afterStay.status);
  check(afterStay.status !== missed, "failed open claimed the user left");
  check(await page.evaluate(() => location.hash) === stayHash, "failed open changed the address");
  const stayChat = await readChat(stay.id);
  check(stayChat.draft.prompt === "Stay on A", "source prompt was not saved: " + JSON.stringify(stayChat.draft));
  check(stayChat.draft.reference?.filename === imageName, "source did not keep the registered image: " + JSON.stringify(stayChat.draft.reference));
  check(stayChat.draft.mode === "image", "source draft mode was not saved");
  const blockedChat = await readChat(blocked.id);
  check(blockedChat.draft.prompt === "Other stays unread", "blocked chat prompt changed");
  check(!blockedChat.draft.reference, "blocked chat received the image");
  check((await listChats()).length === stayBefore, "failed open created a chat");

  const round = await (await page.request.post(base + "/qwen-cn/chats", {
    data: { title: "Round Source" },
  })).json();
  const roundDraft = await page.request.patch(base + "/qwen-cn/chats/" + round.id, {
    data: {
      version: round.draft_version,
      draft: { prompt: "Round text", mode: "chat", reference: null },
    },
  });
  check(roundDraft.ok(), "return source setup failed " + (await roundDraft.text()));
  const roundOther = await (await page.request.post(base + "/qwen-cn/chats", {
    data: { title: "Round Other" },
  })).json();
  const roundOtherDraft = await page.request.patch(base + "/qwen-cn/chats/" + roundOther.id, {
    data: {
      version: roundOther.draft_version,
      draft: { prompt: "Round other", mode: "chat", reference: null },
    },
  });
  check(roundOtherDraft.ok(), "return other setup failed " + (await roundOtherDraft.text()));
  await showChats(["Round Source", "Round Other"]);
  await page.evaluate((id) => {
    location.hash = "#chat=" + id;
  }, round.id);
  await page.waitForFunction(
    ({ id, text }) =>
      current?.id === id &&
      document.getElementById("prompt").value === text &&
      !saving &&
      navigationFlight === 0 &&
      !uploading,
    { id: round.id, text: "Round text" },
  );
  const roundHash = await page.evaluate(() => location.hash);
  const roundHold = holdUpload();
  const roundChoose = page.locator("#file").setInputFiles(file);
  await roundHold.ready;
  await clickChat("Round Other");
  await page.waitForFunction(
    ({ id, text }) =>
      current?.id === id &&
      document.getElementById("prompt").value === text &&
      document.getElementById("reference").hidden &&
      !saving &&
      navigationFlight === 0,
    { id: roundOther.id, text: "Round other" },
  );
  await clickChat("Round Source");
  await page.waitForFunction(
    ({ id, text, hash }) =>
      current?.id === id &&
      location.hash === hash &&
      document.getElementById("prompt").value === text &&
      document.getElementById("mode").value === "chat" &&
      document.getElementById("reference").hidden &&
      !saving &&
      navigationFlight === 0,
    { id: round.id, text: "Round text", hash: roundHash },
  );
  roundHold.release();
  await roundChoose;
  await page.waitForFunction(() => !uploading && !saving);
  const afterRound = await composer();
  check(afterRound.chatId === round.id, "return path left the source " + afterRound.chatId);
  check(afterRound.prompt === "Round text", "return path changed the prompt: " + afterRound.prompt);
  check(afterRound.mode === "chat", "return path changed the mode: " + afterRound.mode);
  check(afterRound.referenceHidden, "return path showed the image");
  check(afterRound.status === missed, "return path status was " + afterRound.status);
  check(await page.evaluate(() => location.hash) === roundHash, "return path changed the address");
  const roundChat = await readChat(round.id);
  check(roundChat.draft.prompt === "Round text", "return source lost its text: " + JSON.stringify(roundChat.draft));
  check(!roundChat.draft.reference, "returning attached the image: " + JSON.stringify(roundChat.draft.reference));
  const roundOtherChat = await readChat(roundOther.id);
  check(roundOtherChat.draft.prompt === "Round other", "return destination prompt changed");
  check(!roundOtherChat.draft.reference, "return destination received the image");

  const flight = await (await page.request.post(base + "/qwen-cn/chats", {
    data: { title: "Flight Dest" },
  })).json();
  const flightDraft = await page.request.patch(base + "/qwen-cn/chats/" + flight.id, {
    data: {
      version: flight.draft_version,
      draft: { prompt: "B original sentence", mode: "chat", reference: null },
    },
  });
  check(flightDraft.ok(), "flight destination setup failed " + (await flightDraft.text()));
  const flightBefore = (await listChats()).length;
  await showChats(["Flight Dest"]);
  await page.evaluate(() => {
    location.hash = "";
  });
  await page.waitForFunction(
    () => !current && view === "chat" && !activeProjectId && !saving && navigationFlight === 0 && !uploading && !dirty,
  );
  const flightHash = "#chat=" + flight.id;
  const flightUploads = uploadCount;
  const flightHold = holdUpload();
  const flightUploaded = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "POST" && url.pathname === "/qwen-cn/uploads";
  });
  const flightChoose = page.locator("#file").setInputFiles(file);
  await flightHold.ready;
  const flightRead = holdRead(flight.id);
  await clickChat("Flight Dest");
  await flightRead.ready;
  check(await page.evaluate(() => !current && navigationFlight > 0), "the saved chat read was not still in flight");
  const flightCreate = armCreateWatch();
  flightHold.release();
  await flightUploaded;
  check((await quietWindow(flightCreate)) === "quiet", "upload created a chat while the saved chat was still opening");
  check(await page.evaluate(() => uploading && navigationFlight > 0 && !saving && !current), "upload completion changed the page before the open landed");
  flightRead.release();
  await flightChoose;
  await page.waitForFunction(
    ({ id, text, hash }) =>
      !uploading &&
      !saving &&
      !dirty &&
      current?.id === id &&
      location.hash === hash &&
      document.getElementById("prompt").value === text &&
      document.getElementById("reference").hidden &&
      document.getElementById("status").textContent === "已离开选择图片时的对话，参考图没有加入当前草稿。",
    { id: flight.id, text: "B original sentence", hash: flightHash },
  );
  const afterFlight = await composer();
  check(afterFlight.chatId === flight.id, "settled open was replaced by " + afterFlight.chatId);
  check(afterFlight.prompt === "B original sentence", "settled open lost its text: " + afterFlight.prompt);
  check(afterFlight.referenceHidden, "settled open showed the image");
  check(await page.evaluate(() => location.hash) === flightHash, "settled open changed the address");
  check((await listChats()).length === flightBefore, "in-flight upload created a chat");
  check(uploadCount === flightUploads + 1, "in-flight success uploaded more than once");
  const continued = "B original sentence kept";
  await page.locator("#prompt").fill(continued);
  await page.waitForFunction(
    ({ id, text }) => !saving && !dirty && current?.id === id && document.getElementById("prompt").value === text,
    { id: flight.id, text: continued },
  );
  const flightChat = await readChat(flight.id);
  check(flightChat.draft.prompt === continued, "later edit missed the opened chat: " + JSON.stringify(flightChat.draft));
  check(!flightChat.draft.reference, "opened chat received the image");
  for (const chat of await listChats()) {
    if (chat.id === flight.id) continue;
    const full = await readChat(chat.id);
    check(full.draft?.prompt !== continued, "later edit was stored on " + chat.id);
  }
  check((await listChats()).length === flightBefore, "later edit created a chat");

  await page.evaluate(() => {
    location.hash = "";
  });
  await page.waitForFunction(
    () => !current && view === "chat" && !activeProjectId && !saving && navigationFlight === 0 && !uploading && !dirty,
  );
  const failUploads = uploadCount;
  const failBefore = (await listChats()).length;
  const failHold = holdUpload();
  const failUploaded = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "POST" && url.pathname === "/qwen-cn/uploads";
  });
  const failChoose = page.locator("#file").setInputFiles(file);
  await failHold.ready;
  const failRead = holdRead(flight.id, openFailure);
  await clickChat("Flight Dest");
  await failRead.ready;
  const failCreate = armCreateWatch();
  failHold.release();
  await failUploaded;
  check((await quietWindow(failCreate)) === "quiet", "failed open created a chat before the read settled");
  check(await page.evaluate(() => uploading && navigationFlight > 0 && !saving && !current), "failed open changed the draft before the read settled");
  failRead.release();
  check(await failCreate === "created", "failed open did not save the original draft");
  await failChoose;
  await page.waitForFunction(
    ({ name, failure }) =>
      !uploading &&
      !saving &&
      !dirty &&
      !!current?.id &&
      reference?.filename === name &&
      document.getElementById("prompt").value === "" &&
      document.getElementById("reference").hidden === false &&
      document.getElementById("status").textContent === failure &&
      document.getElementById("status").classList.contains("error"),
    { name: imageName, failure: openFailure },
  );
  const attachedId = await page.evaluate(() => current.id);
  check(attachedId !== flight.id, "failed in-flight open attached onto the saved chat");
  check(await page.evaluate(() => location.hash) === "#chat=" + attachedId, "failed in-flight open left the original draft");
  const attached = await readChat(attachedId);
  check(attached.draft.prompt === "", "failed in-flight open replaced the original prompt: " + JSON.stringify(attached.draft));
  check(attached.draft.reference?.filename === imageName, "failed in-flight open did not save the image");
  const flightAfterFail = await readChat(flight.id);
  check(flightAfterFail.draft.prompt === continued, "failed in-flight open changed the saved chat");
  check(!flightAfterFail.draft.reference, "failed in-flight open wrote the image onto the saved chat");
  check((await listChats()).length === failBefore + 1, "failed in-flight open created the wrong number of chats");
  check(uploadCount === failUploads + 1, "failed in-flight open uploaded again");

  return {
    savedChatStaysOffDestination: true,
    emptyIdsDoNotCreateDestinationChat: true,
    autosaveSameChatKeepsTextAndImage: true,
    failedOpenKeepsUploadOnSource: true,
    leaveAndReturnDoesNotAttach: true,
    inFlightOpenKeepsDestination: true,
    failedInFlightOpenAttachesOnce: true,
  };
};
