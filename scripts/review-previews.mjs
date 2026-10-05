import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ executablePath: process.env.CIKLISM_CHROME_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:5184/');
  await page.locator('#world[data-ready=true]').waitFor({ timeout: 45000 });
  await page.evaluate(() => document.fonts.ready);
  await mkdir('test-results/previews', { recursive: true });
  for (const route of ['ovalo', 'ruta_inicial', 'valle', 'puerto', 'embalse', 'ermita']) {
    await page.locator(`[data-route="${route}"]`).click();
    await page.locator('#world[data-ready=true][data-view=preview]').waitFor({ timeout: 45000 });
    await page.screenshot({ path: `test-results/previews/${route}.png` });
  }
  console.log({ errors, font: await page.locator('body').evaluate(el => getComputedStyle(el).fontFamily) });
  if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); }
