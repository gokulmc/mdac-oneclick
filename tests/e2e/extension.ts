// Shared Playwright fixtures: the built extension in a persistent Chromium context,
// the MDAC site stand-in, and helpers to seed storage and read the Run.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, chromium, expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { addDays, localIsoDate } from '../../src/domain/dates';
import { SEEDED_PRESETS } from '../../src/domain/seeds';
import type { RunState } from '../../src/domain/queue';
import type { RunRequest, SavedData, Traveller } from '../../src/domain/types';
import { MdacSite, REGISTER_URL } from '../fixtures/mdac-site';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DIST = resolve(process.env.MDAC_DIST ?? join(root, 'dist'));
export const hasPopup = existsSync(join(DIST, 'popup.html'));
export { REGISTER_URL, expect };

// ---- Dummy data only -------------------------------------------------------------------------

export const TODAY = localIsoDate(new Date());
export const inDays = (n: number) => addDays(TODAY, n);

export const TRAVELLERS: Traveller[] = [
  {
    id: 'trav-1', fullName: 'TEST TRAVELLER ONE', passportNo: 'T0000001', dateOfBirth: '1990-01-15',
    nationality: 'IND', placeOfBirth: 'IND', sex: '1', passportExpiry: '2036-06-30',
    email: 'one@example.com', dialCode: '65', mobile: '81234567',
  },
  {
    id: 'trav-2', fullName: 'TEST TRAVELLER TWO', passportNo: 'T0000002', dateOfBirth: '1992-03-20',
    nationality: 'SGP', placeOfBirth: 'SGP', sex: '2', passportExpiry: '2036-07-31',
    email: 'two@example.com', dialCode: '65', mobile: '82345678',
  },
  {
    id: 'trav-3', fullName: 'TEST TRAVELLER THREE', passportNo: 'T0000003', dateOfBirth: '2015-11-05',
    nationality: 'SGP', placeOfBirth: 'SGP', sex: '1', passportExpiry: '2036-08-31',
    email: 'three@example.com', dialCode: '65', mobile: '83456789',
  },
];

export const SAVED: SavedData = {
  version: 1,
  travellers: TRAVELLERS,
  presets: SEEDED_PRESETS.map((p) => ({ ...p })),
};

export function request(over: Partial<RunRequest> = {}): RunRequest {
  return {
    travellerIds: ['trav-1'],
    presetId: 'seed-causeway-bus-jb',
    dates: { arrival: TODAY, departure: inDays(2) },
    transportNo: '',
    ...over,
  };
}

// ---- Fixtures --------------------------------------------------------------------------------

interface Fixtures {
  site: MdacSite;
  context: BrowserContext;
  extensionId: string;
  worker: Worker;
}

export const test = base.extend<Fixtures>({
  site: async ({}, use) => {
    await use(new MdacSite());
  },
  context: async ({ site }, use) => {
    if (!existsSync(join(DIST, 'manifest.json'))) throw new Error(`No extension build at ${DIST}. Run pnpm build first.`);
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${DIST}`,
        `--load-extension=${DIST}`,
        // Tests must never reach the real government site: anything the fixture route misses fails to connect.
        '--host-resolver-rules=MAP imigresen-online.imi.gov.my 127.0.0.1',
      ],
    });
    await site.install(context);
    await use(context);
    await context.close();
  },
  worker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },
  extensionId: async ({ worker }, use) => {
    await use(new URL(worker.url()).host);
  },
});

// ---- Helpers ---------------------------------------------------------------------------------

export async function seed(worker: Worker, data: SavedData = SAVED) {
  await worker.evaluate((d) => chrome.storage.local.set({ data: d }), data);
}

export async function tabs(worker: Worker): Promise<{ id?: number; url?: string }[]> {
  return worker.evaluate(async () => (await chrome.tabs.query({})).map((t) => ({ id: t.id, url: t.url })));
}

/** Tab id of the first tab whose (host-permission-visible) URL matches. */
export async function tabIdWhere(worker: Worker, match: (url: string) => boolean): Promise<number> {
  let found: number | undefined;
  await expect
    .poll(async () => {
      found = (await tabs(worker)).find((t) => t.id !== undefined && match(t.url ?? ''))?.id;
      return found;
    })
    .toBeDefined();
  return found!;
}

export const mdacTabId = (worker: Worker) => tabIdWhere(worker, (u) => u.startsWith(REGISTER_URL));

export async function getRun(worker: Worker): Promise<RunState | undefined> {
  return worker.evaluate(async () => (await chrome.storage.session.get('run')).run as RunState | undefined);
}

export async function waitForItem(worker: Worker, index: number, status: string | string[]) {
  const wanted = Array.isArray(status) ? status : [status];
  await expect
    .poll(
      async () => {
        const status = (await getRun(worker))?.items[index]?.status;
        return wanted.includes(status ?? '') ? status : `item ${index} is ${status}, waiting for ${wanted.join('|')}`;
      },
      { message: `item ${index} -> ${wanted.join('|')}` },
    )
    .toBe(wanted.length === 1 ? wanted[0] : expect.stringMatching(new RegExp(`^(${wanted.join('|')})$`)));
}

/** An extension page that can talk to the background, like the popup does. */
export async function openExtensionPage(context: BrowserContext, extensionId: string, path = 'options.html'): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/${path}`);
  return page;
}

export async function send(page: Page, message: unknown): Promise<unknown> {
  return page.evaluate((m) => chrome.runtime.sendMessage(m), message);
}

export const FIELD_IDS = [
  'name', 'passNo', 'dob', 'sex', 'pob', 'nationality', 'passExpDte', 'email', 'confirmEmail', 'region', 'mobile',
  'arrDt', 'depDt', 'vesselNm', 'trvlMode', 'embark', 'accommodationStay', 'accommodationAddress1',
  'accommodationAddress2', 'accommodationState', 'accommodationCity', 'accommodationPostcode',
] as const;

export async function formValues(page: Page): Promise<Record<string, string>> {
  return page.evaluate(
    (ids) => Object.fromEntries(ids.map((id) => [id, (document.getElementById(id) as HTMLInputElement).value])),
    FIELD_IDS as unknown as string[],
  );
}

export const toForm = (iso: string) => iso.split('-').reverse().join('/');

/** Expected form values for traveller 1 with the bus preset, given dates. */
export function expectedForTraveller(t: Traveller, dates: { arrival: string; departure: string }, transport: string) {
  return {
    name: t.fullName, passNo: t.passportNo, dob: toForm(t.dateOfBirth), sex: t.sex, pob: t.placeOfBirth,
    nationality: t.nationality, passExpDte: toForm(t.passportExpiry), email: t.email, confirmEmail: t.email,
    region: t.dialCode, mobile: t.mobile, arrDt: toForm(dates.arrival), depDt: toForm(dates.departure),
    vesselNm: transport, trvlMode: '2', embark: 'SGP', accommodationStay: '01',
    accommodationAddress1: 'JALAN WONG AH FOOK', accommodationAddress2: 'BANDAR JOHOR BAHRU',
    accommodationState: '01', accommodationCity: '0118', accommodationPostcode: '80000',
  };
}

/**
 * A tab the extension itself opened (chrome.tabs.create) on the register form.
 * Playwright attaches to such a tab after its first request has left, so that request
 * bypasses the fixture route; one reload brings it under the route. The extension is
 * unaffected: after the reload its watcher reports the form exactly like a user reload.
 */
export async function extensionOpenedRegisterPage(context: BrowserContext): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(() => (found = context.pages().find((p) => p.url().startsWith(REGISTER_URL))), { message: 'extension-opened register tab' })
    .toBeDefined();
  const page = found!;
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  if ((await page.locator('form[name=permohonan]').count()) === 0) await page.reload();
  return page;
}
