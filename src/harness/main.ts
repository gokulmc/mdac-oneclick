// Dev-only entry (MDAC_HARNESS=1): lets scripts/ocr-fixture.mjs drive the real OCR pipeline in the built extension.
import { DEFAULT_PREPROCESS, recognizePage } from '../options/ocr';

declare global {
  interface Window { __mdacOcr: { recognizePage: typeof recognizePage; DEFAULT_PREPROCESS: typeof DEFAULT_PREPROCESS } }
}
window.__mdacOcr = { recognizePage, DEFAULT_PREPROCESS };
