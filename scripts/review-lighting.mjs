import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ executablePath: process.env.CIKLISM_CHROME_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__lighting', route => route.fulfill({ contentType: 'text/html', body:
    '<style>html,body{margin:0;width:100%;height:100%}canvas{width:100%;height:100%;display:block}</style><canvas></canvas>' }));
  await page.goto('http://127.0.0.1:5184/__lighting');
  await page.evaluate(async () => {
    const { RideScene } = await import('/src/render/scene.ts');
    window.lightingReview = new RideScene(document.querySelector('canvas'));
    window.lightingReview.setOptions('high', false);
  });
  await mkdir('test-results/lighting', { recursive: true });
  const results = [];
  for (const [routeId, daylight, reversed, quality] of [
    ['ovalo','dia',false,'high'], ['ovalo','amanecer',false,'high'], ['ovalo','atardecer',false,'high'],
    ['ovalo','atardecer',true,'high'], ['ovalo','atardecer',true,'low'], ['ermita','dia',false,'high'],
  ]) {
    const result = await page.evaluate(async ({ routeId, daylight, reversed, quality }) => {
      const { RoutePath } = await import('/src/domain/route.ts');
      const { RideEngine } = await import('/src/domain/ride.ts');
      const { default: route } = await import(`/src/routes/${routeId}.json`);
      const renderer = window.lightingReview;
      renderer.setOptions(quality, false);
      const path = new RoutePath(route, reversed);
      await renderer.load(path, daylight, () => {});
      const sky = renderer.scene.getMeshByName('sky-dome');
      const previewSkyOffset = sky.getWorldMatrix().getTranslation().subtract(renderer.camera.globalPosition).length();
      renderer.engine.stopRenderLoop();
      const ride = new RideEngine(path); ride.state.distance = routeId === 'ovalo' ? 110 : 297;
      renderer.update(ride.state); renderer.scene.render();
      const textures = renderer.scene.textures.filter(t => t.url?.includes('/lighting/'));
      const trunk = renderer.scene.meshes.find(m => m.name.startsWith('trunks-'));
      return { routeId, daylight, reversed, quality, maps: textures.map(t => t.url),
        skyCount: renderer.scene.meshes.filter(m => m.name === 'sky-dome').length,
        previewSkyOffset, rideSkyOffset: sky.getWorldMatrix().getTranslation().subtract(renderer.camera.globalPosition).length(),
        mapBytes: textures.reduce((sum,t) => sum + t.getSize().width * t.getSize().height * 4 * 4 / 3, 0),
        shadowGenerators: renderer.scene.lights.filter(l => l.getShadowGenerator()).length,
        treeMatrices: Array.from(trunk._thinInstanceDataStorage.matrixData),
        staticLit: renderer.materials.filter(m => m.disableLighting && m.lightmapTexture).map(m => m.name) };
    }, { routeId, daylight, reversed, quality });
    if (result.maps.length !== 1 || result.shadowGenerators !== 0) throw new Error('Stale maps or dynamic shadow generator: ' + JSON.stringify(result));
    if (result.skyCount !== 1 || result.previewSkyOffset > 0.01 || result.rideSkyOffset > 0.01) throw new Error('Sky no longer follows the camera: ' + JSON.stringify(result));
    const name = `${routeId}-${daylight}${reversed ? '-reverse' : ''}-${quality}`;
    await page.screenshot({ path: `test-results/lighting/${name}.png` });
    results.push(result);
  }
  if (JSON.stringify(results[2].treeMatrices) !== JSON.stringify(results[3].treeMatrices)) throw new Error('Reversing moved the trees');
  if (results[2].maps[0] !== results[3].maps[0] || results[3].maps[0] !== results[4].maps[0]) throw new Error('Reversing/quality changed the bake');
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile('test-results/lighting/verification.json', JSON.stringify(results.map(({ treeMatrices, ...rest }) => rest), null, 2) + '\n');
  console.log('Verified: three daylight presets, stable reverse layout, shadows in savings, one resident lightmap, zero shadow generators, no JS errors.');
} finally { await browser.close(); }
