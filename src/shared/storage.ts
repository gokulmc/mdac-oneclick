// Saved data lives in chrome.storage.local only: never synced, never sent anywhere.
import { emptyData } from '../domain/io';
import type { QueueEvent, RunState } from '../domain/queue';
import type { RunRequest, SavedData } from '../domain/types';

const DATA_KEY = 'data';
const RUN_KEY = 'run';

export async function loadData(): Promise<SavedData> {
  const stored = (await chrome.storage.local.get(DATA_KEY))[DATA_KEY] as SavedData | undefined;
  return stored ?? emptyData();
}

export async function saveData(data: SavedData): Promise<void> {
  await chrome.storage.local.set({ [DATA_KEY]: data });
}

/** The active Run is per browser session: closing Chrome forgets it. */
export async function loadRun(): Promise<RunState | undefined> {
  return (await chrome.storage.session.get(RUN_KEY))[RUN_KEY] as RunState | undefined;
}

export async function saveRun(run: RunState | undefined): Promise<void> {
  if (run) await chrome.storage.session.set({ [RUN_KEY]: run });
  else await chrome.storage.session.remove(RUN_KEY);
}

export function onRunChanged(listener: (run: RunState | undefined) => void): void {
  chrome.storage.session.onChanged.addListener((changes) => {
    if (RUN_KEY in changes) listener(changes[RUN_KEY]!.newValue as RunState | undefined);
  });
}

/** Messages the popup and page watcher send to the background. */
export type Message =
  | { type: 'start-run'; request: RunRequest; tabId?: number }
  | { type: 'queue-event'; event: QueueEvent }
  | { type: 'refill' }
  | { type: 'skip' }
  | { type: 'cancel-run' };

export type StartRunResult = { ok: true } | { ok: false; error: string };
