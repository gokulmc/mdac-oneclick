// Packs dist/ into release/mdac-oneclick-<version>.zip for the Chrome Web Store and GitHub Releases.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const dev of ['ocr-harness.html', 'harness'])
  if (existsSync(join(root, 'dist', dev))) throw new Error(`dist/${dev} is dev-only OCR harness output; rebuild without MDAC_HARNESS before zipping`);
const { version } = JSON.parse(readFileSync(join(root, 'dist/manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (pkg.version !== version) throw new Error(`package.json ${pkg.version} != manifest ${version}`);
mkdirSync(join(root, 'release'), { recursive: true });
const out = join(root, 'release', `mdac-oneclick-${version}.zip`);
rmSync(out, { force: true });
execFileSync('zip', ['-qrX', out, '.', '-x', '.DS_Store'], { cwd: join(root, 'dist'), stdio: 'inherit' });
console.log(out);
