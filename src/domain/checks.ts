import { addDays, addMonths, daysBetween, isIsoDate } from './dates';
import { cleanAddress, digitsOnly } from './plan';
import { citiesOf, reference } from './reference';
import type { Traveller, TravelDates, TripPreset } from './types';

// Checks never block a Fill (the MDAC site is the authority and its rules change);
// they explain what the site will reject or what the border will question.

export interface Warning {
  field: string;
  message: string;
}

/** The arrival datepicker allows today through today + 2 days. */
export const ARRIVAL_WINDOW_DAYS = 2;
export const PASSPORT_VALIDITY_MONTHS = 6;

// Same pattern the register form uses in checkEmail().
const EMAIL = /^([a-zA-Z0-9_.-])+@(([a-zA-Z0-9-])+\.)+([a-zA-Z0-9]{2,4})+$/;
const NOT_ALLOWED_ADDRESSES = ['NA', 'N/A', 'NULL', 'NIL'];

const has = (options: { code: string }[], code: string) => options.some((o) => o.code === code);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-10-25" → "25 Oct 2026": unambiguous whatever the reader's date order. */
const readableDate = (iso: string) => `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;

export function checkTraveller(t: Traveller, today: string): Warning[] {
  const w: Warning[] = [];
  if (!t.fullName.trim()) w.push({ field: 'fullName', message: 'Name is required, exactly as in the passport.' });
  if (!t.passportNo.trim()) w.push({ field: 'passportNo', message: 'Passport number is required.' });
  else if (t.passportNo.replace(/\s/g, '').length > 12)
    w.push({ field: 'passportNo', message: 'The form accepts at most 12 characters.' });
  if (!isIsoDate(t.dateOfBirth)) w.push({ field: 'dateOfBirth', message: 'Date of birth is required.' });
  else if (t.dateOfBirth >= today) w.push({ field: 'dateOfBirth', message: 'Date of birth must be in the past.' });
  if (!has(reference.nationalities, t.nationality))
    w.push({ field: 'nationality', message: 'Pick a nationality from the list.' });
  if (!has(reference.nationalities, t.placeOfBirth))
    w.push({ field: 'placeOfBirth', message: 'Pick a place of birth from the list.' });
  if (t.sex !== '1' && t.sex !== '2') w.push({ field: 'sex', message: 'Sex is required.' });
  if (!isIsoDate(t.passportExpiry)) w.push({ field: 'passportExpiry', message: 'Passport expiry is required.' });
  else if (t.passportExpiry < today) w.push({ field: 'passportExpiry', message: 'This passport has expired.' });
  if (!EMAIL.test(t.email.trim())) w.push({ field: 'email', message: 'The form will reject this email address.' });
  if (!has(reference.dialCodes, t.dialCode)) w.push({ field: 'dialCode', message: 'Pick a country code.' });
  const mobile = digitsOnly(t.mobile);
  if (!mobile) w.push({ field: 'mobile', message: 'Mobile number is required.' });
  else if (mobile.length > 12) w.push({ field: 'mobile', message: 'The form accepts at most 12 digits.' });
  return w;
}

export function checkPreset(p: TripPreset): Warning[] {
  const w: Warning[] = [];
  if (!has(reference.travelModes, p.travelMode)) w.push({ field: 'travelMode', message: 'Pick a mode of travel.' });
  if (!has(reference.ports, p.embarkPort))
    w.push({ field: 'embarkPort', message: 'Pick the last port before Malaysia.' });
  if (!has(reference.stayTypes, p.stayType)) w.push({ field: 'stayType', message: 'Pick an accommodation type.' });
  const address = cleanAddress(p.address1);
  if (!address) w.push({ field: 'address1', message: 'Address in Malaysia is required.' });
  else if (address.split(' ').length < 3)
    w.push({ field: 'address1', message: 'The form needs at least three words in the first address line.' });
  if (cleanAddress(p.address1) !== p.address1.trim().replace(/\s+/g, ' ').toUpperCase())
    w.push({ field: 'address1', message: "Only letters, digits, spaces and / - @ ( ) , ' are kept." });
  for (const field of ['address1', 'address2'] as const) {
    if (NOT_ALLOWED_ADDRESSES.includes(p[field].trim().toUpperCase()))
      w.push({ field, message: 'NA, N/A, NULL and NIL are not allowed.' });
  }
  if (!has(reference.states, p.state)) w.push({ field: 'state', message: 'Pick a state.' });
  else if (!has(citiesOf(p.state), p.city)) w.push({ field: 'city', message: 'Pick a city in this state.' });
  if (!/^\d{5}$/.test(p.postcode.trim())) w.push({ field: 'postcode', message: 'Postcode must be 5 digits.' });
  if (p.seeded)
    w.push({
      field: 'seeded',
      message: 'This is a starting-point preset. Change the address to where you will actually stay.',
    });
  return w;
}

export function checkRun(
  traveller: Traveller,
  preset: TripPreset,
  dates: TravelDates,
  transportNo: string,
  today: string,
): Warning[] {
  const w: Warning[] = [...checkTraveller(traveller, today), ...checkPreset(preset)];
  if (!isIsoDate(dates.arrival)) w.push({ field: 'arrival', message: 'Arrival date is required.' });
  else {
    const ahead = daysBetween(today, dates.arrival);
    if (ahead < 0) w.push({ field: 'arrival', message: 'Arrival date is in the past.' });
    else if (ahead > ARRIVAL_WINDOW_DAYS)
      w.push({
        field: 'arrival',
        message: `MDAC only opens 3 days before arrival. File on or after ${readableDate(addDays(dates.arrival, -ARRIVAL_WINDOW_DAYS))}.`,
      });
  }
  if (!isIsoDate(dates.departure)) w.push({ field: 'departure', message: 'Departure date is required.' });
  else if (isIsoDate(dates.arrival) && dates.departure < dates.arrival)
    w.push({ field: 'departure', message: 'Departure is before arrival.' });
  if (
    isIsoDate(traveller.passportExpiry) &&
    isIsoDate(dates.arrival) &&
    traveller.passportExpiry >= today &&
    traveller.passportExpiry < addMonths(dates.arrival, PASSPORT_VALIDITY_MONTHS)
  )
    w.push({
      field: 'passportExpiry',
      message: 'Passport expires within 6 months of arrival. Malaysia may refuse entry.',
    });
  if (!(transportNo.trim() || preset.transportNo.trim()))
    w.push({ field: 'transportNo', message: 'Flight / vessel / vehicle number is required.' });
  return w;
}
