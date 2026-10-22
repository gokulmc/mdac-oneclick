// Runs src/options/ocr.ts (the real preprocessing + tesseract pipeline) over PNGs inside the BUILT extension and writes
// <png>.words.json next to each. Offline by construction: every host except the extension itself fails to resolve.
//   node scripts/ocr-fixture.mjs [--pre='{"invertIfDark":false}'] [--psm=6] [--no-build] [file.png ...]
// Default inputs: tests/fixtures/email-*.png. Builds into dist-harness/ (never dist/).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist-harness');
const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const files = args.filter((a) => !a.startsWith('--')).map((f) => resolve(f));
const pre = flag('pre') ? JSON.parse(flag('pre')) : {};
const psm = flag('psm') ? Number(flag('psm')) : undefined;

if (!args.includes('--no-build')) execFileSync('node', [join(root, 'scripts/build.mjs')], { cwd: root, stdio: 'inherit', env: { ...process.env, MDAC_HARNESS: '1' } });
if (!files.length) {
  const dir = join(root, 'tests/fixtures');
  if (existsSync(dir)) for (const f of readdirSync(dir).sort()) if (/^email-.*\.png$/.test(f)) files.push(join(dir, f));
}
if (!files.length) { console.log('No PNGs given and no tests/fixtures/email-*.png found; nothing to do.'); process.exit(0); }

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, '--host-resolver-rules=MAP * ~NOTFOUND'],
});
const requests = [];
context.on('request', (r) => requests.push(r.url()));
let failed = false;
try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/harness/ocr-harness.html`);
  await page.waitForFunction(() => Boolean(window.__mdacOcr));
  const defaults = await page.evaluate(() => window.__mdacOcr.DEFAULT_PREPROCESS);
  const preprocess = { ...defaults, ...pre };
  const t0 = Date.now();
  for (const file of files) {
    const t = Date.now();
    const base64 = readFileSync(file).toString('base64');
    const result = await page.evaluate(
      async ({ base64, pre, psm }) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: 'image/png' });
        return window.__mdacOcr.recognizePage(blob, { preprocess: pre, psm });
      },
      { base64, pre, psm },
    ).catch((e) => { failed = true; console.error(`${basename(file)}: ${e.message}`); return null; });
    if (!result) continue;
    const out = file.replace(/\.png$/i, '') + '.words.json';
    writeFileSync(out, JSON.stringify({ source: basename(file), width: result.width, height: result.height, preprocess, words: result.words }, null, 1) + '\n');
    const confs = result.words.map((w) => w.conf);
    const mean = confs.length ? (confs.reduce((a, b) => a + b, 0) / confs.length).toFixed(1) : 'n/a';
    console.log(`${basename(file)}: ${result.words.length} words, mean conf ${mean}, ${((Date.now() - t) / 1000).toFixed(1)}s -> ${basename(out)}`);
  }
  console.log(`total ${((Date.now() - t0) / 1000).toFixed(1)}s for ${files.length} image(s)`);
} finally {
  await context.close();
}
const outside = requests.filter((u) => !u.startsWith('chrome-extension://') && !u.startsWith('data:') && !u.startsWith('blob:'));
if (outside.length) { console.error('NETWORK REQUESTS LEFT THE EXTENSION:\n' + outside.join('\n')); process.exit(2); }
console.log(`network: ${requests.length} request(s), all chrome-extension:// (or data:/blob:)`);
process.exit(failed ? 1 : 0);
