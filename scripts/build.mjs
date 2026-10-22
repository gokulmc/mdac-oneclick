// Builds the unpacked extension into dist/:
//   popup.html, options.html, background.js  (Vite, ES modules)
//   page/fill.js, page/watcher.js             (esbuild IIFE: injected scripts cannot import)
//   ocr/*                                      (tesseract.js worker, wasm core, English model — copied, never fetched)
import { build as vite } from 'vite';
import { build as esbuild } from 'esbuild';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// MDAC_HARNESS=1 adds the dev-only OCR harness page and builds into dist-harness/ so it can never
// clobber or leak into the release dist/. MDAC_OUT overrides the output directory.
const harness = process.env.MDAC_HARNESS === '1';
const out = resolve(root, process.env.MDAC_OUT ?? (harness ? 'dist-harness' : 'dist'));
rmSync(out, { recursive: true, force: true });

/** The three files src/options/ocr.ts points tesseract.js at. Resolved through pnpm's layout, so the
 *  core is the one tesseract.js itself depends on (pinned to the same version via pnpm.overrides). */
export function ocrFiles() {
  const req = createRequire(join(root, 'package.json'));
  const tesseract = dirname(req.resolve('tesseract.js/package.json'));
  const core = dirname(createRequire(join(tesseract, 'package.json')).resolve('tesseract.js-core/package.json'));
  const eng = dirname(req.resolve('@tesseract.js-data/eng/package.json'));
  return {
    'worker.min.js': join(tesseract, 'dist/worker.min.js'),
    // Plain SIMD (not relaxed): bit-identical results across machines, which the golden OCR fixtures rely on.
    'tesseract-core-simd-lstm.wasm.js': join(core, 'tesseract-core-simd-lstm.wasm.js'),
    'eng.traineddata.gz': join(eng, '4.0.0_best_int/eng.traineddata.gz'),
  };
}

await vite({
  root: join(root, 'src'),
  publicDir: join(root, 'public'),
  logLevel: 'warn',
  build: {
    outDir: out,
    emptyOutDir: false,
    target: 'chrome116',
    modulePreload: false,
    rollupOptions: {
      input: {
        popup: join(root, 'src/popup.html'),
        options: join(root, 'src/options.html'),
        background: join(root, 'src/background/index.ts'),
        ...(harness ? { 'ocr-harness': join(root, 'src/harness/ocr-harness.html') } : {}),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
});

await esbuild({
  entryPoints: { 'page/fill': join(root, 'src/page/fill.ts'), 'page/watcher': join(root, 'src/page/watcher.ts') },
  outdir: out,
  bundle: true,
  format: 'iife',
  target: 'chrome116',
  logLevel: 'warning',
});

mkdirSync(join(out, 'ocr'), { recursive: true });
for (const [name, from] of Object.entries(ocrFiles())) copyFileSync(from, join(out, 'ocr', name));
copyFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), join(out, 'THIRD_PARTY_NOTICES.md'));
console.log(`built ${out}`);
