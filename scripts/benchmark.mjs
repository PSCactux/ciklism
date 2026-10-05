// Start `npm run dev` first. Identical software GPU settings make runs comparable;
// these numbers do not measure a physical phone's GPU, power use or battery life.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const label = process.argv[2] || 'current';
const quality = process.argv[3] || 'high';
const routeId = process.argv[4] || 'ermita';
const source = process.env.CIKLISM_RENDER_SOURCE || '/src/render/scene.ts';
const browser = await chromium.launch({
  executablePath: process.env.CIKLISM_CHROME_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
  await page.context().grantPermissions(['local-network-access']);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.setDefaultTimeout(60000);
  await page.route('**/__benchmark', route => route.fulfill({ contentType: 'text/html', body:
    '<style>html,body{margin:0;width:100%;height:100%}canvas{width:100%;height:100%;display:block}</style><canvas></canvas>' }));
  await page.goto('http://127.0.0.1:5184/__benchmark');
  const result = await page.evaluate(async ({ quality, source, routeId }) => {
    const { RideScene } = await import(source);
    const { RoutePath } = await import('/src/domain/route.ts');
    const { RideEngine } = await import('/src/domain/ride.ts');
    const { default: route } = await import(`/src/routes/${routeId}.json`);
    const renderer = new RideScene(document.querySelector('canvas'));
    window.benchmarkRenderer = renderer;
    renderer.setOptions(quality, false);
    const path = new RoutePath(route), ride = new RideEngine(path);
    const started = performance.now();
    await Promise.race([renderer.load(path, 'dia', () => {}), new Promise((_, reject) => setTimeout(() => reject(new Error('Renderer readiness timeout: ' + renderer.scene.meshes.filter(m => !m.isReady(true)).map(m => m.name).join(', '))), 45000))]);
    const loadMs = performance.now() - started;
    if (renderer.canvas.dataset.renderMode !== 'full') throw new Error('Benchmark requires the full renderer');
    const scene = renderer.scene;
    let frames = 0;
    scene.onAfterRenderObservable.add(() => frames++);
    await new Promise(resolve => setTimeout(resolve, 1000));
    const idleFrames = frames;
    renderer.engine.stopRenderLoop();
    const samples = [];
    // Manually sample identical positions, independent of presentation frame cap.
    for (let i = 0; i < 100; i++) {
      ride.state.distance = i * 3;
      renderer.update(ride.state);
      const before = performance.now();
      renderer.engine.beginFrame();
      renderer.engine._drawCalls.fetchNewFrame();
      scene.render();
      // Force submitted work to complete for this controlled software benchmark.
      const gl = renderer.engine._gl;
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      renderer.engine.endFrame();
      const elapsed = performance.now() - before;
      if (i >= 20) samples.push({ ms: elapsed, indices: scene.getActiveIndices(),
        meshes: scene.getActiveMeshes().length, draws: renderer.engine._drawCalls.current });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const sorted = samples.map(s => s.ms).sort((a, b) => a - b);
    const average = key => Math.round(samples.reduce((n, s) => n + s[key], 0) / samples.length);
    window.benchmarkRenderer = renderer;
    return { route: route.nombre, backend: 'Chromium / ANGLE SwiftShader (software)', viewport: '960x640 DPR 1',
      quality, renderSize: `${renderer.engine.getRenderWidth()}x${renderer.engine.getRenderHeight()}`,
      presentationCapFps: renderer.targetFps ?? 'unbounded', loadMs: Math.round(loadMs), idleFrames, residentVertices: scene.getTotalVertices(),
      activeTriangles: Math.round(average('indices') / 3), activeMeshes: average('meshes'), drawCalls: average('draws'),
      frameMedianMs: +sorted[40].toFixed(2), frameP95Ms: +sorted[76].toFixed(2) };
  }, { quality, source, routeId });
  if (errors.length) throw new Error(errors.join('\n'));
  await mkdir('test-results/benchmark', { recursive: true });
  await page.screenshot({ path: `test-results/benchmark/${label}.png` });
  await writeFile(`test-results/benchmark/${label}.json`, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
