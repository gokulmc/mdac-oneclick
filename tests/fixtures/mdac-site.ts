// Playwright stand-in for https://imigresen-online.imi.gov.my/mdac/*.
// Serves tests/fixtures/register.html, the three AJAX lookups (built from src/reference/data.json),
// the vendor JS from node_modules, and a POST handler. Records every POST body.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Route } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
export const SITE = 'https://imigresen-online.imi.gov.my';
export const REGISTER_URL = `${SITE}/mdac/register`;

const read = (p: string) => readFileSync(join(root, p));

// Read the JSON directly: Playwright's ESM loader rejects `import ... from 'x.json'` without an attribute.
interface Opt { code: string; label: string }
const reference = JSON.parse(read('src/reference/data.json').toString()) as {
  states: Opt[]; nationalities: Opt[]; dialCodes: Opt[]; cities: Record<string, Opt[]>;
};
const VENDOR: Record<string, { file: string; type: string }> = {
  '/mdac/vendor/jquery.js': { file: 'node_modules/jquery/dist/jquery.js', type: 'text/javascript' },
  '/mdac/vendor/bootstrap-datepicker.js': { file: 'node_modules/bootstrap-datepicker/dist/js/bootstrap-datepicker.js', type: 'text/javascript' },
  '/mdac/vendor/bootstrap-datepicker3.css': { file: 'node_modules/bootstrap-datepicker/dist/css/bootstrap-datepicker3.css', type: 'text/css' },
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const option = (value: string, label: string, selected = false) =>
  `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;

const countryOptions = reference.nationalities.map((c) => option(c.code, `${c.code} - ${c.label}`)).join('');
const stateOptions = reference.states.map((s) => option(s.code, s.label)).join('');
const dialOptions = (selectedLabel?: string) => {
  let marked = false;
  return reference.dialCodes
    .map((d) => {
      const sel = !marked && selectedLabel !== undefined && d.label === selectedLabel;
      if (sel) marked = true;
      return option(d.code, `+${d.code} ${d.label}`, sel);
    })
    .join('');
};

export type PostOutcome = 'confirm' | 'reject';

export interface MdacSiteOptions {
  /** Artificial delay for each of the three lookups, in ms. Default 300. */
  latencyMs?: number;
  /** What a POST answers: the confirmation page, or the form again (server rejection). */
  postOutcome?: PostOutcome | ((postNumber: number) => PostOutcome);
}

export interface PostRecord {
  /** Decoded application/x-www-form-urlencoded fields. */
  fields: Record<string, string>;
  raw: string;
}

export class MdacSite {
  latencyMs: number;
  postOutcome: NonNullable<MdacSiteOptions['postOutcome']>;
  readonly posts: PostRecord[] = [];
  /** Lookup requests seen, in arrival order, e.g. "retrieveRefCity:01". */
  readonly lookups: string[] = [];
  /** Every GET of the register page. */
  registerLoads = 0;

  constructor(options: MdacSiteOptions = {}) {
    this.latencyMs = options.latencyMs ?? 300;
    this.postOutcome = options.postOutcome ?? 'confirm';
  }

  async install(context: BrowserContext): Promise<this> {
    await context.route(`${SITE}/**`, (route) => this.handle(route));
    await context.route('https://example.com/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Example stub</title><h1>Example stub</h1>' }),
    );
    return this;
  }

  /** Renders the register page; `error` simulates the site re-showing the form after a rejection. */
  static registerHtml(error?: string): string {
    return read('tests/fixtures/register.html')
      .toString()
      .replace('{{ERROR_BANNER}}', error ? `<div class="banner" id="server-error">${esc(error)}</div>` : '')
      .replaceAll('{{COUNTRY_OPTIONS}}', countryOptions)
      .replace('{{STATE_OPTIONS}}', stateOptions)
      .replace('{{DIAL_OPTIONS}}', dialOptions());
  }

  static confirmationHtml(): string {
    return '<!doctype html><html><head><meta charset="utf-8"><title>MDAC fixture - Confirmation</title></head>'
      + '<body><h2>Registration successful</h2><p>Your Malaysia Digital Arrival Card has been registered.</p></body></html>';
  }

  private async handle(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    const vendor = VENDOR[url.pathname];
    if (vendor) return route.fulfill({ contentType: vendor.type, body: read(vendor.file) });
    if (url.pathname !== '/mdac/register') return route.fulfill({ status: 404, body: 'not found' });

    if (request.method() === 'POST') return this.handlePost(route, request.postData() ?? '');

    const q = url.searchParams;
    if (q.has('retrieveCountryPhoneCode') || q.has('retrieveRefCity') || q.has('retrievePostcode')) {
      await new Promise((r) => setTimeout(r, this.latencyMs));
      return route.fulfill({ contentType: 'text/html', body: this.lookup(q) });
    }
    this.registerLoads++;
    return route.fulfill({ contentType: 'text/html', body: MdacSite.registerHtml() });
  }

  private lookup(q: URLSearchParams): string {
    if (q.has('retrieveCountryPhoneCode')) {
      const country = q.get('ctryCd') ?? '';
      this.lookups.push(`retrieveCountryPhoneCode:${country}`);
      // The live site returns the FULL dial-code list with the country's own code selected.
      const label = reference.nationalities.find((n) => n.code === country)?.label;
      return option('', 'Please Choose') + dialOptions(label);
    }
    if (q.has('retrieveRefCity')) {
      const state = q.get('state') ?? '';
      this.lookups.push(`retrieveRefCity:${state}`);
      return '<option value="">Please Choose</option>' + (reference.cities[state] ?? []).map((c) => option(c.code, c.label)).join('');
    }
    this.lookups.push(`retrievePostcode:${q.get('cityCd') ?? ''}`);
    return '';
  }

  private handlePost(route: Route, raw: string) {
    this.posts.push({ raw, fields: Object.fromEntries(new URLSearchParams(raw)) });
    const outcome = typeof this.postOutcome === 'function' ? this.postOutcome(this.posts.length) : this.postOutcome;
    const body = outcome === 'confirm' ? MdacSite.confirmationHtml() : MdacSite.registerHtml('Fixture: the server rejected this submission.');
    return route.fulfill({ contentType: 'text/html', body });
  }
}
