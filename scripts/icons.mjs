// Renders public/icons/{16,32,48,128}.png: a rounded green square with a white bold "M1".
// Deliberately not a government crest or the Malaysian flag. Run: node scripts/icons.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

const svg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#1F6F43"/>
  <text x="64" y="64" text-anchor="middle" dominant-baseline="central"
        font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
        font-weight="800" font-size="68" letter-spacing="-3" fill="#FFFFFF">M1</text>
</svg>`;

const browser = await chromium.launch();
try {
  for (const size of [16, 32, 48, 128]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg(size)}`);
    await page.screenshot({ path: join(out, `${size}.png`), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log('wrote public/icons/{16,32,48,128}.png');
