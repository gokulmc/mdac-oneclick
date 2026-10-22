import type { PageKind } from '../domain/queue';

export const MDAC_ORIGIN = 'https://imigresen-online.imi.gov.my';
export const REGISTER_URL = `${MDAC_ORIGIN}/mdac/register`;

// Phrases a successful registration page is expected to contain (English and Malay).
// Not yet verified against a real submission: see README "Known gaps".
const CONFIRMATION_TEXT = /(registration (is |was )?success|successfully (registered|submitted)|pendaftaran berjaya|berjaya didaftarkan|thank you for registering|\bPIN\b)/i;

export function detectPage(doc: Document): PageKind {
  const form = doc.forms.namedItem('permohonan');
  if (form && doc.getElementById('passNo') && doc.getElementById('arrDt')) return 'register-form';
  if (!form && CONFIRMATION_TEXT.test(doc.body?.innerText ?? doc.body?.textContent ?? '')) return 'confirmation';
  return 'other';
}
