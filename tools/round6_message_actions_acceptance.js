// Synthetic demo only. Prefer tools/round5_demo.py on 8194 for image rows.
async (page) => {
  const base = "http://127.0.0.1:8194";
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const check = (ok, message) => {
    if (!ok) throw new Error(message);
  };
  const health = await (await page.request.get(base + "/qwen-cn/health")).json();
  check(health.demo, "Synthetic demo required");

  const chats = await (await page.request.get(base + "/qwen-cn/chats")).json();
  const textChat =
    chats.find((c) => c.title === "Synthetic long conversation") || chats[0];
  const imageChat = chats.find((c) => c.title === "Synthetic image collection");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + "/qwen-cn/#chat=" + textChat.id);
  await page.locator(".assistant-message .message-action").first().waitFor();

  const chatMetrics = await page.evaluate(() => {
    const userEdit = document.querySelector(
      ".user-message-shell .message-action[data-action-icon=edit]",
    );
    const assistant = document.querySelector(".assistant-message");
    const copy = assistant?.querySelector(
      '.message-action[data-action-icon=copy]',
    );
    const retry = assistant?.querySelector(
      '.message-action[data-action-icon=retry]',
    );
    const editOnAssistant = assistant?.querySelector(
      '.message-action[data-action-icon=edit]',
    );
    const titles = [...document.querySelectorAll(".message-action")].map((b) =>
      b.getAttribute("title"),
    );
    const copyBtn = copy;
    return {
      hasUserEdit: !!userEdit,
      userEditInShell: !!userEdit?.closest(".user-message-shell"),
      hasCopy: !!copy,
      hasRetry: !!retry,
      noAssistantEdit: !editOnAssistant,
      noNativeTitle: titles.every((t) => !t),
      copySize: copyBtn
        ? copyBtn.getBoundingClientRect().width
        : 0,
    };
  });
  check(chatMetrics.hasUserEdit, "User edit action missing");
  check(chatMetrics.userEditInShell, "User edit not under user bubble");
  check(chatMetrics.hasCopy && chatMetrics.hasRetry, "Assistant actions missing");
  check(chatMetrics.noAssistantEdit, "Edit should not remain on assistant row");
  check(chatMetrics.noNativeTitle, "Native title must not be set");
  check(
    Math.abs(chatMetrics.copySize - 32) < 1,
    "Message action control should be 32px",
  );

  const copyBtn = page.locator(
    '.assistant-message .message-action[data-action-icon=copy]',
  ).first();
  await copyBtn.scrollIntoViewIfNeeded();
  await page.mouse.move(1300, 200);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await copyBtn.hover();
  await page.waitForTimeout(400);
  await page.waitForFunction(
    () =>
      document.getElementById("messageActionTooltip")?.matches(":popover-open"),
  );
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () =>
      !document
        .getElementById("messageActionTooltip")
        ?.matches(":popover-open"),
  );

  await copyBtn.click();
  await page.waitForFunction(
    () =>
      document.querySelector(
        '.assistant-message .message-action[data-action-icon=check]',
      ),
  );

  check(imageChat, "Synthetic image collection chat missing");
  await page.goto(base + "/qwen-cn/#chat=" + imageChat.id);
  await page.locator(".result .message-action").first().waitFor();
  const imageMetrics = await page.evaluate(() => {
    const row = document.querySelector(".result .message-actions");
    const edit = row?.querySelector('[data-action-icon=edit]');
    const dl = row?.querySelector('[data-action-icon=download]');
    const stage = document.querySelector(".image-stage");
    const rowTop = row?.getBoundingClientRect().top ?? 0;
    const stageBottom = stage?.getBoundingClientRect().bottom ?? 0;
    return {
      hasEdit: !!edit,
      hasDownload: !!dl,
      belowImage: rowTop >= stageBottom - 2,
      iconOnly:
        !!edit?.querySelector(".message-action-icon") &&
        !edit?.querySelector(":scope > span:not(.sr-only)"),
    };
  });
  check(imageMetrics.hasEdit && imageMetrics.hasDownload, "Image actions missing");
  check(imageMetrics.belowImage, "Image actions should sit below image");
  check(imageMetrics.iconOnly, "Image edit should be icon-only");

  const mobile = await page.context().browser().newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const mPage = await mobile.newPage();
  try {
    await mPage.goto(base + "/qwen-cn/#chat=" + imageChat.id);
    await mPage.locator(".result .message-action").first().waitFor();
    const visible = await mPage
      .locator(".result .message-actions")
      .first()
      .isVisible();
    check(visible, "Image actions must stay visible on mobile");
  } finally {
    await mobile.close();
  }

  return {
    chatMetrics,
    imageMetrics,
    tooltipKeyboard: true,
    copyFeedback: true,
    mobileImageActions: true,
  };
};
