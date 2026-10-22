import { toFormDate } from './dates';
import type { Traveller, TravelDates, TripPreset } from './types';

// A Fill is an ordered list of steps against the register form's element ids.
// The form chains AJAX lookups:
//   place of birth / nationality → dial-code list (auto-selects the country's code)
//   state → city list,  city → postcode lookup
//   arrival date → clears departure date
// Independent lookups are started together and awaited once (a 'settle' step), so a
// Fill costs about two lookup round-trips instead of five.
export type FillStep =
  | { kind: 'text'; id: string; value: string; section?: 'accommodation' }
  | { kind: 'date'; id: string; value: string }
  | {
      kind: 'select';
      id: string;
      value: string;
      /** Options are loaded by an earlier lookup; wait for this value to appear. */
      awaitOption?: boolean;
      section?: 'accommodation';
    }
  /** Wait until the page has no AJAX lookups in flight. */
  | { kind: 'settle' };

/** Field limits and character rules copied from the register form. */
export const FORM_LIMITS = {
  name: 60,
  passNo: 12,
  mobile: 12,
  email: 100,
  vesselNm: 30,
  address: 100,
  postcode: 5,
} as const;

// The form strips anything outside this set from the address and transport fields.
const ADDRESS_STRIP = /[^A-Za-z0-9/\-@(),' \s]/g;

export function cleanText(value: string, max: number): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase().slice(0, max);
}

export function cleanAddress(value: string, max: number = FORM_LIMITS.address): string {
  return cleanText(value.replace(ADDRESS_STRIP, ''), max);
}

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export function buildFillPlan(
  traveller: Traveller,
  preset: TripPreset,
  dates: TravelDates,
  transportNo: string,
): FillStep[] {
  const transport = transportNo.trim() || preset.transportNo;
  return [
    { kind: 'text', id: 'name', value: cleanText(traveller.fullName, FORM_LIMITS.name) },
    { kind: 'text', id: 'passNo', value: cleanText(traveller.passportNo.replace(/\s/g, ''), FORM_LIMITS.passNo) },
    { kind: 'date', id: 'dob', value: toFormDate(traveller.dateOfBirth) },
    { kind: 'select', id: 'sex', value: traveller.sex },
    // Lookups start here and run while the plain fields below are written.
    { kind: 'select', id: 'pob', value: traveller.placeOfBirth },
    { kind: 'select', id: 'nationality', value: traveller.nationality },
    { kind: 'select', id: 'accommodationState', value: preset.state, section: 'accommodation' },
    { kind: 'date', id: 'passExpDte', value: toFormDate(traveller.passportExpiry) },
    { kind: 'text', id: 'email', value: traveller.email.trim().slice(0, FORM_LIMITS.email) },
    { kind: 'text', id: 'confirmEmail', value: traveller.email.trim().slice(0, FORM_LIMITS.email) },
    { kind: 'text', id: 'mobile', value: digitsOnly(traveller.mobile).slice(0, FORM_LIMITS.mobile) },
    { kind: 'date', id: 'arrDt', value: toFormDate(dates.arrival) },
    { kind: 'date', id: 'depDt', value: toFormDate(dates.departure) },
    { kind: 'text', id: 'vesselNm', value: cleanAddress(transport, FORM_LIMITS.vesselNm) },
    { kind: 'select', id: 'trvlMode', value: preset.travelMode },
    { kind: 'select', id: 'embark', value: preset.embarkPort },
    { kind: 'select', id: 'accommodationStay', value: preset.stayType, section: 'accommodation' },
    { kind: 'text', id: 'accommodationAddress1', value: cleanAddress(preset.address1), section: 'accommodation' },
    { kind: 'text', id: 'accommodationAddress2', value: cleanAddress(preset.address2), section: 'accommodation' },
    // The dial-code list is rewritten by both country lookups: pick the code only after they land.
    { kind: 'settle' },
    { kind: 'select', id: 'region', value: traveller.dialCode, awaitOption: true },
    { kind: 'select', id: 'accommodationCity', value: preset.city, awaitOption: true, section: 'accommodation' },
    { kind: 'settle' },
    // Last: the city's postcode lookup must not land after it.
    {
      kind: 'text',
      id: 'accommodationPostcode',
      value: digitsOnly(preset.postcode).slice(0, FORM_LIMITS.postcode),
      section: 'accommodation',
    },
  ];
}
