// Vocabulary follows CONTEXT.md: Traveller, Trip preset, Travel dates, Run, Queue.
// Dates are ISO yyyy-mm-dd everywhere except at the form boundary (see dates.ts).

export interface Traveller {
  id: string;
  fullName: string;
  passportNo: string;
  dateOfBirth: string;
  /** MDAC country code, e.g. "SGP". */
  nationality: string;
  placeOfBirth: string;
  /** MDAC sex code: "1" male, "2" female. */
  sex: '1' | '2';
  passportExpiry: string;
  email: string;
  /** Dial code without "+", e.g. "65". */
  dialCode: string;
  mobile: string;
}

export interface TripPreset {
  id: string;
  name: string;
  /** MDAC travel mode code: "1" air, "2" land, "3" sea. */
  travelMode: '1' | '2' | '3';
  /** Flight / vessel / vehicle number; can be overridden per Run. */
  transportNo: string;
  /** MDAC country code of the last port of embarkation. */
  embarkPort: string;
  /** MDAC accommodation code: "01" hotel, "02" friends/relatives, "99" others. */
  stayType: '01' | '02' | '99';
  address1: string;
  address2: string;
  /** MDAC state code "01".."16". */
  state: string;
  /** MDAC city code, e.g. "0118" (Johor Bahru). */
  city: string;
  postcode: string;
  /** True for a Seeded preset the traveller has not edited yet. */
  seeded?: boolean;
}

export interface TravelDates {
  arrival: string;
  departure: string;
}

/** What the popup asks for when the traveller clicks Fill. */
export interface RunRequest {
  travellerIds: string[];
  presetId: string;
  dates: TravelDates;
  /** Per-Run transport number; falls back to the preset's when blank. */
  transportNo: string;
}

export interface SavedData {
  version: 1;
  travellers: Traveller[];
  presets: TripPreset[];
  /** Popup convenience: what was picked last time. Never includes Travel dates. */
  lastUsed?: { travellerIds: string[]; presetId: string };
}
