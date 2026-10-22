import type { Warning } from '../domain/checks';
import type { Option } from '../domain/reference';
import { h } from '../shared/dom';

export interface SelectOption {
  value: string;
  label: string;
}

export interface FieldSpec {
  name: string;
  label: string;
  type: 'text' | 'date' | 'email' | 'tel' | 'select';
  /** Spans both columns of the fieldset grid. */
  wide?: boolean;
  options?: SelectOption[];
}

/** Several controls sharing one label and one line, e.g. dial code + mobile number. */
export interface RowSpec {
  label: string;
  fields: FieldSpec[];
}

export interface SectionSpec {
  legend: string;
  items: (FieldSpec | RowSpec)[];
}

type Control = HTMLInputElement | HTMLSelectElement;

export interface FormHandle<T> {
  form: HTMLFormElement;
  controls: Record<string, Control>;
  /** Current values by field name; the caller merges them over the record being edited. */
  read(): T;
  /** Marks every field as visited so all its warnings show (existing records, and Save). */
  touchAll(): void;
  /** Re-runs the checks; call after changing a control's options in code. */
  refresh(): void;
}

export const toOptions = (options: Option[], showCode = false): SelectOption[] =>
  options.map((o) => ({ value: o.code, label: showCode ? `+${o.code} ${o.label}` : o.label }));

/** Replaces a select's options, keeping `value` when it is still offered. */
export function setOptions(select: HTMLSelectElement, options: SelectOption[], value: string, placeholder = 'Select…') {
  select.replaceChildren(
    h('option', { value: '' }, placeholder),
    ...options.map((o) => h('option', { value: o.value }, o.label)),
  );
  select.value = options.some((o) => o.value === value) ? value : '';
}

function isRow(item: FieldSpec | RowSpec): item is RowSpec {
  return 'fields' in item;
}

function buildControl(spec: FieldSpec, value: string): Control {
  const id = `f-${spec.name}`;
  if (spec.type === 'select') {
    const select = h('select', { id, name: spec.name });
    setOptions(select, spec.options ?? [], value);
    return select;
  }
  return h('input', { id, name: spec.name, type: spec.type, value, autocomplete: 'off', spellcheck: false });
}

export function createForm<T extends object>(opts: {
  id: string;
  sections: SectionSpec[];
  values: Record<string, string>;
  check: (values: T) => Warning[];
  /** True for a saved record: every warning shows at once. A new draft only warns on fields touched so far. */
  showAll: boolean;
  /** Warnings that belong to no field of this form (e.g. the Seeded preset notice). */
  onExtra?: (warnings: Warning[]) => void;
  onEdit?: (name: string) => void;
}): FormHandle<T> {
  const controls: Record<string, Control> = {};
  const notes: Record<string, HTMLElement> = {};
  const wraps: Record<string, HTMLElement> = {};
  const touched = new Set<string>(opts.showAll ? Object.keys(opts.values) : []);

  const field = (spec: FieldSpec, label: string | null) => {
    const control = buildControl(spec, opts.values[spec.name] ?? '');
    const note = h('span', { class: 'note', 'data-note-for': spec.name });
    controls[spec.name] = control;
    notes[spec.name] = note;
    return (wraps[spec.name] = h(
      'div',
      { class: `f${spec.wide ? ' wide' : ''}` },
      label !== null && h('label', { for: control.id }, label),
      control,
      note,
    ));
  };

  const item = (it: FieldSpec | RowSpec) =>
    isRow(it)
      ? h('div', { class: 'f wide' }, h('label', { for: `f-${it.fields[0]!.name}` }, it.label), h('div', { class: 'phone' }, ...it.fields.map((f) => field(f, null))))
      : field(it, it.label);

  const form = h(
    'form',
    { id: opts.id, novalidate: true, autocomplete: 'off' },
    ...opts.sections.map((s) => h('fieldset', {}, h('legend', {}, s.legend), ...s.items.map(item))),
  );

  const read = () => Object.fromEntries(Object.entries(controls).map(([name, c]) => [name, c.value])) as T;

  function refresh() {
    const warnings = opts.check(read());
    for (const name of Object.keys(controls)) {
      const own = warnings.filter((w) => w.field === name && touched.has(name));
      notes[name]!.textContent = own.map((w) => w.message).join(' ');
      wraps[name]!.classList.toggle('bad', own.length > 0);
    }
    opts.onExtra?.(warnings.filter((w) => !(w.field in controls)));
  }

  const onEdit = (e: Event) => {
    const name = (e.target as Control).name;
    if (name) touched.add(name);
    opts.onEdit?.(name);
    refresh();
  };
  form.addEventListener('input', onEdit);
  form.addEventListener('change', onEdit);
  refresh();

  return {
    form,
    controls,
    read,
    refresh,
    touchAll() {
      Object.keys(controls).forEach((n) => touched.add(n));
      refresh();
    },
  };
}
