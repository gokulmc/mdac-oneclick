import { describe, expect, it } from 'vitest';
import { buildFillPlan, cleanAddress, cleanText, digitsOnly, type FillStep } from '../../src/domain/plan';
import { preset, traveller } from './helpers';

const dates = { arrival: '2026-10-23', departure: '2026-10-25' };
const plan = (t = traveller(), p = preset(), transport = '') => buildFillPlan(t, p, dates, transport);
const value = (steps: FillStep[], id: string) => (steps.find((s) => s.kind !== 'settle' && s.id === id) as Exclude<FillStep, { kind: 'settle' }>).value;

describe('buildFillPlan order', () => {
  const steps = plan();
  const order = steps.map((s) => (s.kind === 'settle' ? 'SETTLE' : s.id));
  const at = (id: string) => order.indexOf(id);
  /** Is there a settle step between `a` and `b` (a before b)? */
  const settleBetween = (a: string, b: string) => order.slice(at(a) + 1, at(b)).includes('SETTLE');

  it('covers every field of the register form exactly once', () => {
    expect(order.filter((x) => x !== 'SETTLE').sort()).toEqual(
      [
        'name', 'passNo', 'dob', 'sex', 'pob', 'nationality', 'passExpDte', 'email', 'confirmEmail', 'region', 'mobile',
        'arrDt', 'depDt', 'vesselNm', 'trvlMode', 'embark', 'accommodationStay', 'accommodationAddress1',
        'accommodationAddress2', 'accommodationState', 'accommodationCity', 'accommodationPostcode',
      ].sort(),
    );
  });
  it('starts with the plain identity fields', () => {
    expect(order.slice(0, 4)).toEqual(['name', 'passNo', 'dob', 'sex']);
  });
  it('picks the dial code only after a settle that follows both country lookups', () => {
    expect(at('pob')).toBeLessThan(at('nationality'));
    expect(settleBetween('pob', 'region')).toBe(true);
    expect(settleBetween('nationality', 'region')).toBe(true);
  });
  it('sets arrival before departure (arrival clears departure)', () => {
    expect(at('arrDt')).toBeLessThan(at('depDt'));
  });
  it('picks the city after a settle that follows the state', () => {
    expect(at('accommodationState')).toBeLessThan(at('accommodationCity'));
    expect(settleBetween('accommodationState', 'accommodationCity')).toBe(true);
  });
  it('writes the postcode last, after a settle that follows the city', () => {
    expect(order[order.length - 1]).toBe('accommodationPostcode');
    expect(settleBetween('accommodationCity', 'accommodationPostcode')).toBe(true);
  });
  it('awaits the options that lookups load', () => {
    const get = (id: string) => steps.find((s) => s.kind === 'select' && s.id === id) as Extract<FillStep, { kind: 'select' }>;
    expect(get('region').awaitOption).toBe(true);
    expect(get('accommodationCity').awaitOption).toBe(true);
  });
  it('marks the accommodation fields with their section', () => {
    const sectioned = steps
      .filter((s) => s.kind !== 'settle' && 'section' in s && s.section === 'accommodation')
      .map((s) => (s as { id: string }).id)
      .sort();
    expect(sectioned).toEqual(
      ['accommodationStay', 'accommodationAddress1', 'accommodationAddress2', 'accommodationState', 'accommodationCity', 'accommodationPostcode'].sort(),
    );
  });
});

describe('buildFillPlan values', () => {
  it('writes dates as dd/mm/yyyy', () => {
    const steps = plan();
    expect(value(steps, 'dob')).toBe('15/01/1990');
    expect(value(steps, 'passExpDte')).toBe('30/06/2032');
    expect(value(steps, 'arrDt')).toBe('23/10/2026');
    expect(value(steps, 'depDt')).toBe('25/10/2026');
  });
  it('uppercases and collapses whitespace in the name', () => {
    expect(value(plan(traveller({ fullName: '  test   traveller\tone ' })), 'name')).toBe('TEST TRAVELLER ONE');
  });
  it('removes spaces from the passport number and uppercases it', () => {
    expect(value(plan(traveller({ passportNo: ' t 000 0001 ' })), 'passNo')).toBe('T0000001');
  });
  it('keeps only digits of the mobile number', () => {
    expect(value(plan(traveller({ mobile: '+65 (8123) 4567' })), 'mobile')).toBe('6581234567');
  });
  it('copies the email into both email fields, trimmed, not uppercased', () => {
    const steps = plan(traveller({ email: '  one@example.com ' }));
    expect(value(steps, 'email')).toBe('one@example.com');
    expect(value(steps, 'confirmEmail')).toBe('one@example.com');
  });
  it('passes codes through for the selects', () => {
    const steps = plan(traveller({ sex: '2', nationality: 'IND', placeOfBirth: 'SGP', dialCode: '91' }));
    expect(value(steps, 'sex')).toBe('2');
    expect(value(steps, 'nationality')).toBe('IND');
    expect(value(steps, 'pob')).toBe('SGP');
    expect(value(steps, 'region')).toBe('91');
    expect(value(steps, 'trvlMode')).toBe('2');
    expect(value(steps, 'embark')).toBe('SGP');
    expect(value(steps, 'accommodationStay')).toBe('01');
    expect(value(steps, 'accommodationState')).toBe('01');
    expect(value(steps, 'accommodationCity')).toBe('0118');
  });
  it('strips characters the form does not allow from addresses', () => {
    const p = preset({ address1: 'No. 5 #02-01 Jalan Test & Co; <b>One</b>!', address2: 'bandar "test" *x*' });
    const steps = plan(traveller(), p);
    expect(value(steps, 'accommodationAddress1')).toBe('NO 5 02-01 JALAN TEST CO BONE/B');
    expect(value(steps, 'accommodationAddress2')).toBe('BANDAR TEST X');
  });
  it('keeps the allowed punctuation / - @ ( ) , and apostrophe', () => {
    expect(cleanAddress("Lot 1/2, Jalan A-B (Test) @ O'Brien")).toBe("LOT 1/2, JALAN A-B (TEST) @ O'BRIEN");
  });
});

describe('buildFillPlan max lengths', () => {
  it('truncates the name to 60', () => {
    expect(value(plan(traveller({ fullName: 'A'.repeat(80) })), 'name')).toHaveLength(60);
  });
  it('truncates the passport to 12', () => {
    expect(value(plan(traveller({ passportNo: 'T'.repeat(20) })), 'passNo')).toHaveLength(12);
  });
  it('truncates the vessel/transport number to 30', () => {
    expect(value(plan(traveller(), preset(), 'V'.repeat(50)), 'vesselNm')).toHaveLength(30);
  });
  it('truncates the postcode to 5 digits', () => {
    expect(value(plan(traveller(), preset({ postcode: '8000012' })), 'accommodationPostcode')).toBe('80000');
  });
  it('truncates addresses to 100 and mobile to 12', () => {
    expect(value(plan(traveller(), preset({ address1: 'WORD '.repeat(40) })), 'accommodationAddress1').length).toBeLessThanOrEqual(100);
    expect(value(plan(traveller({ mobile: '1'.repeat(20) })), 'mobile')).toHaveLength(12);
  });
  it('truncates the email to 100', () => {
    const long = `${'a'.repeat(120)}@example.com`;
    expect(value(plan(traveller({ email: long })), 'email')).toHaveLength(100);
  });
});

describe('transport number', () => {
  it('a per-run value overrides the preset', () => {
    expect(value(plan(traveller(), preset({ transportNo: 'PRESET1' }), 'run 9'), 'vesselNm')).toBe('RUN 9');
  });
  it('a blank per-run value falls back to the preset', () => {
    expect(value(plan(traveller(), preset({ transportNo: 'preset1' }), ''), 'vesselNm')).toBe('PRESET1');
    expect(value(plan(traveller(), preset({ transportNo: 'preset1' }), '   '), 'vesselNm')).toBe('PRESET1');
  });
});

describe('helpers', () => {
  it('cleanText / digitsOnly', () => {
    expect(cleanText('  a   b ', 10)).toBe('A B');
    expect(cleanText('abcdef', 3)).toBe('ABC');
    expect(digitsOnly('a1b2-3')).toBe('123');
  });
});
