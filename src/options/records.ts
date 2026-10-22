import { citiesOf, reference } from '../domain/reference';
import type { Traveller, TripPreset } from '../domain/types';
import { setOptions, toOptions, type FormHandle, type SectionSpec } from './forms';

// ---------- travellers ----------

export const travellerSections = (): SectionSpec[] => [
  {
    legend: 'Passport',
    items: [
      { name: 'fullName', label: 'Full name', type: 'text', wide: true },
      { name: 'passportNo', label: 'Passport no.', type: 'text' },
      { name: 'sex', label: 'Sex', type: 'select', options: toOptions(reference.sexes) },
      { name: 'nationality', label: 'Nationality', type: 'select', options: toOptions(reference.nationalities) },
      { name: 'placeOfBirth', label: 'Place of birth', type: 'select', options: toOptions(reference.nationalities) },
      { name: 'dateOfBirth', label: 'Date of birth', type: 'date' },
      { name: 'passportExpiry', label: 'Passport expiry', type: 'date' },
    ],
  },
  {
    legend: 'Contact (MDAC confirmation is emailed here)',
    items: [
      { name: 'email', label: 'Email', type: 'email', wide: true },
      {
        label: 'Mobile',
        fields: [
          { name: 'dialCode', label: 'Country code', type: 'select', options: toOptions(reference.dialCodes, true) },
          { name: 'mobile', label: 'Mobile number', type: 'tel' },
        ],
      },
    ],
  },
];

export const blankTraveller = (): Traveller => ({
  id: crypto.randomUUID(), fullName: '', passportNo: '', dateOfBirth: '', nationality: '', placeOfBirth: '',
  sex: '' as Traveller['sex'], passportExpiry: '', email: '', dialCode: '', mobile: '',
});

export function normaliseTraveller(base: Traveller, v: Partial<Traveller>): Traveller {
  return {
    ...base,
    ...v,
    fullName: (v.fullName ?? '').trim().toUpperCase(),
    passportNo: (v.passportNo ?? '').trim().toUpperCase(),
    email: (v.email ?? '').trim(),
    mobile: (v.mobile ?? '').trim(),
  };
}

// ---------- trip presets ----------

export const presetSections = (): SectionSpec[] => [
  {
    legend: 'Journey',
    items: [
      { name: 'name', label: 'Preset name', type: 'text', wide: true },
      { name: 'travelMode', label: 'Mode of travel', type: 'select', options: toOptions(reference.travelModes) },
      { name: 'transportNo', label: 'Flight / vehicle / vessel no.', type: 'text' },
      { name: 'embarkPort', label: 'Last port before Malaysia', type: 'select', options: toOptions(reference.ports), wide: true },
    ],
  },
  {
    legend: 'Where you will stay',
    items: [
      { name: 'stayType', label: 'Accommodation', type: 'select', options: toOptions(reference.stayTypes), wide: true },
      { name: 'address1', label: 'Address line 1', type: 'text', wide: true },
      { name: 'address2', label: 'Address line 2 (optional)', type: 'text', wide: true },
      { name: 'state', label: 'State', type: 'select', options: toOptions(reference.states) },
      { name: 'city', label: 'City', type: 'select', options: [] },
      { name: 'postcode', label: 'Postcode', type: 'text' },
    ],
  },
];

export const blankPreset = (): TripPreset => ({
  id: crypto.randomUUID(), name: '', travelMode: '' as TripPreset['travelMode'], transportNo: '', embarkPort: '',
  stayType: '' as TripPreset['stayType'], address1: '', address2: '', state: '', city: '', postcode: '',
});

export function normalisePreset(base: TripPreset, v: Partial<TripPreset>): TripPreset {
  const { seeded: _seeded, ...rest } = { ...base, ...v };
  return {
    ...rest,
    name: (v.name ?? '').trim() || 'Untitled trip preset',
    transportNo: (v.transportNo ?? '').trim(),
    address1: (v.address1 ?? '').trim(),
    address2: (v.address2 ?? '').trim(),
    postcode: (v.postcode ?? '').trim(),
  };
}

/**
 * Makes the city select follow the state select of a preset form: lists the state's cities (before choosing
 * `cityValue`, so a saved city survives) and starts over with no city whenever the state changes.
 */
export function wireStateCity(handle: Pick<FormHandle<unknown>, 'controls' | 'refresh'>, stateValue: string, cityValue: string) {
  const state = handle.controls.state as HTMLSelectElement;
  const city = handle.controls.city as HTMLSelectElement;
  setOptions(city, toOptions(citiesOf(stateValue)), cityValue, 'Select a city…');
  state.addEventListener('change', () => setOptions(city, toOptions(citiesOf(state.value)), '', 'Select a city…'));
  handle.refresh();
}
