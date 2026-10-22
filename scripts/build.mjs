// Builds the unpacked extension into dist/:
//   popup.html, options.html, background.js  (Vite, ES modules)
//   page/fill.js, page/watcher.js             (esbuild IIFE: injected scripts cannot import)
import { build as vite } from 'vite';
import { build as esbuild } from 'esbuild';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
rmSync(join(root, 'dist'), { recursive: true, force: true });

await vite({
  root: join(root, 'src'),
  publicDir: join(root, 'public'),
  logLevel: 'warn',
  build: {
    outDir: join(root, 'dist'),
    emptyOutDir: false,
    target: 'chrome116',
    modulePreload: false,
    rollupOptions: {
      input: {
        popup: join(root, 'src/popup.html'),
        options: join(root, 'src/options.html'),
        background: join(root, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
});

await esbuild({
  entryPoints: { 'page/fill': join(root, 'src/page/fill.ts'), 'page/watcher': join(root, 'src/page/watcher.ts') },
  outdir: join(root, 'dist'),
  bundle: true,
  format: 'iife',
  target: 'chrome116',
  logLevel: 'warning',
});
console.log('built dist/');
