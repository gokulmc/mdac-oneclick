import type { Traveller, TripPreset } from '../../src/domain/types';

/** Dummy data only: no real people, passports or addresses. */
export function traveller(over: Partial<Traveller> = {}): Traveller {
  return {
    id: 't1',
    fullName: 'TEST TRAVELLER ONE',
    passportNo: 'T0000001',
    dateOfBirth: '1990-01-15',
    nationality: 'IND',
    placeOfBirth: 'IND',
    sex: '1',
    passportExpiry: '2032-06-30',
    email: 'one@example.com',
    dialCode: '65',
    mobile: '81234567',
    ...over,
  };
}

export function preset(over: Partial<TripPreset> = {}): TripPreset {
  return {
    id: 'p1',
    name: 'Test preset',
    travelMode: '2',
    transportNo: 'SGX1234A',
    embarkPort: 'SGP',
    stayType: '01',
    address1: 'JALAN TEST ONE',
    address2: 'BANDAR TEST',
    state: '01',
    city: '0118',
    postcode: '80000',
    ...over,
  };
}
