// Run with the development server on 5184. Generates local assets, no remote service.
import { chromium } from '@playwright/test';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ executablePath: process.env.CIKLISM_CHROME_PATH || undefined });
try {
  const page = await browser.newPage();
  await page.route('**/__bake', route => route.fulfill({ contentType: 'text/html', body: '<title>Lighting baker</title>' }));
  await page.goto('http://127.0.0.1:5184/__bake');
  const jobs = await page.evaluate(async () => {
    const { routes } = await import('/src/routes/catalog.ts');
    return routes.flatMap(r => ['dia','amanecer','atardecer'].map(daylight => ({ id: r.id, route: r.route, daylight })));
  });
  await mkdir('public/lighting', { recursive: true });
  const previous = await readFile('public/lighting/manifest.json', 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return {}; throw error;
  });
  const manifest = {};
  for (const job of jobs) {
    const result = await page.evaluate(async ({ route, daylight }) => {
      const { bakeLighting } = await import('/scripts/bake-lighting.ts');
      const { lightingKey, lightmapBounds } = await import('/src/render/lighting.ts');
      return { key: lightingKey(route, daylight), bounds: lightmapBounds(route), data: await bakeLighting(route, daylight) };
    }, job);
    const file = `${result.key}.webp`, buffer = Buffer.from(result.data, 'base64');
    await writeFile(`public/lighting/${file}`, buffer);
    manifest[result.key] = { route: job.id, daylight: job.daylight, file, ...result.bounds, bytes: buffer.length };
    console.log(`${job.id}/${job.daylight}: ${result.bounds.pixelsX}×${result.bounds.pixelsZ}, ${Math.round(buffer.length / 1024)} KiB`);
  }
  await writeFile('public/lighting/manifest.json.tmp', JSON.stringify(manifest, null, 2) + '\n');
  await rename('public/lighting/manifest.json.tmp', 'public/lighting/manifest.json');
  for (const [key, entry] of Object.entries(previous)) {
    if (!manifest[key] && /^[a-f0-9]{8}\.webp$/.test(entry.file)) await unlink(`public/lighting/${entry.file}`).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
} finally { await browser.close(); }
