// Reads OCR output of MDAC confirmation-email screenshots into a draft Traveller + Trip preset.
//
// The email is a two-column table (bold label · ":" · value) whose labels and values wrap over
// several lines. Tesseract's own line grouping merges wrapped label lines with the value beside
// them and reads the colon as ".", "*", "+" or "|" as often as ":", so nothing here trusts either.
// What is stable is geometry: every label starts at the same x, every value starts at the same x,
// and rows are separated by a gap larger than the gap between wrapped lines.
import { parseFormDate } from './dates';
import { EMAIL } from './checks';
import { codeOf, findCity, reference, splitMobile, stateOf } from './reference';
import type { Traveller, TripPreset } from './types';

export interface OcrWord {
  text: string;
  conf: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrPage {
  width: number;
  height: number;
  words: OcrWord[];
  name?: string;
}

export type FieldKey =
  | 'fullName' | 'passportNo' | 'nationality' | 'dateOfBirth' | 'sex' | 'passportExpiry' | 'email' | 'mobile'
  | 'arrival' | 'travelMode' | 'departure' | 'embarkPort' | 'transportNo' | 'stayType' | 'address'
  | 'postcode' | 'city' | 'state' | 'pin';

export type FieldStatus = 'ok' | 'unsure' | 'missing';

export interface Box {
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ScanField {
  key: FieldKey;
  /** Normalised value (a form code where the form uses codes; ISO date; digits). Empty when missing. */
  value: string;
  /** What OCR read, for the review screen. */
  raw: string;
  conf: number;
  status: FieldStatus;
  note?: string;
  /** Where the value sits in the source image, for the crop thumbnail. */
  box?: Box;
  /** Other readings seen for the same field on other screenshots. */
  alternatives?: string[];
}

export interface ScanResult {
  accepted: boolean;
  reason?: string;
  fields: Record<FieldKey, ScanField>;
  traveller: Partial<Traveller>;
  preset: Partial<TripPreset>;
  dates: { arrival?: string; departure?: string };
  pin?: string;
  warnings: string[];
  /** How many template labels each page recognised. */
  pageLabels: number[];
}

/** The email's rows, in order. `label` is matched by token; `kind` picks the normaliser. */
const TEMPLATE: { key: FieldKey; label: string }[] = [
  { key: 'fullName', label: 'Name' },
  { key: 'passportNo', label: 'Passport No' },
  { key: 'nationality', label: 'Nationality Citizenship' },
  { key: 'dateOfBirth', label: 'Date of Birth' },
  { key: 'sex', label: 'Sex' },
  { key: 'passportExpiry', label: 'Date of Passport Expiry' },
  { key: 'email', label: 'Email Address' },
  { key: 'mobile', label: 'Mobile No' },
  { key: 'arrival', label: 'Date of Arrival' },
  { key: 'travelMode', label: 'Mode of Travel' },
  { key: 'departure', label: 'Date of Departure' },
  { key: 'embarkPort', label: 'Last Port of Embarkation before Malaysia' },
  { key: 'transportNo', label: 'Transportation No' },
  { key: 'stayType', label: 'Accommodation of Stay' },
  { key: 'address', label: 'Address In Malaysia' },
  { key: 'postcode', label: 'Postcode' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'pin', label: 'PIN' },
];

export const FIELD_KEYS: FieldKey[] = TEMPLATE.map((t) => t.key);

/** Geometry thresholds in units of the page's median word height. Tuned on real phone screenshots (Phase 0). */
export const GEOMETRY = {
  /**
   * Row split. Centre-to-centre pitches between consecutive lines of a column form two groups: lines wrapped
   * inside one cell (measured 1.45–1.85 line heights, varying with ascenders) and the step to the next
   * row (≥ 2.03). The split sits at the largest jump in the sorted pitches, accepted when the jump is at
   * least this ratio; otherwise nothing wraps and `blockGap` applies.
   */
  minPitchJump: 1.12,
  /** Fallback row split when nothing wraps: a gap between lines larger than this starts a new row. */
  blockGap: 0.9,
  /** A value block further than this from every label centre belongs to no row. */
  maxRowDistance: 1.6,
  /** Two labels nearly this equidistant from a value block make the assignment ambiguous. */
  ambiguity: 0.25,
  /** A block this close to the image's top or bottom edge may be cut off. */
  clipMargin: 1.5,
  /** Minimum template labels on the best page for the set to count as a confirmation email. */
  minLabels: 4,
  /** Word confidence at or above which an exact reading is `ok`. */
  okConf: 85,
} as const;

// ---------- geometry ----------

interface Line {
  words: OcrWord[];
  y0: number;
  y1: number;
  /** Median of the words' vertical centres: steadier than the box edges, which OCR inflates on some words. */
  centre: number;
}

interface Block {
  lines: Line[];
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  centre: number;
  conf: number;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
}

/**
 * Groups words of one column into lines by vertical overlap. Word boxes OCR has inflated far beyond
 * a line of text (Tesseract stretches "Nationality" to 2+ line heights) are shrunk around their
 * centre first, so they can neither bridge two lines nor drag a line's edges outward.
 */
function toLines(words: OcrWord[], lineHeight: number): Line[] {
  const clamp = (w: OcrWord): OcrWord => {
    if (w.y1 - w.y0 <= 1.4 * lineHeight) return w;
    const c = (w.y0 + w.y1) / 2;
    return { ...w, y0: c - 0.7 * lineHeight, y1: c + 0.7 * lineHeight };
  };
  const sorted = words.map(clamp).sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0);
  const lines: Line[] = [];
  for (const w of sorted) {
    const last = lines[lines.length - 1];
    const centre = (w.y0 + w.y1) / 2;
    if (last && centre < last.y1 - 0.3 * lineHeight && centre > last.y0 + 0.3 * lineHeight) {
      last.words.push(w);
      last.y0 = Math.min(last.y0, w.y0);
      last.y1 = Math.max(last.y1, w.y1);
    } else lines.push({ words: [w], y0: w.y0, y1: w.y1, centre });
  }
  for (const line of lines) line.centre = median(line.words.map((w) => (w.y0 + w.y1) / 2));
  return lines;
}

/** Decides whether `next` starts a new row after `prev`. */
type RowSplit = (prev: Line, next: Line) => boolean;

/**
 * The row rule for this page, read off the label column: the smallest top-to-top pitch between
 * consecutive lines is a wrapped line inside one cell (the email always wraps "Nationality /
 * Citizenship"); rows are at least `rowPitchFactor` further apart. If even the smallest pitch is too
 * large to be a wrap, nothing wraps and a plain gap rule applies.
 */
function rowSplit(lines: Line[], lineHeight: number): RowSplit {
  const gapRule: RowSplit = (prev, next) => next.y0 - prev.y1 > GEOMETRY.blockGap * lineHeight;
  // Keep only pitches that can be a wrapped line or a row step: anything under 1.2 line heights is
  // one line that OCR split in two (toolbar text); anything over 4 is a section gap or footer
  // paragraph (rows measured 2.6–3.1 line heights across phone, desktop and low-res captures).
  const pitches = lines
    .slice(1)
    .map((l, i) => l.centre - lines[i]!.centre)
    .filter((p) => p > 1.2 * lineHeight && p < 4 * lineHeight)
    .sort((a, b) => a - b);
  if (pitches.length < 2) return gapRule;
  // Otsu's threshold: the split of the sorted pitches into two groups that maximises the separation
  // between the groups' means, weighted by their sizes — so one stray toolbar pitch cannot move it.
  let best = { at: -1, score: -1 };
  for (let k = 1; k < pitches.length; k++) {
    const lo = pitches.slice(0, k);
    const hi = pitches.slice(k);
    const m1 = lo.reduce((a, b) => a + b, 0) / lo.length;
    const m2 = hi.reduce((a, b) => a + b, 0) / hi.length;
    const score = lo.length * hi.length * (m2 - m1) ** 2;
    if (score > best.score) best = { at: k, score };
  }
  const lo = pitches.slice(0, best.at);
  const hi = pitches.slice(best.at);
  const m1 = lo.reduce((a, b) => a + b, 0) / lo.length;
  const m2 = hi.reduce((a, b) => a + b, 0) / hi.length;
  // Only the smaller group can be wrapped lines: it must sit clearly below the rows and be wrap-sized.
  // Otherwise nothing on the page wraps and the plain gap rule applies.
  if (m2 / m1 < GEOMETRY.minPitchJump || m1 > 2.2 * lineHeight) return gapRule;
  const limit = (lo[lo.length - 1]! + hi[0]!) / 2;
  return (prev, next) => next.centre - prev.centre > limit;
}

/** Groups a column's lines into row blocks. */
function blocks(words: OcrWord[], lineHeight: number, split: RowSplit): Block[] {
  const lines = toLines(words, lineHeight);
  const out: Block[] = [];
  let current: Line[] = [];
  const flush = () => {
    if (!current.length) return;
    const ws = current.flatMap((l) => [...l.words].sort((a, b) => a.x0 - b.x0));
    const y0 = Math.min(...ws.map((w) => w.y0));
    const y1 = Math.max(...ws.map((w) => w.y1));
    out.push({
      lines: current,
      text: ws.map((w) => w.text).join(' '),
      x0: Math.min(...ws.map((w) => w.x0)),
      y0,
      x1: Math.max(...ws.map((w) => w.x1)),
      y1,
      centre: (y0 + y1) / 2,
      conf: ws.reduce((a, w) => a + w.conf, 0) / ws.length,
    });
    current = [];
  };
  for (const line of lines) {
    const prev = current[current.length - 1];
    if (prev && split(prev, line)) flush();
    current.push(line);
  }
  flush();
  return out;
}

// ---------- label alignment ----------

const normToken = (t: string) => t.toUpperCase().replace(/[^A-Z0-9]/g, '');

function editDistance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) rows[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, rows[i - 2]![j - 2]! + 1);
      rows[i]![j] = d;
    }
  return rows[a.length]![b.length]!;
}

const tokensMatch = (a: string, b: string) => (a.length < 4 || b.length < 4 ? a === b : editDistance(a, b) <= 1);

/**
 * How well a block's text matches a template label, 0..1. Counts matched template tokens, then
 * falls back to comparing the joined strings so split ("Nati lit") or merged ("Dateof") tokens still score.
 */
function labelScore(blockText: string, label: string): number {
  const want = label.split(' ').map(normToken);
  const have = blockText.split(/\s+/).map(normToken).filter(Boolean);
  let hit = 0;
  const used = new Set<number>();
  for (const w of want) {
    const i = have.findIndex((h, idx) => !used.has(idx) && tokensMatch(h, w));
    if (i >= 0) {
      used.add(i);
      hit += 1;
    }
  }
  const byToken = hit / want.length;
  const joinedWant = want.join('');
  const joinedHave = have.join('');
  const byString = 1 - editDistance(joinedHave, joinedWant) / Math.max(joinedWant.length, joinedHave.length, 1);
  // Extra tokens in the block (noise like "|") cost a little so "Name" beats "Name Something".
  const noise = Math.max(0, have.length - want.length) * 0.05;
  return Math.max(byToken, byString) - noise;
}

/** Best monotonic assignment of label blocks to template rows: order is preserved, rows may be skipped. */
function alignLabels(labelBlocks: Block[]): (number | undefined)[] {
  const B = labelBlocks.length;
  const T = TEMPLATE.length;
  const MIN = 0.6;
  const score = labelBlocks.map((b) => TEMPLATE.map((t) => labelScore(b.text, t.label)));
  // best[i][j] = best total using blocks[0..i) with the last used template index < j... classic LIS-style DP.
  const best: number[][] = Array.from({ length: B + 1 }, () => new Array<number>(T + 1).fill(0));
  const choice: (number | undefined)[][] = Array.from({ length: B + 1 }, () => new Array(T + 1).fill(undefined));
  for (let i = 1; i <= B; i++) {
    for (let j = 0; j <= T; j++) {
      // Skip this block.
      best[i]![j] = best[i - 1]![j]!;
      choice[i]![j] = undefined;
      // Or match it to template row t < j, having used rows < t before.
      for (let t = 0; t < j; t++) {
        const s = score[i - 1]![t]!;
        if (s < MIN) continue;
        const cand = best[i - 1]![t]! + s;
        if (cand > best[i]![j]!) {
          best[i]![j] = cand;
          choice[i]![j] = t;
        }
      }
    }
  }
  const out: (number | undefined)[] = new Array(B).fill(undefined);
  let j = T;
  for (let i = B; i >= 1; i--) {
    const t = choice[i]![j];
    if (t !== undefined) {
      out[i - 1] = t;
      j = t;
    }
  }
  // Positional fallback: a garbled label wedged between two matched neighbours whose template rows
  // are two apart can only be the row between them ("Address (In Malaysia)" often reads as "… Malaysia)").
  for (let i = 0; i < B; i++) {
    if (out[i] !== undefined) continue;
    const prev = i > 0 ? out[i - 1] : undefined;
    const next = i < B - 1 ? out[i + 1] : undefined;
    if (prev !== undefined && next !== undefined && next - prev === 2 && score[i]![prev + 1]! >= 0.2) out[i] = prev + 1;
  }
  return out;
}

// ---------- value assignment ----------

/**
 * How far apart a label and a value sit vertically. Cells are middle-aligned in the real email
 * (centres coincide) but a top-aligned rendering is possible (tops coincide); the smaller wins.
 */
function rowDistance(label: Block, value: Block): number {
  return Math.min(Math.abs(value.centre - label.centre), Math.abs(value.y0 - label.y0));
}

/** Monotonic one-to-one assignment of value blocks to labels by row distance. */
function assignValues(labels: { block: Block; row: number }[], values: Block[], lineHeight: number): Map<number, Block> {
  const L = labels.length;
  const V = values.length;
  const max = GEOMETRY.maxRowDistance * lineHeight;
  const cost = labels.map((l) => values.map((v) => rowDistance(l.block, v)));
  // dp[i][j]: min cost using labels[0..i) and values[0..j); each pair used at most once, order preserved.
  const INF = Number.POSITIVE_INFINITY;
  const dp: number[][] = Array.from({ length: L + 1 }, () => new Array<number>(V + 1).fill(0));
  const from: ('skipL' | 'skipV' | 'pair')[][] = Array.from({ length: L + 1 }, () => new Array(V + 1).fill('skipL'));
  const unmatched = max; // cost of leaving a label or value unmatched, so pairing only wins when it is closer
  for (let i = 0; i <= L; i++)
    for (let j = 0; j <= V; j++) {
      if (i === 0 && j === 0) continue;
      let bestCost = INF;
      let how: 'skipL' | 'skipV' | 'pair' = 'skipL';
      if (i > 0 && dp[i - 1]![j]! + unmatched < bestCost) {
        bestCost = dp[i - 1]![j]! + unmatched;
        how = 'skipL';
      }
      if (j > 0 && dp[i]![j - 1]! + unmatched < bestCost) {
        bestCost = dp[i]![j - 1]! + unmatched;
        how = 'skipV';
      }
      if (i > 0 && j > 0) {
        const c = cost[i - 1]![j - 1]!;
        if (c <= max && dp[i - 1]![j - 1]! + c < bestCost) {
          bestCost = dp[i - 1]![j - 1]! + c;
          how = 'pair';
        }
      }
      dp[i]![j] = bestCost;
      from[i]![j] = how;
    }
  const out = new Map<number, Block>();
  let i = L;
  let j = V;
  while (i > 0 || j > 0) {
    const how = from[i]![j]!;
    if (how === 'pair') {
      out.set(labels[i - 1]!.row, values[j - 1]!);
      i -= 1;
      j -= 1;
    } else if (how === 'skipL' && i > 0) i -= 1;
    else j -= 1;
  }
  return out;
}

// ---------- per-page parse ----------

interface Reading {
  key: FieldKey;
  raw: string;
  conf: number;
  box: Box;
  clipped: boolean;
  ambiguous: boolean;
}

interface PageParse {
  readings: Reading[];
  labelsFound: number;
}

/** The geometry a page was parsed with, for tests and debugging. */
export interface PageInspection {
  lineHeight: number;
  labelStart?: number;
  valueStart?: number;
  labelBlocks: { text: string; y0: number; y1: number; row?: FieldKey }[];
  valueBlocks: { text: string; y0: number; y1: number; conf: number }[];
}

export function inspectPage(page: OcrPage): PageInspection {
  const g = columns(page);
  const rows = alignLabels(g.labelBlocks);
  return {
    lineHeight: g.lineHeight,
    labelStart: g.labelStart,
    valueStart: g.valueStart,
    labelBlocks: g.labelBlocks.map((b, i) => ({ text: b.text, y0: b.y0, y1: b.y1, row: rows[i] === undefined ? undefined : TEMPLATE[rows[i]!]!.key })),
    valueBlocks: g.valueBlocks.map((b) => ({ text: b.text, y0: b.y0, y1: b.y1, conf: b.conf })),
  };
}

interface Columns {
  lineHeight: number;
  labelStart?: number;
  valueStart?: number;
  labelBlocks: Block[];
  valueBlocks: Block[];
}

/** Every x where at least three words start (clustered within `tolerance`), left to right, with the count. */
function columnStarts(words: OcrWord[], tolerance: number): { x: number; n: number }[] {
  const xs = words.map((w) => w.x0).sort((a, b) => a - b);
  const out: { x: number; n: number }[] = [];
  let current: number[] = [];
  const flush = () => {
    if (current.length >= 3) out.push({ x: current.reduce((a, b) => a + b, 0) / current.length, n: current.length });
    current = [];
  };
  for (const x of xs) {
    if (current.length && x - current[current.length - 1]! > tolerance) flush();
    current.push(x);
  }
  flush();
  return out;
}

/** Splits the page's words into the label and value columns that start at `labelStart` / `valueStart`. */
function columnsAt(words: OcrWord[], labelStart: number, valueStart: number, lineHeight: number): Columns {
  const labelWords: OcrWord[] = [];
  const valueWords: OcrWord[] = [];
  const edge = valueStart - 0.6 * lineHeight;
  // Nothing left of the label column is the email (a desktop screenshot has the mail client's sidebar there),
  // and values end well before anything a screen width away (toolbars, a right-hand rail).
  const leftmost = labelStart - 0.5 * lineHeight;
  const rightmost = valueStart + 40 * lineHeight;
  for (const w of words) {
    if (w.x0 < leftmost || w.x0 > rightmost) continue;
    const narrow = w.x1 - w.x0 < 0.8 * lineHeight;
    // Narrow tokens are mostly the divider or speckle, but a lone confident digit or letter ("9", "A")
    // is real text: keep those, except inside the divider's own band just left of the value column.
    if (narrow && (w.conf < 50 || !/[A-Za-z0-9]/.test(w.text) || (w.x0 > valueStart - 2 * lineHeight && w.x1 <= edge))) continue;
    if (w.x0 >= edge) valueWords.push(w);
    // A value word whose box starts at a fused colon (":INDIA") straddles the edge; labels never do.
    else if (w.x1 > valueStart + 0.6 * lineHeight) valueWords.push(w);
    else if (w.x1 <= edge) labelWords.push(w);
  }
  // The label column always has wrapped cells ("Nationality / Citizenship"), so it sets the row rule for both.
  const split = rowSplit(toLines(labelWords, lineHeight), lineHeight);
  return {
    lineHeight,
    labelStart,
    valueStart,
    labelBlocks: blocks(labelWords, lineHeight, split),
    valueBlocks: blocks(valueWords, lineHeight, split),
  };
}

/**
 * Finds the email's two columns among everything on the page. Every pair of x positions where words
 * start is a candidate; the winner is the pair whose left column reads most like the template labels
 * and whose rows have values beside them — so neither a mail client's sidebar (many lines, wrong words)
 * nor a far-off toolbar can pass for the table, whatever the screenshot's width.
 */
function columns(page: OcrPage): Columns {
  const words = page.words.filter((w) => w.text.trim());
  const lineHeight = median(words.filter((w) => w.text.length >= 3).map((w) => w.y1 - w.y0)) || 1;
  // Divider tokens (the colon, however it was read) are narrow; leave them out of the column vote.
  const wide = words.filter((w) => w.x1 - w.x0 >= 0.8 * lineHeight);
  const starts = columnStarts(wide, 0.5 * lineHeight);
  const MIN_LABEL = 0.6;
  let best: { columns: Columns; score: number; size: number; span: number } | undefined;
  for (const { x: labelStart } of starts) {
    for (const { x: valueStart, n: size } of starts) {
      const span = valueStart - labelStart;
      if (span < 3 * lineHeight) continue;
      const cols = columnsAt(words, labelStart, valueStart, lineHeight);
      // Quality, not just count: "Date of Birth" (1.0) must outrank "Date of" (0.67), or the column where
      // labels' second words start would tie with the real value column.
      const quality = cols.labelBlocks
        .map((b) => Math.max(...TEMPLATE.map((t) => labelScore(b.text, t.label))))
        .filter((q) => q >= MIN_LABEL);
      if (quality.length < 2) continue;
      const paired = cols.labelBlocks.filter((l) =>
        cols.valueBlocks.some((v) => rowDistance(l, v) <= GEOMETRY.maxRowDistance * lineHeight),
      ).length;
      const score = quality.reduce((a, q) => a + q, 0) * 2 + paired;
      // Ties: the real value column is where most values start, not a stray word that happens to line up.
      const better =
        !best || score > best.score || (score === best.score && (size > best.size || (size === best.size && span < best.span)));
      if (better) best = { columns: cols, score, size, span };
    }
  }
  return best?.columns ?? { lineHeight, labelBlocks: [], valueBlocks: [] };
}

// ---------- retry pass ----------

/** A value line worth a second, zoomed single-line read, in source-image pixels. */
export interface RetryTarget {
  page: number;
  key: FieldKey;
  /** The line's box, its left edge pushed past the divider so the colon is not re-read as a word. */
  box: Box;
}

/** Value lines whose words averaged below `minConf` on first reading, per field. */
export function retryTargets(pages: OcrPage[], minConf: number = GEOMETRY.okConf): RetryTarget[] {
  const out: RetryTarget[] = [];
  pages.forEach((page, index) => {
    const g = columns(page);
    if (g.valueStart === undefined) return;
    const rows = alignLabels(g.labelBlocks);
    const labels = g.labelBlocks
      .map((block, i) => ({ block, row: rows[i] }))
      .filter((l): l is { block: Block; row: number } => l.row !== undefined);
    const assigned = assignValues(labels, g.valueBlocks, g.lineHeight);
    const left = g.valueStart - 0.5 * g.lineHeight;
    for (const [row, block] of assigned) {
      const key = TEMPLATE[row]!.key;
      if (key === 'pin') continue; // display only
      for (const line of block.lines) {
        const conf = line.words.reduce((a, w) => a + w.conf, 0) / line.words.length;
        if (conf >= minConf) continue;
        const x1 = Math.max(...line.words.map((w) => w.x1));
        out.push({ page: index, key, box: { page: index, x0: Math.max(left, Math.min(...line.words.map((w) => w.x0)) - 0.3 * g.lineHeight), y0: line.y0 - 0.3 * g.lineHeight, x1: x1 + 0.5 * g.lineHeight, y1: line.y1 + 0.3 * g.lineHeight } });
      }
    }
  });
  return out;
}

/** The page with the words inside `box` replaced by a second reading (words already in source coordinates). */
export function replaceWords(page: OcrPage, box: Box, words: OcrWord[]): OcrPage {
  const inside = (w: OcrWord) => {
    const cx = (w.x0 + w.x1) / 2;
    const cy = (w.y0 + w.y1) / 2;
    return cx >= box.x0 && cx <= box.x1 && cy >= box.y0 && cy <= box.y1;
  };
  const kept = page.words.filter((w) => !inside(w));
  const fresh = words.filter((w) => w.text.trim() && inside(w));
  // A worse second reading must not replace a readable first one.
  const before = page.words.filter(inside);
  const mean = (ws: OcrWord[]) => (ws.length ? ws.reduce((a, w) => a + w.conf, 0) / ws.length : 0);
  if (!fresh.length || mean(fresh) <= mean(before)) return page;
  return { ...page, words: [...kept, ...fresh] };
}

function parsePage(page: OcrPage, pageIndex: number): PageParse {
  const { lineHeight, labelBlocks, valueBlocks } = columns(page);
  const rows = alignLabels(labelBlocks);
  const labels = labelBlocks
    .map((block, i) => ({ block, row: rows[i] }))
    .filter((l): l is { block: Block; row: number } => l.row !== undefined);
  const assigned = assignValues(labels, valueBlocks, lineHeight);

  const readings: Reading[] = [];
  for (const { block: labelBlock, row } of labels) {
    const value = assigned.get(row);
    if (!value) continue;
    const others = labels.filter((l) => l.row !== row).map((l) => rowDistance(l.block, value));
    const own = rowDistance(labelBlock, value);
    const ambiguous = others.some((d) => Math.abs(d - own) < GEOMETRY.ambiguity * lineHeight);
    const margin = GEOMETRY.clipMargin * lineHeight;
    const clipped =
      Math.min(value.y0, labelBlock.y0) < margin || Math.max(value.y1, labelBlock.y1) > page.height - margin;
    readings.push({
      key: TEMPLATE[row]!.key,
      raw: value.text,
      conf: value.conf,
      box: { page: pageIndex, x0: value.x0, y0: value.y0, x1: value.x1, y1: value.y1 },
      clipped,
      ambiguous,
    });
  }
  return { readings, labelsFound: labels.length };
}

// ---------- normalisation ----------

interface Normalised {
  value: string;
  exact: boolean;
  note?: string;
}

const upper = (s: string) => s.replace(/\s+/g, ' ').trim().toUpperCase();

function normalise(key: FieldKey, rawText: string): Normalised | undefined {
  // A stray divider glyph that slipped into the value column (": INDIA", "+ 15/01/1990") is never part
  // of the value; a "+" fused to the digits ("+6581234567") is.
  const raw = rawText.replace(/^\s*:+\s*/, '').replace(/^(?:[:.*+=|'"`,-]+\s+)+/, '').trim();
  if (!raw) return undefined;
  switch (key) {
    case 'fullName':
      return { value: upper(raw).replace(/[^A-Z' -]/g, '').trim(), exact: !/[^A-Za-z' \s-]/.test(raw) };
    case 'passportNo': {
      const v = raw.replace(/\s/g, '').toUpperCase();
      if (!v) return undefined;
      // Most passport numbers are a letter or two followed by digits (Y2533879, K0011223). When OCR has
      // put an O or I where that shape wants a digit, repair it — but never call the result certain.
      // Try the shortest letter prefix first, or "TO000001" would keep its O as a second letter.
      for (const letters of [1, 2]) {
        const head = v.slice(0, letters);
        const tail = v.slice(letters);
        if (!/^[A-Z]+$/.test(head) || tail.length < 6 || tail.length > 9) continue;
        const repaired = tail.replace(/O/g, '0').replace(/I/g, '1');
        if (repaired !== tail && /^\d+$/.test(repaired))
          return { value: head + repaired, exact: false, note: 'O/0 or I/1 repaired — check against the passport' };
      }
      return { value: v, exact: /^[A-Z0-9]+$/.test(v) && v.length <= 12 };
    }
    case 'nationality':
    case 'embarkPort': {
      const m = codeOf(key === 'nationality' ? reference.nationalities : reference.ports, raw);
      return m && { value: m.code, exact: m.status === 'ok' };
    }
    case 'dateOfBirth':
    case 'passportExpiry':
    case 'arrival':
    case 'departure': {
      // The date is the first token shaped like one; anything after it is noise from a neighbouring row.
      const token = /[0-9OoIl|SBZ]{1,2}\s*[/.-]\s*[0-9OoIl|SBZ]{1,2}\s*[/.-]\s*[0-9OoIl|SBZ]{4}/.exec(raw)?.[0] ?? raw;
      const d = parseFormDate(token);
      const extra = token !== raw.trim();
      return d && { value: d.iso, exact: !d.repaired && !extra, note: d.repaired ? 'Some digits were repaired' : undefined };
    }
    case 'sex': {
      const m = codeOf(reference.sexes, raw);
      return m && { value: m.code, exact: m.status === 'ok' };
    }
    case 'travelMode': {
      const m = codeOf(reference.travelModes, raw);
      return m && { value: m.code, exact: m.status === 'ok' };
    }
    case 'stayType': {
      const m = codeOf(reference.stayTypes, raw.replace(/\s*\/\s*/g, '/'));
      return m && { value: m.code, exact: m.status === 'ok' };
    }
    case 'email': {
      const m = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.exec(raw.replace(/\s/g, ''));
      if (!m) return undefined;
      const v = m[0].toLowerCase().replace(/[._]+$/, '');
      return { value: v, exact: EMAIL.test(v) && m[0].length === raw.replace(/\s/g, '').length };
    }
    case 'mobile': {
      const m = splitMobile(raw);
      return m && { value: `${m.dialCode}|${m.mobile}`, exact: m.status === 'ok', note: m.dialCode ? undefined : 'Pick the country code' };
    }
    case 'transportNo':
      return { value: upper(raw).replace(/[^A-Z0-9/\-@(),' ]/g, ''), exact: /^[A-Za-z0-9/\-@(),' \s]+$/.test(raw) };
    case 'address':
      return { value: upper(raw).replace(/[^A-Z0-9/\-@(),' ]/g, ''), exact: /^[A-Za-z0-9/\-@(),' \s]+$/.test(raw) };
    case 'postcode': {
      const d = raw.replace(/[^0-9OoIl|SB]/g, '').replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
      return /^\d{5}$/.test(d) ? { value: d, exact: /^\d{5}$/.test(raw.trim()) } : undefined;
    }
    case 'state': {
      const m = stateOf(raw);
      return m && { value: m.code, exact: m.status === 'ok' };
    }
    case 'city':
      // Resolved after the state is known; keep the text.
      return { value: upper(raw), exact: true };
    case 'pin':
      return { value: raw.replace(/\s/g, ''), exact: true };
  }
}

// ---------- merge ----------

function emptyField(key: FieldKey): ScanField {
  return { key, value: '', raw: '', conf: 0, status: 'missing' };
}

function rank(status: FieldStatus): number {
  return status === 'ok' ? 2 : status === 'unsure' ? 1 : 0;
}

/** Parses one or more screenshots of the same confirmation email. */
export function parseConfirmation(pages: OcrPage[]): ScanResult {
  const parsed = pages.map((p, i) => parsePage(p, i));
  const pageLabels = parsed.map((p) => p.labelsFound);
  const fields = Object.fromEntries(FIELD_KEYS.map((k) => [k, emptyField(k)])) as Record<FieldKey, ScanField>;
  const warnings: string[] = [];
  const result: ScanResult = { accepted: false, fields, traveller: {}, preset: {}, dates: {}, warnings, pageLabels };

  const accepted = parsed.filter((p) => p.labelsFound >= GEOMETRY.minLabels);
  if (!accepted.length) {
    result.reason = "This doesn't look like an MDAC confirmation email.";
    return result;
  }
  result.accepted = true;
  // Pages with at least one recognised label count once the set has an anchor page.
  const usable = parsed.filter((p) => p.labelsFound >= 1);

  // Every candidate reading per field, scored.
  const candidates = new Map<FieldKey, (Reading & { norm?: Normalised; status: FieldStatus })[]>();
  for (const p of usable)
    for (const r of p.readings) {
      const norm = normalise(r.key, r.raw);
      let status: FieldStatus = 'missing';
      if (norm) status = norm.exact && !r.ambiguous && !r.clipped && r.conf >= GEOMETRY.okConf ? 'ok' : 'unsure';
      (candidates.get(r.key) ?? candidates.set(r.key, []).get(r.key)!).push({ ...r, norm, status });
    }

  for (const key of FIELD_KEYS) {
    const list = candidates.get(key) ?? [];
    if (!list.length) continue;
    list.sort((a, b) => Number(a.clipped) - Number(b.clipped) || rank(b.status) - rank(a.status) || b.conf - a.conf);
    const best = list[0]!;
    const field: ScanField = {
      key,
      value: best.norm?.value ?? '',
      raw: best.raw,
      conf: best.conf,
      status: best.status,
      note: best.norm?.note,
      box: best.box,
    };
    if (best.status === 'missing') field.note = 'Could not read this field';
    else if (best.clipped) {
      field.status = 'unsure';
      field.note = 'Cut off at the screenshot edge — check';
    } else if (best.ambiguous) field.note = 'Not sure which row this belongs to';
    const differing = list.filter((c) => c.norm && best.norm && c.norm.value !== best.norm.value && !c.clipped);
    if (differing.length) {
      field.status = 'unsure';
      field.alternatives = [...new Set(differing.map((c) => c.raw))];
      field.note = 'Screenshots disagree';
    }
    fields[key] = field;
  }

  // Guards across pages.
  const passports = (candidates.get('passportNo') ?? []).filter((c) => c.status === 'ok').map((c) => c.norm!.value);
  if (new Set(passports).size > 1) {
    result.accepted = false;
    result.reason = 'These screenshots are from different confirmations (different passport numbers).';
    return result;
  }
  for (const key of ['arrival', 'departure'] as const) {
    const dates = new Set((candidates.get(key) ?? []).filter((c) => c.norm).map((c) => c.norm!.value));
    if (dates.size > 1) warnings.push('These screenshots may be from different filings: the travel dates differ.');
  }

  // City needs the state.
  const stateCode = fields.state.status !== 'missing' ? fields.state.value : '';
  if (fields.city.status !== 'missing') {
    const m = stateCode ? findCity(stateCode, fields.city.raw) : undefined;
    if (m) {
      fields.city.value = m.code;
      if (m.status === 'unsure' && fields.city.status === 'ok') {
        fields.city.status = 'unsure';
        fields.city.note = 'Closest city in the list';
      }
    } else {
      fields.city.value = '';
      fields.city.status = stateCode ? 'missing' : 'unsure';
      fields.city.note = stateCode ? 'Not a city in this state: pick it' : 'Pick the state first';
    }
  }

  // Assemble.
  const t = result.traveller;
  const p = result.preset;
  const val = (key: FieldKey) => (fields[key].status === 'missing' ? undefined : fields[key].value);
  if (val('fullName')) t.fullName = val('fullName');
  if (val('passportNo')) t.passportNo = val('passportNo');
  if (val('nationality')) {
    t.nationality = val('nationality');
    t.placeOfBirth = val('nationality');
  }
  if (val('dateOfBirth')) t.dateOfBirth = val('dateOfBirth');
  if (val('sex')) t.sex = val('sex') as Traveller['sex'];
  if (val('passportExpiry')) t.passportExpiry = val('passportExpiry');
  if (val('email')) t.email = val('email');
  if (val('mobile')) {
    const [dial, number] = val('mobile')!.split('|');
    t.dialCode = dial;
    t.mobile = number;
  }
  if (val('travelMode')) p.travelMode = val('travelMode') as TripPreset['travelMode'];
  if (val('embarkPort')) p.embarkPort = val('embarkPort');
  if (val('transportNo')) p.transportNo = val('transportNo');
  if (val('stayType')) p.stayType = val('stayType') as TripPreset['stayType'];
  if (val('address')) {
    // The email has one address row; the form has two 100-character lines. Split only when it does not fit.
    const address = val('address')!;
    if (address.length <= 100) p.address1 = address;
    else {
      const cut = address.lastIndexOf(' ', 100);
      p.address1 = address.slice(0, cut > 0 ? cut : 100).trim();
      p.address2 = address.slice(cut > 0 ? cut : 100).trim().slice(0, 100);
      fields.address.status = 'unsure';
      fields.address.note = 'Longer than one form line: split into two';
    }
  }
  if (val('postcode')) p.postcode = val('postcode');
  if (val('state')) p.state = val('state');
  if (val('city')) p.city = val('city');
  result.dates = { arrival: val('arrival'), departure: val('departure') };
  result.pin = val('pin');
  return result;
}
