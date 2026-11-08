// CLI adapter for current exported browser contracts. No source rewriting/eval.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const file = path.resolve(process.argv[2]);
  const browser = await chromium.launch({headless:true});
  const record = ['release-flows.cjs','projects.cjs'].includes(path.basename(file));
  const page = await browser.newPage({viewport:{width:1440,height:900}, ...(record ? {recordVideo:{dir:process.env.LOCALGPT_TEST_OUTPUT,size:{width:1440,height:900}}} : {})});
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(process.env.LOCALGPT_TEST_BASE + '/qwen-cn/');
    const result = await require(file)(page);
    if (errors.length) throw Error('Uncaught browser errors: ' + errors.join('; '));
    console.log(JSON.stringify({status:'PASS', result}));
  } catch (error) {
    await page.screenshot({path:path.join(process.env.LOCALGPT_TEST_OUTPUT, path.basename(file) + '.failure.png'),fullPage:true}).catch(()=>{});
    throw error;
  } finally {
    await browser.close();
    if(page.video()) fs.renameSync(await page.video().path(),path.join(process.env.LOCALGPT_TEST_OUTPUT,path.basename(file,'.cjs')+'.webm'));
  }
})().catch(error => {console.error(error);process.exitCode=1;});
