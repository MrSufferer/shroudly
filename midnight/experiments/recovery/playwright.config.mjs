import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.browser.spec.mjs',
  workers: 1,
  timeout: 60000,
  reporter: 'list',
  use: {channel: 'chrome', headless: true},
});
