import { checkRun } from '../domain/checks';
import { localIsoDate } from '../domain/dates';
import { labelOf, reference } from '../domain/reference';
import type { Traveller, TripPreset, SavedData } from '../domain/types';
import { h, replace } from '../shared/dom';
import { loadData, saveData, type Message, type StartRunResult } from '../shared/storage';

const TRANSPORT_LABEL: Record<TripPreset['travelMode'], string> = {
  '1': 'Flight no.',
  '2': 'Vehicle / bus no.',
  '3': 'Vessel no.',
};

const TRAVELLER_FIELDS = new Set([
  'fullName', 'passportNo', 'dateOfBirth', 'nationality', 'placeOfBirth',
  'sex', 'passportExpiry', 'email', 'dialCode', 'mobile',
]);

interface WarningLine {
  lead?: string;
  message: string;
}

function travellerName(t: Traveller): string {
  return t.fullName.trim() || 'Unnamed traveller';
}

function travellerOption(t: Traveller, checked: boolean): HTMLLabelElement {
  const nationality = labelOf(reference.nationalities, t.nationality) ?? t.nationality;
  const detail = [nationality, t.passportNo].filter(Boolean).join(' · ');
  return h(
    'label',
    { class: 'trav' },
    h('input', { type: 'checkbox', 'data-testid': 'traveller-option', value: t.id, checked }),
    h('span', {}, h('b', {}, travellerName(t)), h('small', {}, detail)),
  );
}

function dateField(id: string, label: string, value: string): HTMLElement {
  return h('div', { class: 'field' }, h('label', { for: id }, label), h('input', { type: 'date', id, value }));
}

/** The seeded-preset warning leads with its first sentence in bold, like the design card. */
function toLine(field: string, message: string): WarningLine {
  if (field !== 'seeded') return { message };
  const end = message.indexOf('. ');
  return end === -1 ? { message } : { lead: message.slice(0, end + 1), message: message.slice(end + 2) };
}

async function currentTabId(): Promise<number | undefined> {
  const fromUrl = new URLSearchParams(location.search).get('tab');
  if (fromUrl !== null && fromUrl !== '' && Number.isFinite(Number(fromUrl))) return Number(fromUrl);
  return (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
}

export function renderReady(root: HTMLElement, data: SavedData, onStarted: () => void): void {
  const today = localIsoDate(new Date());
  const lastIds = data.lastUsed?.travellerIds.filter((id) => data.travellers.some((t) => t.id === id)) ?? [];
  const selectedIds = new Set(lastIds.length ? lastIds : [data.travellers[0]!.id]);
  const presetId = data.presets.some((p) => p.id === data.lastUsed?.presetId) ? data.lastUsed!.presetId : data.presets[0]?.id;

  const boxes = data.travellers.map((t) => travellerOption(t, selectedIds.has(t.id)));
  const presetSelect = h('select', { id: 'preset' }, ...data.presets.map((p) => h('option', { value: p.id }, p.name)));
  if (presetId) presetSelect.value = presetId;
  const arrival = dateField('arrival', 'Arrival', today);
  const departure = dateField('departure', 'Departure', today);
  const arrivalInput = arrival.querySelector('input')!;
  const departureInput = departure.querySelector('input')!;
  const transportLabel = h('label', { for: 'transportNo', id: 'transport-label' }, TRANSPORT_LABEL['2']);
  const transportInput = h('input', { id: 'transportNo', type: 'text', autocomplete: 'off' });
  // Warnings never block Fill, but they must be seen first: they live in the footer next to Fill, collapsed to
  // a count plus the first warning, and expand in place (the footer is sticky, so it grows upwards).
  const warningLabel = h('b', {});
  const warningToggle = h(
    'button',
    { class: 'warn-toggle', id: 'warn-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'warnings' },
    h('span', { 'aria-hidden': 'true' }, '⚠'),
    warningLabel,
    h('span', { class: 'chev', 'aria-hidden': 'true' }),
  );
  const warnings = h('div', { class: 'warn-list', id: 'warnings', role: 'status' });
  const warnBox = h('div', { class: 'warn', id: 'warn-box', 'data-open': 'false', hidden: true }, warningToggle, warnings);
  const error = h('div', { class: 'error', id: 'fill-error', role: 'alert', hidden: true });
  const fill = h('button', { class: 'primary fill', id: 'fill', type: 'button' }, 'Fill MDAC');

  const preset = () => data.presets.find((p) => p.id === presetSelect.value);
  const selected = () => data.travellers.filter((_, i) => boxes[i]!.querySelector('input')!.checked);
  const dates = () => ({ arrival: arrivalInput.value, departure: departureInput.value });

  function syncPreset() {
    const p = preset();
    transportLabel.textContent = TRANSPORT_LABEL[p?.travelMode ?? '2'];
    transportInput.value = p?.transportNo ?? '';
  }

  function warningLines(): WarningLine[] {
    const p = preset();
    const shared = new Map<string, WarningLine>();
    const personal: WarningLine[] = [];
    if (!p) shared.set('no-preset', { message: 'Add a trip preset in settings first.' });
    else {
      for (const t of selected()) {
        const seen = new Set<string>();
        for (const w of checkRun(t, p, dates(), transportInput.value, today)) {
          if (TRAVELLER_FIELDS.has(w.field)) {
            if (!seen.has(w.message)) personal.push({ lead: travellerName(t), message: w.message });
            seen.add(w.message);
          } else shared.set(w.message, toLine(w.field, w.message));
        }
      }
    }
    return [...shared.values(), ...personal];
  }

  function setWarningsOpen(open: boolean) {
    warnBox.dataset.open = String(open);
    warningToggle.setAttribute('aria-expanded', String(open));
  }

  function refresh() {
    const count = selected().length;
    fill.disabled = count === 0 || !preset();
    fill.textContent = count > 1 ? `Fill MDAC for ${count} travellers` : 'Fill MDAC';
    const lines = warningLines();
    warnBox.hidden = lines.length === 0;
    warningLabel.textContent = `${lines.length} ${lines.length === 1 ? 'thing' : 'things'} to check`;
    if (lines.length === 0) setWarningsOpen(false);
    replace(
      warnings,
      ...lines.map((l) =>
        h('span', { 'data-testid': 'warning' }, l.lead && h('b', {}, l.lead), l.lead && ' ', l.message),
      ),
    );
  }

  function showError(message: string) {
    error.textContent = message;
    error.hidden = !message;
  }

  async function start() {
    const p = preset();
    if (!p) return;
    const travellerIds = selected().map((t) => t.id);
    fill.disabled = true;
    showError('');
    try {
      await saveData({ ...(await loadData()), lastUsed: { travellerIds, presetId: p.id } });
      const message: Message = {
        type: 'start-run',
        request: { travellerIds, presetId: p.id, dates: dates(), transportNo: transportInput.value.trim() },
        tabId: await currentTabId(),
      };
      const result = (await chrome.runtime.sendMessage(message)) as StartRunResult | undefined;
      if (result?.ok) return onStarted();
      showError(result?.error ?? 'The extension did not answer. Try again.');
    } catch (e) {
      showError((e as Error).message);
    }
    refresh();
  }

  boxes.forEach((b) => b.addEventListener('change', refresh));
  presetSelect.addEventListener('change', () => {
    syncPreset();
    refresh();
  });
  arrivalInput.addEventListener('change', () => {
    // Departure follows arrival until the traveller picks a later day.
    if (!departureInput.value || departureInput.value < arrivalInput.value) departureInput.value = arrivalInput.value;
    refresh();
  });
  departureInput.addEventListener('change', refresh);
  transportInput.addEventListener('input', refresh);
  fill.addEventListener('click', () => void start());
  warningToggle.addEventListener('click', () => setWarningsOpen(warnBox.dataset.open !== 'true'));
  // Mouse users can also tap the collapsed first-warning line itself.
  warnings.addEventListener('click', () => setWarningsOpen(warnBox.dataset.open !== 'true'));

  replace(
    root,
    h('section', {}, h('div', { class: 'label' }, "Who's travelling"), h('div', { class: 'travellers' }, ...boxes)),
    h('section', { class: 'field' }, h('div', { class: 'label' }, 'Trip preset'), presetSelect),
    h('section', { class: 'row' }, arrival, departure),
    h('section', { class: 'field' }, transportLabel, transportInput),
    h(
      'footer',
      { class: 'ready-foot' },
      warnBox,
      error,
      fill,
      h('div', { class: 'foot' }, "You'll complete the slider and press Submit yourself."),
    ),
  );
  syncPreset();
  refresh();
}
