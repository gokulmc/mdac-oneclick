// The "Scan a confirmation email" view: screenshots in, review forms out. OCR itself lives in ocr.ts and the
// reading rules in domain/scan.ts; this file is the screen. Screenshots stay in memory (object URLs + bitmaps)
// and are released when the view is left.
import { checkPreset, checkTraveller } from '../domain/checks';
import { toFormDate } from '../domain/dates';
import { cityLabel, labelOf, reference } from '../domain/reference';
import { parseConfirmation, type Box, type ScanField, type ScanResult } from '../domain/scan';
import type { SavedData, Traveller, TripPreset } from '../domain/types';
import { h, replace } from '../shared/dom';
import { createForm, type FormHandle } from './forms';
import { MAX_FILES, MAX_PIXELS, createScanController, onOcrStage } from './ocr';
import {
  blankPreset, blankTraveller, normalisePreset, normaliseTraveller, presetSections, travellerSections, wireStateCity,
} from './records';

export interface ScanDeps {
  /** The list column (screenshots live there) and the grid that hides it when empty. */
  list: HTMLElement;
  wrap: HTMLElement;
  getData(): SavedData;
  today(): string;
  /** Writes through the same path the editors use; resolves once storage has the data. */
  save(traveller: Traveller, preset: TripPreset): Promise<void>;
  /** Called after a successful save so the page can switch to the Travellers view. */
  onDone(travellerId: string): void;
}

type ChipStatus = 'ok' | 'unsure' | 'missing' | 'saved' | 'edited';
type Phase = 'idle' | 'scanning' | 'review' | 'failed' | 'cancelled';

const CHIP_TEXT: Record<ChipStatus, string> = { ok: 'Read', unsure: 'Unsure', missing: 'Missing', saved: 'From saved', edited: 'Edited' };
const MISSING_NOTE = 'Not found in the email. Fill it in.';
const PARSER_MISSING_NOTE = 'Could not read this field';
const PLACE_OF_BIRTH_NOTE = 'Not in the email; defaulted to nationality';
const SAVED_DELAY_MS = 700;

interface Shot {
  id: number;
  file: File;
  url: string;
  bitmap?: ImageBitmap;
  error?: string;
}

interface ChipInit {
  status: ChipStatus;
  note?: string;
  /** The OCR field whose crop to show under the control. */
  field?: ScanField;
}

interface Draft {
  values: Record<string, string>;
  chips: Record<string, ChipInit>;
}

const titleCase = (text: string) => text.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
const passportKey = (value: string) => value.trim().toUpperCase();
const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

// ---------- ScanResult -> form values ----------

function fieldNote(field: ScanField): string | undefined {
  const parts = [field.note, field.alternatives?.length ? `Also read as: ${field.alternatives.join(', ')}` : undefined].filter(Boolean);
  return parts.length ? parts.join('. ') : undefined;
}

const missingNote = (field: ScanField) => (field.note && field.note !== PARSER_MISSING_NOTE ? field.note : MISSING_NOTE);

/** Traveller form values and chips. With a saved traveller, only values OCR really read replace saved ones. */
function travellerDraft(result: ScanResult, saved: Traveller | undefined): Draft {
  const values: Record<string, string> = {};
  const chips: Record<string, ChipInit> = {};
  const t = result.traveller as Record<string, string | undefined>;
  const f = result.fields;
  const place = (chip: string, names: (keyof Traveller & string)[], src: ScanField, inferred?: string) => {
    const read = src.status !== 'missing' && !inferred;
    if (read) {
      for (const n of names) values[n] = t[n] ?? '';
      chips[chip] = { status: src.status, note: fieldNote(src), field: src };
    } else if (saved) {
      for (const n of names) values[n] = saved[n] as string;
      const why = inferred ? 'Not in the email' : 'Not read from the email';
      chips[chip] = { status: 'saved', note: `${why}; kept from the saved traveller`, field: undefined };
    } else {
      for (const n of names) values[n] = t[n] ?? '';
      chips[chip] = inferred && t[names[0]!]
        ? { status: 'unsure', note: inferred, field: src }
        : { status: 'missing', note: missingNote(src) };
    }
  };
  place('fullName', ['fullName'], f.fullName);
  place('passportNo', ['passportNo'], f.passportNo);
  place('sex', ['sex'], f.sex);
  place('nationality', ['nationality'], f.nationality);
  place('placeOfBirth', ['placeOfBirth'], f.nationality, PLACE_OF_BIRTH_NOTE);
  place('dateOfBirth', ['dateOfBirth'], f.dateOfBirth);
  place('passportExpiry', ['passportExpiry'], f.passportExpiry);
  place('email', ['email'], f.email);
  place('mobile', ['dialCode', 'mobile'], f.mobile);
  return { values, chips };
}

function presetDraft(result: ScanResult): Draft {
  const values: Record<string, string> = {};
  const chips: Record<string, ChipInit> = {};
  const p = result.preset as Record<string, string | undefined>;
  const f = result.fields;
  const place = (chip: string, name: string, src: ScanField) => {
    values[name] = src.status === 'missing' ? '' : (p[name] ?? '');
    if (name === 'address2' && !values[name]) return; // optional line: nothing to flag
    chips[chip] = src.status === 'missing'
      ? { status: 'missing', note: missingNote(src) }
      : { status: src.status, note: fieldNote(src), field: src };
  };
  place('travelMode', 'travelMode', f.travelMode);
  place('transportNo', 'transportNo', f.transportNo);
  place('embarkPort', 'embarkPort', f.embarkPort);
  place('stayType', 'stayType', f.stayType);
  place('address1', 'address1', f.address);
  place('address2', 'address2', f.address);
  place('state', 'state', f.state);
  place('city', 'city', f.city);
  place('postcode', 'postcode', f.postcode);
  const place_ = cityLabel(values.state ?? '', values.city ?? '') ?? labelOf(reference.states, values.state ?? '');
  const mode = labelOf(reference.travelModes, values.travelMode ?? '');
  values.name = [place_, mode].filter(Boolean).map((s) => titleCase(s!)).join(' · ') || 'Scanned trip';
  return { values, chips };
}

// ---------- chips, notes and crops on the form fields ----------

function cropOf(box: Box, shots: Shot[], total: number): HTMLElement | undefined {
  const bitmap = shots[box.page]?.bitmap;
  if (!bitmap) return undefined;
  const pad = 6;
  const sx = Math.max(0, box.x0 - pad);
  const sy = Math.max(0, box.y0 - pad);
  const sw = Math.min(bitmap.width, box.x1 + pad) - sx;
  const sh = Math.min(bitmap.height, box.y1 + pad) - sy;
  if (sw <= 0 || sh <= 0) return undefined;
  // Shown at about the size the text had on the phone (a 1080px-wide screenshot is ~2.6x its CSS pixels),
  // never wider than 320px or taller than 96px.
  const shown = Math.min(1, 540 / bitmap.width, 320 / sw, 96 / sh);
  const cssW = Math.max(1, Math.round(sw * shown));
  const cssH = Math.max(1, Math.round(sh * shown));
  const ratio = Math.min(window.devicePixelRatio || 1, sw / cssW);
  const canvas = h('canvas', { class: 'scan-crop', role: 'img', 'aria-label': 'The part of the screenshot this was read from' });
  canvas.width = Math.round(cssW * ratio);
  canvas.height = Math.round(cssH * ratio);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.getContext('2d')?.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return h('div', { class: 'scan-crop-wrap' }, canvas, h('small', {}, total > 1 ? `From screenshot ${box.page + 1}` : 'From screenshot'));
}

interface ChipUi {
  chip: HTMLElement;
  wrap: HTMLElement;
  note: HTMLElement;
}

/** Owns the chips of one form: attaches them as fields are built, and flips them as the user edits. */
function chipSet(inits: Record<string, ChipInit>, shots: Shot[]) {
  const ui = new Map<string, ChipUi>();
  const keyOf = (name: string) => (name === 'dialCode' ? 'mobile' : name);

  function paint(key: string, status: ChipStatus) {
    const u = ui.get(key);
    if (!u) return;
    u.chip.className = `scan-chip ${status}`;
    u.chip.dataset.status = status;
    u.chip.textContent = CHIP_TEXT[status];
    u.wrap.classList.toggle('scan-unsure', status === 'unsure');
    u.wrap.classList.toggle('scan-missing', status === 'missing');
  }

  function attach(key: string, wrap: HTMLElement) {
    const init = inits[key];
    if (!init) return;
    const chip = h('span', { 'data-testid': 'scan-chip', 'data-field': key });
    const note = h('span', { class: 'note scan-note', 'data-testid': 'scan-note' }, init.status === 'ok' ? '' : init.note ?? '');
    const extra = h('div', { class: 'scan-extra' }, note);
    if ((init.status === 'unsure' || init.status === 'missing') && init.field?.box) {
      const crop = cropOf(init.field.box, shots, shots.filter((s) => s.bitmap).length);
      if (crop) extra.append(crop);
    }
    // The row of dial code + mobile has its label on the wrap itself, so one chip serves both controls.
    const label = wrap.querySelector(':scope > label');
    if (label) {
      const row = h('div', { class: 'scan-lr' });
      label.replaceWith(row);
      row.append(label, chip);
    }
    wrap.append(extra);
    ui.set(key, { chip, wrap, note });
    paint(key, init.status);
  }

  return {
    ui,
    /** `decorate` hook for createForm. The phone row is attached afterwards by attachPhone(). */
    decorate(name: string, wrap: HTMLElement) {
      if (name === 'dialCode' || name === 'mobile') return;
      attach(name, wrap);
    },
    /** One chip for the dial code + mobile pair, on the row's label. */
    attachPhone(handle: FormHandle<unknown>) {
      const row = handle.controls.dialCode?.closest('.phone')?.parentElement;
      if (!(row instanceof HTMLElement) || !inits.mobile) return;
      attach('mobile', row);
    },
    set(name: string, status: ChipStatus, note?: string) {
      const key = keyOf(name);
      const u = ui.get(key);
      if (!u) return;
      paint(key, status);
      if (status === 'edited') u.note.textContent = '';
      else if (note !== undefined) u.note.textContent = note;
    },
    edited(name: string) {
      this.set(name, 'edited');
    },
  };
}

// ---------- the view ----------

/** What the review screen exposes to the rest of the view; `save` is absent when the scan was refused. */
interface Review {
  el: HTMLElement;
  accepted: boolean;
}

/** Everything Save needs, read at click time so later edits and a changed update target are honoured. */
interface Draftable {
  base: Traveller;
  presetBase: TripPreset;
  target: Traveller | undefined;
  tForm: FormHandle<Traveller>;
  pForm: FormHandle<TripPreset>;
}

export function renderScanView(root: HTMLElement, deps: ScanDeps): () => void {
  const controller = createScanController();
  let shots: Shot[] = [];
  let nextId = 1;
  let phase: Phase = 'idle';
  let progress = { index: 0, total: 0, started: false, p: 0, stage: '' as string, check: undefined as { done: number; total: number } | undefined };
  let progressRefs: { text: HTMLElement; bar: HTMLProgressElement } | undefined;
  let review: Review | undefined;
  let failure = '';
  let notice = '';
  let runId = 0;
  let unmounted = false;
  let saving = false;
  let doneTimer: number | undefined;

  const fileInput = h('input', { type: 'file', id: 'scan-file', accept: 'image/*', multiple: true, hidden: true });
  const content = h('div', { class: 'scan-content' });
  root.replaceChildren(fileInput, content);

  fileInput.addEventListener('change', () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    void addFiles(files);
  });

  // ----- adding and removing screenshots -----

  async function addFiles(incoming: File[]) {
    if (unmounted || saving || !incoming.length) return;
    const images = incoming.filter((f) => f.type.startsWith('image/'));
    const room = MAX_FILES - shots.length;
    const take = images.slice(0, Math.max(0, room));
    const notes: string[] = [];
    if (images.length < incoming.length) notes.push('Only image files can be scanned.');
    if (images.length > take.length) notes.push(room <= 0 ? `You can add up to ${MAX_FILES} screenshots. Remove one to add another.` : `You can add up to ${MAX_FILES} screenshots; the extra ones were skipped.`);
    notice = notes.join(' ');
    if (!take.length) return render();

    const added: Shot[] = take.map((file) => ({ id: nextId++, file, url: URL.createObjectURL(file) }));
    shots = [...shots, ...added];
    render();
    await Promise.all(
      added.map(async (s) => {
        try {
          const bitmap = await createImageBitmap(s.file);
          if (unmounted || !shots.includes(s)) return bitmap.close();
          if (bitmap.width * bitmap.height > MAX_PIXELS) {
            bitmap.close();
            s.error = 'Too large (over 25 megapixels)';
          } else s.bitmap = bitmap;
        } catch {
          s.error = "Couldn't open this image";
        }
      }),
    );
    if (unmounted) return;
    if (added.some((s) => s.bitmap)) void runScan();
    else render();
  }

  function release(s: Shot) {
    s.bitmap?.close();
    s.bitmap = undefined;
  }

  function removeShot(id: number) {
    const s = shots.find((x) => x.id === id);
    if (!s || saving) return;
    URL.revokeObjectURL(s.url);
    release(s);
    shots = shots.filter((x) => x !== s);
    notice = '';
    if (!shots.length) reset();
    else void runScan();
  }

  /** Back to the empty drop zone, everything released. */
  function reset() {
    runId++;
    controller.cancel();
    for (const s of shots) {
      URL.revokeObjectURL(s.url);
      release(s);
    }
    shots = [];
    review = undefined;
    notice = '';
    phase = 'idle';
    render();
  }

  // ----- scanning -----

  async function runScan() {
    const valid = shots.filter((s) => s.bitmap);
    const id = ++runId;
    review = undefined;
    failure = '';
    if (!valid.length) {
      controller.cancel();
      phase = 'idle';
      return render();
    }
    phase = 'scanning';
    progress = { index: 0, total: valid.length, started: false, p: 0, stage: '', check: undefined };
    onOcrStage((stage) => {
      if (id !== runId) return;
      progress = { ...progress, stage };
      updateProgress();
    });
    render();
    try {
      const pages = await controller.scan(
        valid.map((s) => s.file),
        (index, p) => {
          if (id !== runId) return;
          progress = { ...progress, index, started: true, p };
          updateProgress();
        },
        (done, total) => {
          if (id !== runId) return;
          progress = { ...progress, check: { done, total } };
          updateProgress();
        },
      );
      if (id !== runId || unmounted) return;
      review = buildReview(parseConfirmation(pages), valid);
      phase = 'review';
    } catch (e) {
      if (id !== runId || unmounted) return;
      phase = isAbort(e) ? 'cancelled' : 'failed';
      failure = e instanceof Error ? e.message : '';
    }
    render();
  }

  function cancelOcr() {
    runId++;
    controller.cancel();
    phase = 'cancelled';
    render();
  }

  function updateProgress() {
    if (!progressRefs) return;
    const { text, bar } = progressRefs;
    if (progress.check) {
      const { done, total } = progress.check;
      text.textContent = `Checking ${total} unclear value${total === 1 ? '' : 's'}…`;
      bar.value = Math.round((done / Math.max(1, total)) * 100);
      return;
    }
    if (!progress.started) {
      text.textContent = progress.stage ? `Loading OCR model… (${progress.stage})` : 'Loading OCR model…';
      bar.removeAttribute('value');
      return;
    }
    const pct = Math.round(progress.p * 100);
    text.textContent = `Reading screenshot ${progress.index + 1} of ${progress.total} — ${pct}%`;
    bar.value = pct;
  }

  // ----- review -----

  function buildReview(result: ScanResult, valid: Shot[]): Review {
    const title = (text: string) => h('h3', { class: 'scan-h' }, text);
    const bar = h('div', { class: 'bar' });
    const cancelBtn = h('button', { id: 'scan-cancel', type: 'button', class: 'ghost' }, result.accepted ? 'Cancel' : 'Start over');
    cancelBtn.addEventListener('click', reset);

    if (!result.accepted) {
      replace(bar, cancelBtn);
      const el = h('div', { class: 'scan-review' }, h('div', { id: 'scan-reason', class: 'callout danger', role: 'alert' }, result.reason ?? "This doesn't look like an MDAC confirmation email."), bar);
      return { el, accepted: false };
    }

    // Update target: saved travellers with the same passport number.
    const passport = result.traveller.passportNo ?? '';
    const matches = passport ? deps.getData().travellers.filter((t) => passportKey(t.passportNo) === passportKey(passport)) : [];
    const target: Traveller | undefined = matches[0];
    const presetBase = blankPreset();

    const saveBtn = h('button', { id: 'scan-save', type: 'button', class: 'save' }, 'Save traveller and preset');
    const status = h('span', { id: 'scan-status', class: 'note scan-status', role: 'status' }, 'Nothing saved yet');
    replace(bar, saveBtn, cancelBtn, status);

    const tHost = h('div', { class: 'scan-form-host' });
    const el = h('div', { class: 'scan-review' });
    // tForm and pForm are filled in below, before anything can read them.
    const r = { base: target ?? blankTraveller(), presetBase, target } as Draftable;

    // Callout naming the traveller that will be updated (and a picker when several share the passport number).
    const targetText = h('span', { class: 'scan-target-text' });
    const describe = () => {
      if (!r.target) return;
      const changed = passportKey(r.tForm.controls.passportNo?.value ?? '') !== passportKey(r.target.passportNo);
      targetText.textContent = `Updating ${r.target.fullName || 'Unnamed traveller'} (${changed ? 'passport number changed' : 'same passport number'})`;
    };
    let targetCallout: HTMLElement | undefined;
    if (target) {
      targetCallout = h('div', { id: 'scan-update-target', class: 'callout', role: 'status' }, targetText);
      if (matches.length > 1) {
        const which = h('select', { id: 'scan-which', 'aria-label': 'Which saved traveller to update' },
          ...matches.map((t, i) => h('option', { value: String(i) }, `${t.fullName || 'Unnamed traveller'} · ${labelOf(reference.nationalities, t.nationality) ?? t.nationality}`)));
        which.addEventListener('change', () => {
          r.target = matches[Number(which.value)];
          r.base = r.target ?? blankTraveller();
          buildTravellerForm();
        });
        targetCallout.append(which);
      }
    }

    function buildTravellerForm() {
      const draft = travellerDraft(result, r.target);
      const chips = chipSet(draft.chips, valid);
      const form = createForm<Traveller>({
        id: 'scan-traveller-form',
        sections: travellerSections(),
        values: draft.values,
        check: (v) => checkTraveller({ ...r.base, ...v }, deps.today()),
        showAll: true,
        preventSubmit: true,
        decorate: (name, wrap) => chips.decorate(name, wrap),
        onEdit: (name) => {
          chips.edited(name);
          if (name === 'passportNo') describe();
          updateSave();
        },
      });
      chips.attachPhone(form as FormHandle<unknown>);
      r.tForm = form;
      replace(tHost, form.form);
      form.refresh();
      describe();
      updateSave();
    }

    // Trip preset form.
    const pDraft = presetDraft(result);
    const pChips = chipSet(pDraft.chips, valid);
    const pForm = createForm<TripPreset>({
      id: 'scan-preset-form',
      sections: presetSections(),
      values: pDraft.values,
      check: (v) => checkPreset({ ...presetBase, ...v }),
      showAll: true,
      preventSubmit: true,
      decorate: (name, wrap) => pChips.decorate(name, wrap),
      onEdit: (name) => {
        pChips.edited(name);
        if (name === 'state') pChips.set('city', 'missing', '');
      },
    });
    wireStateCity(pForm, pDraft.values.state ?? '', pDraft.values.city ?? '');
    const nameInput = pForm.controls.name;
    if (nameInput) {
      nameInput.id = 'scan-preset-name';
      pForm.form.querySelector('label[for=f-name]')?.setAttribute('for', 'scan-preset-name');
    }
    r.pForm = pForm;

    // Facts from that trip, shown but never saved.
    const tripParts = [
      result.dates.arrival && `Arrival ${toFormDate(result.dates.arrival)}`,
      result.dates.departure && `Departure ${toFormDate(result.dates.departure)}`,
      result.pin && `PIN ${result.pin.slice(0, 4)}…`,
    ].filter(Boolean);
    const trip = tripParts.length
      ? h('div', { id: 'scan-trip', class: 'scan-trip' }, h('b', {}, 'From that trip (not saved):'), ` ${tripParts.join(' · ')}`)
      : undefined;

    function updateSave() {
      saveBtn.disabled = saving || !(r.tForm?.controls.passportNo?.value ?? '').trim();
    }

    saveBtn.addEventListener('click', () => void save(r, status, updateSave));

    buildTravellerForm();
    replace(
      el,
      ...result.warnings.map((w) => h('div', { class: 'callout', 'data-testid': 'scan-warning', role: 'status' }, w)),
      targetCallout,
      title('Traveller'),
      tHost,
      title('Trip preset'),
      pForm.form,
      trip,
      bar,
    );
    return { el, accepted: true };
  }

  async function save(r: Draftable, status: HTMLElement, updateSave: () => void) {
    if (saving || unmounted) return;
    saving = true;
    updateSave();
    status.classList.remove('error');
    status.textContent = 'Saving…';
    const traveller = normaliseTraveller(r.base, r.tForm.read());
    const preset = normalisePreset(r.presetBase, r.pForm.read());
    try {
      await deps.save(traveller, preset);
    } catch (e) {
      saving = false;
      status.classList.add('error');
      status.textContent = `Couldn't save: ${e instanceof Error ? e.message : 'storage error'}`;
      updateSave();
      return;
    }
    status.textContent = r.target ? `Updated ${r.target.fullName || 'traveller'}` : 'Saved';
    // The scan is over: free the OCR worker and the decoded bitmaps now, the page switches a moment later.
    controller.dispose();
    shots.forEach(release);
    doneTimer = window.setTimeout(() => {
      if (!unmounted) deps.onDone(traveller.id);
    }, SAVED_DELAY_MS);
  }

  // ----- drag and drop, paste -----

  function acceptDrops(el: HTMLElement) {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    el.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      el.classList.add('over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('over');
      void addFiles([...(e.dataTransfer?.files ?? [])]);
    });
  }

  // A file dropped anywhere else in the view is still added instead of navigating the tab to it.
  const onDocDrag = (e: DragEvent) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  };
  const onDocDrop = (e: DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    void addFiles([...e.dataTransfer.files]);
  };
  const onPaste = (e: ClipboardEvent) => {
    const files = [...(e.clipboardData?.items ?? [])]
      .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f);
    if (!files.length) return;
    e.preventDefault();
    void addFiles(files);
  };
  document.addEventListener('paste', onPaste);
  document.addEventListener('dragover', onDocDrag);
  document.addEventListener('drop', onDocDrop);

  // ----- rendering -----

  const pick = () => fileInput.click();

  function noticeEl() {
    return h('p', { id: 'scan-notice', class: 'note scan-notice', role: 'status' }, notice);
  }

  function thumb(s: Shot, i: number) {
    const n = i + 1;
    const frame = s.error
      ? h('div', { class: 'scan-phone err' }, h('span', { class: 'scan-err', role: 'alert' }, s.error))
      : h('div', { class: 'scan-phone' }, h('img', { src: s.url, alt: `Screenshot ${n}` }));
    const remove = h('button', { type: 'button', class: 'scan-x', 'aria-label': `Remove screenshot ${n}`, 'data-testid': 'scan-remove' }, '×');
    remove.addEventListener('click', () => removeShot(s.id));
    return h('div', { class: 'scan-shot', 'data-testid': 'scan-thumb' }, h('div', { class: 'scan-shotbox' }, frame, remove), h('span', { class: 'scan-cap' }, `Screenshot ${n}`));
  }

  function renderList() {
    if (!shots.length) return replace(deps.list);
    const addBox = h('button', { id: 'scan-add-more', type: 'button', class: 'add scan-addbox' }, '+ Add screenshot');
    addBox.addEventListener('click', pick);
    acceptDrops(addBox);
    replace(
      deps.list,
      h('h3', { class: 'scan-h' }, 'Screenshots'),
      h('div', { class: 'scan-shots' }, ...shots.map(thumb)),
      addBox,
      h('p', { class: 'scan-privacy' }, 'Read on this device by a built-in OCR engine — no AI service, nothing uploaded. Kept in memory only until you save.'),
      noticeEl(),
    );
  }

  function dropZone() {
    const add = h('button', { id: 'scan-add', type: 'button', class: 'add scan-add' }, 'Add screenshots');
    add.addEventListener('click', pick);
    const drop = h(
      'div',
      { id: 'scan-drop', class: 'scan-drop' },
      h('div', { class: 'scan-ic', 'aria-hidden': 'true' }, '+'),
      h('b', {}, 'Drop 1–2 screenshots of your MDAC confirmation email here, or paste'),
      h('span', { class: 'scan-sub' }, 'Read on this device by the OCR engine built into the extension (Tesseract) — not an AI service. Nothing is uploaded; screenshots stay in memory only until you save, and you review every field first.'),
      add,
    );
    acceptDrops(drop);
    const steps = ['Open the email the Immigration Department sent after a past filing', "Screenshot it — two screenshots if it doesn't fit", 'Drop them here and review'];
    return [
      drop,
      h('h3', { class: 'scan-h scan-h-gap' }, 'How it works'),
      h('ol', { class: 'scan-steps' }, ...steps.map((text, i) => h('li', {}, h('span', { class: 'n' }, String(i + 1)), text))),
    ];
  }

  function renderEditor() {
    progressRefs = undefined;
    const reviewing = phase === 'review';
    const head = [
      h('h2', {}, reviewing ? (review?.accepted ? 'Review what was read' : 'Scan a confirmation email') : 'Scan a confirmation email'),
      h(
        'p',
        { class: 'hint' },
        reviewing && review?.accepted
          ? 'Fix anything yellow or red, then save. Dates and PIN are from that trip and are not saved.'
          : 'Turn a past MDAC confirmation into a saved traveller and trip preset.',
      ),
    ];
    let body: (Node | undefined)[] = [];
    if (phase === 'scanning') {
      const text = h('span', { id: 'scan-progress', class: 'scan-progress-text' });
      const bar = h('progress', { max: 100 });
      const cancel = h('button', { id: 'scan-cancel-ocr', type: 'button', class: 'ghost' }, 'Cancel');
      cancel.addEventListener('click', cancelOcr);
      progressRefs = { text, bar };
      body = [h('div', { class: 'scan-progress', role: 'status' }, text, bar, cancel)];
      updateProgress();
    } else if (phase === 'failed' || phase === 'cancelled') {
      const retry = h('button', { id: 'scan-retry', type: 'button', class: 'save' }, phase === 'failed' ? 'Try again' : 'Scan again');
      retry.addEventListener('click', () => void runScan());
      body = [
        h(
          'div',
          { class: phase === 'failed' ? 'callout danger' : 'callout', id: 'scan-problem', role: phase === 'failed' ? 'alert' : 'status' },
          phase === 'failed' ? "Couldn't read this image" : 'Scan cancelled',
          phase === 'failed' && failure ? h('small', { class: 'scan-detail' }, failure) : undefined,
        ),
        h('div', { class: 'bar' }, retry),
      ];
    } else if (phase === 'review' && review) {
      body = [review.el];
    } else {
      body = [...dropZone(), shots.length ? undefined : noticeEl()];
    }
    replace(content, ...head, ...body);
  }

  function render() {
    if (unmounted) return;
    deps.wrap.classList.toggle('no-list', shots.length === 0);
    renderList();
    renderEditor();
  }

  render();

  return function unmount() {
    unmounted = true;
    window.clearTimeout(doneTimer);
    document.removeEventListener('paste', onPaste);
    document.removeEventListener('dragover', onDocDrag);
    document.removeEventListener('drop', onDocDrop);
    controller.dispose();
    for (const s of shots) {
      URL.revokeObjectURL(s.url);
      release(s);
    }
    shots = [];
    review = undefined;
  };
}
