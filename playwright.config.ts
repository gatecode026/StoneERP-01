import { defineConfig } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 3100);

// Phone-sized screen (360 px) is the main target; set E2E_CHANNEL=msedge to use an installed Edge instead of downloading Chromium.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 360, height: 780 },
    channel: process.env.E2E_CHANNEL || undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npx tsx scripts/e2e-server.ts',
    url: `http://localhost:${port}/login`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
  },
});
