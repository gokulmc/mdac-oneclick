// Packs dist/ into two zips in release/:
//   mdac-oneclick-<version>.zip          GitHub release, loaded unpacked. Keeps the manifest "key", which pins
//                                        the extension ID — saved travellers live under that ID, so every
//                                        version and every folder it is unzipped to keeps the same data.
//   mdac-oneclick-<version>-webstore.zip Chrome Web Store upload. The store rejects a manifest "key" and assigns
//                                        its own ID, so it is removed here.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
for (const dev of ['ocr-harness.html', 'harness'])
  if (existsSync(join(dist, dev))) throw new Error(`dist/${dev} is dev-only OCR harness output; rebuild without MDAC_HARNESS before zipping`);
const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (pkg.version !== manifest.version) throw new Error(`package.json ${pkg.version} != manifest ${manifest.version}`);
if (!manifest.key) throw new Error('dist/manifest.json has no "key": the release would get a new extension ID and lose saved data');
mkdirSync(join(root, 'release'), { recursive: true });

function zip(from, name) {
  const out = join(root, 'release', name);
  rmSync(out, { force: true });
  execFileSync('zip', ['-qrX', out, '.', '-x', '.DS_Store'], { cwd: from, stdio: 'inherit' });
  console.log(out);
}

zip(dist, `mdac-oneclick-${manifest.version}.zip`);

const store = mkdtempSync(join(tmpdir(), 'mdac-webstore-'));
cpSync(dist, store, { recursive: true });
const { key: _key, ...storeManifest } = manifest;
writeFileSync(join(store, 'manifest.json'), JSON.stringify(storeManifest, null, 2) + '\n');
zip(store, `mdac-oneclick-${manifest.version}-webstore.zip`);
rmSync(store, { recursive: true, force: true });
