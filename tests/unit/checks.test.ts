import { describe, expect, it } from 'vitest';
import { checkPreset, checkRun, checkTraveller, type Warning } from '../../src/domain/checks';
import { SEEDED_PRESETS } from '../../src/domain/seeds';
import { preset, traveller } from './helpers';

const TODAY = '2026-10-22';
const fields = (w: Warning[]) => w.map((x) => x.field);
const run = (over: { t?: Parameters<typeof traveller>[0]; p?: Parameters<typeof preset>[0]; arrival?: string; departure?: string; transport?: string } = {}) =>
  checkRun(
    traveller(over.t),
    preset(over.p),
    { arrival: over.arrival ?? '2026-10-23', departure: over.departure ?? '2026-10-25' },
    over.transport ?? '',
    TODAY,
  );

describe('checkRun happy path', () => {
  it('a complete dummy run has no warnings', () => {
    expect(run()).toEqual([]);
  });
});

describe('arrival window', () => {
  it('today and today+2 are fine', () => {
    expect(fields(run({ arrival: '2026-10-22', departure: '2026-10-24' }))).not.toContain('arrival');
    expect(fields(run({ arrival: '2026-10-24', departure: '2026-10-26' }))).not.toContain('arrival');
  });
  it('today+3 warns and says when to file', () => {
    const w = run({ arrival: '2026-10-25', departure: '2026-10-27' }).find((x) => x.field === 'arrival');
    expect(w?.message).toMatch(/3 days before arrival/);
    expect(w?.message).toContain('23 Oct 2026');
  });
  it('a past arrival warns', () => {
    const w = run({ arrival: '2026-10-21', departure: '2026-10-25' }).find((x) => x.field === 'arrival');
    expect(w?.message).toMatch(/past/);
  });
  it('a missing or invalid arrival warns', () => {
    expect(fields(run({ arrival: '' }))).toContain('arrival');
    expect(fields(run({ arrival: '2026-02-30' }))).toContain('arrival');
  });
});

describe('departure', () => {
  it('before arrival warns', () => {
    expect(run({ arrival: '2026-10-24', departure: '2026-10-23' }).some((x) => x.field === 'departure')).toBe(true);
  });
  it('same day as arrival is fine', () => {
    expect(fields(run({ arrival: '2026-10-23', departure: '2026-10-23' }))).not.toContain('departure');
  });
  it('missing warns', () => {
    expect(fields(run({ departure: '' }))).toContain('departure');
  });
});

describe('passport', () => {
  it('expiring less than 6 months after arrival warns', () => {
    const w = run({ t: { passportExpiry: '2027-03-01' } });
    expect(w.find((x) => x.field === 'passportExpiry')?.message).toMatch(/6 months/);
  });
  it('exactly 6 months after arrival is fine; one day short warns', () => {
    expect(fields(run({ t: { passportExpiry: '2027-04-23' } }))).not.toContain('passportExpiry');
    expect(fields(run({ t: { passportExpiry: '2027-04-22' } }))).toContain('passportExpiry');
  });
  it('an expired passport warns once (as expired, not as 6-month)', () => {
    const w = run({ t: { passportExpiry: '2026-10-01' } }).filter((x) => x.field === 'passportExpiry');
    expect(w).toHaveLength(1);
    expect(w[0]!.message).toMatch(/expired/);
  });
  it('expiring today is not expired', () => {
    const w = checkTraveller(traveller({ passportExpiry: TODAY }), TODAY);
    expect(fields(w)).not.toContain('passportExpiry');
  });
  it('more than 12 characters (spaces ignored) warns', () => {
    expect(fields(checkTraveller(traveller({ passportNo: 'T000000000001' }), TODAY))).toContain('passportNo');
    expect(fields(checkTraveller(traveller({ passportNo: 'T000 0000 0001' }), TODAY))).not.toContain('passportNo');
  });
});

describe('transport number', () => {
  it('missing in both preset and run warns', () => {
    expect(fields(run({ p: { transportNo: '' } }))).toContain('transportNo');
  });
  it('a per-run value satisfies a blank preset', () => {
    expect(fields(run({ p: { transportNo: '' }, transport: 'SGX1' }))).not.toContain('transportNo');
  });
  it('whitespace only counts as missing', () => {
    expect(fields(run({ p: { transportNo: '  ' }, transport: ' ' }))).toContain('transportNo');
  });
});

describe('checkTraveller', () => {
  const only = (over: Parameters<typeof traveller>[0]) => fields(checkTraveller(traveller(over), TODAY));
  it('flags blank name and passport', () => {
    expect(only({ fullName: ' ' })).toEqual(['fullName']);
    expect(only({ passportNo: '' })).toEqual(['passportNo']);
  });
  it('flags a bad or future date of birth', () => {
    expect(only({ dateOfBirth: '' })).toEqual(['dateOfBirth']);
    expect(only({ dateOfBirth: '2026-02-30' })).toEqual(['dateOfBirth']);
    expect(only({ dateOfBirth: '2026-10-22' })).toEqual(['dateOfBirth']);
  });
  it('flags unknown nationality / place of birth / dial code', () => {
    expect(only({ nationality: 'QQQ' })).toEqual(['nationality']);
    expect(only({ placeOfBirth: '' })).toEqual(['placeOfBirth']);
    expect(only({ dialCode: '9999' })).toEqual(['dialCode']);
  });
  it('flags an invalid sex code', () => {
    expect(only({ sex: '3' as never })).toEqual(['sex']);
  });
  it('validates email with the form regex', () => {
    expect(only({ email: 'one@example.com' })).toEqual([]);
    expect(only({ email: 'first.last-1@sub.example.com' })).toEqual([]);
    for (const bad of ['', 'one', 'one@', 'one@example', 'a b@example.com', '@example.com', 'one@example.c']) {
      expect(only({ email: bad }), bad).toEqual(['email']);
    }
  });
  it('flags empty or over-long mobile', () => {
    expect(only({ mobile: '' })).toEqual(['mobile']);
    expect(only({ mobile: 'abc' })).toEqual(['mobile']);
    expect(only({ mobile: '1'.repeat(13) })).toEqual(['mobile']);
    expect(only({ mobile: '+65 8123 4567' })).toEqual([]);
  });
});

describe('checkPreset', () => {
  const only = (over: Parameters<typeof preset>[0]) => fields(checkPreset(preset(over)));
  it('a good preset has no warnings', () => expect(checkPreset(preset())).toEqual([]));
  it('flags unknown mode, port and stay type', () => {
    expect(only({ travelMode: '4' as never })).toEqual(['travelMode']);
    expect(only({ embarkPort: 'QQQ' })).toEqual(['embarkPort']);
    expect(only({ stayType: '03' as never })).toEqual(['stayType']);
  });
  it('requires an address of at least three words', () => {
    expect(only({ address1: '' })).toEqual(['address1']);
    expect(only({ address1: 'JALAN TEST' })).toEqual(['address1']);
    expect(only({ address1: 'JALAN TEST ONE' })).toEqual([]);
  });
  it('warns when disallowed characters would be stripped', () => {
    const w = checkPreset(preset({ address1: 'JALAN TEST ONE #5' }));
    expect(w.map((x) => x.message).join()).toMatch(/Only letters, digits/);
  });
  it('rejects NA, N/A, NULL, NIL in either address line (any case)', () => {
    for (const bad of ['NA', 'n/a', 'Null', 'nil']) {
      expect(checkPreset(preset({ address2: bad })).map((x) => x.field), bad).toEqual(['address2']);
      expect(checkPreset(preset({ address1: bad })).map((x) => x.field), bad).toContain('address1');
    }
  });
  it('requires a 5-digit postcode', () => {
    for (const bad of ['', '8000', '800000', 'ABCDE', '80 00']) expect(only({ postcode: bad }), bad).toEqual(['postcode']);
    expect(only({ postcode: ' 80000 ' })).toEqual([]);
  });
  it('flags an unknown state, and a city outside the state', () => {
    expect(only({ state: '99' })).toEqual(['state']);
    expect(only({ state: '01', city: '1401' })).toEqual(['city']);
    expect(only({ state: '14', city: '1401' })).toEqual([]);
  });
  it('flags a seeded preset until it is edited', () => {
    expect(only({ seeded: true })).toEqual(['seeded']);
  });
});

describe('SEEDED_PRESETS guard against the site rules', () => {
  it.each(SEEDED_PRESETS.map((p) => [p.name, p] as const))('%s only warns that it is seeded', (_name, p) => {
    expect(checkPreset(p)).toEqual([
      { field: 'seeded', message: expect.stringContaining('starting-point preset') },
    ]);
  });
  it('every seeded preset is flagged seeded and has a unique id', () => {
    expect(SEEDED_PRESETS.every((p) => p.seeded)).toBe(true);
    expect(new Set(SEEDED_PRESETS.map((p) => p.id)).size).toBe(SEEDED_PRESETS.length);
  });
});
