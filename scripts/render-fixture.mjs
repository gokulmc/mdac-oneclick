// One-shot: renders tests/fixtures/confirmation-email.html to PNG fixtures in tests/fixtures/.
// Run once with `node scripts/render-fixture.mjs` and commit the PNGs. Not part of CI.
import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
const PAGE = pathToFileURL(join(FIX, 'confirmation-email.html')).href;
// Pixel 2.625 nominal; Chromium rounds 412*2.625=1081.5 and 915*2.625=2401.9 UP to 1082x2402, but a real phone
// screenshot is 1081x2401, so use 2.6243 (imperceptibly different) to land on exactly those device pixels.
const W = 412, H = 915, DSF = 2.6243;
const written = [];

const browser = await chromium.launch();

async function open(data, deviceScaleFactor = DSF) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor, colorScheme: data.theme === 'light' ? 'light' : 'dark' });
  const page = await ctx.newPage();
  await page.addInitScript((d) => { window.__fixture = d; }, data);
  await page.goto(PAGE);
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page };
}
const save = (name, buf) => { written.push([name, buf]); return import('node:fs').then((fs) => fs.writeFileSync(join(FIX, name), buf)); };

// "Full page" shot: grow the viewport to the document height so the sticky bottom bar sits at the very end.
async function full(name, data, dsf = DSF) {
  const { ctx, page } = await open(data, dsf);
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: W, height: h });
  await save(name, await page.screenshot());
  await ctx.close();
}

async function viewport(name, data, scrollFn) {
  const { ctx, page } = await open(data);
  const y = await page.evaluate(scrollFn);
  await page.evaluate((y) => window.scrollTo(0, y), y);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await save(name, await page.screenshot());
  await ctx.close();
  return y;
}

await full('email-light.png', { theme: 'light' });
await full('email-dark.png', { theme: 'dark' });
await full('email-dark-top.png', { theme: 'dark', align: 'top' });
await full('email-light-dsf1.png', { theme: 'light' }, 1);

// Phone captures: status bar only on top (a phone screenshot of the scrolled email), sticky Reply/Forward bar at the bottom.
const dark = { theme: 'dark', chrome: false };
// Head: top of the email down to and including the Address row. Scrolls only if that does not fit above the bar.
await viewport('email-dark-head.png', dark, () => {
  const bar = document.querySelector('.bottom').getBoundingClientRect().height;
  const bottom = document.querySelector('[data-row="address"]').getBoundingClientRect().bottom + scrollY;
  return Math.max(0, Math.ceil(bottom + 8 - (innerHeight - bar)));
});
// Tail: starts at the Date of Departure row (a little margin above it) and runs to the end of the email.
await viewport('email-dark-tail.png', dark, () => {
  const top = document.querySelector('[data-row="departure"]').getBoundingClientRect().top + scrollY;
  return Math.min(Math.max(0, Math.floor(top - 10)), document.documentElement.scrollHeight - innerHeight);
});
// Cut: no bar; the screen's bottom edge slices through the middle of the SECOND line of the 2-line Name value.
// `above` pads the top so the Name row can actually be scrolled down to the bottom of the screen.
await viewport('email-cut-name.png', { theme: 'dark', bar: false, above: 700 }, () => {
  const r = document.querySelector('[data-row="name"] td.v').getBoundingClientRect();
  const cutAt = r.top + scrollY + 7 + 24 + 12; // td padding + line 1 + half of line 2
  return Math.round(cutAt - innerHeight);
});

await browser.close();

// Report pixel dimensions from PNG headers.
for (const [name, buf] of written) console.log(name.padEnd(24), `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`);
