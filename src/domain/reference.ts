import data from '../reference/data.json';

export interface Option {
  code: string;
  label: string;
}

export const reference = data as {
  capturedOn: string;
  sexes: Option[];
  travelModes: Option[];
  stayTypes: Option[];
  states: Option[];
  nationalities: Option[];
  ports: Option[];
  dialCodes: Option[];
  cities: Record<string, Option[]>;
};

export function citiesOf(state: string): Option[] {
  return reference.cities[state] ?? [];
}

export function labelOf(options: Option[], code: string): string | undefined {
  return options.find((o) => o.code === code)?.label;
}

export function cityLabel(state: string, city: string): string | undefined {
  return labelOf(citiesOf(state), city);
}

// ---------- reading free text (OCR, pasted emails) back into form codes ----------

/** A reading of free text as a form code. `unsure` means it was fuzzy, ambiguous or repaired and needs a human look. */
export interface CodeMatch {
  code: string;
  status: 'ok' | 'unsure';
}

/** Upper case, "&" as AND, punctuation dropped, spaces collapsed: the comparison key for labels. */
export function normaliseLabel(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/['\u2018\u2019`]/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Edit distance; `damerau` counts swapping two neighbouring letters as one edit. */
function distance(a: string, b: string, damerau: boolean): number {
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) rows[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (damerau && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, rows[i - 2]![j - 2]! + 1);
      rows[i]![j] = d;
    }
  }
  return rows[a.length]![b.length]!;
}

interface Keyed {
  key: string;
  codes: string[];
}

/** Options grouped by comparison key, in first-seen order (two codes can share one label). */
function keyed(options: Option[], keyOf: (label: string) => string): Keyed[] {
  const byKey = new Map<string, Keyed>();
  for (const o of options) {
    const key = keyOf(o.label);
    const hit = byKey.get(key);
    if (hit) hit.codes.push(o.code);
    else byKey.set(key, { key, codes: [o.code] });
  }
  return [...byKey.values()];
}

/** The single closest key within `max` edits whose runner-up is at least `margin` further away. */
function closest(entries: Keyed[], key: string, max: number, margin: number, damerau: boolean): Keyed | undefined {
  const scored = entries.map((e) => ({ e, d: distance(key, e.key, damerau) })).sort((x, y) => x.d - y.d);
  const [best, next] = scored;
  if (!best || best.d > max) return undefined;
  return next && next.d < best.d + margin ? undefined : best.e;
}

// Where the site lists two codes for one country name, the current ISO code is the one the form accepts.
const PREFERRED_CODES = ['PRK', 'PSE', 'ROU', 'SRB', 'TLS', 'ZWE'];

/** Country (or any code/label list) from text such as "INDIA" or "SGP - SINGAPORE". Never matches on a prefix. */
export function codeOf(options: Option[], text: string): CodeMatch | undefined {
  const key = normaliseLabel(text.trim().toUpperCase().replace(/^[A-Z0-9]{3}\s*-\s*/, ''));
  if (!key) return undefined;
  const pick = (e: Keyed) => PREFERRED_CODES.find((c) => e.codes.includes(c)) ?? e.codes[0]!;
  const entries = keyed(options, normaliseLabel);
  const exact = entries.find((e) => e.key === key);
  if (exact) return { code: pick(exact), status: 'ok' };
  // OCR sometimes breaks a word ("SINGA PORE") or drops a space; spacing never changes which label it is.
  const tight = key.replace(/ /g, '');
  const spaced = entries.find((e) => e.key.replace(/ /g, '') === tight);
  if (spaced) return { code: pick(spaced), status: 'ok' };
  const near = closest(entries, key, Math.max(1, Math.round(0.15 * key.length)), 2, true);
  return near && { code: pick(near), status: 'unsure' };
}

/** "WP KUALA LUMPUR" and "KUALA LUMPUR" are one state; "N SEMBILAN" and "P PINANG" are written short. */
function stateKey(text: string): string {
  const bare = text
    .toUpperCase()
    .replace(/WILAYAH\s+PERSEKUTUAN/g, ' ')
    .replace(/\bW\.\s?P\b\.?/g, ' ')
    .replace(/\bWP\b/g, ' ');
  return normaliseLabel(bare).replace(/^N /, 'NEGERI ').replace(/^P /, 'PULAU ');
}

export function stateOf(text: string): CodeMatch | undefined {
  const key = stateKey(text);
  if (!key) return undefined;
  const entries = keyed(reference.states, stateKey);
  const exact = entries.find((e) => e.key === key);
  if (exact) return { code: exact.codes[0]!, status: 'ok' };
  const near = closest(entries, key, 2, 1, false);
  return near && { code: near.codes[0]!, status: 'unsure' };
}

const CITY_WORDS: Record<string, string> = {
  BDR: 'BANDAR', K: 'KUALA', KG: 'KAMPUNG', KAMPONG: 'KAMPUNG', SG: 'SUNGAI', TG: 'TANJONG', TANJUNG: 'TANJONG',
  BTG: 'BATANG', PENG: 'PENGKALAN', TELUK: 'TELOK',
};

/** The site abbreviates inconsistently (BDR. BARU BANGI, SG AYER TAWAR); this spells every form out the same way. */
function cityKey(text: string): string {
  const bare = text.toUpperCase().replace(/\([^)]*\)?/g, ' ').replace(/,.*$/, ' ');
  return normaliseLabel(bare)
    .replace(/\bC HIGHLANDS\b/g, 'CAMERON HIGHLANDS')
    .split(' ')
    .map((w) => CITY_WORDS[w] ?? w)
    .join(' ');
}

/** A city within `state` only; a city from another state is never guessed. */
export function findCity(state: string, text: string): CodeMatch | undefined {
  const cities = citiesOf(state);
  const plain = normaliseLabel(text);
  if (!plain || cities.length === 0) return undefined;
  const exact = keyed(cities, normaliseLabel).find((e) => e.key === plain);
  if (exact) return { code: exact.codes[0]!, status: exact.codes.length === 1 ? 'ok' : 'unsure' };
  const key = cityKey(text);
  const entries = keyed(cities, cityKey);
  const spelled = entries.find((e) => e.key === key);
  if (spelled) return { code: spelled.codes[0]!, status: 'unsure' };
  const near = closest(entries, key, 2, 1, false);
  return near && { code: near.codes[0]!, status: 'unsure' };
}

// OCR confuses these glyphs with digits; applied to a phone number only after the digits are all that is left to read.
const PHONE_LOOKALIKES: Record<string, string> = { O: '0', o: '0', I: '1', l: '1', '|': '1', S: '5', B: '8' };

/**
 * Splits a mobile number printed with its dial code fused on ("+919892800000", "0065 9123 4567").
 * With a leading + or 00 the longest dial-code prefix wins; without one the digits are kept whole and the
 * dial code is left for the traveller to pick.
 */
export function splitMobile(text: string): { dialCode: string; mobile: string; status: 'ok' | 'unsure' } | undefined {
  const raw = text.normalize('NFKC').trim();
  const international = /^(\+|00)/.test(raw);
  let digits = '';
  let repaired = false;
  for (const c of raw.replace(/^(\+|00)/, '')) {
    if (/[0-9]/.test(c)) digits += c;
    else if (PHONE_LOOKALIKES[c]) {
      digits += PHONE_LOOKALIKES[c];
      repaired = true;
    } else if (!/[\s\-().\u00b7]/.test(c)) return undefined;
  }
  if (digits.length < 7) return undefined;
  if (international && digits.length >= 8 && digits.length <= 15) {
    const codes = [...new Set(reference.dialCodes.map((d) => d.code))].sort((a, b) => b.length - a.length);
    const dialCode = codes.find((c) => digits.startsWith(c) && digits.length > c.length);
    if (dialCode) return { dialCode, mobile: digits.slice(dialCode.length), status: repaired ? 'unsure' : 'ok' };
  }
  return { dialCode: '', mobile: digits, status: 'unsure' };
}
