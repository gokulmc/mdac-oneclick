// Visual QC: screenshots into test-results/qc/ plus layout assertions that catch clipped text,
// horizontal scroll and an off-screen Fill button. Read the screenshots too: assertions do not see ugly.
import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { SavedData } from '../../src/domain/types';
import {
  REGISTER_URL, SAVED, TODAY, TRAVELLERS, expect, inDays, mdacTabId, openExtensionPage, request, seed, send, test,
  waitForItem,
} from './extension';

const QC_DIR = 'test-results/qc';
mkdirSync(QC_DIR, { recursive: true });
const shot = (page: Page, name: string, fullPage = false) => page.screenshot({ path: `${QC_DIR}/${name}.png`, fullPage });

/** Layout rules every screen must satisfy. */
async function assertLayout(page: Page) {
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement!;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  expect(overflow.scrollWidth, 'no horizontal page overflow').toBeLessThanOrEqual(overflow.clientWidth);

  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('button, label, a, h1, h2, h3, li, select, input, [data-testid=warning], .item, small, .sub')]
      .filter((el) => el.offsetParent !== null && el.clientWidth > 0)
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      // Native selects and inputs scroll their own value; only flag them when the box itself overflows its parent.
      .filter((el) => !['SELECT', 'INPUT'].includes(el.tagName) || el.scrollWidth > (el.parentElement?.clientWidth ?? Infinity) + 1)
      .map((el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} "${(el.textContent ?? '').trim().slice(0, 40)}" ${el.scrollWidth}>${el.clientWidth}`),
  );
  expect(clipped, 'text overflowing its box').toEqual([]);
}

const FOUR_TRAVELLERS: SavedData = {
  ...SAVED,
  travellers: [
    ...TRAVELLERS,
    {
      ...TRAVELLERS[0]!, id: 'trav-4', fullName: 'TEST TRAVELLER FOUR WITH A DELIBERATELY VERY LONG PASSPORT NAME',
      passportNo: 'T0000004', passportExpiry: inDays(90), email: 'four@example.com',
    },
  ],
};

async function openPopup(page: Page, extensionId: string, tabId: number) {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
}

test.describe('popup (360x640)', () => {
  test('empty state', async ({ context, worker, extensionId }) => {
    await seed(worker, { version: 1, travellers: [], presets: SAVED.presets });
    const mdac = await context.newPage();
    await mdac.goto(REGISTER_URL);
    const popup = await context.newPage();
    await openPopup(popup, extensionId, await mdacTabId(worker));
    await expect(popup.locator('#empty')).toBeVisible();
    await shot(popup, 'popup-empty');
    await assertLayout(popup);
  });

  test('ready with warnings', async ({ context, worker, extensionId }) => {
    await seed(worker); // 3 travellers, seeded presets
    const mdac = await context.newPage();
    await mdac.goto(REGISTER_URL);
    const popup = await context.newPage();
    await openPopup(popup, extensionId, await mdacTabId(worker));
    await popup.locator('input[data-testid=traveller-option][value="trav-1"]').check();
    await popup.locator('input[data-testid=traveller-option][value="trav-2"]').check();
    await popup.locator('select#preset').selectOption('seed-causeway-bus-jb');
    await popup.locator('input#arrival').fill(inDays(5));
    await popup.locator('input#departure').fill(inDays(7));
    const warnings = popup.locator('#warnings [data-testid=warning]');
    await expect(warnings.first()).toBeVisible();
    expect(await warnings.count()).toBeGreaterThanOrEqual(2); // seeded preset + arrival window
    await shot(popup, 'popup-ready-warnings');
    for (const w of await warnings.all()) await expect(w).toBeVisible();
    await expect(popup.locator('button#fill')).toBeVisible();
    await expect(popup.locator('button#fill')).toBeInViewport({ ratio: 1 });
    await assertLayout(popup);
  });

  // Stress: 4 travellers (one with a very long name) and 4 warnings. Nothing may overflow sideways,
  // and Fill must stay fully on screen (it is sticky: a real Chrome popup tops out near 600px and scrolls).
  test('many warnings and a long name', async ({ context, worker, extensionId }) => {
    await seed(worker, FOUR_TRAVELLERS);
    const mdac = await context.newPage();
    await mdac.goto(REGISTER_URL);
    const popup = await context.newPage();
    await openPopup(popup, extensionId, await mdacTabId(worker));
    await popup.locator('input[data-testid=traveller-option][value="trav-1"]').check();
    await popup.locator('input[data-testid=traveller-option][value="trav-4"]').check();
    await popup.locator('select#preset').selectOption('seed-causeway-bus-jb');
    await popup.locator('input#arrival').fill(inDays(5));
    await popup.locator('input#departure').fill(inDays(4));
    expect(await popup.locator('#warnings [data-testid=warning]').count()).toBeGreaterThanOrEqual(3);
    await shot(popup, 'popup-many-warnings-full', true);
    await expect(popup.locator('button#fill')).toBeInViewport({ ratio: 1 });
    await assertLayout(popup);
  });

  test('ready, no warnings', async ({ context, worker, extensionId }) => {
    const edited = { ...FOUR_TRAVELLERS, presets: FOUR_TRAVELLERS.presets.map((p) => ({ ...p, seeded: undefined })) };
    await seed(worker, edited);
    const mdac = await context.newPage();
    await mdac.goto(REGISTER_URL);
    const popup = await context.newPage();
    await openPopup(popup, extensionId, await mdacTabId(worker));
    await popup.locator('input[data-testid=traveller-option][value="trav-1"]').check();
    await popup.locator('select#preset').selectOption('seed-causeway-bus-jb');
    await popup.locator('input#arrival').fill(TODAY);
    await popup.locator('input#departure').fill(inDays(2));
    await expect(popup.locator('button#fill')).toBeInViewport({ ratio: 1 });
    await shot(popup, 'popup-ready-clean');
    await assertLayout(popup);
  });

  test('queue view', async ({ context, worker, extensionId }) => {
    await seed(worker);
    const mdac = await context.newPage();
    await mdac.goto(REGISTER_URL);
    const tabId = await mdacTabId(worker);
    const ext = await openExtensionPage(context, extensionId);
    await send(ext, { type: 'start-run', request: request({ travellerIds: ['trav-1', 'trav-2', 'trav-3'] }), tabId });
    await waitForItem(worker, 0, 'filled');
    const popup = await context.newPage();
    await openPopup(popup, extensionId, tabId);
    await expect(popup.locator('#queue li[data-status]')).toHaveCount(3);
    await expect(popup.locator('#skip')).toBeVisible();
    await shot(popup, 'popup-queue');
    await assertLayout(popup);
  });
});

test.describe('options (1100x760)', () => {
  for (const view of ['travellers', 'presets', 'data'] as const) {
    test(`${view} view`, async ({ context, worker, extensionId }) => {
      await seed(worker, FOUR_TRAVELLERS);
      const page = await context.newPage();
      await page.setViewportSize({ width: 1100, height: 760 });
      await page.goto(`chrome-extension://${extensionId}/options.html#${view}`);
      await expect(page.locator(`nav a[data-view=${view}]`)).toHaveClass(/on/);
      if (view !== 'data') await page.locator('#list .item').first().click();
      await shot(page, `options-${view}`);
      await assertLayout(page);
    });
  }

  test('editing the long-named traveller', async ({ context, worker, extensionId }) => {
    await seed(worker, FOUR_TRAVELLERS);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1100, height: 760 });
    await page.goto(`chrome-extension://${extensionId}/options.html#travellers`);
    await page.locator('#list .item').last().click();
    await shot(page, 'options-travellers-long-name');
    await assertLayout(page);
  });
});

test('register page after a fill shows the hand-off banner', async ({ context, worker, extensionId }) => {
  await seed(worker);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.goto(REGISTER_URL);
  const tabId = await mdacTabId(worker);
  const ext = await openExtensionPage(context, extensionId);
  await send(ext, { type: 'start-run', request: request({ transportNo: 'TEST1234' }), tabId });
  await waitForItem(worker, 0, 'filled');
  const banner = page.locator('#mdac-oneclick-handoff');
  await expect(banner).toBeInViewport();
  const box = (await banner.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(760);
  await page.waitForTimeout(600); // let the smooth scroll settle
  await shot(page, 'register-after-fill');
  await shot(page, 'register-after-fill-full', true);
});
