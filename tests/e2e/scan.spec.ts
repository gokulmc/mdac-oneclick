// The Scan view end to end: screenshots in through the real file input, the built extension's OCR (tesseract in a
// worker), review forms out, Save through the same storage path as the editors. Dummy data only (tests/fixtures).
import { join } from 'node:path';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import type { SavedData, Traveller } from '../../src/domain/types';
import { SAVED, TRAVELLERS, expect, openExtensionPage, seed, test } from './extension';

const FX = (name: string) => join(process.cwd(), 'tests', 'fixtures', name);
const HEAD = FX('email-dark-head.png');
const TAIL = FX('email-dark-tail.png');
const LIGHT = FX('email-light.png');
const NOT_AN_EMAIL = join(process.cwd(), 'store', 'screenshots', '1-popup.png');

const REVIEW_TIMEOUT = 90_000;

// What the parser makes of the all-zero dummy passport T0000001 in the fixtures: OCR reads one zero as the letter O
// and the repair keeps it (the letters-then-digits pattern takes "TO" as the letters). The chip is Unsure and the
// note says to check it, so the user is told; the test pins the real output so an update-by-passport can be exercised.
const SCANNED_PASSPORT = 'T0000001'; // the parser repairs the O the OCR reads in the all-zero dummy

/** Every request the context makes: the extension must never talk to anything outside itself while scanning. */
function trackRequests(context: BrowserContext): string[] {
  const urls: string[] = [];
  context.on('request', (r) => urls.push(r.url()));
  return urls;
}

const IN_EXTENSION = /^(chrome-extension:\/\/|blob:chrome-extension:|data:)/;

// The fixture email carries TRAVELLERS[0]'s passport, so a "new traveller" scan must start without it.
const INITIAL: SavedData = { ...SAVED, travellers: [TRAVELLERS[1]!] };

test.beforeEach(async ({ worker }) => {
  await seed(worker, INITIAL);
});

const stored = (worker: Worker): Promise<SavedData> =>
  worker.evaluate(async () => (await chrome.storage.local.get('data')).data as SavedData);

async function openScan(context: BrowserContext, extensionId: string): Promise<{ page: Page; errors: string[] }> {
  const page = await openExtensionPage(context, extensionId, 'options.html#scan');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await expect(page.locator('#scan-drop')).toBeVisible();
  return { page, errors };
}

/** Adds the files and waits for the review (or the refusal) while measuring how long reading took. */
async function scan(page: Page, files: string[], reached: 'review' | 'reason' = 'review'): Promise<number> {
  const t0 = Date.now();
  await page.setInputFiles('#scan-file', files);
  await expect(page.locator(reached === 'review' ? '#scan-save' : '#scan-reason')).toBeVisible({ timeout: REVIEW_TIMEOUT });
  const ms = Date.now() - t0;
  console.log(`scan of ${files.map((f) => f.split('/').pop()).join(' + ')} -> ${reached} in ${ms} ms`);
  test.info().annotations.push({ type: 'scan-ms', description: String(ms) });
  return ms;
}

const chipStatus = (page: Page, field: string) =>
  page.locator(`[data-testid=scan-chip][data-field=${field}]`).getAttribute('data-status');

async function chips(page: Page): Promise<Record<string, string>> {
  return page.locator('[data-testid=scan-chip]').evaluateAll((els) =>
    Object.fromEntries(els.map((e) => [(e as HTMLElement).dataset.field!, (e as HTMLElement).dataset.status!])),
  );
}

const noteOf = (page: Page, field: string) =>
  page
    .locator(`[data-testid=scan-chip][data-field=${field}]`)
    .locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " f ")][1]')
    .locator('[data-testid=scan-note]');

async function formValues(page: Page, names: string[]): Promise<Record<string, string>> {
  return page.evaluate(
    (ns) => Object.fromEntries(ns.map((n) => [n, (document.getElementById(`f-${n}`) as HTMLInputElement).value])),
    names,
  );
}

const EXPECTED_VALUES = {
  fullName: 'TEST TRAVELLER ONE', nationality: 'IND', placeOfBirth: 'IND', dateOfBirth: '1990-01-15', sex: '1',
  passportExpiry: '2036-06-30', email: 'one@example.com', dialCode: '65', mobile: '81234567',
  travelMode: '2', embarkPort: 'SGP', transportNo: 'SGX1234A', stayType: '01',
  address1: 'JALAN WONG AH FOOK', postcode: '80000', state: '01', city: '0118',
};

/** Fails the test if anything left the extension or the page threw. */
function expectQuiet(urls: string[], errors: string[]) {
  expect(urls.filter((u) => !IN_EXTENSION.test(u)), 'requests that left the extension').toEqual([]);
  expect(errors, 'page errors').toEqual([]);
}

test.describe('scan view', () => {
  test('a. two screenshots (head + tail): review values, chips, trip strip, and Save stores traveller + preset', async ({ context, worker, extensionId }) => {
    test.slow();
    const urls = trackRequests(context);
    const { page, errors } = await openScan(context, extensionId);
    await scan(page, [HEAD, TAIL]);

    // Chips: everything is Read except the passport number (unsure, with a reason). Email and the transport number
    // are free text so either read or unsure is fine. Place of birth is never in the email: unsure, defaulted.
    const c = await chips(page);
    for (const [field, status] of Object.entries(c)) {
      if (['passportNo', 'email', 'transportNo', 'placeOfBirth'].includes(field)) continue;
      expect(status, `chip ${field}`).toBe('ok');
    }
    expect(c.passportNo).toBe('unsure');
    expect(['ok', 'unsure']).toContain(c.email);
    expect(['ok', 'unsure']).toContain(c.transportNo);
    expect(c.placeOfBirth).toBe('unsure');
    for (const f of ['fullName', 'sex', 'nationality', 'dateOfBirth', 'passportExpiry', 'mobile', 'travelMode', 'embarkPort', 'stayType', 'address1', 'state', 'city', 'postcode']) {
      expect(c[f], `chip ${f} present`).toBe('ok');
    }
    await expect(noteOf(page, 'passportNo')).not.toHaveText('');
    await expect(noteOf(page, 'placeOfBirth')).toContainText('Not in the email');
    await expect(page.locator('[data-testid=scan-chip][data-field=passportNo]')).toHaveText('Unsure');

    // The trip strip: both dates and a truncated PIN, never the whole PIN.
    const trip = page.locator('#scan-trip');
    await expect(trip).toContainText('23/10/2026');
    await expect(trip).toContainText('25/10/2026');
    await expect(trip).toContainText(/PIN \S{4}…/);
    expect(await trip.textContent()).not.toMatch(/PIN [A-Za-z0-9]{5}/);

    expect(await formValues(page, Object.keys(EXPECTED_VALUES))).toEqual(EXPECTED_VALUES);
    await expect(page.locator('#scan-preset-name')).toHaveValue(/Johor Bahru/);
    const passportValue = await page.locator('#f-passportNo').inputValue();
    expect(passportValue).toBe(SCANNED_PASSPORT);
    // Nothing is written until Save.
    expect((await stored(worker)).travellers).toHaveLength(1);

    await page.locator('#scan-save').click();
    await expect(page.locator('#scan-status')).toHaveText(/Saved/);

    const data = await stored(worker);
    expect(data.travellers).toHaveLength(2);
    expect(data.presets).toHaveLength(SAVED.presets.length + 1);
    const t = data.travellers.find((x) => !SAVED.travellers.some((s) => s.id === x.id))!;
    expect(t).toMatchObject({
      fullName: 'TEST TRAVELLER ONE', passportNo: passportValue, nationality: 'IND', placeOfBirth: 'IND',
      dateOfBirth: '1990-01-15', sex: '1', passportExpiry: '2036-06-30', email: 'one@example.com', dialCode: '65', mobile: '81234567',
    });
    const p = data.presets.find((x) => !SAVED.presets.some((s) => s.id === x.id))!;
    expect(p).toMatchObject({
      travelMode: '2', transportNo: 'SGX1234A', embarkPort: 'SGP', stayType: '01', address1: 'JALAN WONG AH FOOK',
      state: '01', city: '0118', postcode: '80000',
    });
    expect(p.name).toContain('Johor Bahru');
    expect(p.seeded, 'a scanned preset is the user\'s own, not a starting point').toBeUndefined();

    // The page lands on Travellers with the new record selected.
    await expect(page.locator('nav a[data-view=travellers]')).toHaveClass(/on/);
    await expect(page.locator(`[data-testid=traveller-item].on[data-id="${t.id}"]`)).toBeVisible();
    await expect(page.locator('#scan-drop')).toHaveCount(0);
    expectQuiet(urls, errors);
  });

  test('b. update: a saved traveller with the same passport is updated, inferred place of birth does not replace the saved one', async ({ context, worker, extensionId }) => {
    test.slow();
    const urls = trackRequests(context);
    const saved: Traveller = { ...TRAVELLERS[0]!, id: 'trav-upd', email: 'old-saved@example.com', placeOfBirth: 'SGP', passportNo: SCANNED_PASSPORT };
    await seed(worker, { ...SAVED, travellers: [saved, TRAVELLERS[1]!] });
    const { page, errors } = await openScan(context, extensionId);
    await scan(page, [LIGHT]);

    await expect(page.locator('#scan-update-target')).toContainText('TEST TRAVELLER ONE');
    expect(await chipStatus(page, 'placeOfBirth')).toBe('saved');
    await expect(page.locator('[data-testid=scan-chip][data-field=placeOfBirth]')).toHaveText('From saved');
    await expect(page.locator('#f-placeOfBirth')).toHaveValue('SGP');
    expect(await chipStatus(page, 'email')).toBe('ok');
    await expect(page.locator('[data-testid=scan-chip][data-field=email]')).toHaveText('Read');
    await expect(page.locator('#f-email')).toHaveValue('one@example.com');
    await expect(page.locator('#f-passportNo')).toHaveValue(SCANNED_PASSPORT);

    await page.locator('#scan-save').click();
    await expect(page.locator('#scan-status')).toHaveText(/Updated/);

    const data = await stored(worker);
    expect(data.travellers).toHaveLength(2);
    const t = data.travellers.find((x) => x.id === 'trav-upd')!;
    expect(t).toMatchObject({ id: 'trav-upd', email: 'one@example.com', placeOfBirth: 'SGP', passportNo: SCANNED_PASSPORT, fullName: 'TEST TRAVELLER ONE' });
    expect(data.travellers.find((x) => x.id === 'trav-2')).toEqual(TRAVELLERS[1]);
    expect(data.presets).toHaveLength(SAVED.presets.length + 1);
    await expect(page.locator('nav a[data-view=travellers]')).toHaveClass(/on/);
    await expect(page.locator('[data-testid=traveller-item].on[data-id="trav-upd"]')).toBeVisible();
    expectQuiet(urls, errors);
  });

  test('c. a user edit of the inferred place of birth becomes Edited and is what gets saved', async ({ context, worker, extensionId }) => {
    test.slow();
    const urls = trackRequests(context);
    const { page, errors } = await openScan(context, extensionId);
    await scan(page, [HEAD, TAIL]);
    expect(await chipStatus(page, 'placeOfBirth')).toBe('unsure');
    await page.locator('#f-placeOfBirth').selectOption('SGP');
    expect(await chipStatus(page, 'placeOfBirth')).toBe('edited');
    await expect(page.locator('[data-testid=scan-chip][data-field=placeOfBirth]')).toHaveText('Edited');
    expect(await chipStatus(page, 'nationality'), 'other chips are untouched').toBe('ok');

    await page.locator('#scan-save').click();
    await expect(page.locator('#scan-status')).toHaveText(/Saved/);
    const t = (await stored(worker)).travellers.find((x) => !SAVED.travellers.some((s) => s.id === x.id))!;
    expect(t.placeOfBirth).toBe('SGP');
    expect(t.nationality).toBe('IND');
    expectQuiet(urls, errors);
  });

  test('d. changing the state clears the city, offers that state\'s cities, and the picked city is saved', async ({ context, worker, extensionId }) => {
    test.slow();
    const urls = trackRequests(context);
    const { page, errors } = await openScan(context, extensionId);
    await scan(page, [HEAD, TAIL]);
    await expect(page.locator('#f-city')).toHaveValue('0118');

    await page.locator('#f-state').selectOption('14'); // WP Kuala Lumpur
    await expect(page.locator('#f-city')).toHaveValue('');
    const options = await page.locator('#f-city option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    expect(options).toContain('1401');
    expect(options, 'Johor Bahru is not a Kuala Lumpur city').not.toContain('0118');
    expect(await chipStatus(page, 'state')).toBe('edited');
    expect(await chipStatus(page, 'city')).toBe('missing');

    await page.locator('#f-city').selectOption('1401');
    expect(await chipStatus(page, 'city')).toBe('edited');
    await page.locator('#scan-save').click();
    await expect(page.locator('#scan-status')).toHaveText(/Saved/);
    const p = (await stored(worker)).presets.find((x) => !SAVED.presets.some((s) => s.id === x.id))!;
    expect(p).toMatchObject({ state: '14', city: '1401' });
    expectQuiet(urls, errors);
  });

  test('e. tail screenshot only: accepted, personal fields Missing, Save needs a passport number', async ({ context, worker, extensionId }) => {
    test.slow();
    const urls = trackRequests(context);
    const { page, errors } = await openScan(context, extensionId);
    await scan(page, [TAIL]);

    const c = await chips(page);
    for (const f of ['fullName', 'passportNo', 'sex', 'nationality', 'dateOfBirth', 'passportExpiry', 'email', 'mobile']) {
      expect(c[f], `chip ${f}`).toBe('missing');
    }
    await expect(page.locator('#f-passportNo')).toHaveValue('');
    await expect(page.locator('#f-fullName')).toHaveValue('');
    await expect(page.locator('#scan-save')).toBeDisabled();

    await page.locator('#f-passportNo').fill('T0000009');
    await expect(page.locator('#scan-save')).toBeEnabled();
    expect(await chipStatus(page, 'passportNo')).toBe('edited');
    // The travel half was still read.
    const preset = await formValues(page, ['travelMode', 'embarkPort', 'stayType', 'address1', 'state', 'city', 'postcode']);
    expect(preset).toMatchObject({ stayType: '01', state: '01', city: '0118', postcode: '80000' });
    expect(preset.address1).toContain('JALAN');

    await page.locator('#scan-save').click();
    await expect(page.locator('#scan-status')).toHaveText(/Saved/);
    const data = await stored(worker);
    expect(data.travellers).toHaveLength(2);
    const t = data.travellers.find((x) => x.passportNo === 'T0000009')!;
    expect(t).toBeDefined();
    const p = data.presets.find((x) => !SAVED.presets.some((s) => s.id === x.id))!;
    expect(p).toMatchObject({ stayType: '01', state: '01', city: '0118', postcode: '80000' });
    expectQuiet(urls, errors);
  });

  test('f. cancelling a scan saves nothing, and Scan again reads the same screenshots', async ({ context, worker, extensionId }) => {
    test.slow();
    const urls = trackRequests(context);
    const { page, errors } = await openScan(context, extensionId);
    await page.setInputFiles('#scan-file', [HEAD, TAIL]);
    await expect(page.locator('#scan-progress')).toBeVisible();
    await page.locator('#scan-cancel-ocr').click();
    await expect(page.locator('#scan-progress')).toHaveCount(0);
    await expect(page.locator('#scan-problem')).toContainText('Scan cancelled');
    await expect(page.locator('[data-testid=scan-thumb]')).toHaveCount(2);
    await expect(page.locator('#scan-save')).toHaveCount(0);
    expect(await stored(worker)).toEqual(INITIAL);

    const t0 = Date.now();
    await page.locator('#scan-retry').click();
    await expect(page.locator('#scan-save')).toBeVisible({ timeout: REVIEW_TIMEOUT });
    console.log(`retry after cancel -> review in ${Date.now() - t0} ms`);
    expect(await formValues(page, ['fullName', 'passportExpiry'])).toEqual({ fullName: 'TEST TRAVELLER ONE', passportExpiry: '2036-06-30' });
    expect(await stored(worker)).toEqual(INITIAL);
    expectQuiet(urls, errors);
  });

  test('g. an unrelated image is refused with a reason, no forms, nothing saved', async ({ context, worker, extensionId }) => {
    test.slow();
    const urls = trackRequests(context);
    const { page, errors } = await openScan(context, extensionId);
    await scan(page, [NOT_AN_EMAIL], 'reason');
    await expect(page.locator('#scan-reason')).toContainText("doesn't look like");
    await expect(page.locator('#scan-traveller-form')).toHaveCount(0);
    await expect(page.locator('#scan-preset-form')).toHaveCount(0);
    await expect(page.locator('#scan-save')).toHaveCount(0);
    expect(await stored(worker)).toEqual(INITIAL);
    // Start over returns to the drop zone.
    await page.locator('#scan-cancel').click();
    await expect(page.locator('#scan-drop')).toBeVisible();
    expectQuiet(urls, errors);
  });

  test('h. leaving the view mid-scan is quiet: no errors, nothing saved, the Scan view starts clean', async ({ context, worker, extensionId }) => {
    test.slow();
    const urls = trackRequests(context);
    const { page, errors } = await openScan(context, extensionId);
    await page.setInputFiles('#scan-file', [HEAD, TAIL]);
    await expect(page.locator('#scan-progress')).toBeVisible();
    await page.locator('nav a[data-view=travellers]').click();
    await expect(page.locator('nav a[data-view=travellers]')).toHaveClass(/on/);
    await expect(page.locator('#scan-progress')).toHaveCount(0);
    await page.waitForTimeout(4_000); // a scan still running in the background would blow up (or render) about now
    await expect(page.locator('#scan-save')).toHaveCount(0);
    await expect(page.locator('[data-testid=scan-thumb]')).toHaveCount(0);
    expect(await stored(worker)).toEqual(INITIAL);

    // Coming back shows an empty drop zone, not the abandoned scan.
    await page.locator('nav a[data-view=scan]').click();
    await expect(page.locator('#scan-drop')).toBeVisible();
    await expect(page.locator('[data-testid=scan-thumb]')).toHaveCount(0);
    expectQuiet(urls, errors);
  });
});
