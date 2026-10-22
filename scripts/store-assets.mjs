// Generates the Chrome Web Store assets from the BUILT extension (dist/) with dummy data only:
//   store/screenshots/1-popup.png ... 5-presets.png  (1280x800)
//   store/promo-440x280.png                          (small promo tile)
// Run with `pnpm store-assets` (builds first). Re-runnable; output depends only on dist/ and today's date.
//
// Real extension pages (popup.html, options.html) and the real fill run against the hand-written
// fixture of the register form, served through tests/fixtures/mdac-site.ts. The real government
// site is never contacted (host-resolver rule + route). No government crest/flag/branding is used.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { MdacSite, REGISTER_URL } from '../tests/fixtures/mdac-site.ts';
import { SEEDED_PRESETS } from '../src/domain/seeds.ts';
import { addDays, localIsoDate } from '../src/domain/dates.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(process.env.MDAC_DIST ?? join(root, 'dist'));
const SHOTS = join(root, 'store', 'screenshots');
if (!existsSync(join(DIST, 'manifest.json'))) throw new Error(`No extension build at ${DIST}. Run pnpm build first.`);
mkdirSync(SHOTS, { recursive: true });

// ---- Dummy data only ---------------------------------------------------------------------------
const TODAY = localIsoDate(new Date());
const inDays = (n) => addDays(TODAY, n);
const TRAVELLERS = [
  { id: 'trav-1', fullName: 'TEST TRAVELLER ONE', passportNo: 'T0000001', dateOfBirth: '1990-01-15', nationality: 'IND', placeOfBirth: 'IND', sex: '1', passportExpiry: '2036-06-30', email: 'one@example.com', dialCode: '65', mobile: '81234567' },
  { id: 'trav-2', fullName: 'TEST TRAVELLER TWO', passportNo: 'T0000002', dateOfBirth: '1992-03-20', nationality: 'IND', placeOfBirth: 'IND', sex: '2', passportExpiry: '2036-07-31', email: 'two@example.com', dialCode: '65', mobile: '82345678' },
  { id: 'trav-3', fullName: 'TEST TRAVELLER THREE', passportNo: 'T0000003', dateOfBirth: '2015-11-05', nationality: 'IND', placeOfBirth: 'IND', sex: '1', passportExpiry: '2036-08-31', email: 'three@example.com', dialCode: '65', mobile: '83456789' },
];
// Presets the user has "made their own" (no starter-address warning) for the popup shots.
const OWN_PRESETS = SEEDED_PRESETS.map((p) => ({ ...p, seeded: undefined }));
const data = (presets) => ({ version: 1, travellers: TRAVELLERS, presets: presets.map((p) => ({ ...p })) });
const request = (over = {}) => ({
  travellerIds: ['trav-1'], presetId: 'seed-causeway-bus-jb', dates: { arrival: inDays(1), departure: inDays(3) }, transportNo: '', ...over,
});

// ---- Composition page ----------------------------------------------------------------------------
const dataUri = (buf, type = 'image/png') => `data:${type};base64,${buf.toString('base64')}`;
const ICON = dataUri(readFileSync(join(root, 'public/icons/128.png')));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const BASE_CSS = `
  :root { --bg:#F7F7F4; --surface:#fff; --line:#DCDED6; --text:#1C1F1A; --text-2:#5B6157; --accent:#1F6F43;
          --accent-soft:#E3F1E8; --handoff:#E0B400; --handoff-soft:#FFF6D6; --handoff-text:#3D3000;
          --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 100%; height: 100%; overflow: hidden; }
  body { font-family: var(--font); color: var(--text); -webkit-font-smoothing: antialiased;
         background: radial-gradient(900px 700px at 100% 0%, var(--accent-soft) 0%, transparent 70%),
                     radial-gradient(700px 600px at 0% 110%, var(--handoff-soft) 0%, transparent 70%), var(--bg); }
`;

function slide({ headline, caption, img, imgWidth, imgRadius = 14, textWidth = 420, headSize = 46, gap = 64, pad = 72 }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
    .stage { width: 1280px; height: 800px; display: flex; align-items: center; justify-content: center; gap: ${gap}px; padding: 0 ${pad}px; }
    .text { width: ${textWidth}px; flex: none; }
    .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 36px; font-weight: 700; font-size: 20px; color: var(--accent); }
    .brand img { width: 40px; height: 40px; border-radius: 10px; }
    h1 { font-size: ${headSize}px; line-height: 1.1; letter-spacing: -0.02em; font-weight: 800; }
    p { margin-top: 20px; font-size: 22px; line-height: 1.45; color: var(--text-2); }
    .rule { width: 56px; height: 5px; border-radius: 3px; background: var(--handoff); margin-top: 28px; }
    .shot { flex: none; width: ${imgWidth}px; border-radius: ${imgRadius}px; overflow: hidden; background: #fff;
            box-shadow: 0 0 0 1px rgba(28,31,26,.10), 0 24px 60px -12px rgba(28,31,26,.32), 0 8px 20px -8px rgba(28,31,26,.18); }
    .shot img { display: block; width: 100%; height: auto; }
  </style></head><body><div class="stage">
    <div class="shot"><img id="shot" src="${img}"></div>
    <div class="text"><div class="brand"><img src="${ICON}" alt="">MDAC One-Click</div>
      <h1>${esc(headline)}</h1><p>${esc(caption)}</p><div class="rule"></div></div>
  </div></body></html>`;
}

function promo() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
    body { width: 440px; height: 280px; display: flex; flex-direction: column; justify-content: center; padding: 0 36px; }
    img { width: 84px; height: 84px; border-radius: 20px; box-shadow: 0 8px 20px -6px rgba(31,111,67,.45); }
    h1 { margin-top: 20px; font-size: 38px; letter-spacing: -0.02em; font-weight: 800; color: var(--accent); line-height: 1.05; }
    p { margin-top: 10px; font-size: 20px; line-height: 1.3; color: var(--text); font-weight: 500; }
    .rule { width: 48px; height: 5px; border-radius: 3px; background: var(--handoff); margin-top: 16px; }
  </style></head><body><img src="${ICON}" alt=""><h1>MDAC One-Click</h1><p>Malaysia arrival card in one click</p><div class="rule"></div></body></html>`;
}

// ---- Run -------------------------------------------------------------------------------------------
const site = new MdacSite({ latencyMs: 60 });
const ext = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  deviceScaleFactor: 2, // crisp raw captures; compositions are rendered at 1x below
  args: [
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    '--host-resolver-rules=MAP imigresen-online.imi.gov.my 127.0.0.1',
  ],
});
const composer = await chromium.launch({ channel: 'chromium', headless: true });
const composeCtx = await composer.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

try {
  await site.install(ext);
  const worker = ext.serviceWorkers()[0] ?? (await ext.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  const seed = (d) => worker.evaluate((v) => chrome.storage.local.set({ data: v }), d);
  const clearRun = () => worker.evaluate(() => chrome.storage.session.remove('run'));
  const getRun = () => worker.evaluate(async () => (await chrome.storage.session.get('run')).run);
  const waitFor = async (fn, what, ms = 20_000) => {
    const t0 = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const waitItem = (i, status) => waitFor(async () => (await getRun())?.items[i]?.status === status, `item ${i} ${status}`);
  const mdacTabId = () => waitFor(() => worker.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => (t.url ?? '').startsWith(u))?.id, REGISTER_URL), 'MDAC tab');
  const send = (page, m) => page.evaluate((x) => chrome.runtime.sendMessage(x), m);

  async function openRegister() {
    const page = await ext.newPage();
    await page.setViewportSize({ width: 800, height: 760 });
    await page.goto(REGISTER_URL);
    return page;
  }

  /** The popup's content height, capped like Chrome's 600px popup limit. */
  const contentHeight = (page) =>
    page.evaluate(() => Math.min(600, Math.ceil(document.getElementById('app').getBoundingClientRect().height)));

  /** Real popup.html at its real width, cropped to its content height (like Chrome's popup). */
  async function popupPng(tabId) {
    const page = await ext.newPage();
    await page.setViewportSize({ width: 360, height: 700 });
    await page.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
    await page.waitForSelector('#ready:not([hidden]), #queue:not([hidden]), #empty:not([hidden])');
    await page.evaluate(() => document.fonts.ready);
    const height = await contentHeight(page);
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: 360, height } });
    await page.close();
    return { png, height };
  }

  async function compose(file, html, width, height) {
    const page = await composeCtx.newPage();
    await page.setViewportSize({ width, height });
    await page.setContent(html);
    await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: file, type: 'png' });
    await page.close();
    console.log('wrote', file.replace(root + '/', ''));
  }

  const slideFile = (n) => join(SHOTS, n);

  // 1. Popup, ready to fill.
  await seed(data(OWN_PRESETS));
  {
    const mdac = await openRegister();
    const tabId = await mdacTabId();
    const popup = await ext.newPage();
    await popup.setViewportSize({ width: 360, height: 700 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
    await popup.waitForSelector('#ready:not([hidden])');
    await popup.locator('select#preset').selectOption('seed-causeway-bus-jb');
    await popup.locator('input#arrival').fill(inDays(1));
    await popup.locator('input#departure').fill(inDays(3));
    await popup.locator('input[data-testid=traveller-option][value="trav-1"]').check();
    await popup.locator('input[data-testid=traveller-option][value="trav-2"]').check();
    await popup.evaluate(() => document.fonts.ready);
    const height = await contentHeight(popup);
    const png = await popup.screenshot({ clip: { x: 0, y: 0, width: 360, height } });
    await popup.close();
    await compose(slideFile('1-popup.png'), slide({
      headline: 'Fill the whole MDAC in one click',
      caption: 'Pick who is travelling, a trip preset and the dates. Every field fills in about two seconds.',
      img: dataUri(png), imgWidth: 360 * 1.2, imgRadius: 16,
    }), 1280, 800);
    await mdac.close();
  }

  // 2. Family queue: traveller one confirmed, traveller two's turn, traveller three waiting.
  await clearRun();
  // The queue shows "Fills after <first word>'s confirmation", so give the family a first word that reads well.
  await seed({ ...data(OWN_PRESETS), travellers: TRAVELLERS.map((t, i) => ({ ...t, fullName: `TRAVELLER ${['ONE', 'TWO', 'THREE'][i]} (TEST)` })) });
  {
    const mdac = await openRegister();
    const tabId = await mdacTabId();
    const helper = await ext.newPage();
    await helper.goto(`chrome-extension://${extensionId}/options.html`);
    await send(helper, { type: 'start-run', request: request({ travellerIds: ['trav-1', 'trav-2', 'trav-3'] }), tabId });
    await waitItem(0, 'filled');
    await mdac.evaluate(() => window.__fixtureVerify());
    await mdac.locator('#submit').click();
    await waitItem(0, 'confirmed');
    await waitItem(1, 'filled');
    await helper.close();
    const { png } = await popupPng(tabId);
    await compose(slideFile('2-family-queue.png'), slide({
      headline: 'Travelling as a family?',
      caption: 'Each traveller fills after the last one is confirmed.',
      img: dataUri(png), imgWidth: 360 * 1.2, imgRadius: 16,
    }), 1280, 800);
    await mdac.close();
  }

  // 3. The filled register form with the hand-off banner above the slider.
  await clearRun();
  await seed(data(OWN_PRESETS));
  {
    const mdac = await openRegister();
    await mdac.setViewportSize({ width: 760, height: 800 });
    const tabId = await mdacTabId();
    const helper = await ext.newPage();
    await helper.goto(`chrome-extension://${extensionId}/options.html`);
    await send(helper, { type: 'start-run', request: request({ transportNo: 'CW2' }), tabId });
    await waitItem(0, 'filled');
    await helper.close();
    await mdac.locator('#mdac-oneclick-handoff').waitFor();
    // The fixture labels its slider placeholder; show it the way the real form reads.
    await mdac.evaluate(() => { document.getElementById('captcha').textContent = 'Drag To Verify'; });
    await mdac.waitForTimeout(900); // smooth scroll settles
    // Start the visible form on a label boundary instead of slicing a field in half.
    await mdac.evaluate(() => {
      const top = document.querySelector('label[for=vesselNm]').getBoundingClientRect().top;
      window.scrollTo({ top: window.scrollY + top - 16, behavior: 'instant' });
    });
    await mdac.waitForTimeout(150);
    const png = await mdac.screenshot();
    await compose(slideFile('3-filled-form.png'), slide({
      headline: 'You stay in control',
      caption: 'Complete the slider and press Submit yourself. The extension never does it for you.',
      img: dataUri(png), imgWidth: 700, imgRadius: 12, textWidth: 380,
    }), 1280, 800);
    await mdac.close();
  }

  // 4 + 5. Settings: saved travellers and trip presets (starter presets, as a new user sees them).
  await clearRun();
  await seed(data(SEEDED_PRESETS));
  async function optionsPng(view) {
    const page = await ext.newPage();
    await page.setViewportSize({ width: 860, height: 900 });
    await page.goto(`chrome-extension://${extensionId}/options.html#${view}`);
    await page.locator('#list .item').first().click();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);
    // Crop just below the last whole control that fits, so no field is sliced in half.
    const height = await page.evaluate((cap) => {
      const bottoms = [...document.querySelectorAll('#editor input, #editor select, #editor button, #editor textarea')]
        .map((el) => el.getBoundingClientRect().bottom)
        .filter((b) => b <= cap - 10);
      return Math.ceil(Math.max(...bottoms) + 10);
    }, 790);
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: 860, height } });
    await page.close();
    return png;
  }
  await compose(slideFile('4-travellers.png'), slide({
    headline: 'Save passport details once',
    caption: 'Kept only in this browser. No account, no server, no analytics.',
    img: dataUri(await optionsPng('travellers')), imgWidth: 790, imgRadius: 12, textWidth: 330, headSize: 40, gap: 48, pad: 56,
  }), 1280, 800);
  await compose(slideFile('5-presets.png'), slide({
    headline: 'Presets for the Causeway, KL, Melaka and Penang',
    caption: 'Start from a ready-made trip and edit the address to where you will stay.',
    img: dataUri(await optionsPng('presets')), imgWidth: 790, imgRadius: 12, textWidth: 330, headSize: 40, gap: 48, pad: 56,
  }), 1280, 800);

  // Small promo tile.
  await compose(join(root, 'store', 'promo-440x280.png'), promo(), 440, 280);
} finally {
  await composer.close();
  await ext.close();
}
