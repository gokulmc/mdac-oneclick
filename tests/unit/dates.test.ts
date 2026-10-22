import { describe, expect, it } from 'vitest';
import { addDays, addMonths, daysBetween, isIsoDate, localIsoDate, toFormDate } from '../../src/domain/dates';

describe('toFormDate', () => {
  it('converts ISO to dd/mm/yyyy', () => {
    expect(toFormDate('2026-10-22')).toBe('22/10/2026');
    expect(toFormDate('2027-01-05')).toBe('05/01/2027');
  });
  it('throws on a non-ISO string', () => {
    expect(() => toFormDate('22/10/2026')).toThrow(/not an ISO date/);
    expect(() => toFormDate('')).toThrow();
  });
});

describe('isIsoDate', () => {
  it('accepts real dates, including leap day', () => {
    expect(isIsoDate('2026-10-22')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
  });
  it('rejects impossible dates', () => {
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2027-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-00-10')).toBe(false);
    expect(isIsoDate('2026-04-31')).toBe(false);
  });
  it('rejects wrong shapes', () => {
    expect(isIsoDate('')).toBe(false);
    expect(isIsoDate('22/10/2026')).toBe(false);
    expect(isIsoDate('2026-1-5')).toBe(false);
    expect(isIsoDate('2026-10-22T00:00')).toBe(false);
  });
});

describe('daysBetween', () => {
  it('counts whole days b - a', () => {
    expect(daysBetween('2026-10-22', '2026-10-22')).toBe(0);
    expect(daysBetween('2026-10-22', '2026-10-24')).toBe(2);
    expect(daysBetween('2026-10-22', '2026-10-19')).toBe(-3);
  });
  it('crosses month, year and leap boundaries', () => {
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2027-02-28', '2027-03-01')).toBe(1);
  });
});

describe('addDays / addMonths', () => {
  it('adds days across a month', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('clamps to the end of a shorter month', () => {
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2027-08-31', 6)).toBe('2028-02-29');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });
  it('keeps the day when it exists and crosses years', () => {
    expect(addMonths('2026-10-22', 6)).toBe('2027-04-22');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-03-15', -4)).toBe('2025-11-15');
  });
});

describe('localIsoDate', () => {
  it('uses the local calendar day', () => {
    expect(localIsoDate(new Date(2026, 9, 2, 23, 59))).toBe('2026-10-02');
    expect(localIsoDate(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });
});
