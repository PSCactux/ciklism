import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ executablePath: process.env.CIKLISM_CHROME_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  await mkdir('test-results/ui-review', { recursive: true });
  for (const [name, width, height, touch] of [['desktop',1440,1000,false], ['mobile',390,844,true], ['landscape',844,390,true], ['small',320,740,true]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch });
    page.on('pageerror', e => console.error(name, e));
    await page.goto('http://127.0.0.1:5184/');
    await page.locator('#world[data-ready=true]').waitFor({ timeout: 45000 });
    await page.screenshot({ path: `test-results/ui-review/${name}-home.png`, fullPage: true });
    if (name === 'desktop' || name === 'mobile') {
      for (const action of ['settings','history','profile']) {
        await page.locator(`.app-header [data-action=${action}]`).click();
        await page.screenshot({ path: `test-results/ui-review/${name}-${action}.png` });
        await page.locator('.dialog-heading [data-action=close]').click();
      }
    }
    await page.getByRole('button', { name: 'Probar la ruta' }).click();
    await page.waitForTimeout(1700);
    await page.screenshot({ path: `test-results/ui-review/${name}-ride.png` });
    console.log(name, await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
      hud: document.querySelector('.hud')?.getBoundingClientRect().toJSON(), controls: document.querySelector('.ride-controls')?.getBoundingClientRect().toJSON() })));
    await page.getByRole('button', { name: 'Pausar', exact: true }).click();
    await page.screenshot({ path: `test-results/ui-review/${name}-pause.png` });
    await page.getByRole('button', { name: 'Terminar y guardar', exact: true }).click();
    await page.getByRole('button', { name: 'Guardar salida', exact: false }).click();
    await page.getByRole('dialog').getByText('Bien rodado.', { exact: true }).waitFor();
    await page.screenshot({ path: `test-results/ui-review/${name}-summary.png` });
    await page.close();
  }
} finally { await browser.close(); }
