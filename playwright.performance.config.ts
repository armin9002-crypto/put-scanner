import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: 'performance.spec.ts', workers: 1, timeout: 180_000,
  expect: { timeout: 30_000 },
  outputDir: 'e2e-artifacts/performance-tests', reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4318', viewport: { width: 1440, height: 900 },
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined) },
  },
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 4318 --outDir e2e-artifacts/perf-dist', url: 'http://127.0.0.1:4318', reuseExistingServer: true },
});
