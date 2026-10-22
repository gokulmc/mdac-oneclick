import { currentIndex, isFinished, type ItemStatus, type RunItem, type RunState } from '../domain/queue';
import type { SavedData } from '../domain/types';
import { h, replace } from '../shared/dom';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface QueueHooks {
  send: (type: 'refill' | 'skip' | 'cancel-run') => void;
  newRun: () => void;
}

function shortDate(iso: string): { day: number; month: string } | undefined {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso);
  return m ? { day: Number(m[2]), month: MONTHS[Number(m[1]) - 1] ?? '' } : undefined;
}

/** "23–25 Oct", "30 Oct–2 Nov" or "23 Oct". */
export function tripDates(arrival: string, departure: string): string {
  const a = shortDate(arrival);
  const d = shortDate(departure);
  if (!a) return '';
  if (!d || (a.day === d.day && a.month === d.month)) return `${a.day} ${a.month}`;
  return a.month === d.month ? `${a.day}–${d.day} ${a.month}` : `${a.day} ${a.month}–${d.day} ${d.month}`;
}

function firstName(full: string): string {
  const word = full.trim().split(/\s+/)[0] ?? '';
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

export function queueSubtitle(run: RunState): string {
  if (isFinished(run)) return 'All done';
  return `Filing ${currentIndex(run) + 1} of ${run.items.length}`;
}

function row(run: RunState, data: SavedData, item: RunItem, index: number): HTMLLIElement {
  const names = run.items.map((i) => data.travellers.find((t) => t.id === i.travellerId)?.fullName.trim() || 'Deleted traveller');
  const current = index === currentIndex(run);
  const before = names[index - 1];
  const number = String(index + 1);

  const status: Record<ItemStatus, { cls: string; dot: string; pill: string; detail: string }> = {
    confirmed: { cls: '', dot: '✓', pill: 'Done', detail: 'Confirmed' },
    filled: { cls: 'now', dot: number, pill: 'Your turn', detail: 'Form filled, check it' },
    submitted: { cls: 'now', dot: number, pill: 'Submitting…', detail: 'Waiting for the MDAC confirmation' },
    'needs-attention': { cls: '', dot: '!', pill: 'Fix', detail: item.note || 'Check the MDAC tab, then Refill or Skip.' },
    skipped: { cls: '', dot: '–', pill: 'Skipped', detail: 'Skipped' },
    pending: current
      ? { cls: 'now', dot: number, pill: 'Filling…', detail: 'Opening the MDAC form' }
      : { cls: '', dot: number, pill: 'Next', detail: before ? `Fills after ${firstName(before)}'s confirmation` : 'Waiting' },
  };
  const s = status[item.status];
  return h(
    'li',
    { 'data-status': item.status, class: s.cls },
    h('span', { class: 'dot' }, s.dot),
    h('span', {}, h('span', { class: 'name' }, names[index]!), h('small', {}, s.detail)),
    h('span', { class: 'pill' }, s.pill),
  );
}

function hint(run: RunState): HTMLElement {
  const item = run.items[currentIndex(run)]!;
  const more = run.items.slice(currentIndex(run) + 1).some((i) => i.status !== 'skipped');
  if (item.status === 'needs-attention')
    return h('div', { class: 'hint bad' }, 'Something needs a look. Fix it on the MDAC tab and press ', h('b', {}, 'Refill'), ', or ', h('b', {}, 'Skip'), ' this traveller.');
  if (item.status === 'pending')
    return h('div', { class: 'hint' }, 'Opening the MDAC form and filling it in. This takes a moment.');
  return h(
    'div',
    { class: 'hint' },
    'On the MDAC tab: complete the slider, then press ',
    h('b', {}, 'Submit'),
    more ? '. The next traveller fills automatically.' : '.',
  );
}

function summary(run: RunState): string {
  const done = run.items.filter((i) => i.status === 'confirmed').length;
  const skipped = run.items.length - done;
  return skipped ? `${done} confirmed, ${skipped} skipped.` : `${done} of ${run.items.length} confirmed.`;
}

export function renderQueue(root: HTMLElement, run: RunState, data: SavedData, hooks: QueueHooks): void {
  const preset = data.presets.find((p) => p.id === run.request.presetId);
  const finished = isFinished(run);
  const button = (id: string, label: string, type: 'refill' | 'skip' | 'cancel-run', quiet = false) => {
    const b = h('button', { id, type: 'button', class: quiet ? 'btn quiet' : 'btn' }, label);
    b.addEventListener('click', () => hooks.send(type));
    return b;
  };
  const newRun = h('button', { id: 'new-run', type: 'button', class: 'primary fill' }, 'Start a new run');
  newRun.addEventListener('click', hooks.newRun);

  replace(
    root,
    h(
      'div',
      { class: 'trip' },
      h('b', {}, preset?.name ?? 'Trip preset'),
      ` · ${tripDates(run.request.dates.arrival, run.request.dates.departure)}`,
    ),
    h('ol', {}, ...run.items.map((item, i) => row(run, data, item, i))),
    finished
      ? h('div', { class: 'hint done' }, h('b', {}, 'All done. '), summary(run))
      : hint(run),
    finished
      ? newRun
      : h('div', { class: 'actions' }, button('refill', 'Refill', 'refill'), button('skip', 'Skip', 'skip'), button('cancel', 'Cancel run', 'cancel-run', true)),
  );
}
