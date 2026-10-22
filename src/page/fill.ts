// Injected into the MDAC register page's MAIN world so it can see the page's jQuery
// (AJAX in flight, bootstrap-datepicker). Writes a FillStep plan, verifies it, then
// hands off at the verification slider. It never touches the slider or Submit (ADR 0001).
import type { FillStep } from '../domain/plan';

export interface FillReport {
  ok: boolean;
  /** Fields whose final value differs from the plan (e.g. a date the datepicker rejected). */
  mismatches: { id: string; expected: string; actual: string }[];
  /** Select values the form did not offer. */
  missingOptions: string[];
  /** Accommodation fields skipped because the form hides that section for this nationality. */
  skipped: string[];
}

interface PageJQuery {
  (el: Element): { datepicker?: (method: string, value?: string) => unknown };
  active: number;
}

declare global {
  interface Window {
    jQuery?: PageJQuery;
    __mdacOneClick?: { fill(plan: FillStep[]): Promise<FillReport> };
  }
}

const HANDOFF_ID = 'mdac-oneclick-handoff';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function lookupsSettled(timeoutMs = 10_000): Promise<void> {
  await sleep(150);
  const end = Date.now() + timeoutMs;
  while (window.jQuery && window.jQuery.active > 0 && Date.now() < end) await sleep(100);
}

async function optionAppears(select: HTMLSelectElement, value: string, timeoutMs = 10_000): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if ([...select.options].some((o) => o.value === value)) return true;
    if (Date.now() >= end) return false;
    await sleep(100);
  }
}

function fire(el: Element, type: 'input' | 'change') {
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

function setDate(el: HTMLInputElement, value: string) {
  el.value = value;
  const picker = window.jQuery?.(el).datepicker;
  if (picker) {
    try {
      // 'update' re-parses the value against the picker's start/end limits without firing changeDate.
      window.jQuery!(el).datepicker!('update', value);
    } catch {
      // Picker missing or older API: the raw value is what the form submits anyway.
    }
  }
}

function accommodationHidden(): boolean {
  const section = document.getElementById('formAccommodation');
  return !!section && section.style.display === 'none';
}

function handOff() {
  document.getElementById(HANDOFF_ID)?.remove();
  const slider = document.querySelector<HTMLElement>('.slidercaptcha') ?? document.getElementById('captcha');
  const anchor = slider ?? document.getElementById('submit');
  if (!anchor) return;
  const note = document.createElement('div');
  note.id = HANDOFF_ID;
  note.setAttribute('role', 'status');
  note.textContent = 'Filled by MDAC One-Click. Check the details above, complete the slider, then press Submit.';
  Object.assign(note.style, {
    margin: '12px 0',
    padding: '10px 14px',
    borderRadius: '8px',
    background: '#FFF6D6',
    border: '1px solid #E0B400',
    color: '#3D3000',
    font: '600 14px/1.4 system-ui, sans-serif',
  });
  anchor.parentElement?.insertBefore(note, anchor);
  if (slider) slider.style.outline = '3px solid #E0B400';
  note.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

export async function fill(plan: FillStep[]): Promise<FillReport> {
  const report: FillReport = { ok: true, mismatches: [], missingOptions: [], skipped: [] };
  const applied: Exclude<FillStep, { kind: 'settle' }>[] = [];

  for (const step of plan) {
    if (step.kind === 'settle') {
      await lookupsSettled();
      continue;
    }
    if ('section' in step && step.section === 'accommodation' && accommodationHidden()) {
      report.skipped.push(step.id);
      continue;
    }
    const el = document.getElementById(step.id);
    if (!el) {
      report.missingOptions.push(step.id);
      continue;
    }
    if (step.kind === 'text') {
      (el as HTMLInputElement).value = step.value;
      fire(el, 'input');
      fire(el, 'change');
    } else if (step.kind === 'date') {
      setDate(el as HTMLInputElement, step.value);
    } else {
      const select = el as HTMLSelectElement;
      if (step.awaitOption && !(await optionAppears(select, step.value))) {
        report.missingOptions.push(step.id);
        continue;
      }
      if (select.value !== step.value) {
        if (![...select.options].some((o) => o.value === step.value)) {
          report.missingOptions.push(step.id);
          continue;
        }
        select.value = step.value;
        fire(select, 'change');
      }
    }
    applied.push(step);
  }

  // Lookups can rewrite fields after we set them (e.g. arrival clears departure); put them back once.
  await lookupsSettled();
  for (const step of applied) {
    const el = document.getElementById(step.id) as HTMLInputElement | HTMLSelectElement;
    if (el.value === step.value || step.kind === 'select') continue;
    if (step.kind === 'date') setDate(el as HTMLInputElement, step.value);
    else {
      el.value = step.value;
      fire(el, 'change');
    }
  }
  for (const step of applied) {
    const el = document.getElementById(step.id) as HTMLInputElement | HTMLSelectElement;
    if (el.value !== step.value) report.mismatches.push({ id: step.id, expected: step.value, actual: el.value });
  }

  report.ok = report.mismatches.length === 0 && report.missingOptions.length === 0;
  handOff();
  return report;
}

window.__mdacOneClick = { fill };
