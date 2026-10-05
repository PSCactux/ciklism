import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ executablePath: process.env.CIKLISM_CHROME_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 });
  await page.context().grantPermissions(['local-network-access']);
  const folder = `test-results/routes/${process.argv[2] || 'current'}`;
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/__routes', route => route.fulfill({ contentType: 'text/html', body:
    '<style>html,body{margin:0;width:100%;height:100%}canvas{width:100%;height:100%;display:block}</style><canvas></canvas>' }));
  await page.goto('http://localhost:5184/__routes');
  await page.evaluate(async () => {
    const { RideScene } = await import('/src/render/scene.ts');
    window.review = new RideScene(document.querySelector('canvas'));
    window.review.setOptions('high', false);
  });
  await mkdir(folder, { recursive: true });
  const results = [];
  for (const id of ['ovalo', 'ruta_inicial', 'valle', 'puerto', 'embalse', 'ermita']) {
    const result = await page.evaluate(async id => {
      const { routes } = await import('/src/routes/catalog.ts');
      const { RoutePath } = await import('/src/domain/route.ts');
      const option = routes.find(r => r.id === id), renderer = window.review;
      const start = performance.now(), phases = [];
      await renderer.load(option.path, 'dia', phase => phases.push({ phase, ms: Math.round(performance.now() - start) }), option.preview);
      const loadMs = Math.round(performance.now() - start), content = renderer.content, map = renderer.lightmap;
      const reverseStart = performance.now();
      await renderer.load(new RoutePath(option.route, true), 'dia', () => {}, option.preview);
      const reverseMs = Math.round(performance.now() - reverseStart);
      if (renderer.content !== content || renderer.lightmap !== map) throw new Error('Reverse rebuilt the route or its lightmap');
      await renderer.load(option.path, 'dia', () => {}, option.preview);
      renderer.engine.stopRenderLoop();
      if (renderer.canvas.dataset.renderMode !== 'full') throw new Error(`${id}: material fallback`);
      const water = renderer.scene.getMaterialByName('water');
      if (water && !water.reflectionTexture) throw new Error(`${id}: missing sky reflection`);
      return { id, km: option.path.totalLength / 1000, loadMs, reverseMs, phases, meshes: renderer.scene.meshes.length,
        triangles: renderer.scene.meshes.reduce((n, m) => n + m.getTotalIndices() / 3, 0),
        maps: renderer.scene.textures.filter(t => t.url?.includes('/lighting/')).length };
    }, id);
    if (result.maps !== 1) throw new Error('More than one lightmap resident');
    await page.screenshot({ path: `${folder}/${id}-preview.png` });
    for (const fraction of [0.05, 0.5, 0.95]) {
      await page.evaluate(async ({ id, fraction }) => {
        const { routes } = await import('/src/routes/catalog.ts');
        const { RideEngine } = await import('/src/domain/ride.ts');
        const path = routes.find(r => r.id === id).path, ride = new RideEngine(path);
        const distance = path.totalLength * fraction;
        Object.assign(ride.state, path.sample(distance), { distance, elapsedSeconds: 60 });
        window.review.update(ride.state);
        await window.review.prepareVisibleScene();
      }, { id, fraction });
      await page.screenshot({ path: `${folder}/${id}-ride-${fraction}.png` });
    }
    await page.evaluate(async () => {
      const renderer = window.review;
      renderer.setOptions('low', false); await renderer.prepareVisibleScene();
      if (renderer.canvas.dataset.renderMode !== 'full') throw new Error('Low quality material fallback');
      renderer.setOptions('high', false); await renderer.prepareVisibleScene();
    });
    results.push(result); console.log(JSON.stringify(result));
  }
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile(`${folder}/verification.json`, JSON.stringify({ device: 'Chromium SwiftShader, 1100×700, DPR 1', errors, results }, null, 2) + '\n');
} finally { await browser.close(); }
