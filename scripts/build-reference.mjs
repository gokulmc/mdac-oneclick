// Regenerates src/reference/data.json from a saved copy of the MDAC register page
// plus reference/cities.txt. Usage: node scripts/build-reference.mjs <register.html>
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(process.argv[2], 'utf8');

function selectOptions(id) {
  const m = html.match(new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)</select>`));
  if (!m) throw new Error(`select #${id} not found`);
  const seen = new Map();
  for (const [, value, label] of m[1].matchAll(/<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g)) {
    if (!value || seen.has(value)) continue;
    seen.set(value, label.replace(/\s+/g, ' ').trim());
  }
  return [...seen].map(([code, label]) => ({ code, label }));
}

// The country select lists every country twice ("SGP - SINGAPORE" and "SINGAPORE"); keep the name only.
const countryName = ({ code, label }) => ({ code, label: label.replace(/^[A-Z0-9]{3} - /, '') });
const nationalities = selectOptions('nationality').map(countryName);
// Last port of embarkation accepts a few places that are not nationalities (e.g. Somaliland).
const ports = selectOptions('embark').map(countryName);

// Dial codes repeat across countries (1 = Canada, US, ...), so keep one entry per (code, country).
const dialCodes = [];
{
  const m = html.match(/<select[^>]*id="region"[^>]*>([\s\S]*?)<\/select>/);
  for (const [, code, label] of m[1].matchAll(/<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g)) {
    if (!code) continue;
    dialCodes.push({ code, label: label.replace(/\s+/g, ' ').replace(/^\( ?\S+ ?\) /, '').trim() });
  }
}

const cities = {};
for (const line of readFileSync(join(root, 'reference/cities.txt'), 'utf8').split('\n')) {
  if (!/^\d\d>/.test(line)) continue;
  const [state, rest] = [line.slice(0, 2), line.slice(3)];
  // City names can contain commas ("ASAHAN, JOHOR"), so split only before "<2 digits>:".
  cities[state] = rest.split(/,(?=\d\d:)/).map((pair) => {
    const [suffix, ...name] = pair.split(':');
    return { code: state + suffix, label: name.join(':') };
  });
}

const data = {
  capturedOn: '2026-10-22',
  sexes: selectOptions('sex'),
  travelModes: selectOptions('trvlMode'),
  stayTypes: selectOptions('accommodationStay'),
  states: selectOptions('accommodationState'),
  nationalities,
  ports,
  dialCodes,
  cities,
};
writeFileSync(join(root, 'src/reference/data.json'), JSON.stringify(data, null, 1) + '\n');
console.log(`nationalities ${nationalities.length}, ports ${ports.length}, dial codes ${dialCodes.length}, states ${data.states.length}, cities ${Object.values(cities).flat().length}`);
