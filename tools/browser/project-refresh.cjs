// Delayed project list and detail reads must not replace a completed navigation
// or a newer read. A list that returns while a project open is already in
// flight must not cancel that open, even if the project still on screen was
// deleted. If that open fails and the deleted project is still showing, the
// refresh leaves it. Run via tools/validate.py --case project-refresh.
module.exports = async (page) => {
  const base = process.env.LOCALGPT_TEST_BASE;
  if (!(await (await page.request.get(base + "/qwen-cn/health")).json()).database)
    throw Error("Synthetic projects fixture required");
  page.setDefaultTimeout(20000);
  const results = [];
  const check = (ok, message) => {
    if (!ok) throw Error(message);
  };
  let arm = null;
  await page.route("**/qwen-cn/projects**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const parts = url.pathname.split("/").filter(Boolean);
    const isList =
      request.method() === "GET" &&
      parts.length === 2 &&
      parts[0] === "qwen-cn" &&
      parts[1] === "projects" &&
      !url.search;
    const isDetail =
      request.method() === "GET" &&
      parts.length === 3 &&
      parts[0] === "qwen-cn" &&
      parts[1] === "projects";
    const id = isDetail ? decodeURIComponent(parts[2]) : "";
    const current = arm;
    const matched =
      current &&
      ((current.kind === "list" && isList) ||
        (current.kind === "detail" && isDetail && current.id === id));
    if (!matched) {
      await route.continue();
      return;
    }
    arm = null;
    if (current.mode === "pause") {
      current.settle();
      await current.gate;
      await route.continue();
      return;
    }
    const fetched = await route.fetch();
    const fail = current.mode === "fail";
    const body = fail
      ? JSON.stringify({
          error: "项目暂时无法刷新。",
          code: "project_unavailable",
        })
      : await fetched.text();
    current.slot.body = body;
    current.slot.upstream = fetched.status();
    current.settle();
    await current.gate;
    await route.fulfill({
      status: fail ? 503 : fetched.status(),
      contentType: "application/json",
      body,
    });
  });

  function hold(kind, id = "", mode = "hold") {
    let release;
    let settle;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const ready = new Promise((resolve) => {
      settle = resolve;
    });
    const slot = { body: "", upstream: 0 };
    arm = { kind, id, mode, gate, slot, settle: () => settle(slot) };
    return {
      slot,
      release: () => release(),
      ready: Promise.race([
        ready,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(Error("timed out waiting for " + kind + " " + id)),
            8000,
          ),
        ),
      ]),
    };
  }

  async function createProject(name) {
    const response = await page.request.post(base + "/qwen-cn/projects", {
      data: { name, memory_mode: "default" },
    });
    if (!response.ok()) throw Error("create failed " + (await response.text()));
    return response.json();
  }
  async function readProject(id) {
    const response = await page.request.get(base + "/qwen-cn/projects/" + id);
    if (!response.ok()) throw Error("read failed " + (await response.text()));
    return response.json();
  }
  async function patchProject(project, data) {
    const response = await page.request.patch(
      base + "/qwen-cn/projects/" + project.id,
      { data: { version: project.version, ...data } },
    );
    if (!response.ok()) throw Error("patch failed " + (await response.text()));
    return response.json();
  }
  async function deleteProject(project) {
    const response = await page.request.delete(
      base + "/qwen-cn/projects/" + project.id,
      { data: { version: project.version, confirm: true } },
    );
    if (!response.ok()) throw Error("delete failed " + (await response.text()));
  }
  async function prepare(hash = "") {
    await page.evaluate(() => {
      localStorage.setItem("qwen-studio-sidebar", "open");
      localStorage.setItem("qwen-studio-language", "zh");
    });
    await page.goto(base + "/qwen-cn/" + hash);
    await page.waitForFunction(
      () => typeof appReady !== "undefined" && appReady && !refreshing,
    );
    await page.evaluate(() => clearInterval(refreshTimer));
  }
  function startRefresh() {
    return page.evaluate(() =>
      refresh().then(
        () => ({
          status: "ok",
          title: document.title,
          hash: location.hash,
          connection: document.getElementById("connection").textContent,
          statusText: document.getElementById("status").textContent,
          projectHidden: document.getElementById("projectView").hidden,
        }),
        (error) => ({
          status: "error",
          message: error.message,
          title: document.title,
          hash: location.hash,
          connection: document.getElementById("connection").textContent,
          statusText: document.getElementById("status").textContent,
          projectHidden: document.getElementById("projectView").hidden,
        }),
      ),
    );
  }
  async function waitForTitle(name) {
    await page.waitForFunction(
      (expected) => document.title === expected + " · LocalGPT",
      name,
    );
  }
  async function openProject(project) {
    await page.evaluate((id) => {
      location.hash = "#project=" + id;
    }, project.id);
    await waitForTitle(project.name);
  }
  async function expectEditName(name) {
    await page.locator('#projectPageHeader [aria-label="项目操作"]').click();
    await page
      .locator("#projectMenu [role='menuitem']")
      .filter({ hasText: "编辑项目" })
      .click();
    const value = await page
      .locator('#projectDialog input[aria-label="项目名称"]')
      .inputValue();
    check(value === name, "edit dialog shows " + value);
    await page.locator('#projectDialog [aria-label="关闭"]').click();
    await page.waitForFunction(() => !document.getElementById("projectDialog").open);
  }
  async function stayOn(project, result) {
    check(result.status === "ok", JSON.stringify(result));
    check(result.hash === "#project=" + project.id, result.hash);
    check(result.title === project.name + " · LocalGPT", result.title);
    check(result.projectHidden === false, "left the project page");
    check(!result.statusText.includes("回收站"), result.statusText);
    check(result.connection !== "刷新失败", result.connection);
  }

  const alpha = await createProject("Nav Alpha");
  const beta = await createProject("Nav Beta");
  await prepare("#project=" + alpha.id);
  await waitForTitle(alpha.name);

  const detailHold = hold("detail", alpha.id);
  const detailRefresh = startRefresh();
  const detailSlot = await detailHold.ready;
  check(JSON.parse(detailSlot.body).name === alpha.name, "held detail was not Alpha");
  check(detailSlot.upstream === 200, "detail did not reach the backend");
  await openProject(beta);
  detailHold.release();
  const afterHash = await detailRefresh;
  stayOn(beta, afterHash);
  await expectEditName(beta.name);
  await page.evaluate(() => refresh());
  check((await page.title()) === beta.name + " · LocalGPT", "normal refresh changed the title");
  const chat = (await (await page.request.get(base + "/qwen-cn/chats")).json())[0];
  check(chat && chat.id, "fixture chat missing");
  await page.evaluate((id) => {
    location.hash = "#chat=" + id;
  }, chat.id);
  await page.waitForFunction(
    (id) => location.hash === "#chat=" + id && document.getElementById("projectView").hidden,
    chat.id,
  );
  await page.evaluate(() => refresh());
  check(
    !(await page.evaluate(() => location.hash)).includes(alpha.id),
    "leaving the project returned to Alpha",
  );
  results.push("detail-hash");

  await prepare("#project=" + alpha.id);
  await waitForTitle(alpha.name);
  const sidebarHold = hold("detail", alpha.id);
  const sidebarRefresh = startRefresh();
  await sidebarHold.ready;
  await page
    .locator(`.project-sidebar-row[data-project-id="${beta.id}"] .project-sidebar-link`)
    .click();
  await waitForTitle(beta.name);
  sidebarHold.release();
  const afterClick = await sidebarRefresh;
  stayOn(beta, afterClick);
  await expectEditName(beta.name);
  results.push("detail-sidebar");

  await prepare("#project=" + alpha.id);
  await waitForTitle(alpha.name);
  const staleOnBeta = hold("detail", alpha.id, "fail");
  const staleBetaRefresh = startRefresh();
  const staleBetaSlot = await staleOnBeta.ready;
  check(staleBetaSlot.upstream === 200, "failing detail did not reach the backend");
  await openProject(beta);
  staleOnBeta.release();
  const betaError = await staleBetaRefresh;
  stayOn(beta, betaError);
  check(!betaError.statusText.includes("项目暂时无法刷新"), betaError.statusText);
  results.push("stale-503-project");

  await prepare("#project=" + alpha.id);
  await waitForTitle(alpha.name);
  const staleOnChat = hold("detail", alpha.id, "fail");
  const staleChatRefresh = startRefresh();
  await staleOnChat.ready;
  await page.evaluate((id) => {
    location.hash = "#chat=" + id;
  }, chat.id);
  await page.waitForFunction(
    (id) => location.hash === "#chat=" + id && document.getElementById("projectView").hidden,
    chat.id,
  );
  staleOnChat.release();
  const chatError = await staleChatRefresh;
  check(chatError.status === "ok", JSON.stringify(chatError));
  check(chatError.hash === "#chat=" + chat.id, chatError.hash);
  check(chatError.connection !== "刷新失败", chatError.connection);
  check(!chatError.statusText.includes("项目暂时无法刷新"), chatError.statusText);
  results.push("stale-503-chat");

  await prepare("#project=" + alpha.id);
  await waitForTitle(alpha.name);
  const currentFail = hold("detail", alpha.id, "fail");
  const currentFailRefresh = startRefresh();
  await currentFail.ready;
  currentFail.release();
  const currentError = await currentFailRefresh;
  check(currentError.status === "ok", JSON.stringify(currentError));
  check(currentError.connection === "刷新失败", currentError.connection);
  check(currentError.statusText.includes("项目暂时无法刷新"), currentError.statusText);
  check(currentError.hash === "#project=" + alpha.id, currentError.hash);
  check(currentError.title === alpha.name + " · LocalGPT", currentError.title);
  results.push("current-503");

  await prepare("#project=" + alpha.id);
  await waitForTitle(alpha.name);
  const olderDetail = hold("detail", alpha.id);
  const olderRefresh = startRefresh();
  const olderSlot = await olderDetail.ready;
  check(JSON.parse(olderSlot.body).name === alpha.name, "older detail captured the new name");
  const renamed = await patchProject(await readProject(alpha.id), {
    name: "Nav Alpha Renamed",
  });
  await page.evaluate(async () => {
    await window.ProjectWorkspace.refresh();
    window.ProjectWorkspace.refreshView(true);
  });
  await waitForTitle(renamed.name);
  olderDetail.release();
  const afterNewer = await olderRefresh;
  check(afterNewer.status === "ok", JSON.stringify(afterNewer));
  check(afterNewer.title === renamed.name + " · LocalGPT", afterNewer.title);
  check(afterNewer.hash === "#project=" + alpha.id, afterNewer.hash);
  await expectEditName(renamed.name);
  results.push("newer-detail");

  await prepare("#projects");
  await page.waitForFunction(() => document.title === "项目 · LocalGPT");
  const olderList = hold("list");
  const olderListRefresh = startRefresh();
  const olderListSlot = await olderList.ready;
  const listedBefore = JSON.parse(olderListSlot.body);
  check(
    listedBefore.some((project) => project.name === renamed.name),
    "held list missed the renamed project",
  );
  const listedAgain = await patchProject(renamed, { name: "Nav Alpha Listed" });
  await page.evaluate(async () => {
    await window.ProjectWorkspace.refresh();
    renderSidebar(true);
    window.ProjectWorkspace.refreshView(true);
  });
  await page.waitForFunction(
    (name) =>
      [...document.querySelectorAll(".project-card")].some((card) =>
        card.textContent.includes(name),
      ),
    listedAgain.name,
  );
  olderList.release();
  const afterOlderList = await olderListRefresh;
  check(afterOlderList.status === "ok", JSON.stringify(afterOlderList));
  check(
    (await page.locator(".project-card", { hasText: listedAgain.name }).count()) === 1,
    "stale list removed the newer project name",
  );
  check(
    (await page.locator(".project-card", { hasText: renamed.name }).count()) === 0,
    "stale list restored the older project name",
  );
  results.push("newer-list");

  await prepare("#project=" + alpha.id);
  await waitForTitle(listedAgain.name);
  const staleList = hold("list");
  const staleListRefresh = startRefresh();
  const staleListSlot = await staleList.ready;
  const created = await createProject("Nav Created Later");
  check(
    !JSON.parse(staleListSlot.body).some((project) => project.id === created.id),
    "held list already contained the new project",
  );
  await openProject(created);
  staleList.release();
  const afterStaleList = await staleListRefresh;
  stayOn(created, afterStaleList);
  await expectEditName(created.name);
  await page.evaluate(() => refresh());
  check((await page.title()) === created.name + " · LocalGPT", "refresh after a stale list left the project");
  check(
    (await page.locator(`.project-sidebar-row[data-project-id="${created.id}"]`).count()) === 1,
    "a current refresh did not show the new project",
  );
  results.push("stale-list-navigation");

  const doomed = await createProject("Nav Doomed");
  await prepare("#project=" + doomed.id);
  await waitForTitle(doomed.name);
  await deleteProject(await readProject(doomed.id));
  const deleted = await startRefresh();
  check(deleted.status === "ok", JSON.stringify(deleted));
  check(deleted.statusText.includes("项目已移入回收站"), deleted.statusText);
  check(deleted.projectHidden === true, "deleted project stayed open");
  check(!deleted.hash.includes(doomed.id), deleted.hash);
  results.push("real-deletion");

  const slow = await createProject("Nav Slow Delete");
  await prepare("#project=" + slow.id);
  await waitForTitle(slow.name);
  const freshSlow = await readProject(slow.id);
  const pausedList = hold("list", "", "pause");
  const pausedRefresh = startRefresh();
  await pausedList.ready;
  await deleteProject(freshSlow);
  pausedList.release();
  const deletedLate = await pausedRefresh;
  check(deletedLate.statusText.includes("项目已移入回收站"), JSON.stringify(deletedLate));
  check(deletedLate.projectHidden === true, JSON.stringify(deletedLate));
  check(!deletedLate.hash.includes(slow.id), deletedLate.hash);
  results.push("real-deletion-delayed-list");

  const origin = await createProject("Nav Origin");
  const destination = await createProject("Nav Destination");
  await prepare("#project=" + origin.id);
  await waitForTitle(origin.name);
  const opening = hold("detail", destination.id);
  await page.evaluate((id) => {
    location.hash = "#project=" + id;
  }, destination.id);
  await opening.ready;
  await deleteProject(await readProject(origin.id));
  const duringOpen = await startRefresh();
  check(duringOpen.status === "ok", JSON.stringify(duringOpen));
  check(!duringOpen.statusText.includes("回收站"), duringOpen.statusText);
  check(duringOpen.projectHidden === false, "in-flight open left the project page");
  check(duringOpen.title === origin.name + " · LocalGPT", duringOpen.title);
  check(duringOpen.hash === "#project=" + destination.id, duringOpen.hash);
  opening.release();
  await waitForTitle(destination.name);
  await expectEditName(destination.name);
  const keptOpen = await page.evaluate(() => ({
    status: "ok",
    title: document.title,
    hash: location.hash,
    connection: document.getElementById("connection").textContent,
    statusText: document.getElementById("status").textContent,
    projectHidden: document.getElementById("projectView").hidden,
  }));
  stayOn(destination, keptOpen);
  await page.evaluate(() => refresh());
  check(
    (await page.title()) === destination.name + " · LocalGPT",
    "refresh after the kept open left the project",
  );
  results.push("inflight-open-keeps-navigation");

  const failedOrigin = await createProject("Nav Failed Open");
  await prepare("#project=" + failedOrigin.id);
  await waitForTitle(failedOrigin.name);
  const failingOpen = hold("detail", destination.id, "fail");
  await page.evaluate((id) => {
    location.hash = "#project=" + id;
  }, destination.id);
  await failingOpen.ready;
  await deleteProject(await readProject(failedOrigin.id));
  const duringFailure = await startRefresh();
  check(duringFailure.status === "ok", JSON.stringify(duringFailure));
  check(!duringFailure.statusText.includes("项目已移入回收站"), duringFailure.statusText);
  check(duringFailure.projectHidden === false, JSON.stringify(duringFailure));
  check(duringFailure.title === failedOrigin.name + " · LocalGPT", duringFailure.title);
  failingOpen.release();
  await page.waitForFunction(() => {
    const status = document.getElementById("status").textContent;
    return (
      document.getElementById("projectView").hidden &&
      status.includes("项目已移入回收站")
    );
  });
  const afterFailedOpen = await page.evaluate(() => location.hash);
  check(!afterFailedOpen.includes(failedOrigin.id), afterFailedOpen);
  check(!afterFailedOpen.includes(destination.id), afterFailedOpen);
  results.push("inflight-open-failure-leaves");

  const lateOrigin = await createProject("Nav Late Failure");
  await prepare("#project=" + lateOrigin.id);
  await waitForTitle(lateOrigin.name);
  const lateOpen = hold("detail", destination.id, "fail");
  await page.evaluate((id) => {
    location.hash = "#project=" + id;
  }, destination.id);
  await lateOpen.ready;
  await deleteProject(await readProject(lateOrigin.id));
  const lateList = hold("list", "", "pause");
  const lateRefresh = startRefresh();
  await lateList.ready;
  lateOpen.release();
  await page.waitForFunction(() =>
    document.getElementById("status").textContent.includes("项目暂时无法刷新"),
  );
  check(
    (await page.title()) === lateOrigin.name + " · LocalGPT",
    "failed open left before its list returned",
  );
  check(
    (await page.evaluate(() => document.getElementById("projectView").hidden)) === false,
    "failed open hid the project before its list returned",
  );
  lateList.release();
  const lateResult = await lateRefresh;
  check(lateResult.status === "ok", JSON.stringify(lateResult));
  check(lateResult.statusText.includes("项目已移入回收站"), JSON.stringify(lateResult));
  check(lateResult.projectHidden === true, JSON.stringify(lateResult));
  check(!lateResult.hash.includes(lateOrigin.id), lateResult.hash);
  results.push("refresh-after-open-failure");

  return { results };
};
