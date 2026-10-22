import data from '../reference/data.json';

export interface Option {
  code: string;
  label: string;
}

export const reference = data as {
  capturedOn: string;
  sexes: Option[];
  travelModes: Option[];
  stayTypes: Option[];
  states: Option[];
  nationalities: Option[];
  ports: Option[];
  dialCodes: Option[];
  cities: Record<string, Option[]>;
};

export function citiesOf(state: string): Option[] {
  return reference.cities[state] ?? [];
}

export function labelOf(options: Option[], code: string): string | undefined {
  return options.find((o) => o.code === code)?.label;
}

export function cityLabel(state: string, city: string): string | undefined {
  return labelOf(citiesOf(state), city);
}
