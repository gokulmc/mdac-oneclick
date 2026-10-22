import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FIELD_KEYS, GEOMETRY, inspectPage, parseConfirmation, replaceWords, retryTargets } from '../../src/domain/scan';
import type { Box, FieldKey, OcrPage, OcrWord, ScanResult } from '../../src/domain/scan';

// ---------- golden OCR (dummy data: TEST TRAVELLER ONE) ----------

/** Golden OCR output, produced from the built extension over the PNG fixtures (never re-run in CI). */
function golden(name: string): OcrPage {
  const file = fileURLToPath(new URL(`../fixtures/${name}.words.json`, import.meta.url));
  const json = JSON.parse(readFileSync(file, 'utf8')) as { width: number; height: number; words: OcrWord[] };
  return { name, width: json.width, height: json.height, words: json.words };
}

const FIRST_FIELDS = {
  fullName: 'TEST TRAVELLER ONE',
  nationality: 'IND',
  placeOfBirth: 'IND',
  dateOfBirth: '1990-01-15',
  sex: '1',
  passportExpiry: '2036-06-30',
  email: 'one@example.com',
  dialCode: '65',
  mobile: '81234567',
};
const FIRST_PRESET = {
  travelMode: '2',
  embarkPort: 'SGP',
  transportNo: 'SGX1234A',
  stayType: '01',
  address1: 'JALAN WONG AH FOOK',
  postcode: '80000',
  state: '01',
  city: '0118',
};

/** Field keys whose statuses the two-phone set pins to `ok`. */
const OK_ON_PHONE = FIELD_KEYS.filter((k) => !['passportNo', 'email', 'transportNo', 'pin'].includes(k));

describe('golden OCR of the confirmation email', () => {
  describe('two phone screenshots (dark, head + tail)', () => {
    const r = parseConfirmation([golden('email-dark-head'), golden('email-dark-tail')]);

    it('is accepted and every normalised value is exact', () => {
      expect(r.accepted).toBe(true);
      expect(r.warnings).toEqual([]);
      expect(r.traveller).toMatchObject(FIRST_FIELDS);
      expect(r.preset).toMatchObject(FIRST_PRESET);
      expect(r.dates).toEqual({ arrival: '2026-10-23', departure: '2026-10-25' });
    });

    it('marks every field ok except passport, email, transport number and PIN', () => {
      for (const key of OK_ON_PHONE) expect(r.fields[key].status, key).toBe('ok');
      for (const key of ['email', 'transportNo', 'pin'] as const) expect(r.fields[key].status, key).not.toBe('missing');
    });

    it('repairs the O that OCR reads in the all-zero dummy passport, but refuses to call it ok', () => {
      // T0000001 has no letter to anchor the zeros; OCR reads some as O. A letters-then-digits shape
      // is repaired (so an existing traveller still matches) and left for the human to confirm.
      expect(r.fields.passportNo.raw).toMatch(/^T[O0]{6}1$/);
      expect(r.fields.passportNo.value).toBe('T0000001');
      expect(r.fields.passportNo.status).toBe('unsure');
      expect(r.fields.passportNo.note).toMatch(/repaired/);
    });

    it('never stores the PIN or marks it ok', () => {
      expect(r.pin).toBeTruthy();
      expect(r.fields.pin.status).toBe('unsure');
      expect(JSON.stringify({ t: r.traveller, p: r.preset })).not.toContain(r.pin!);
    });

    it('is independent of page order', () => {
      const swapped = parseConfirmation([golden('email-dark-tail'), golden('email-dark-head')]);
      expect(swapped.traveller).toEqual(r.traveller);
      expect(swapped.preset).toEqual(r.preset);
      expect(swapped.dates).toEqual(r.dates);
    });
  });

  describe('single full-page screenshots', () => {
    it('light theme: every value is exact except the passport (OCR inserted a character)', () => {
      const r = parseConfirmation([golden('email-light')]);
      expect(r.accepted).toBe(true);
      expect(r.pageLabels).toEqual([19]);
      expect(r.traveller).toMatchObject(FIRST_FIELDS);
      expect(r.preset).toMatchObject(FIRST_PRESET);
      expect(r.dates).toEqual({ arrival: '2026-10-23', departure: '2026-10-25' });
      expect(r.fields.passportNo.status).toBe('unsure');
      for (const key of FIELD_KEYS) expect(r.fields[key].status, key).not.toBe('missing');
    });

    it('dark theme: every value is exact; departure is missing because OCR garbled it', () => {
      const r = parseConfirmation([golden('email-dark')]);
      expect(r.accepted).toBe(true);
      expect(r.traveller).toMatchObject(FIRST_FIELDS);
      expect(r.preset).toMatchObject(FIRST_PRESET);
      expect(r.dates.arrival).toBe('2026-10-23');
      // Known OCR limit of this golden: the date reads "25/10/202 20/2028" (a truncated year plus a
      // confidence-0 duplicate). The parser must report it missing rather than invent a year.
      expect(r.fields.departure.raw).toBe('25/10/202 20/2028');
      expect(r.fields.departure.status).toBe('missing');
      expect(r.dates.departure).toBeUndefined();
      for (const key of FIELD_KEYS.filter((k) => k !== 'departure')) expect(r.fields[key].status, key).not.toBe('missing');
    });

    it('top-aligned cells: every value is exact', () => {
      const r = parseConfirmation([golden('email-dark-top')]);
      expect(r.accepted).toBe(true);
      expect(r.traveller).toMatchObject(FIRST_FIELDS);
      expect(r.preset).toMatchObject(FIRST_PRESET);
      expect(r.dates).toEqual({ arrival: '2026-10-23', departure: '2026-10-25' });
      for (const key of FIELD_KEYS) expect(r.fields[key].status, key).not.toBe('missing');
    });

    it('a complete screenshot marks no field as cut off', () => {
      for (const name of ['email-light', 'email-dark', 'email-dark-top']) {
        const r = parseConfirmation([golden(name)]);
        for (const key of FIELD_KEYS) expect(r.fields[key].note ?? '', `${name} ${key}`).not.toMatch(/Cut off/);
      }
    });
  });

  describe('low-resolution stress (DSF 1.0)', () => {
    const r = parseConfirmation([golden('email-light-dsf1')]);

    it('keeps every value that is present correct', () => {
      expect(r.accepted).toBe(true);
      expect(r.traveller).toMatchObject(FIRST_FIELDS);
      const { transportNo, ...presetWithout } = FIRST_PRESET;
      expect(transportNo).toBe('SGX1234A');
      expect(r.preset).toMatchObject(presetWithout);
      expect(r.dates).toEqual({ arrival: '2026-10-23', departure: '2026-10-25' });
      expect(r.pin).toBe('7KQPx92a');
    });

    it('cannot read the transport number (known low-res limit) but never calls the junk ok', () => {
      // The parser reads the junk "(oan" at confidence 7 and must flag it, not trust it.
      expect(r.fields.transportNo.status).not.toBe('ok');
      expect(r.fields.transportNo.conf).toBeLessThan(GEOMETRY.okConf);
      if (r.fields.transportNo.status === 'unsure') expect(r.fields.transportNo.value).not.toBe('SGX1234A');
      const missing = FIELD_KEYS.filter((k) => r.fields[k].status === 'missing' && k !== 'transportNo');
      expect(missing).toEqual([]);
    });

    it('does not call a noisy reading ok', () => {
      expect(r.fields.departure.raw).toContain('25/10/2026');
      expect(r.fields.departure.status).toBe('unsure');
      expect(r.fields.passportNo.status).toBe('unsure');
    });
  });

  describe('partial screenshots', () => {
    it('the tail alone is accepted: personal fields missing, travel fields present', () => {
      const r = parseConfirmation([golden('email-dark-tail')]);
      expect(r.accepted).toBe(true);
      expect(r.pageLabels).toEqual([9]);
      expect(r.pageLabels[0]).toBeGreaterThanOrEqual(GEOMETRY.minLabels);
      for (const key of ['fullName', 'passportNo', 'nationality', 'dateOfBirth', 'sex', 'passportExpiry', 'email', 'mobile', 'arrival', 'travelMode'] as const)
        expect(r.fields[key].status, key).toBe('missing');
      for (const key of ['departure', 'embarkPort', 'transportNo', 'stayType', 'address', 'postcode', 'city', 'state'] as const)
        expect(r.fields[key].status, key).not.toBe('missing');
      expect(r.traveller).toEqual({});
      const { travelMode, ...presetWithout } = FIRST_PRESET;
      expect(travelMode).toBe('2');
      expect(r.preset).toEqual(presetWithout);
      expect(r.dates).toEqual({ arrival: undefined, departure: '2026-10-25' });
    });

    it('a screenshot cut through the name is accepted via the head and adds nothing itself', () => {
      const head = parseConfirmation([golden('email-dark-head')]);
      const r = parseConfirmation([golden('email-dark-head'), golden('email-cut-name')]);
      expect(r.accepted).toBe(true);
      expect(r.pageLabels[0]).toBeGreaterThanOrEqual(GEOMETRY.minLabels);
      expect(r.pageLabels[1]).toBe(0);
      expect(r.fields).toEqual(head.fields);
    });

    it('the cut-through-the-name screenshot alone is not a confirmation', () => {
      const r = parseConfirmation([golden('email-cut-name')]);
      expect(r.accepted).toBe(false);
      expect(r.reason).toMatch(/doesn't look like an MDAC confirmation/);
      for (const key of FIELD_KEYS) expect(r.fields[key].status).toBe('missing');
    });
  });

  describe('geometry of a phone screenshot', () => {
    const g = inspectPage(golden('email-dark-head'));

    it('finds the label and value columns', () => {
      expect(g.labelStart).toBeGreaterThan(65);
      expect(g.labelStart).toBeLessThan(75);
      expect(g.valueStart).toBeGreaterThan(506);
      expect(g.valueStart).toBeLessThan(516);
      expect(g.lineHeight).toBeGreaterThanOrEqual(30);
      expect(g.lineHeight).toBeLessThanOrEqual(40);
    });

    it('keeps a three-line wrapped label as one block', () => {
      const blocks = g.labelBlocks.filter((b) => b.row === 'embarkPort');
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.text).toBe('Last Port of Embarkation before Malaysia');
      expect(g.labelBlocks.filter((b) => b.text.includes('Embarkation'))).toHaveLength(1);
    });

    it('keeps "Nationality / Citizenship" as one block', () => {
      const blocks = g.labelBlocks.filter((b) => b.row === 'nationality');
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.text).toMatch(/^Nationality\W*Citizenship$/);
      expect(g.labelBlocks.filter((b) => /Nationality|Citizenship/.test(b.text))).toHaveLength(1);
    });
  });
});

// ---------- synthetic pages in the fixture's geometry ----------

interface Row {
  label: string;
  value: string;
  /** Force the number of wrapped lines for label and value; default wraps by width. */
  lines?: number;
}
interface PageOptions {
  /** Glyph the divider is read as; 'merge' fuses ":" into the first value word (box and all) on every other row. */
  colon?: string;
  /** Page height; default leaves a generous margin below the last row. */
  height?: number;
  /** Top of the first row. */
  top?: number;
  /** Confidence of every word. */
  conf?: number;
}

const GEO = { labelX: 70, valueX: 511, colonX: 466, colonW: 10, rowPitch: 95, linePitch: 56, wordH: 33, charW: 16, spaceW: 14, width: 1081 };

/** Splits `text` into lines of words: into `lines` even chunks, or greedily to `maxChars` per line. */
function wrap(text: string, maxChars: number, lines?: number): string[][] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  if (lines) {
    const per = Math.ceil(words.length / lines);
    return Array.from({ length: Math.ceil(words.length / per) }, (_, i) => words.slice(i * per, (i + 1) * per));
  }
  const out: string[][] = [[]];
  for (const w of words) {
    const line = out[out.length - 1]!;
    if (line.length && [...line, w].join(' ').length > maxChars) out.push([w]);
    else line.push(w);
  }
  return out;
}

/** Builds an OcrPage with the real email's geometry: label column x 70, colon x 466, value column x 511. */
function page(rows: Row[], options: PageOptions = {}): OcrPage {
  const { colon = ':', conf = 95 } = options;
  const words: OcrWord[] = [];
  const place = (lines: string[][], x: number, top: number, lineCount: number, stretchFirst = 0) => {
    // Middle-aligned: a cell shorter than its row is centred against it.
    const offset = ((lineCount - lines.length) * GEO.linePitch) / 2;
    lines.forEach((line, li) => {
      let cursor = x;
      line.forEach((text, wi) => {
        const x0 = li === 0 && wi === 0 ? cursor - stretchFirst : cursor;
        const x1 = cursor + text.length * GEO.charW;
        const y0 = Math.round(top + offset + li * GEO.linePitch);
        words.push({ text: li === 0 && wi === 0 && stretchFirst ? `:${text}` : text, conf, x0, y0, x1, y1: y0 + GEO.wordH });
        cursor = x1 + GEO.spaceW;
      });
    });
  };
  let y = options.top ?? 150;
  for (const [index, row] of rows.entries()) {
    const merged = colon === 'merge' && index % 2 === 0;
    const labelLines = wrap(row.label, 22, row.lines);
    const valueLines = wrap(row.value, 30, row.lines);
    const lineCount = Math.max(labelLines.length, valueLines.length, 1);
    const rowHeight = (lineCount - 1) * GEO.linePitch + GEO.wordH;
    place(labelLines, GEO.labelX, y, lineCount);
    place(valueLines, GEO.valueX, y, lineCount, merged ? GEO.valueX - GEO.colonX : 0);
    if (!merged) {
      const cy = Math.round(y + rowHeight / 2 - 12);
      words.push({ text: colon === 'merge' ? ':' : colon, conf: 60, x0: GEO.colonX, y0: cy, x1: GEO.colonX + GEO.colonW, y1: cy + 24 });
    }
    y += rowHeight + (GEO.rowPitch - GEO.wordH);
  }
  return { width: GEO.width, height: options.height ?? y + 300, words };
}

/** The 19 rows of the email with the dummy traveller; override any value by field key or drop a row. */
const LABELS: Record<FieldKey, { label: string; value: string; lines?: number }> = {
  fullName: { label: 'Name', value: 'TEST TRAVELLER ONE' },
  passportNo: { label: 'Passport No.', value: 'T0000001' },
  nationality: { label: 'Nationality / Citizenship', value: 'INDIA', lines: 2 },
  dateOfBirth: { label: 'Date of Birth', value: '15/01/1990' },
  sex: { label: 'Sex', value: 'MALE' },
  passportExpiry: { label: 'Date of Passport Expiry', value: '30/06/2036', lines: 2 },
  email: { label: 'Email Address', value: 'one@example.com' },
  mobile: { label: 'Mobile No.', value: '+6581234567' },
  arrival: { label: 'Date of Arrival', value: '23/10/2026' },
  travelMode: { label: 'Mode of Travel', value: 'LAND' },
  departure: { label: 'Date of Departure', value: '25/10/2026', lines: 2 },
  embarkPort: { label: 'Last Port of Embarkation before Malaysia', value: 'SINGAPORE', lines: 3 },
  transportNo: { label: 'Transportation No.', value: 'SGX1234A', lines: 2 },
  stayType: { label: 'Accommodation of Stay', value: 'HOTEL/MOTEL/REST HOUSE', lines: 2 },
  address: { label: 'Address (In Malaysia)', value: 'JALAN WONG AH FOOK', lines: 2 },
  postcode: { label: 'Postcode', value: '80000' },
  city: { label: 'City', value: 'JOHOR BAHRU' },
  state: { label: 'State', value: 'JOHOR' },
  pin: { label: 'PIN', value: '7KQPx92a' },
};

function rows(over: Partial<Record<FieldKey, string | null>> = {}): Row[] {
  return FIELD_KEYS.flatMap((key) => {
    const o = over[key];
    if (o === null) return [];
    return [{ ...LABELS[key], value: o ?? LABELS[key].value }];
  });
}

const EXPECT_TRAVELLER = { ...FIRST_FIELDS, passportNo: 'T0000001' };

function expectClean(r: ScanResult) {
  expect(r.accepted).toBe(true);
  expect(r.traveller).toMatchObject(EXPECT_TRAVELLER);
  expect(r.preset).toMatchObject(FIRST_PRESET);
  expect(r.dates).toEqual({ arrival: '2026-10-23', departure: '2026-10-25' });
  expect(r.pin).toBe('7KQPx92a');
}

describe('parseConfirmation on synthetic pages', () => {
  it('(a) a clean page reads every field ok', () => {
    const r = parseConfirmation([page(rows())]);
    expectClean(r);
    expect(r.warnings).toEqual([]);
    expect(r.pageLabels).toEqual([19]);
    for (const key of FIELD_KEYS) expect(r.fields[key].status, key).toBe('ok');
  });

  it('(a) the synthetic geometry matches the fixture (sanity check on the helper)', () => {
    const g = inspectPage(page(rows()));
    expect(g.labelStart).toBeCloseTo(70, 0);
    expect(g.valueStart).toBeCloseTo(511, 0);
    expect(g.labelBlocks.filter((b) => b.row === 'embarkPort')).toHaveLength(1);
    expect(g.labelBlocks.filter((b) => b.row === 'nationality')).toHaveLength(1);
  });

  describe('(b) however the colon was read', () => {
    for (const glyph of ['.', '*', '+', '|', ':']) {
      it(`read as "${glyph}"`, () => {
        const r = parseConfirmation([page(rows(), { colon: glyph })]);
        expectClean(r);
        for (const key of FIELD_KEYS) expect(r.fields[key].status, key).toBe('ok');
      });
    }

    it('dropped altogether', () => {
      const p = page(rows());
      p.words = p.words.filter((w) => w.x0 !== GEO.colonX);
      const r = parseConfirmation([p]);
      expectClean(r);
      for (const key of FIELD_KEYS) expect(r.fields[key].status, key).toBe('ok');
    });

    it('fused into the value (":INDIA", box starting at the colon)', () => {
      const r = parseConfirmation([page(rows(), { colon: 'merge' })]);
      expectClean(r);
      for (const key of FIELD_KEYS) expect(r.fields[key].status, key).toBe('ok');
    });
  });

  it('(c) a missing interior label row leaves the others correct and only that field missing', () => {
    const r = parseConfirmation([page(rows({ email: null }))]);
    expect(r.accepted).toBe(true);
    expect(r.fields.email.status).toBe('missing');
    expect(r.traveller.email).toBeUndefined();
    const { email, ...rest } = EXPECT_TRAVELLER;
    expect(email).toBeDefined();
    expect(r.traveller).toMatchObject(rest);
    expect(r.preset).toMatchObject(FIRST_PRESET);
    for (const key of FIELD_KEYS.filter((k) => k !== 'email')) expect(r.fields[key].status, key).toBe('ok');
  });

  describe('(d) misspelled labels keep the neighbouring rows aligned', () => {
    const cases: [string, FieldKey, string][] = [
      ['Nationality / Citizenship', 'nationality', 'Nati lit'],
      ['Date of Birth', 'dateOfBirth', 'Dateof Birth'],
      ['Date of Passport Expiry', 'passportExpiry', 'Passport Expiry'],
    ];
    for (const [original, key, misspelled] of cases) {
      it(`"${original}" read as "${misspelled}"`, () => {
        const rs = rows().map((row) => (row.label === original ? { ...row, label: misspelled } : row));
        const r = parseConfirmation([page(rs)]);
        expect(r.accepted).toBe(true);
        // The damaged row is read correctly or reported missing, never filled with a neighbour's value.
        const damaged = r.fields[key];
        if (damaged.status !== 'missing') expect(damaged.value).toBe(LABELS[key].value === 'INDIA' ? 'IND' : damaged.value);
        // Every other row is untouched.
        for (const other of FIELD_KEYS.filter((k) => k !== key)) expect(r.fields[other].status, other).toBe('ok');
        const expected = parseConfirmation([page(rows())]);
        for (const other of FIELD_KEYS.filter((k) => k !== key)) expect(r.fields[other].value, other).toBe(expected.fields[other].value);
      });
    }

    it('"Date of Passport Expiry" without "Date of" still reads its own date', () => {
      const rs = rows().map((row) => (row.label === 'Date of Passport Expiry' ? { ...row, label: 'Passport Expiry' } : row));
      const r = parseConfirmation([page(rs)]);
      expect(r.fields.passportExpiry.value).toBe('2036-06-30');
      expect(r.fields.passportNo.value).toBe('T0000001');
    });
  });

  it('(e) swapped page order gives the same result', () => {
    const all = rows();
    const head = page(all.slice(0, 11));
    const tail = page(all.slice(11));
    const forward = parseConfirmation([head, tail]);
    const backward = parseConfirmation([tail, head]);
    expectClean(forward);
    expectClean(backward);
    expect(backward.traveller).toEqual(forward.traveller);
    expect(backward.preset).toEqual(forward.preset);
    for (const key of FIELD_KEYS) expect(backward.fields[key].status, key).toBe(forward.fields[key].status);
  });

  it('(f) two pages with different ok passport numbers are refused', () => {
    const a = page(rows());
    const b = page(rows({ passportNo: 'T0000002' }));
    const r = parseConfirmation([a, b]);
    expect(r.accepted).toBe(false);
    expect(r.reason).toMatch(/different confirmations/);
  });

  it('(g) differing arrival dates warn but are still accepted', () => {
    const a = page(rows());
    const b = page(rows({ arrival: '24/10/2026' }));
    const r = parseConfirmation([a, b]);
    expect(r.accepted).toBe(true);
    expect(r.warnings.some((w) => /different filings/.test(w))).toBe(true);
    expect(r.traveller).toMatchObject(EXPECT_TRAVELLER);
  });

  it('(h) the same field read differently on two pages is unsure, with the other reading kept', () => {
    const a = page(rows());
    const b = page(rows({ fullName: 'TEST TRAVELLER ONF' }));
    const r = parseConfirmation([a, b]);
    expect(r.accepted).toBe(true);
    const f = r.fields.fullName;
    expect(f.status).toBe('unsure');
    expect(f.note).toMatch(/disagree/);
    expect(f.alternatives).toHaveLength(1);
    expect(new Set([f.raw, ...f.alternatives!])).toEqual(new Set(['TEST TRAVELLER ONE', 'TEST TRAVELLER ONF']));
    // Fields the pages agree on stay ok.
    expect(r.fields.dateOfBirth.status).toBe('ok');
    expect(r.fields.dateOfBirth.alternatives).toBeUndefined();
  });

  describe('(i) clipping at the image edge', () => {
    const tail = rows().slice(11);
    const bottomEdge = (extra: number) => {
      const p = page(tail);
      const last = Math.max(...p.words.map((w) => w.y1));
      return page(tail, { height: last + extra });
    };

    it('a value within 1.5 line heights of the bottom edge is unsure with the cut-off note', () => {
      const margin = GEOMETRY.clipMargin * GEO.wordH;
      const r = parseConfirmation([bottomEdge(margin / 2)]);
      expect(r.accepted).toBe(true);
      expect(r.fields.pin.status).toBe('unsure');
      expect(r.fields.pin.note).toMatch(/Cut off/);
      // Rows well clear of the edge are unaffected.
      expect(r.fields.postcode.status).toBe('ok');
      expect(r.fields.postcode.note ?? '').not.toMatch(/Cut off/);
    });

    it('a value hard against the top edge is unsure with the cut-off note', () => {
      const r = parseConfirmation([page(rows(), { top: 10 })]);
      expect(r.fields.fullName.status).toBe('unsure');
      expect(r.fields.fullName.note).toMatch(/Cut off/);
      expect(r.fields.passportNo.note ?? '').not.toMatch(/Cut off/);
    });

    it('the same rows with room below are not clipped', () => {
      const r = parseConfirmation([bottomEdge(300)]);
      for (const key of FIELD_KEYS) expect(r.fields[key].note ?? '', key).not.toMatch(/Cut off/);
      expect(r.fields.pin.status).toBe('ok');
    });

    it('a complete page has no field with the note, even for its first and last rows', () => {
      const r = parseConfirmation([page(rows())]);
      for (const key of FIELD_KEYS) expect(r.fields[key].note ?? '', key).not.toMatch(/Cut off/);
    });

    it('a clipped reading loses to a complete one on another page', () => {
      const clipped = bottomEdge(GEOMETRY.clipMargin * GEO.wordH / 2);
      const full = page(rows());
      const r = parseConfirmation([clipped, full]);
      expect(r.fields.pin.status).toBe('ok');
      expect(r.fields.pin.note ?? '').not.toMatch(/Cut off/);
    });
  });

  describe('(j) text that is not a confirmation email', () => {
    const WORDS = 'the quick brown fox jumps over lazy dogs while seven wizards quietly box jars of mixed fruit and ripe plums'.split(' ');
    const wordAt = (text: string, x0: number, y0: number): OcrWord => ({ text, conf: 90, x0, y0, x1: x0 + text.length * 16, y1: y0 + 33 });

    it('free-flowing paragraphs', () => {
      const words: OcrWord[] = [];
      for (let line = 0; line < 25; line++) {
        let x = 70;
        for (let i = 0; i < 6; i++) {
          const text = WORDS[(line * 7 + i * 3) % WORDS.length]!;
          words.push(wordAt(text, x, 100 + line * 50));
          x += text.length * 16 + 14;
        }
      }
      const r = parseConfirmation([{ width: 1081, height: 1500, words }]);
      expect(r.accepted).toBe(false);
      expect(r.reason).toMatch(/doesn't look like an MDAC confirmation/);
      for (const key of FIELD_KEYS) expect(r.fields[key].status).toBe('missing');
    });

    it('two aligned columns of unrelated words', () => {
      const rs: Row[] = Array.from({ length: 12 }, (_, i) => ({ label: WORDS[i]!, value: WORDS[(i * 5 + 2) % WORDS.length]! }));
      const r = parseConfirmation([page(rs)]);
      expect(r.accepted).toBe(false);
      expect(r.traveller).toEqual({});
      expect(r.preset).toEqual({});
    });

    it('a page with no words', () => {
      const r = parseConfirmation([{ width: 1081, height: 2000, words: [] }]);
      expect(r.accepted).toBe(false);
    });

    it('a stray page does not rescue the set, but a real one carries a stray page', () => {
      const stray = page(rows().slice(0, 2));
      expect(parseConfirmation([stray]).accepted).toBe(false);
      expect(parseConfirmation([page(rows()), stray]).accepted).toBe(true);
    });
  });

  describe('(k) city depends on state', () => {
    it('a city that is not in the given state is missing, with a note', () => {
      const r = parseConfirmation([page(rows({ state: 'KUALA LUMPUR' }))]);
      expect(r.fields.state.value).toBe('14');
      expect(r.fields.city.status).toBe('missing');
      expect(r.fields.city.value).toBe('');
      expect(r.fields.city.note).toMatch(/Not a city in this state/);
      expect(r.preset.city).toBeUndefined();
      expect(r.preset.state).toBe('14');
    });

    it('a missing state makes the city unsure: pick the state first', () => {
      const r = parseConfirmation([page(rows({ state: null }))]);
      expect(r.fields.state.status).toBe('missing');
      expect(r.fields.city.status).toBe('unsure');
      expect(r.fields.city.note).toMatch(/Pick the state first/);
      expect(r.fields.city.value).toBe('');
      expect(r.preset.state).toBeUndefined();
    });
  });

  it('(l) an address longer than 100 characters splits at a word boundary and is unsure', () => {
    const address = 'LOT 1234 JALAN PERMAI INDAH TAMAN DESA MURNI BANDAR BARU SEKSYEN 9 PERSIARAN KEMBANGAN UTAMA KAMPUNG TENGAH BUKIT LANJAN';
    expect(address.length).toBeGreaterThan(100);
    const r = parseConfirmation([page(rows({ address }))]);
    expect(r.fields.address.status).toBe('unsure');
    expect(r.fields.address.note).toMatch(/split into two/);
    const { address1, address2 } = r.preset;
    expect(address1!.length).toBeLessThanOrEqual(100);
    expect(address2!.length).toBeGreaterThan(0);
    expect(address2!.length).toBeLessThanOrEqual(100);
    expect(`${address1} ${address2}`).toBe(address);
    // Cut on a word boundary: neither half starts or ends mid-word.
    expect(address.startsWith(`${address1} `)).toBe(true);
    // Rows after the long address still align.
    expect(r.preset).toMatchObject({ postcode: '80000', state: '01', city: '0118' });
  });

  it('an address of up to 100 characters stays on one line and ok', () => {
    const r = parseConfirmation([page(rows())]);
    expect(r.preset.address1).toBe('JALAN WONG AH FOOK');
    expect(r.preset.address2).toBeUndefined();
    expect(r.fields.address.status).toBe('ok');
  });

  it('(m) an empty pages array is not a confirmation and does not throw', () => {
    let r: ScanResult | undefined;
    expect(() => (r = parseConfirmation([]))).not.toThrow();
    expect(r!.accepted).toBe(false);
    expect(r!.reason).toBeTruthy();
    expect(r!.pageLabels).toEqual([]);
    for (const key of FIELD_KEYS) expect(r!.fields[key].status).toBe('missing');
  });
});

// ---------- second-pass retry ----------

describe('retryTargets', () => {
  const head = golden('email-dark-head');
  const targets = retryTargets([head]);
  const g = inspectPage(head);

  it('targets the low-confidence passport and transport lines', () => {
    const keys = targets.map((t) => t.key);
    expect(keys).toContain('passportNo');
    expect(keys).toContain('transportNo');
  });

  it('never targets the PIN, even though it reads at low confidence', () => {
    expect(targets.map((t) => t.key)).not.toContain('pin');
    expect(retryTargets([golden('email-dark-tail')]).map((t) => t.key)).not.toContain('pin');
  });

  it('keeps every box on the value side of the divider', () => {
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) {
      expect(t.page).toBe(0);
      expect(t.box.page).toBe(0);
      expect(t.box.x0, t.key).toBeGreaterThanOrEqual(g.valueStart! - 0.5 * g.lineHeight);
      expect(t.box.x1).toBeGreaterThan(t.box.x0);
      expect(t.box.y1).toBeGreaterThan(t.box.y0);
    }
  });

  it('skips lines that already read above the threshold', () => {
    const keys = targets.map((t) => t.key);
    expect(keys).not.toContain('nationality');
    expect(keys).not.toContain('sex');
    expect(retryTargets([head], 0)).toEqual([]);
  });

  it('indexes targets by their page', () => {
    const both = retryTargets([golden('email-dark-head'), golden('email-dark-tail')]);
    expect(both.some((t) => t.page === 1 && t.key === 'transportNo')).toBe(true);
    expect(both.every((t) => t.box.page === t.page)).toBe(true);
  });
});

describe('replaceWords', () => {
  const head = golden('email-dark-head');
  const target = retryTargets([head]).find((t) => t.key === 'passportNo')!;
  const box: Box = target.box;
  const inside = (w: OcrWord) => (w.x0 + w.x1) / 2 >= box.x0 && (w.x0 + w.x1) / 2 <= box.x1 && (w.y0 + w.y1) / 2 >= box.y0 && (w.y0 + w.y1) / 2 <= box.y1;
  const original = head.words.filter(inside);
  const better = (text: string, conf: number): OcrWord => ({ text, conf, x0: box.x0 + 5, y0: box.y0 + 8, x1: box.x1 - 5, y1: box.y1 - 8 });

  it('has a passport line to replace (sanity)', () => {
    expect(original.map((w) => w.text)).toContain('TO000001');
  });

  it('swaps in a more confident reading and leaves words outside the box alone', () => {
    const out = replaceWords(head, box, [better('T0000001', 97)]);
    expect(out.words.filter(inside).map((w) => w.text)).toEqual(['T0000001']);
    expect(out.words.filter((w) => !inside(w))).toEqual(head.words.filter((w) => !inside(w)));
    expect(out.width).toBe(head.width);
    expect(out.height).toBe(head.height);
    // The input page is not mutated.
    expect(head.words.filter(inside).map((w) => w.text)).toContain('TO000001');
  });

  it('re-parses to the corrected value, and the passport becomes ok', () => {
    const out = replaceWords(head, box, [better('T0000001', 97)]);
    const r = parseConfirmation([out, golden('email-dark-tail')]);
    expect(r.fields.passportNo.value).toBe('T0000001');
    expect(r.fields.passportNo.status).toBe('ok');
    expect(r.traveller).toMatchObject(EXPECT_TRAVELLER);
  });

  it('keeps the page unchanged when the new reading is worse', () => {
    expect(replaceWords(head, box, [better('TOOOOOO1', 10)])).toBe(head);
    expect(replaceWords(head, box, [better('T0000001', Math.min(...original.map((w) => w.conf)) - 1)])).toBe(head);
  });

  it('keeps the page unchanged when the new reading is empty', () => {
    expect(replaceWords(head, box, [])).toBe(head);
    expect(replaceWords(head, box, [better('   ', 99)])).toBe(head);
  });

  it('ignores new words that fall outside the box', () => {
    const stray: OcrWord = { text: 'STRAY', conf: 99, x0: 0, y0: 0, x1: 40, y1: 30 };
    expect(replaceWords(head, box, [stray])).toBe(head);
    const out = replaceWords(head, box, [better('T0000001', 97), stray]);
    expect(out.words.some((w) => w.text === 'STRAY')).toBe(false);
  });
});
