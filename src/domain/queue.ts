import type { RunRequest } from './types';

// A Run walks its Travellers one at a time. The extension fills, the traveller
// drags the slider and submits (the Hand-off), and the next Register form only
// gets filled after the site shows a Confirmation for the current one.

export type ItemStatus =
  | 'pending' // not filled yet
  | 'filled' // form filled, waiting for the traveller to submit
  | 'submitted' // traveller pressed Submit, waiting for the next page
  | 'confirmed' // the site showed a Confirmation
  | 'needs-attention' // the site came back with the form again, or the fill failed
  | 'skipped';

export interface RunItem {
  travellerId: string;
  status: ItemStatus;
  note?: string;
}

export interface RunState {
  request: RunRequest;
  items: RunItem[];
  tabId?: number;
}

/** What the page watcher reports after each MDAC page load. */
export type PageKind = 'register-form' | 'confirmation' | 'other';

export type QueueEvent =
  | { type: 'page'; kind: PageKind }
  | { type: 'filled'; ok: boolean; note?: string }
  | { type: 'submitted' }
  | { type: 'refill' }
  | { type: 'skip' };

export type QueueAction =
  | { type: 'fill'; travellerId: string }
  | { type: 'open-form' }
  | { type: 'done' }
  | { type: 'none' };

export function startRun(request: RunRequest): RunState {
  return { request, items: request.travellerIds.map((travellerId) => ({ travellerId, status: 'pending' })) };
}

/** The item the Run is working on: the first one not confirmed or skipped. */
export function currentIndex(state: RunState): number {
  return state.items.findIndex((i) => i.status !== 'confirmed' && i.status !== 'skipped');
}

export function isFinished(state: RunState): boolean {
  return currentIndex(state) === -1;
}

function withItem(state: RunState, index: number, patch: Partial<RunItem>): RunState {
  return { ...state, items: state.items.map((item, i) => (i === index ? { ...item, ...patch } : item)) };
}

function next(state: RunState): QueueAction {
  const i = currentIndex(state);
  if (i === -1) return { type: 'done' };
  return { type: 'open-form' };
}

export function reduce(state: RunState, event: QueueEvent): { state: RunState; action: QueueAction } {
  const i = currentIndex(state);
  if (i === -1) return { state, action: { type: 'done' } };
  const item = state.items[i]!;

  switch (event.type) {
    case 'page': {
      if (event.kind === 'confirmation') {
        if (item.status !== 'submitted') return { state, action: { type: 'none' } };
        const s = withItem(state, i, { status: 'confirmed', note: undefined });
        return { state: s, action: next(s) };
      }
      if (event.kind === 'register-form') {
        if (item.status === 'pending') return { state, action: { type: 'fill', travellerId: item.travellerId } };
        if (item.status === 'submitted')
          // The site re-rendered the form instead of confirming: a server-side rejection.
          return {
            state: withItem(state, i, {
              status: 'needs-attention',
              note: 'The MDAC site showed the form again. Check its message, then Refill or Skip.',
            }),
            action: { type: 'none' },
          };
        // A reload of a filled form loses the values; fill again.
        if (item.status === 'filled')
          return { state: withItem(state, i, { status: 'pending' }), action: { type: 'fill', travellerId: item.travellerId } };
      }
      return { state, action: { type: 'none' } };
    }
    case 'filled':
      return {
        state: withItem(state, i, event.ok ? { status: 'filled', note: event.note } : { status: 'needs-attention', note: event.note }),
        action: { type: 'none' },
      };
    case 'submitted':
      if (item.status !== 'filled' && item.status !== 'needs-attention') return { state, action: { type: 'none' } };
      return { state: withItem(state, i, { status: 'submitted', note: undefined }), action: { type: 'none' } };
    case 'refill':
      return {
        state: withItem(state, i, { status: 'pending', note: undefined }),
        action: { type: 'open-form' },
      };
    case 'skip': {
      const s = withItem(state, i, { status: 'skipped' });
      return { state: s, action: next(s) };
    }
  }
}
