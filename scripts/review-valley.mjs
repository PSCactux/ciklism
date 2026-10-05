import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const label = process.argv[2] || 'after';
const browser = await chromium.launch({ executablePath: process.env.CIKLISM_CHROME_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  await context.grantPermissions(['local-network-access']);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/__valley', route => route.fulfill({ contentType: 'text/html', body:
    '<style>html,body{margin:0;width:100%;height:100%}canvas{width:100%;height:100%;display:block}</style><canvas></canvas>' }));
  await page.goto('http://localhost:5184/__valley');
  const folder = `test-results/valley/${label}`;
  await mkdir(folder, { recursive: true });
  const stats = await page.evaluate(async () => {
    const { RideScene } = await import('/src/render/scene.ts');
    const { routes } = await import('/src/routes/catalog.ts');
    const renderer = window.review = new RideScene(document.querySelector('canvas'));
    renderer.setOptions('high', false);
    const option = routes.find(r => r.id === 'valle'), start = performance.now();
    await renderer.load(option.path, 'dia', () => {}, option.preview);
    renderer.engine.stopRenderLoop(); renderer.scene.render();
    return { loadMs: Math.round(performance.now() - start), mode: renderer.canvas.dataset.renderMode,
      active: renderer.scene.getActiveMeshes().length, meshes: renderer.scene.meshes.length };
  });
  await page.screenshot({ path: `${folder}/preview.png` });
  for (const fraction of [0.05, 0.36, 0.75]) {
    await page.evaluate(async fraction => {
      const { routes } = await import('/src/routes/catalog.ts');
      const { RideEngine } = await import('/src/domain/ride.ts');
      const path = routes.find(r => r.id === 'valle').path, ride = new RideEngine(path);
      const distance = path.totalLength * fraction;
      Object.assign(ride.state, path.sample(distance), { distance });
      window.review.update(ride.state); await window.review.prepareVisibleScene();
    }, fraction);
    await page.screenshot({ path: `${folder}/ride-${fraction}.png` });
  }
  const app = await page.context().newPage();
  await app.setViewportSize({ width: 1600, height: 1000 });
  app.on('pageerror', e => errors.push(e.message));
  await app.goto('http://localhost:5184/');
  await app.locator('#world[data-ready=true]').waitFor({ timeout: 45000 });
  await app.locator('[data-route="valle"]').click();
  await app.locator('#world[data-ready=true]').waitFor({ timeout: 45000 });
  await app.evaluate(() => document.fonts.ready);
  await app.locator('.route-preview').screenshot({ path: `${folder}/app-preview.png` });
  await app.getByRole('button', { name: 'Probar la ruta', exact: true }).click();
  await app.locator('#world[data-view=ride]').waitFor();
  await app.getByRole('button', { name: 'Pausar', exact: true }).click();
  await app.locator('#pause-cover').waitFor({ state: 'visible' });
  console.log(JSON.stringify({ ...stats, errors }));
  await writeFile(`${folder}/verification.json`, JSON.stringify({ ...stats, errors }, null, 2));
  if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); }
