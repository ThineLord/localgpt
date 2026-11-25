// Inline code keeps its characters. Emphasis outside code, fenced blocks, and
// copy still follow the existing renderer. Synthetic persisted chat only.
const assert = require("node:assert/strict");

const ANSWER = [
  "Paragraph `a * b * c`, `**literal**`, and `*.py and *.js`.",
  "",
  "**Use `x < y & z` now**",
  "",
  "**Keep `a * b * c` literal**",
  "",
  "*Wrap `x < y & z` once* and **use `one` plus `two` together**",
  "",
  "Outside **bold**, *italic*, and ***both***.",
  "",
  "- item `a * b * c`",
  "- item `**literal**`",
  "- item `*.py and *.js`",
  "",
  "## heading `a * b * c` `**literal**` `*.py and *.js`",
  "",
  "Span `a * b * c",
  "**literal**` then **bold** and *italic*.",
  "",
  "Before fence `not closed",
  "",
  "```python",
  "a * b * c",
  "**literal**",
  "*.py and *.js",
  "x < y & z",
  "```",
  "",
  "After fence **bold** and *italic* still work.",
  "",
  'Quotes `say "hi" & \'ok\' <tag>`.',
].join("\n");

const FENCE = ["a * b * c", "**literal**", "*.py and *.js", "x < y & z", ""].join("\n");
const LITERALS = ["a * b * c", "**literal**", "*.py and *.js"];

module.exports = async (page) => {
  const base = process.env.LOCALGPT_TEST_BASE;
  const health = await (await page.request.get(base + "/qwen-cn/health")).json();
  assert.equal(health.demo, true);
  const chats = await (await page.request.get(base + "/qwen-cn/chats")).json();
  const listed = chats.find((chat) => chat.title === "Synthetic inline code");
  assert.ok(listed, "persisted inline-code chat missing");
  const saved = await (await page.request.get(base + "/qwen-cn/chats/" + listed.id)).json();
  assert.equal(saved.messages.length, 1);
  assert.equal(saved.messages[0].status, "completed");
  assert.equal(saved.messages[0].prompt, "Show the inline code literals.");
  assert.equal(saved.messages[0].answer, ANSWER);

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(base).origin,
  });
  await page.addInitScript(() => localStorage.setItem("qwen-studio-language", "zh"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + "/qwen-cn/#chat=" + encodeURIComponent(listed.id));
  await page.waitForFunction(() => typeof appReady !== "undefined" && appReady);
  const root = page.locator(".assistant-message .markdown");
  await root.waitFor();
  await root.locator("code").first().waitFor();

  const rendered = await (await page.request.get(base + "/qwen-cn/chats/" + listed.id)).json();
  assert.equal(rendered.messages[0].answer, ANSWER, "opening the chat changed the stored answer");

  const view = await root.evaluate((el) => {
    const blocks = [...el.children].map((node) => ({
      tag: node.tagName,
      className: node.className,
      text: node.textContent,
      html: node.innerHTML,
      inline: [...node.querySelectorAll("code")]
        .filter((code) => !code.closest("pre"))
        .map((code) => ({
          text: code.textContent,
          html: code.innerHTML,
          children: code.children.length,
          parent: code.parentElement.tagName,
        })),
      strong: [...node.querySelectorAll("strong")].map((item) => ({
        text: item.textContent,
        html: item.innerHTML,
        parent: item.parentElement.tagName,
        childTags: [...item.childNodes].map((child) =>
          child.nodeType === Node.TEXT_NODE ? "#text:" + child.textContent : child.tagName + ":" + child.textContent,
        ),
      })),
      em: [...node.querySelectorAll("em")].map((item) => ({
        text: item.textContent,
        html: item.innerHTML,
        parent: item.parentElement.tagName,
        childTags: [...item.childNodes].map((child) =>
          child.nodeType === Node.TEXT_NODE ? "#text:" + child.textContent : child.tagName + ":" + child.textContent,
        ),
      })),
      items: [...node.children].map((child) => ({
        tag: child.tagName,
        text: child.textContent,
        inline: [...child.querySelectorAll("code")].map((code) => ({
          text: code.textContent,
          children: code.children.length,
          parent: code.parentElement.tagName,
        })),
        emphasis: child.querySelectorAll("em, strong").length,
      })),
    }));
    const fence = el.querySelector(".code-block");
    const fenceCode = fence?.querySelector("pre > code");
    return {
      blocks,
      fenceCount: el.querySelectorAll(".code-block").length,
      fence: fence && {
        label: fence.querySelector(":scope > span")?.textContent,
        text: fenceCode?.textContent,
        children: fenceCode?.children.length,
        emphasis: fence.querySelectorAll("em, strong").length,
      },
    };
  });

  assert.deepEqual(
    view.blocks.map((block) => block.tag),
    ["P", "P", "P", "P", "P", "UL", "H3", "P", "P", "DIV", "P", "P"],
  );
  const [paragraph, wrapped, keep, multi, outside, list, heading, cross, unclosed, fenceBlock, after, quotes] = view.blocks;

  // Positive: the same three literals survive in a paragraph, a list, and a heading.
  assert.deepEqual(paragraph.inline.map((code) => code.text), LITERALS);
  assert.ok(paragraph.inline.every((code) => code.children === 0 && code.parent === "P"));
  assert.equal(paragraph.strong.length, 0);
  assert.equal(paragraph.em.length, 0);
  assert.equal(list.tag, "UL");
  assert.deepEqual(list.items.map((item) => item.inline.map((code) => code.text)), LITERALS.map((text) => [text]));
  assert.ok(list.items.every((item) => item.emphasis === 0 && item.inline[0].children === 0 && item.inline[0].parent === "LI"));
  assert.equal(heading.tag, "H3");
  assert.deepEqual(heading.inline.map((code) => code.text), LITERALS);
  assert.ok(heading.inline.every((code) => code.children === 0 && code.parent === "H3"));
  assert.equal(heading.strong.length, 0);
  assert.equal(heading.em.length, 0);

  // Emphasis may wrap one or more code spans, including escaped characters.
  assert.deepEqual(wrapped.strong, [{
    text: "Use x < y & z now",
    html: "Use <code>x &lt; y &amp; z</code> now",
    parent: "P",
    childTags: ["#text:Use ", "CODE:x < y & z", "#text: now"],
  }]);
  assert.equal(wrapped.em.length, 0);
  assert.equal(wrapped.inline[0].children, 0);
  assert.deepEqual(keep.strong[0].childTags, ["#text:Keep ", "CODE:a * b * c", "#text: literal"]);
  assert.equal(keep.inline[0].text, "a * b * c");
  assert.equal(keep.inline[0].children, 0);
  assert.equal(keep.inline[0].parent, "STRONG");
  assert.deepEqual(multi.em[0].childTags, ["#text:Wrap ", "CODE:x < y & z", "#text: once"]);
  assert.equal(multi.em[0].html, "Wrap <code>x &lt; y &amp; z</code> once");
  assert.deepEqual(multi.strong[0].childTags, ["#text:use ", "CODE:one", "#text: plus ", "CODE:two", "#text: together"]);
  assert.ok(multi.inline.every((code) => code.children === 0));

  // Negative: outside code, the same markers still become emphasis and are not left literal.
  assert.equal(outside.inline.length, 0);
  assert.equal(outside.text, "Outside bold, italic, and both.");
  assert.equal(outside.strong[0].text, "bold");
  assert.equal(outside.strong[0].parent, "P");
  assert.deepEqual(outside.em.map((item) => item.text), ["italic", "both"]);
  assert.equal(outside.em[1].html, "<strong>both</strong>");
  assert.equal(outside.strong[1].text, "both");
  assert.equal(outside.strong[1].parent, "EM");

  // Cross-line code contrast: a closed span keeps operators, emphasis after it still applies,
  // and an unclosed backtick does not swallow the following fenced block.
  assert.equal(cross.inline.length, 1);
  assert.equal(cross.inline[0].text, "a * b * c\n**literal**");
  assert.equal(cross.inline[0].children, 0);
  assert.equal(cross.inline[0].parent, "P");
  assert.equal(cross.strong.length, 1);
  assert.equal(cross.strong[0].text, "bold");
  assert.equal(cross.strong[0].parent, "P");
  assert.equal(cross.em.length, 1);
  assert.equal(cross.em[0].text, "italic");
  assert.equal(cross.em[0].parent, "P");
  assert.equal(unclosed.text, "Before fence `not closed");
  assert.equal(unclosed.inline.length, 0);
  assert.equal(unclosed.strong.length, 0);
  assert.equal(unclosed.em.length, 0);
  assert.equal(fenceBlock.tag, "DIV");
  assert.equal(fenceBlock.className, "code-block");
  assert.equal(view.fenceCount, 1);
  assert.equal(view.fence.label, "python");
  assert.equal(view.fence.text, FENCE);
  assert.equal(view.fence.children, 0);
  assert.equal(view.fence.emphasis, 0);
  assert.ok(!unclosed.text.includes(FENCE.trim()));

  // Negative again, after the fence: emphasis still applies and does not become a code span.
  assert.equal(after.inline.length, 0);
  assert.equal(after.text, "After fence bold and italic still work.");
  assert.equal(after.strong[0].text, "bold");
  assert.equal(after.em[0].text, "italic");

  assert.equal(quotes.inline.length, 1);
  assert.equal(quotes.inline[0].text, 'say "hi" & \'ok\' <tag>');
  assert.equal(quotes.inline[0].children, 0);
  assert.equal(quotes.inline[0].html.includes("<tag"), false);
  assert.ok(quotes.inline[0].html.includes("&lt;"));
  assert.ok(quotes.inline[0].html.includes("&amp;"));

  const messageCopy = page.locator('.assistant-message .message-actions button[aria-label="复制"]');
  await messageCopy.click();
  await page.waitForFunction(() => {
    const button = document.querySelector('.assistant-message .message-actions button[data-action-icon="check"]');
    return button && button.getAttribute("aria-label") === "已复制";
  });
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), ANSWER);
  assert.equal(await page.locator("#status").innerText(), "");

  await page.locator(".code-block button").click();
  await page.waitForFunction(() => document.querySelector(".code-block button")?.textContent === "已复制");
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), FENCE);
  assert.equal(await root.locator("pre code").evaluate((el) => el.textContent), FENCE);
  assert.equal(await page.locator("#status").innerText(), "");
  const afterCopy = await (await page.request.get(base + "/qwen-cn/chats/" + listed.id)).json();
  assert.equal(afterCopy.messages[0].answer, ANSWER);

  return {
    persistedAnswer: true,
    positiveLiterals: ["paragraph", "list", "heading"],
    wrappedCode: true,
    negativeEmphasis: true,
    crossLineContrast: true,
    fencedCopy: true,
  };
};
