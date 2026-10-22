// ISO yyyy-mm-dd in our data; the MDAC datepickers use dd/mm/yyyy.

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): boolean {
  const m = ISO.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!;
}

export function toFormDate(iso: string): string {
  const m = ISO.exec(iso);
  if (!m) throw new Error(`not an ISO date: ${iso}`);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Local calendar date of `now`, as ISO. The MDAC window is about the traveller's calendar day. */
export function localIsoDate(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Whole days from `a` to `b` (b - a), both ISO. */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}

// OCR confuses these glyphs with digits; applied only to a date that does not parse as-is.
const DIGIT_LOOKALIKES: Record<string, string> = { O: '0', o: '0', I: '1', l: '1', '|': '1', S: '5', B: '8', Z: '2' };

const FORM_DATE = /^([0-9OoIl|SBZ]{1,2})\s*[/.-]\s*([0-9OoIl|SBZ]{1,2})\s*[/.-]\s*([0-9OoIl|SBZ]{4})$/;

/**
 * Reads a dd/mm/yyyy date as printed on the MDAC site or in its emails (also dd-mm-yyyy, dd.mm.yyyy), tolerating
 * stray punctuation and OCR digit look-alikes. `repaired` says a look-alike was replaced.
 */
export function parseFormDate(text: string): { iso: string; repaired: boolean } | undefined {
  const m = FORM_DATE.exec(text.trim().replace(/^[^0-9A-Za-z|]+|[^0-9A-Za-z|]+$/g, ''));
  if (!m) return undefined;
  const fix = (part: string) => part.replace(/[^0-9]/g, (c) => DIGIT_LOOKALIKES[c] ?? c);
  const [day, month, year] = [m[1]!, m[2]!, m[3]!].map(fix) as [string, string, string];
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  if (!isIsoDate(iso)) return undefined;
  return { iso, repaired: `${m[1]}${m[2]}${m[3]}` !== `${day}${month}${year}` };
}
