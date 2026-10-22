import type { RunState } from '../domain/queue';
import type { SavedData } from '../domain/types';
import { byId, h, replace } from '../shared/dom';
import { loadData, loadRun, onRunChanged, type Message } from '../shared/storage';
import './popup.css';
import { queueSubtitle, renderQueue } from './queue';
import { renderReady } from './ready';

const SUBTITLE = 'Malaysia Digital Arrival Card';
const views = { empty: byId('empty'), ready: byId('ready'), queue: byId('queue') };
type View = keyof typeof views;

let data: SavedData = await loadData();
let shown: View | undefined;

function show(view: View, subtitle = SUBTITLE) {
  shown = view;
  for (const [name, el] of Object.entries(views)) el.hidden = name !== view;
  byId('subtitle').textContent = subtitle;
}

/** The background answers popup actions through storage changes, not replies. */
function send(message: Message) {
  return chrome.runtime.sendMessage(message).catch(() => undefined);
}

function renderEmpty() {
  const add = h('button', { id: 'add-first', class: 'primary', type: 'button' }, 'Add traveller');
  add.addEventListener('click', () => void chrome.runtime.openOptionsPage());
  replace(
    views.empty,
    h('h2', {}, 'Add your first traveller'),
    h('p', {}, 'Save passport details once. Next time, the whole MDAC form fills in one click.'),
    add,
    h('p', { class: 'small' }, 'Stored only in this browser. Nothing is sent anywhere except the MDAC form itself.'),
  );
}

/** Picks the view for the current Run (or lack of one). A Run, even a finished one, stays until cancelled. */
async function route(run: RunState | undefined) {
  if (run) {
    renderQueue(views.queue, run, data, { send: (type) => void send({ type }), newRun: () => void newRun() });
    return show('queue', queueSubtitle(run));
  }
  if (shown === 'queue' || shown === undefined) data = await loadData();
  if (data.travellers.length === 0) {
    if (shown !== 'empty') renderEmpty();
    show('empty');
  } else if (shown !== 'ready') {
    renderReady(views.ready, data, () => void loadRun().then(route));
    show('ready');
  }
}

async function newRun() {
  await send({ type: 'cancel-run' });
  await route(undefined);
}

byId('gear').addEventListener('click', () => void chrome.runtime.openOptionsPage());
onRunChanged((run) => void route(run));
await route(await loadRun());
