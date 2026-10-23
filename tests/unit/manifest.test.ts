import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Saved travellers live in chrome.storage under the extension's ID. Without a manifest "key", an unpacked
// extension's ID comes from its folder path, so unzipping a new release into a new folder silently starts
// with empty storage (it happened between 0.2.1 and 0.2.2). The key pins the ID; this guards it.
export const EXTENSION_ID = 'oiijdmbibokdnnfpfhomjjddbggbgldf';

/** Chrome's rule: SHA-256 of the DER public key, first 32 hex digits, each 0-f mapped to a-p. */
function idFromKey(base64Key: string): string {
  const hex = createHash('sha256').update(Buffer.from(base64Key, 'base64')).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16))).join('');
}

describe('extension ID', () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, '../../public/manifest.json'), 'utf8'));

  it('has a manifest key, so every release keeps the same ID and the same saved data', () => {
    expect(typeof manifest.key).toBe('string');
  });

  it('the key gives the published ID (changing it would orphan every user’s saved travellers)', () => {
    expect(idFromKey(manifest.key)).toBe(EXTENSION_ID);
  });
});
