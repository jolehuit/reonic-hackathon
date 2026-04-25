// Headless test runner — opens the page, captures screenshot + logs
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://localhost:3000/design/brandenburg?mock=1';
const OUT = process.argv[3] || '/tmp/page.png';
const WAIT_MS = parseInt(process.argv[4] || '15000', 10);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();

const consoleLogs = [];
const requestFailures = [];
const responseErrors = [];

page.on('console', (msg) => {
  consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
});
page.on('pageerror', (err) => {
  consoleLogs.push(`[pageerror] ${err.message}\n${err.stack || ''}`);
});
page.on('requestfailed', (req) => {
  requestFailures.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
});
page.on('response', async (resp) => {
  if (resp.status() >= 400) {
    let body = '';
    try { body = (await resp.text()).slice(0, 500); } catch {}
    responseErrors.push(`${resp.status()} ${resp.url()}\n  ${body}`);
  }
});

console.log(`Navigating to ${URL}…`);
await page.goto(URL, { waitUntil: 'load', timeout: 60000 });

console.log(`Waiting ${WAIT_MS}ms for vision pipeline…`);
await page.waitForTimeout(WAIT_MS);

// Capture
await page.screenshot({ path: OUT, fullPage: false });
console.log(`Screenshot saved → ${OUT}`);

// Read vision badge text
const badge = await page.evaluate(() => {
  const el = document.querySelector('[class*="font-mono"][class*="bg-zinc-900"]');
  return el?.textContent ?? null;
});

console.log('\n--- VISION BADGE ---');
console.log(badge ?? '(badge not found)');

console.log('\n--- CONSOLE LOGS ---');
for (const l of consoleLogs.slice(-30)) console.log(l);

console.log('\n--- REQUEST FAILURES ---');
for (const r of requestFailures) console.log(r);

console.log('\n--- HTTP ERRORS ---');
for (const r of responseErrors) console.log(r);

await browser.close();
