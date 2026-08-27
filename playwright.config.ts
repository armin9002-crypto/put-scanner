import { defineConfig } from '@playwright/test';

const systemChrome = process.platform === 'win32'
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : undefined;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  outputDir: 'e2e-artifacts',
  reporter: [['line']],
  use: {
    baseURL: 'http://127.0.0.1:4317',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || systemChrome
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || systemChrome }
      : undefined,
  },
  projects: [
    { name: 'desktop-1440x900', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'tablet-1024x768', use: { viewport: { width: 1024, height: 768 } } },
    { name: 'portrait-375x667', use: { viewport: { width: 375, height: 667 } } },
    { name: 'portrait-390x844', use: { viewport: { width: 390, height: 844 } } },
    { name: 'portrait-430x932', use: { viewport: { width: 430, height: 932 } } },
    { name: 'landscape-667x375', use: { viewport: { width: 667, height: 375 } } },
    { name: 'landscape-844x390', use: { viewport: { width: 844, height: 390 } } },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4317',
    url: 'http://127.0.0.1:4317',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
