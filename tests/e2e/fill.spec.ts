import {
  DIST, REGISTER_URL, extensionOpenedRegisterPage, SAVED, TODAY, TRAVELLERS, expect, expectedForTraveller, formValues, getRun, hasPopup, inDays,
  mdacTabId, openExtensionPage, request, seed, send, tabs, test, waitForItem,
} from './extension';

const DATES = { arrival: TODAY, departure: inDays(2) };

test.beforeEach(async ({ worker }) => {
  await seed(worker);
});

test('a. single traveller: every field is filled, hand-off banner shown, nothing submitted', async ({ context, worker, extensionId, site }) => {
  const page = await context.newPage();
  await page.goto(REGISTER_URL);
  const tabId = await mdacTabId(worker);
  const ext = await openExtensionPage(context, extensionId);

  const started = await send(ext, { type: 'start-run', request: request({ transportNo: 'TEST1234' }), tabId });
  expect(started).toEqual({ ok: true });
  await waitForItem(worker, 0, 'filled');

  // An INDIA national dialled with +65: region is the traveller's +65, not India's +91 the lookup preselected.
  const expected = expectedForTraveller(TRAVELLERS[0]!, DATES, 'TEST1234');
  expect(await formValues(page)).toEqual(expected);
  expect(expected.nationality).toBe('IND');
  expect(expected.region).toBe('65');

  // Both dates survive: arrival is today and departure (which the arrival datepicker clears) is today+2.
  const dates = await page.evaluate(() => [
    (document.getElementById('arrDt') as HTMLInputElement).value,
    (document.getElementById('depDt') as HTMLInputElement).value,
  ]);
  expect(dates).toEqual([expected.arrDt, expected.depDt]);

  const banner = page.locator('#mdac-oneclick-handoff');
  await expect(banner).toBeVisible();
  await expect(banner).toBeInViewport();
  await expect(page.locator('#submit')).toBeVisible();

  // The Hand-off: no submission, slider untouched.
  expect(site.posts).toHaveLength(0);
  expect(await page.evaluate(() => (window as unknown as { verifyResult: unknown }).verifyResult)).toBeNull();
  expect(await page.evaluate(() => (window as unknown as { __lastValidation: unknown }).__lastValidation)).toBeNull();
  expect(page.url()).toBe(REGISTER_URL);
  expect((await getRun(worker))?.items[0]?.note).toBeUndefined();
});

test('a2. concurrent lookups with slow responses still end with the right region, city and postcode', async ({ context, worker, extensionId, site }) => {
  site.latencyMs = 900;
  const page = await context.newPage();
  await page.goto(REGISTER_URL);
  const tabId = await mdacTabId(worker);
  const ext = await openExtensionPage(context, extensionId);
  await send(ext, { type: 'start-run', request: request(), tabId });
  await waitForItem(worker, 0, 'filled');
  const v = await formValues(page);
  expect(v.region).toBe('65');
  expect(v.accommodationCity).toBe('0118');
  expect(v.accommodationPostcode).toBe('80000');
  // The lookups really ran (country x2, state, city postcode).
  expect(site.lookups).toEqual(expect.arrayContaining(['retrieveCountryPhoneCode:IND', 'retrieveRefCity:01', 'retrievePostcode:0118']));
});

test('b. arrival outside the window is reported as needs-attention naming arrDt', async ({ context, worker, extensionId, site }) => {
  const page = await context.newPage();
  await page.goto(REGISTER_URL);
  const tabId = await mdacTabId(worker);
  const ext = await openExtensionPage(context, extensionId);
  await send(ext, {
    type: 'start-run',
    request: request({ dates: { arrival: inDays(5), departure: inDays(7) } }),
    tabId,
  });
  await waitForItem(worker, 0, 'needs-attention');
  const item = (await getRun(worker))!.items[0]!;
  expect(item.note).toMatch(/arrDt/);
  // Still handed off to the traveller, who can correct it by hand; nothing submitted.
  await expect(page.locator('#mdac-oneclick-handoff')).toBeVisible();
  expect(site.posts).toHaveLength(0);
});

test('c. queue of 3: each traveller fills after the previous confirmation; 3 POSTs in order', async ({ context, worker, extensionId, site }) => {
  const page = await context.newPage();
  await page.goto(REGISTER_URL);
  const tabId = await mdacTabId(worker);
  const ext = await openExtensionPage(context, extensionId);
  await send(ext, { type: 'start-run', request: request({ travellerIds: ['trav-1', 'trav-2', 'trav-3'] }), tabId });

  for (let i = 0; i < 3; i++) {
    await waitForItem(worker, i, 'filled');
    const t = TRAVELLERS[i]!;
    await expect(page.locator('#name')).toHaveValue(t.fullName);
    await expect(page.locator('#mdac-oneclick-handoff')).toBeVisible();
    await page.evaluate(() => (window as unknown as { __fixtureVerify(): void }).__fixtureVerify());
    await page.locator('#submit').click();
    await waitForItem(worker, i, 'confirmed');
    if (i < 2) {
      // The extension opens a fresh register form itself and fills the next traveller.
      await expect(page.locator('#name')).toHaveValue(TRAVELLERS[i + 1]!.fullName);
    }
  }
  const run = (await getRun(worker))!;
  expect(run.items.map((x) => x.status)).toEqual(['confirmed', 'confirmed', 'confirmed']);
  expect(site.posts.map((p) => p.fields.passNo)).toEqual(['T0000001', 'T0000002', 'T0000003']);
  expect(site.posts.every((p) => p.fields.submitRegistration === 'Submit')).toBe(true);
  await expect(page.locator('h2')).toHaveText('Registration successful');
});

test('d. server rejection: needs-attention, then Refill fills the form again', async ({ context, worker, extensionId, site }) => {
  site.postOutcome = (n) => (n === 1 ? 'reject' : 'confirm');
  const page = await context.newPage();
  await page.goto(REGISTER_URL);
  const tabId = await mdacTabId(worker);
  const ext = await openExtensionPage(context, extensionId);
  await send(ext, { type: 'start-run', request: request(), tabId });
  await waitForItem(worker, 0, 'filled');
  await page.evaluate(() => (window as unknown as { __fixtureVerify(): void }).__fixtureVerify());
  await page.locator('#submit').click();

  // The site answered with the form again (blank, with its own error banner).
  await expect(page.locator('#server-error')).toBeVisible();
  await waitForItem(worker, 0, 'needs-attention');
  expect((await getRun(worker))!.items[0]!.note).toMatch(/showed the form again/);
  await expect(page.locator('#name')).toHaveValue('');

  await send(ext, { type: 'refill' });
  await waitForItem(worker, 0, 'filled');
  await expect(page.locator('#name')).toHaveValue('TEST TRAVELLER ONE');
  expect(await formValues(page)).toEqual(expectedForTraveller(TRAVELLERS[0]!, DATES, 'CW2'));
  expect(site.posts).toHaveLength(1);
});

test('e. starting from a non-MDAC tab opens a new tab on the register form and leaves the original alone', async ({ context, worker, extensionId, site }) => {
  // Without the "tabs" permission the extension cannot see this tab's URL: find its id as the one new tab.
  const known = new Set((await tabs(worker)).map((t) => t.id));
  const other = await context.newPage();
  await other.goto('https://example.com/');
  let tabId: number | undefined;
  await expect.poll(async () => (tabId = (await tabs(worker)).find((t) => !known.has(t.id) && !(t.url ?? '').startsWith('chrome-extension://'))?.id)).toBeDefined();
  const ext = await openExtensionPage(context, extensionId);
  const pagesBefore = context.pages().length;
  await send(ext, { type: 'start-run', request: request(), tabId });

  const mdac = await extensionOpenedRegisterPage(context);
  await waitForItem(worker, 0, 'filled');
  const run = (await getRun(worker))!;
  expect(run.tabId).toBeDefined();
  expect(run.tabId).not.toBe(tabId);
  expect(context.pages().length).toBe(pagesBefore + 1);
  await expect(mdac.locator('#name')).toHaveValue('TEST TRAVELLER ONE');
  expect(other.url()).toBe('https://example.com/');
  expect(site.posts).toHaveLength(0);
  expect((await tabs(worker)).some((t) => t.url === REGISTER_URL)).toBe(true);
});

test.describe('f. popup UI', () => {
  test.skip(!hasPopup, `popup.html is not in ${DIST}`);

  test('fills a traveller from the real popup form', async ({ context, worker, extensionId, site }) => {
    const page = await context.newPage();
    await page.goto(REGISTER_URL);
    const tabId = await mdacTabId(worker);

    const popup = await context.newPage();
    await popup.setViewportSize({ width: 360, height: 640 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);

    const options = popup.locator('input[data-testid=traveller-option]');
    await expect(options).toHaveCount(TRAVELLERS.length);
    await popup.locator('input[data-testid=traveller-option][value="trav-1"]').check();
    await popup.locator('select#preset').selectOption('seed-causeway-bus-jb');
    await popup.locator('input#arrival').fill(TODAY);
    await popup.locator('input#departure').fill(inDays(2));
    await popup.locator('input#transportNo').fill('TEST1234');

    // The seeded preset warns until it is edited.
    await expect(popup.locator('#warnings [data-testid=warning]').first()).toBeVisible();
    await expect(popup.locator('#warnings')).toContainText(/starting-point preset/i);

    await expect(popup.locator('button#fill')).toBeEnabled();
    await popup.locator('button#fill').click();

    await expect(popup.locator('#queue li[data-status]')).toHaveCount(1);
    await waitForItem(worker, 0, 'filled');
    await expect(popup.locator('#queue li[data-status="filled"]')).toHaveCount(1);
    expect(await formValues(page)).toEqual(expectedForTraveller(TRAVELLERS[0]!, DATES, 'TEST1234'));
    expect(site.posts).toHaveLength(0);
    expect((await getRun(worker))!.request.travellerIds).toEqual(['trav-1']);
    expect(SAVED.presets.some((p) => p.id === 'seed-causeway-bus-jb')).toBe(true);
  });

  test('queue view: skip and cancel', async ({ context, worker, extensionId }) => {
    const page = await context.newPage();
    await page.goto(REGISTER_URL);
    const tabId = await mdacTabId(worker);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
    await popup.locator('input[data-testid=traveller-option][value="trav-1"]').check();
    await popup.locator('input[data-testid=traveller-option][value="trav-2"]').check();
    await popup.locator('select#preset').selectOption('seed-causeway-bus-jb');
    await popup.locator('input#arrival').fill(TODAY);
    await popup.locator('input#departure').fill(inDays(2));
    await popup.locator('button#fill').click();
    await expect(popup.locator('#queue li[data-status]')).toHaveCount(2);
    await waitForItem(worker, 0, 'filled');

    await popup.locator('#skip').click();
    await expect(popup.locator('#queue li').first()).toHaveAttribute('data-status', 'skipped');
    await waitForItem(worker, 1, 'filled');
    await expect(page.locator('#name')).toHaveValue('TEST TRAVELLER TWO');

    await popup.locator('#cancel').click();
    await expect.poll(async () => getRun(worker)).toBeUndefined();
  });
});
