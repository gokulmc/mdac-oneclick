import { checkPreset, checkTraveller } from '../domain/checks';
import { localIsoDate } from '../domain/dates';
import { emptyData, mergeImport, parseExport, toExport } from '../domain/io';
import { cityLabel, labelOf, reference } from '../domain/reference';
import type { SavedData, Traveller, TripPreset } from '../domain/types';
import { byId, h, replace } from '../shared/dom';
import { loadData, saveData } from '../shared/storage';
import { createForm, type FormHandle, type SectionSpec } from './forms';
import { blankPreset, blankTraveller, normalisePreset, normaliseTraveller, presetSections, travellerSections, wireStateCity } from './records';
import { renderScanView } from './scan';
import './options.css';

type View = 'travellers' | 'presets' | 'scan' | 'data';
type Kind = 'traveller' | 'preset';

const VIEWS: View[] = ['travellers', 'presets', 'scan', 'data'];
const wrap = byId('wrap');
const list = byId('list');
const editor = byId('editor');

let data: SavedData = await loadData();
let view: View = VIEWS.find((v) => `#${v}` === location.hash) ?? 'travellers';
const selected: Record<'travellers' | 'presets', string | undefined> = {
  travellers: data.travellers[0]?.id,
  presets: data.presets[0]?.id,
};
/** A record being created: lives only in the editor until it is saved. */
let draft: Traveller | TripPreset | undefined;
let justSaved = false;
/** Tears down the Scan view (OCR worker, object URLs, paste listener) when another view takes over. */
let unmountScan: (() => void) | undefined;

const today = () => localIsoDate(new Date());

/** Applies a change to the freshest saved data, so edits the popup made meanwhile (lastUsed) survive. */
async function commit(change: (current: SavedData) => SavedData) {
  data = change(await loadData());
  await saveData(data);
}

// ---------- shared list + editor chrome ----------

const travellerDetail = (t: Traveller) =>
  [labelOf(reference.nationalities, t.nationality) ?? t.nationality, t.passportNo].filter(Boolean).join(' · ');

function presetDetail(p: TripPreset) {
  const mode = labelOf(reference.travelModes, p.travelMode) ?? '';
  const place = [cityLabel(p.state, p.city), labelOf(reference.states, p.state)].filter(Boolean).join(', ');
  return [mode, place].filter(Boolean).join(' · ');
}

function listItem(testid: string, id: string, title: string, detail: string, on: boolean, badge?: string) {
  const item = h(
    'button',
    { type: 'button', class: `item${on ? ' on' : ''}`, 'data-testid': testid, 'data-id': id },
    h('b', {}, title),
    h('small', {}, detail),
    badge && h('span', { class: 'badge' }, badge),
  );
  item.addEventListener('click', () => {
    draft = undefined;
    justSaved = false;
    selected[view as 'travellers' | 'presets'] = id;
    render();
  });
  return item;
}

function renderNav() {
  byId('count-travellers').textContent = String(data.travellers.length);
  byId('count-presets').textContent = String(data.presets.length);
  document.querySelectorAll<HTMLAnchorElement>('nav a').forEach((a) => a.classList.toggle('on', a.dataset.view === view));
}

function renderList() {
  wrap.classList.toggle('no-list', view === 'data' || view === 'scan');
  if (view === 'data' || view === 'scan') return replace(list); // the Scan view fills the list column itself
  const isTraveller = view === 'travellers';
  const add = h('button', { id: isTraveller ? 'add-traveller' : 'add-preset', type: 'button', class: 'add' }, isTraveller ? '+ Add traveller' : '+ Add trip preset');
  add.addEventListener('click', () => {
    draft = isTraveller ? blankTraveller() : blankPreset();
    justSaved = false;
    render();
  });
  const scanOpen = h('button', { id: 'scan-open', type: 'button', class: 'ghost' }, 'Scan a confirmation email…');
  scanOpen.addEventListener('click', () => go('scan'));
  const id = selected[view];
  const items = isTraveller
    ? data.travellers.map((t) => listItem('traveller-item', t.id, t.fullName || 'Unnamed traveller', travellerDetail(t), !draft && t.id === id))
    : data.presets.map((p) => listItem('preset-item', p.id, p.name, presetDetail(p), !draft && p.id === id, p.seeded ? 'Starting point' : undefined));
  const draftItem = draft && h('div', { class: 'item on' }, h('b', {}, isTraveller ? 'New traveller' : 'New trip preset'), h('small', {}, 'Not saved yet'));
  replace(list, add, scanOpen, draftItem, ...items);
}

/** Save / delete bar with the in-page delete confirmation (window.confirm would block automation). */
function renderBar(opts: {
  kind: Kind;
  isNew: boolean;
  subject: string;
  onDelete: () => Promise<void>;
  onDuplicate?: () => Promise<void>;
}): HTMLElement {
  const bar = h('div', { class: 'bar' });
  const status = h('span', { class: 'note', id: 'save-status', role: 'status' }, justSaved ? 'Saved' : '');

  const normal = () => {
    const save = h('button', { id: `save-${opts.kind}`, type: 'submit', class: 'save' }, `Save ${opts.kind === 'traveller' ? 'traveller' : 'preset'}`);
    const buttons: Node[] = [save, status];
    if (opts.onDuplicate) {
      const dup = h('button', { id: 'duplicate-preset', type: 'button', class: 'ghost' }, 'Duplicate');
      dup.addEventListener('click', () => void opts.onDuplicate!());
      buttons.push(dup);
    }
    if (!opts.isNew) {
      const del = h('button', { id: `delete-${opts.kind}`, type: 'button', class: 'del' }, 'Delete');
      del.addEventListener('click', confirming);
      buttons.push(del);
    }
    replace(bar, ...buttons);
  };
  const confirming = () => {
    const yes = h('button', { id: 'confirm-delete', type: 'button', class: 'danger' }, 'Yes, delete');
    const no = h('button', { id: 'cancel-delete', type: 'button', class: 'ghost' }, 'Keep it');
    yes.addEventListener('click', () => void opts.onDelete());
    no.addEventListener('click', normal);
    replace(bar, h('span', { class: 'confirm-text', role: 'alert' }, `Delete ${opts.subject}? This cannot be undone.`), yes, no);
  };
  normal();
  return bar;
}

function renderRecordEditor<T extends Traveller | TripPreset>(opts: {
  kind: Kind;
  record: T;
  isNew: boolean;
  title: string;
  hint: string;
  sections: SectionSpec[];
  check: (v: T) => ReturnType<typeof checkPreset>;
  normalise: (base: T, v: Partial<T>) => T;
  onBuilt?: (f: FormHandle<T>) => void;
  banner?: HTMLElement;
  onSaved: (record: T) => Promise<void>;
  onDelete: () => Promise<void>;
  onDuplicate?: (record: T) => Promise<void>;
  onExtra?: (w: ReturnType<typeof checkPreset>) => void;
}) {
  const handle = createForm<T>({
    id: `${opts.kind}-form`,
    sections: opts.sections,
    values: opts.record as unknown as Record<string, string>,
    check: (v) => opts.check({ ...opts.record, ...v }),
    showAll: !opts.isNew,
    onExtra: opts.onExtra,
    onEdit: () => {
      const status = document.getElementById('save-status');
      if (status) status.textContent = '';
    },
  });
  opts.onBuilt?.(handle);
  handle.refresh();
  const current = () => opts.normalise(opts.record, handle.read());
  handle.form.addEventListener('submit', (e) => {
    e.preventDefault();
    handle.touchAll();
    void opts.onSaved(current());
  });
  handle.form.append(
    renderBar({
      kind: opts.kind,
      isNew: opts.isNew,
      subject: opts.title,
      onDelete: opts.onDelete,
      onDuplicate: opts.onDuplicate && (() => opts.onDuplicate!(current())),
    }),
  );
  replace(editor, h('h2', {}, opts.title), h('p', { class: 'hint' }, opts.hint), opts.banner, handle.form);
}

function renderEmptyEditor(what: string) {
  replace(editor, h('h2', {}, `No ${what} yet`), h('p', { class: 'hint' }, `Use "Add" to create your first one.`));
}

function renderTravellerEditor() {
  const existing = data.travellers.find((t) => t.id === selected.travellers);
  const record = draft ? (draft as Traveller) : existing;
  if (!record) return renderEmptyEditor('travellers');
  renderRecordEditor<Traveller>({
    kind: 'traveller',
    record,
    isNew: !!draft,
    title: record.fullName ? titleCase(record.fullName) : 'New traveller',
    hint: 'Enter everything exactly as printed in the passport.',
    sections: travellerSections(),
    check: (t) => checkTraveller(t, today()),
    normalise: normaliseTraveller,
    onSaved: async (t) => {
      await commit((cur) => ({ ...cur, travellers: upsert(cur.travellers, t) }));
      draft = undefined;
      selected.travellers = t.id;
      justSaved = true;
      render();
    },
    onDelete: async () => {
      await commit((cur) => ({ ...cur, travellers: cur.travellers.filter((x) => x.id !== record.id) }));
      selected.travellers = data.travellers[0]?.id;
      justSaved = false;
      render();
    },
  });
}

function renderPresetEditor() {
  const existing = data.presets.find((p) => p.id === selected.presets);
  const record = draft ? (draft as TripPreset) : existing;
  if (!record) return renderEmptyEditor('trip presets');
  const callout = h('div', { class: 'callout', id: 'seeded-note', 'data-testid': 'seeded-note', hidden: true });
  renderRecordEditor<TripPreset>({
    kind: 'preset',
    record,
    isNew: !!draft,
    title: record.name || 'New trip preset',
    hint: 'A reusable journey. Travel dates are asked for each time you Fill.',
    sections: presetSections(),
    check: checkPreset,
    normalise: normalisePreset,
    banner: callout,
    onExtra: (warnings) => {
      callout.hidden = warnings.length === 0;
      callout.textContent = warnings.map((w) => w.message).join(' ');
    },
    onBuilt: (handle) => wireStateCity(handle, record.state, record.city),
    onSaved: async (p) => {
      await commit((cur) => ({ ...cur, presets: upsert(cur.presets, p) }));
      draft = undefined;
      selected.presets = p.id;
      justSaved = true;
      render();
    },
    onDelete: async () => {
      await commit((cur) => ({ ...cur, presets: cur.presets.filter((x) => x.id !== record.id) }));
      selected.presets = data.presets[0]?.id;
      justSaved = false;
      render();
    },
    onDuplicate: async (p) => {
      const copy: TripPreset = { ...p, id: crypto.randomUUID(), name: `${p.name} (copy)` };
      await commit((cur) => ({ ...cur, presets: [...cur.presets, copy] }));
      draft = undefined;
      selected.presets = copy.id;
      justSaved = true;
      render();
    },
  });
}

function upsert<T extends { id: string }>(items: T[], item: T): T[] {
  return items.some((x) => x.id === item.id) ? items.map((x) => (x.id === item.id ? item : x)) : [...items, item];
}

function titleCase(name: string) {
  return name.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

// ---------- backup & import ----------

function downloadBackup() {
  const url = URL.createObjectURL(new Blob([toExport(data)], { type: 'application/json' }));
  const a = h('a', { href: url, download: `mdac-oneclick-backup-${localIsoDate(new Date())}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderDataView() {
  const importStatus = h('p', { id: 'import-status', class: 'note', role: 'status' });
  const fileInput = h('input', { type: 'file', id: 'import', accept: 'application/json,.json' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    importStatus.classList.remove('error');
    try {
      const incoming = parseExport(await file.text());
      await commit((cur) => mergeImport(cur, incoming));
      selected.travellers ??= data.travellers[0]?.id;
      selected.presets ??= data.presets[0]?.id;
      const n = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
      importStatus.textContent = `Saved: imported ${n(incoming.travellers.length, 'traveller')} and ${n(incoming.presets.length, 'trip preset')}.`;
      renderNav();
    } catch (e) {
      importStatus.classList.add('error');
      importStatus.textContent = (e as Error).message;
    }
    fileInput.value = '';
  });

  const exportBtn = h('button', { id: 'export', type: 'button', class: 'save' }, 'Export backup');
  exportBtn.addEventListener('click', downloadBackup);

  const deleteZone = h('div', { class: 'danger-zone' });
  const showDelete = () => {
    const del = h('button', { id: 'delete-all', type: 'button', class: 'danger-outline' }, 'Delete all saved data');
    del.addEventListener('click', showConfirm);
    replace(deleteZone, del);
  };
  const showConfirm = () => {
    const yes = h('button', { id: 'confirm-delete-all', type: 'button', class: 'danger' }, 'Yes, delete everything');
    const no = h('button', { id: 'cancel-delete-all', type: 'button', class: 'ghost' }, 'Keep my data');
    yes.addEventListener('click', async () => {
      data = emptyData();
      await saveData(data);
      selected.travellers = undefined;
      selected.presets = data.presets[0]?.id;
      renderNav();
      showDelete();
      importStatus.classList.remove('error');
      importStatus.textContent = 'Saved: all travellers deleted and trip presets reset to the starting points.';
    });
    no.addEventListener('click', showDelete);
    replace(deleteZone, h('p', { role: 'alert', class: 'confirm-text' }, 'Delete every traveller and trip preset from this browser? This cannot be undone.'), h('div', { class: 'row-btns' }, yes, no));
  };
  showDelete();

  replace(
    editor,
    h('h2', {}, 'Backup & import'),
    h('p', { class: 'hint' }, 'Your data is stored in chrome.storage.local on this device. It is never synced and never sent anywhere.'),
    h('div', { class: 'callout' }, 'Export files contain passport details. Keep them somewhere safe and delete them when you are done.'),
    h('section', { class: 'block' }, h('h3', {}, 'Export'), h('p', { class: 'hint' }, 'Download every traveller and trip preset as one JSON file.'), exportBtn),
    h('section', { class: 'block' }, h('h3', {}, 'Import'), h('p', { class: 'hint' }, 'Records with the same id are replaced; everything else is added.'), h('label', { class: 'file', for: 'import' }, 'Backup file'), fileInput, importStatus),
    h('section', { class: 'block' }, h('h3', {}, 'Delete'), deleteZone),
  );
}

// ---------- routing ----------

function render() {
  unmountScan?.();
  unmountScan = undefined;
  renderNav();
  renderList();
  if (view === 'travellers') renderTravellerEditor();
  else if (view === 'presets') renderPresetEditor();
  else if (view === 'scan') unmountScan = renderScanView(editor, scanDeps());
  else renderDataView();
}

function go(next: View) {
  view = next;
  draft = undefined;
  justSaved = false;
  history.replaceState(null, '', `#${view}`);
  render();
}

const scanDeps = () => ({
  list,
  wrap,
  getData: () => data,
  today,
  save: (t: Traveller, p: TripPreset) =>
    commit((cur) => ({ ...cur, travellers: upsert(cur.travellers, t), presets: [...cur.presets, p] })),
  onDone: (travellerId: string) => {
    selected.travellers = travellerId;
    view = 'travellers';
    draft = undefined;
    justSaved = true;
    history.replaceState(null, '', '#travellers');
    render();
  },
});

document.querySelectorAll<HTMLAnchorElement>('nav a').forEach((a) =>
  a.addEventListener('click', (e) => {
    e.preventDefault();
    const next = a.dataset.view as View;
    if (next === 'scan' && view === 'scan') return; // already here: keep the screenshots
    go(next);
  }),
);

render();
