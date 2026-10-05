import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', outputDir: './test-results/e2e', fullyParallel: false, workers: 1, timeout: 60000,
  use: { baseURL: 'http://127.0.0.1:5185', screenshot: 'only-on-failure', trace: 'retain-on-failure',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      executablePath: process.env.CIKLISM_CHROME_PATH || undefined } },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 960 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } }],
  webServer: { command: 'npm run preview -- --port 5185 --strictPort', url: 'http://127.0.0.1:5185', reuseExistingServer: false, timeout: 60000 },
});
