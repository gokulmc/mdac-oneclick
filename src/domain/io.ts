import { SEEDED_PRESETS } from './seeds';
import type { SavedData, Traveller, TripPreset } from './types';

export function emptyData(): SavedData {
  return { version: 1, travellers: [], presets: SEEDED_PRESETS.map((p) => ({ ...p })) };
}

const TRAVELLER_KEYS: (keyof Traveller)[] = [
  'id', 'fullName', 'passportNo', 'dateOfBirth', 'nationality', 'placeOfBirth',
  'sex', 'passportExpiry', 'email', 'dialCode', 'mobile',
];
const PRESET_KEYS: (keyof TripPreset)[] = [
  'id', 'name', 'travelMode', 'transportNo', 'embarkPort', 'stayType',
  'address1', 'address2', 'state', 'city', 'postcode',
];

function pickStrings<T>(raw: unknown, keys: (keyof T)[], what: string): T {
  if (!raw || typeof raw !== 'object') throw new Error(`${what}: not an object`);
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = (raw as Record<string, unknown>)[k as string];
    if (typeof v !== 'string') throw new Error(`${what}: "${String(k)}" must be text`);
    out[k as string] = v;
  }
  return out as T;
}

/** Parses an exported file. Unknown fields are dropped; a malformed file throws with a readable reason. */
export function parseExport(json: string): SavedData {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  const r = raw as { app?: unknown; version?: unknown; travellers?: unknown; presets?: unknown };
  if (r?.app !== 'mdac-oneclick' || r.version !== 1) throw new Error('This is not an MDAC One-Click export.');
  if (!Array.isArray(r.travellers) || !Array.isArray(r.presets)) throw new Error('The export is missing travellers or presets.');
  const travellers = r.travellers.map((t, i) => pickStrings<Traveller>(t, TRAVELLER_KEYS, `Traveller ${i + 1}`));
  const presets = r.presets.map((p, i) => ({
    ...pickStrings<TripPreset>(p, PRESET_KEYS, `Trip preset ${i + 1}`),
    ...((p as TripPreset).seeded ? { seeded: true } : {}),
  }));
  return { version: 1, travellers, presets };
}

export function toExport(data: SavedData): string {
  return JSON.stringify(
    { app: 'mdac-oneclick', version: 1, exportedAt: new Date().toISOString(), travellers: data.travellers, presets: data.presets },
    null,
    2,
  );
}

/** Import merges by id: imported records replace same-id records and add new ones. */
export function mergeImport(current: SavedData, incoming: SavedData): SavedData {
  const merge = <T extends { id: string }>(a: T[], b: T[]) => [...a.filter((x) => !b.some((y) => y.id === x.id)), ...b];
  return {
    ...current,
    travellers: merge(current.travellers, incoming.travellers),
    presets: merge(current.presets, incoming.presets),
  };
}
