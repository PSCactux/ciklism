import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export default defineConfig({
  // Relative base: the same build works at a domain root, under /ciklism/ on GitHub Pages
  // and inside the Capacitor containers.
  base: './',
  // Pre-bundled dependencies live under their own folder name; see the cache note below.
  cacheDir: 'node_modules/.vite/megabici',
  plugins: [{ name: 'local-render-diagnostics', configureServer(server) {
    // Vite serves pre-bundled dependency chunks as immutable for a year, but the chunks import each
    // other without a version. After a new dependency is bundled, a browser can pair a cached old
    // chunk with new ones: Babylon then registers its shaders in a second copy of its shader store,
    // cannot find them and fetches them by URL, which here returns index.html as shader source.
    // Revalidating every chunk costs a 304 and keeps one consistent set.
    server.middlewares.use((req, res, next) => {
      if (req.url?.includes('/node_modules/.vite/')) {
        const setHeader = res.setHeader.bind(res);
        res.setHeader = (name, value) => setHeader(name, name.toLowerCase() === 'cache-control' ? 'no-cache' : value);
      }
      next();
    });
    const entries: unknown[] = [];
    let writing = Promise.resolve();
    server.ws.on('megabici:render-diagnostic', data => {
      entries.push({ at: new Date().toISOString(), data });
      if (entries.length > 30) entries.shift();
      const snapshot = JSON.stringify(entries, null, 2);
      writing = writing.then(async () => {
        const folder = resolve(server.config.root, 'test-results');
        await mkdir(folder, { recursive: true });
        await writeFile(resolve(folder, 'live-render-diagnostics.json'), snapshot);
      }).catch(error => server.config.logger.error(String(error)));
    });
  } }, VitePWA({
    registerType: 'prompt',
    injectRegister: false,
    includeAssets: ['icon.svg', 'apple-touch-icon.png'],
    manifest: {
      name: 'MegaBici', short_name: 'MegaBici', lang: 'es',
      description: 'Tus rutas de ciclismo indoor, en cualquier pantalla.',
      theme_color: '#152820', background_color: '#f3f2e9', display: 'standalone',
      icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,json,svg,png,webp,woff2}'],
      maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      cleanupOutdatedCaches: true,
    },
  })],
  build: { target: 'es2022' },
  server: { port: 5184, strictPort: true },
});
