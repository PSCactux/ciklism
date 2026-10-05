import { chromium } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';

// Rasterize our vector mark for native launchers and iOS home-screen installation.
const browser = await chromium.launch({ executablePath: process.env.CIKLISM_CHROME_PATH || undefined });
const page = await browser.newPage({ deviceScaleFactor: 1 });
const svg = await readFile(new URL('../public/icon.svg', import.meta.url), 'utf8');
async function icon(path, size, padding = 0) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;background:#152820;padding:${padding}px}svg{width:100%;height:100%}</style>${svg}`);
  await page.screenshot({ path });
}
await icon('public/icon-192.png', 192);
await icon('public/icon-512.png', 512);
await icon('public/apple-touch-icon.png', 180);
await icon('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', 1024);
for (const [folder, size, foreground] of [['mdpi',48,108],['hdpi',72,162],['xhdpi',96,216],['xxhdpi',144,324],['xxxhdpi',192,432]]) {
  await icon(`android/app/src/main/res/mipmap-${folder}/ic_launcher.png`, size);
  await icon(`android/app/src/main/res/mipmap-${folder}/ic_launcher_round.png`, size);
  await icon(`android/app/src/main/res/mipmap-${folder}/ic_launcher_foreground.png`, foreground, Math.round(foreground * .25));
}
// A quiet branded launch screen, shared by the generated native containers.
for (const entry of await readdir('ios/App/App/Assets.xcassets/Splash.imageset')) {
  if (entry.endsWith('.png')) await icon(`ios/App/App/Assets.xcassets/Splash.imageset/${entry}`, 1024, 430);
}
for (const dir of await readdir('android/app/src/main/res')) {
  if (!dir.startsWith('drawable')) continue;
  if ((await readdir(`android/app/src/main/res/${dir}`)).includes('splash.png')) await icon(`android/app/src/main/res/${dir}/splash.png`, 1024, 430);
}
await browser.close();
