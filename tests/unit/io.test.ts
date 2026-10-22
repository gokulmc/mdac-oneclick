import { describe, expect, it } from 'vitest';
import { emptyData, mergeImport, parseExport, toExport } from '../../src/domain/io';
import { SEEDED_PRESETS } from '../../src/domain/seeds';
import type { SavedData } from '../../src/domain/types';
import { preset, traveller } from './helpers';

const data = (): SavedData => ({
  version: 1,
  travellers: [traveller({ id: 't1' }), traveller({ id: 't2', fullName: 'TEST TRAVELLER TWO', passportNo: 'T0000002' })],
  presets: [preset({ id: 'p1' })],
});

describe('emptyData', () => {
  it('starts with the seeded presets and no travellers', () => {
    const d = emptyData();
    expect(d.travellers).toEqual([]);
    expect(d.presets).toHaveLength(SEEDED_PRESETS.length);
    expect(d.presets.every((p) => p.seeded)).toBe(true);
  });
  it('returns copies, not the shared seed objects', () => {
    const d = emptyData();
    d.presets[0]!.name = 'changed';
    expect(SEEDED_PRESETS[0]!.name).not.toBe('changed');
  });
});

describe('export / parse', () => {
  it('round-trips travellers and presets', () => {
    const d = data();
    expect(parseExport(toExport(d))).toEqual(d);
  });
  it('keeps the seeded flag', () => {
    const d: SavedData = { version: 1, travellers: [], presets: [preset({ id: 's', seeded: true })] };
    expect(parseExport(toExport(d)).presets[0]!.seeded).toBe(true);
  });
  it('tags the file with the app name and version', () => {
    const o = JSON.parse(toExport(data()));
    expect(o.app).toBe('mdac-oneclick');
    expect(o.version).toBe(1);
    expect(typeof o.exportedAt).toBe('string');
  });
  it('drops unknown fields on travellers and presets', () => {
    const o = JSON.parse(toExport(data()));
    o.travellers[0].secretNote = 'x';
    o.presets[0].extra = 1;
    o.somethingElse = true;
    const parsed = parseExport(JSON.stringify(o));
    expect(parsed.travellers[0]).not.toHaveProperty('secretNote');
    expect(parsed.presets[0]).not.toHaveProperty('extra');
    expect(parsed).not.toHaveProperty('somethingElse');
    expect(parsed).toEqual(data());
  });
});

describe('parse errors are readable', () => {
  const valid = () => JSON.parse(toExport(data()));
  it('malformed JSON', () => {
    expect(() => parseExport('{nope')).toThrow('This file is not valid JSON.');
    expect(() => parseExport('')).toThrow(/not valid JSON/);
  });
  it('wrong app, wrong version, or not an object', () => {
    expect(() => parseExport(JSON.stringify({ app: 'other', version: 1, travellers: [], presets: [] }))).toThrow(/not an MDAC One-Click export/);
    expect(() => parseExport(JSON.stringify({ app: 'mdac-oneclick', version: 2, travellers: [], presets: [] }))).toThrow(/not an MDAC One-Click export/);
    expect(() => parseExport('null')).toThrow(/not an MDAC One-Click export/);
    expect(() => parseExport('[]')).toThrow(/not an MDAC One-Click export/);
  });
  it('missing travellers or presets', () => {
    const o = valid();
    delete o.travellers;
    expect(() => parseExport(JSON.stringify(o))).toThrow(/missing travellers or presets/);
    const p = valid();
    p.presets = 'x';
    expect(() => parseExport(JSON.stringify(p))).toThrow(/missing travellers or presets/);
  });
  it('a traveller or preset missing a field names the record and the field', () => {
    const o = valid();
    delete o.travellers[1].passportNo;
    expect(() => parseExport(JSON.stringify(o))).toThrow('Traveller 2: "passportNo" must be text');
    const p = valid();
    p.presets[0].postcode = 80000;
    expect(() => parseExport(JSON.stringify(p))).toThrow('Trip preset 1: "postcode" must be text');
    const q = valid();
    q.travellers[0] = 5;
    expect(() => parseExport(JSON.stringify(q))).toThrow('Traveller 1: not an object');
  });
});

describe('mergeImport', () => {
  it('replaces same-id records and adds new ones, keeping the rest', () => {
    const current = data();
    const incoming: SavedData = {
      version: 1,
      travellers: [traveller({ id: 't2', fullName: 'CHANGED NAME' }), traveller({ id: 't3', fullName: 'TEST TRAVELLER THREE' })],
      presets: [preset({ id: 'p2', name: 'New' })],
    };
    const m = mergeImport(current, incoming);
    expect(m.travellers.map((t) => t.id).sort()).toEqual(['t1', 't2', 't3']);
    expect(m.travellers.find((t) => t.id === 't2')!.fullName).toBe('CHANGED NAME');
    expect(m.travellers.find((t) => t.id === 't1')!.fullName).toBe('TEST TRAVELLER ONE');
    expect(m.presets.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
  });
  it('keeps lastUsed and does not mutate its inputs', () => {
    const current: SavedData = { ...data(), lastUsed: { travellerIds: ['t1'], presetId: 'p1' } };
    const before = JSON.stringify(current);
    const m = mergeImport(current, data());
    expect(m.lastUsed).toEqual({ travellerIds: ['t1'], presetId: 'p1' });
    expect(JSON.stringify(current)).toBe(before);
    expect(m.travellers).toHaveLength(2);
  });
});
