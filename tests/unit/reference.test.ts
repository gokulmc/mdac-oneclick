import { describe, expect, it } from 'vitest';
import { SEEDED_PRESETS } from '../../src/domain/seeds';
import { cityLabel, citiesOf, codeOf, findCity, labelOf, normaliseLabel, reference, splitMobile, stateOf } from '../../src/domain/reference';

const codes = (o: { code: string }[]) => new Set(o.map((x) => x.code));

describe('reference data', () => {
  it('has 16 states and 509 cities', () => {
    expect(reference.states).toHaveLength(16);
    expect(Object.keys(reference.cities)).toHaveLength(16);
    expect(Object.values(reference.cities).reduce((n, c) => n + c.length, 0)).toBe(509);
  });
  it('every state has cities whose codes start with the state code', () => {
    for (const s of reference.states) {
      const cities = citiesOf(s.code);
      expect(cities.length, s.label).toBeGreaterThan(0);
      for (const c of cities) expect(c.code.startsWith(s.code), `${s.label} ${c.code}`).toBe(true);
    }
  });
  it('JOHOR BAHRU is 0118', () => {
    expect(cityLabel('01', '0118')).toBe('JOHOR BAHRU');
    expect(citiesOf('01').find((c) => c.label === 'JOHOR BAHRU')?.code).toBe('0118');
  });
  it('lookups return undefined / empty for unknown input', () => {
    expect(citiesOf('99')).toEqual([]);
    expect(labelOf(reference.states, '99')).toBeUndefined();
  });
  it('Singapore, India: nationality, port and dial code exist', () => {
    expect(labelOf(reference.nationalities, 'SGP')).toBe('SINGAPORE');
    expect(labelOf(reference.nationalities, 'IND')).toBe('INDIA');
    expect(labelOf(reference.ports, 'SGP')).toBe('SINGAPORE');
    expect(labelOf(reference.dialCodes, '65')).toBe('SINGAPORE');
    expect(labelOf(reference.dialCodes, '91')).toBe('INDIA');
  });
});

describe('seeded presets use real site codes', () => {
  it.each(SEEDED_PRESETS.map((p) => [p.name, p] as const))('%s', (_n, p) => {
    expect(codes(reference.states).has(p.state), 'state').toBe(true);
    expect(codes(citiesOf(p.state)).has(p.city), 'city in state').toBe(true);
    expect(codes(reference.ports).has(p.embarkPort), 'port').toBe(true);
    expect(codes(reference.travelModes).has(p.travelMode), 'mode').toBe(true);
    expect(codes(reference.stayTypes).has(p.stayType), 'stay').toBe(true);
  });
});

describe('normaliseLabel', () => {
  it('upper-cases, spells out &, drops punctuation and collapses spaces', () => {
    expect(normaliseLabel(' bosnia & herzegovina ')).toBe('BOSNIA AND HERZEGOVINA');
    expect(normaliseLabel("COTE D'IVOIRE")).toBe('COTE DIVOIRE');
    expect(normaliseLabel('K.  KUBU-BHARU')).toBe('K KUBU BHARU');
  });
});

describe('codeOf', () => {
  const nat = reference.nationalities;
  it('exact labels are ok, with or without a leading code', () => {
    expect(codeOf(nat, 'INDIA')).toEqual({ code: 'IND', status: 'ok' });
    expect(codeOf(nat, 'singapore')).toEqual({ code: 'SGP', status: 'ok' });
    expect(codeOf(nat, 'SGP - SINGAPORE')).toEqual({ code: 'SGP', status: 'ok' });
    expect(codeOf(nat, 'SGP-SINGAPORE')).toEqual({ code: 'SGP', status: 'ok' });
  });
  it('a small typo is unsure', () => {
    expect(codeOf(nat, 'INDA')).toEqual({ code: 'IND', status: 'unsure' });
    expect(codeOf(nat, 'SINGAPOER')).toEqual({ code: 'SGP', status: 'unsure' });
  });
  it('never matches on a prefix: NIGER is not NIGERIA', () => {
    expect(codeOf(nat, 'NIGER')).toEqual({ code: 'NER', status: 'ok' });
    expect(codeOf(nat, 'NIGERIA')).toEqual({ code: 'NGA', status: 'ok' });
    expect(codeOf(nat, 'NIGE')).toBeUndefined();
    expect(codeOf(nat, 'INDO')?.code).not.toBe('IDN');
  });
  it('an ambiguous near-miss is rejected rather than guessed', () => {
    expect(codeOf(nat, 'NIGERI')).toBeUndefined();
  });
  it('labels shared by two codes resolve to the preferred one and stay ok', () => {
    expect(codeOf(nat, 'ZIMBABWE')).toEqual({ code: 'ZWE', status: 'ok' });
    expect(codeOf(nat, 'ROMANIA')).toEqual({ code: 'ROU', status: 'ok' });
    expect(codeOf(nat, 'SERBIA')).toEqual({ code: 'SRB', status: 'ok' });
    expect(codeOf(nat, 'PALESTINE')).toEqual({ code: 'PSE', status: 'ok' });
    expect(codeOf(nat, 'TIMOR LESTE')).toEqual({ code: 'TLS', status: 'ok' });
    expect(codeOf(nat, "DEMOCRATIC PEOPLE'S REPUBLIC OF KOREA")).toEqual({ code: 'PRK', status: 'ok' });
  });
  it('works on any option list and returns undefined for nonsense', () => {
    expect(codeOf(reference.ports, 'MALAYSIA')?.status).toBe('ok');
    expect(codeOf(nat, '')).toBeUndefined();
    expect(codeOf(nat, 'QQQQQQQQ')).toBeUndefined();
  });
});

describe('stateOf', () => {
  it('reads the federal territories with or without WP', () => {
    expect(stateOf('WP KUALA LUMPUR')).toEqual({ code: '14', status: 'ok' });
    expect(stateOf('KUALA LUMPUR')).toEqual({ code: '14', status: 'ok' });
    expect(stateOf('W.P. KUALA LUMPUR')).toEqual({ code: '14', status: 'ok' });
    expect(stateOf('WILAYAH PERSEKUTUAN PUTRAJAYA')).toEqual({ code: '16', status: 'ok' });
    expect(stateOf('LABUAN')).toEqual({ code: '15', status: 'ok' });
  });
  it('expands the short N / P forms', () => {
    expect(stateOf('P PINANG')).toEqual({ code: '07', status: 'ok' });
    expect(stateOf('PULAU PINANG')).toEqual({ code: '07', status: 'ok' });
    expect(stateOf('N SEMBILAN')).toEqual({ code: '05', status: 'ok' });
    expect(stateOf('JOHOR')).toEqual({ code: '01', status: 'ok' });
  });
  it('a small typo is unsure; nonsense is not a state', () => {
    expect(stateOf('SELANGOER')).toEqual({ code: '10', status: 'unsure' });
    expect(stateOf('ATLANTIS')).toBeUndefined();
    expect(stateOf('')).toBeUndefined();
  });
});

describe('findCity', () => {
  it('exact labels are ok', () => {
    expect(findCity('01', 'JOHOR BAHRU')).toEqual({ code: '0118', status: 'ok' });
    expect(findCity('01', 'JOHOR')).toEqual({ code: '0100', status: 'ok' });
  });
  it('a label shared by two codes takes the first and is unsure', () => {
    expect(findCity('04', 'MELAKA')).toEqual({ code: '0400', status: 'unsure' });
    expect(findCity('10', 'BANDAR PUNCAK ALAM')).toEqual({ code: '1095', status: 'unsure' });
  });
  it('spells abbreviations out on both sides', () => {
    expect(findCity('10', 'BANDAR BARU BANGI')).toEqual({ code: '1050', status: 'unsure' });
    expect(findCity('10', 'BDR. BARU BANGI')).toEqual({ code: '1050', status: 'ok' });
    expect(findCity('10', 'SUNGAI AYER TAWAR')).toEqual({ code: '1040', status: 'unsure' });
    expect(findCity('10', 'KUALA KUBU BHARU')).toEqual({ code: '1018', status: 'unsure' });
    expect(findCity('10', 'BATANG BERJUNTAI')).toEqual({ code: '1003', status: 'unsure' });
    expect(findCity('10', 'TANJUNG KARANG')).toEqual({ code: '1044', status: 'unsure' });
  });
  it('drops bracketed and comma suffixes', () => {
    expect(findCity('10', 'PUTRAJAYA')).toEqual({ code: '1051', status: 'unsure' });
    expect(findCity('10', 'PUTRAJAYA (NEW)')).toEqual({ code: '1051', status: 'unsure' });
    expect(findCity('01', 'JOHOR BAHRU, JOHOR')).toEqual({ code: '0118', status: 'unsure' });
  });
  it('an OCR slip is unsure', () => {
    expect(findCity('01', 'J0HOR BAHRU')).toEqual({ code: '0118', status: 'unsure' });
  });
  it('never returns a city from another state', () => {
    expect(findCity('14', 'JOHOR BAHRU')).toBeUndefined();
    expect(findCity('99', 'JOHOR BAHRU')).toBeUndefined();
    expect(findCity('01', '')).toBeUndefined();
  });
});

describe('splitMobile', () => {
  it('splits a fused dial code by the longest prefix', () => {
    expect(splitMobile('+919892800000')).toEqual({ dialCode: '91', mobile: '9892800000', status: 'ok' });
    expect(splitMobile('+6591234567')).toEqual({ dialCode: '65', mobile: '91234567', status: 'ok' });
    expect(splitMobile('+18761234567')).toEqual({ dialCode: '1876', mobile: '1234567', status: 'ok' });
    expect(splitMobile('+4415341234567')).toEqual({ dialCode: '441534', mobile: '1234567', status: 'ok' });
  });
  it('accepts 00 and full-width plus, and ignores spacing', () => {
    expect(splitMobile('0091 98928 00000')).toEqual({ dialCode: '91', mobile: '9892800000', status: 'ok' });
    expect(splitMobile('\uFF0B6591234567')).toEqual({ dialCode: '65', mobile: '91234567', status: 'ok' });
    expect(splitMobile('+65 9123 4567')).toEqual({ dialCode: '65', mobile: '91234567', status: 'ok' });
  });
  it('without a plus the dial code is left empty and the digits are unsure', () => {
    expect(splitMobile('91234567')).toEqual({ dialCode: '', mobile: '91234567', status: 'unsure' });
  });
  it('a repaired digit is unsure', () => {
    expect(splitMobile('+6591O34567')).toEqual({ dialCode: '65', mobile: '9103 4567'.replace(' ', ''), status: 'unsure' });
  });
  it('too short or not a number is undefined', () => {
    expect(splitMobile('12345')).toBeUndefined();
    expect(splitMobile('')).toBeUndefined();
    expect(splitMobile('call me')).toBeUndefined();
  });
});
