import { describe, expect, it } from 'vitest';
import { SEEDED_PRESETS } from '../../src/domain/seeds';
import { cityLabel, citiesOf, labelOf, reference } from '../../src/domain/reference';

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
