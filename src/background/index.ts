import { buildFillPlan } from '../domain/plan';
import { isFinished, reduce, startRun, type QueueAction, type QueueEvent, type RunState } from '../domain/queue';
import type { FillReport } from '../page/fill';
import { MDAC_ORIGIN, REGISTER_URL } from '../page/detect';
import { loadData, loadRun, saveRun, type Message, type StartRunResult } from '../shared/storage';

// Messages are handled one at a time: a page load, a fill result and a popup click
// can arrive together, and each must see the Run state the previous one left.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const result = chain.then(task, task);
  chain = result.catch(() => undefined);
  return result;
}

async function updateBadge(run: RunState | undefined) {
  if (!run) return chrome.action.setBadgeText({ text: '' });
  const done = run.items.filter((i) => i.status === 'confirmed' || i.status === 'skipped').length;
  const attention = run.items.some((i) => i.status === 'needs-attention');
  await chrome.action.setBadgeBackgroundColor({ color: attention ? '#B42318' : '#1F6F43' });
  await chrome.action.setBadgeText({ text: isFinished(run) ? '✓' : `${done}/${run.items.length}` });
}

async function commit(run: RunState | undefined) {
  await saveRun(run);
  await updateBadge(run);
}

async function fillCurrent(run: RunState, travellerId: string): Promise<QueueEvent> {
  const data = await loadData();
  const traveller = data.travellers.find((t) => t.id === travellerId);
  const preset = data.presets.find((p) => p.id === run.request.presetId);
  if (!traveller || !preset) return { type: 'filled', ok: false, note: 'This traveller or trip preset was deleted.' };
  const plan = buildFillPlan(traveller, preset, run.request.dates, run.request.transportNo);
  const target = { tabId: run.tabId! };
  try {
    await chrome.scripting.executeScript({ target, world: 'MAIN', files: ['page/fill.js'] });
    const [result] = await chrome.scripting.executeScript({
      target,
      world: 'MAIN',
      func: (steps) => window.__mdacOneClick!.fill(steps),
      args: [plan],
    });
    const report = result?.result as FillReport | undefined;
    if (!report) return { type: 'filled', ok: false, note: 'The page did not answer. Reload it and press Refill.' };
    if (report.ok) return { type: 'filled', ok: true };
    const problems = [
      ...report.missingOptions.map((id) => `${id}: value not offered by the form`),
      ...report.mismatches.map((m) => `${m.id}: form kept "${m.actual}" instead of "${m.expected}"`),
    ];
    return { type: 'filled', ok: false, note: problems.join('; ') };
  } catch (e) {
    return { type: 'filled', ok: false, note: `Could not fill the page: ${(e as Error).message}` };
  }
}

async function perform(run: RunState, action: QueueAction): Promise<RunState> {
  if (action.type === 'open-form') {
    await chrome.tabs.update(run.tabId!, { url: REGISTER_URL, active: true });
  } else if (action.type === 'fill') {
    const event = await fillCurrent(run, action.travellerId);
    return reduce(run, event).state;
  }
  return run;
}

async function handleQueueEvent(event: QueueEvent, tabId: number | undefined) {
  const run = await loadRun();
  if (!run || run.tabId !== tabId || isFinished(run)) return;
  const { state, action } = reduce(run, event);
  await commit(state);
  const after = await perform(state, action);
  if (after !== state) await commit(after);
}

/** Asks the tab's watcher to report its page; injecting is a no-op beyond that if it is already there. */
async function reportPage(tabId: number) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['page/watcher.js'] });
}

async function handleStart(message: Extract<Message, { type: 'start-run' }>): Promise<StartRunResult> {
  if (message.request.travellerIds.length === 0) return { ok: false, error: 'Pick at least one traveller.' };
  // Without the "tabs" permission, tab.url is only visible for MDAC pages (host permission),
  // so any other tab reads as "not MDAC" and keeps its page: the Run gets a new tab instead.
  const tab = message.tabId === undefined ? undefined : await chrome.tabs.get(message.tabId).catch(() => undefined);
  const url = tab?.url ?? '';
  const run: RunState = startRun(message.request);
  if (url.startsWith(`${MDAC_ORIGIN}/mdac/register`)) {
    run.tabId = tab!.id;
    await commit(run);
    await reportPage(tab!.id!);
  } else if (url.startsWith(`${MDAC_ORIGIN}/mdac/`)) {
    run.tabId = tab!.id;
    await commit(run);
    await chrome.tabs.update(tab!.id!, { url: REGISTER_URL });
  } else {
    // The new tab's first page report queues behind this handler (serial), so it sees the Run.
    run.tabId = (await chrome.tabs.create({ url: REGISTER_URL })).id;
    await commit(run);
  }
  return { ok: true };
}

async function handlePopupAction(type: 'refill' | 'skip' | 'cancel-run') {
  const run = await loadRun();
  if (!run) return;
  if (type === 'cancel-run') return commit(undefined);
  const { state, action } = reduce(run, { type });
  await commit(state);
  // Refill on an already-open register form: no navigation needed, just re-report the page.
  if (type === 'refill' && run.tabId !== undefined) {
    const tab = await chrome.tabs.get(run.tabId).catch(() => undefined);
    if (tab?.url?.startsWith(`${MDAC_ORIGIN}/mdac/register`)) return reportPage(run.tabId);
  }
  const after = await perform(state, action);
  if (after !== state) await commit(after);
}

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  if (message.type === 'start-run') {
    serial(() => handleStart(message)).then(sendResponse, (e: Error) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (message.type === 'queue-event') {
    void serial(() => handleQueueEvent(message.event, sender.tab?.id));
  } else if (message.type === 'refill' || message.type === 'skip' || message.type === 'cancel-run') {
    void serial(() => handlePopupAction(message.type));
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void serial(async () => {
    const run = await loadRun();
    if (run?.tabId === tabId) await commit(undefined);
  });
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') void chrome.runtime.openOptionsPage();
});
