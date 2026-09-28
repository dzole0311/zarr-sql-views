import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './browser',
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:4175',
    viewport: { width: 1280, height: 900 },
    launchOptions: { args: ['--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: 'npm run preview -- --port 4175 --strictPort',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
  },
});
