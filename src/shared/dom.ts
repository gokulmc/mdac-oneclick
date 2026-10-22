// Tiny DOM builder. Everything goes through textContent / setAttribute, never innerHTML:
// passport data must not become an XSS vector.

export type Child = Node | string | null | undefined | false;
export type Attrs = Record<string, string | number | boolean | undefined>;

const PROPS = new Set(['value', 'checked', 'disabled', 'hidden', 'selected', 'readOnly']);

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (PROPS.has(key)) (el as unknown as Record<string, unknown>)[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

export function append(parent: Element, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child);
  }
}

/** Replaces all children of `parent`. */
export function replace(parent: Element, ...children: Child[]): void {
  parent.replaceChildren();
  append(parent, children);
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing from the page`);
  return el as T;
}
