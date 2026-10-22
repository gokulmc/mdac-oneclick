import { defineConfig } from '@playwright/test';

// Extensions need a persistent context, which tests/e2e/extension.ts launches itself.
// Run `pnpm build` first (the test:e2e / qc scripts do). Set MDAC_DIST to test another build.
export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results/artifacts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  projects: [
    { name: 'e2e', testMatch: /.*\.spec\.ts/ },
    { name: 'qc', testMatch: /.*\.qc\.ts/ },
  ],
});
