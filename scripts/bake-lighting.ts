// Development-only baker, loaded through Vite by bake-lighting.mjs.
// It is never imported by the app or shipped in its JS bundle.
import { RoutePath, type Route } from '../src/domain/route';
import { LIGHTING, lightmapBounds, projectShadow, treeLayout, type Daylight } from '../src/render/lighting';

export async function bakeLighting(route: Route, daylight: Daylight) {
  const b = lightmapBounds(route), path = new RoutePath(route), light = LIGHTING[daylight];
  const canvas = document.createElement('canvas'); canvas.width = b.pixelsX; canvas.height = b.pixelsZ;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const river = route.scenery === 'river';
  const image = await createImageBitmap(await (await fetch(`/textures/${river ? 'valley-trees' : 'pine-tree'}.webp`)).blob());
  const masks = Array.from({ length: river ? 2 : 1 }, (_, column) => {
    const mask = document.createElement('canvas'); mask.width = image.width / (river ? 2 : 1); mask.height = image.height;
    const mc = mask.getContext('2d')!;
    mc.drawImage(image, column * mask.width, 0, mask.width, mask.height, 0, 0, mask.width, mask.height);
    mc.globalCompositeOperation = 'source-in'; mc.fillStyle = '#000'; mc.fillRect(0, 0, mask.width, mask.height);
    return mask;
  });
  image.close();
  const sx = b.pixelsX / b.width, sz = b.pixelsZ / b.depth;
  const length = Math.hypot(light.direction.x, light.direction.z);
  const cross = { x: light.direction.z / length, z: -light.direction.x / length };
  for (const tree of treeLayout(route)) {
    // Project the photographic crown in strips so it follows the receiving slope.
    const mask = masks[tree.kind === 'alder' ? 1 : 0];
    const strips = 12, width = tree.height * (river ? 0.75 : 2 / 3);
    ctx.globalAlpha = 0.86;
    for (let i = 0; i < strips; i++) {
      const top = i / strips, bottom = (i + 1) / strips;
      const a = projectShadow(path, { x: tree.x, y: tree.y + tree.height * (1.018 - top * 1.036), z: tree.z }, light.direction);
      const c = projectShadow(path, { x: tree.x, y: tree.y + tree.height * (1.018 - bottom * 1.036), z: tree.z }, light.direction);
      const row = mask.height / strips;
      ctx.setTransform(cross.x * width * sx / mask.width, cross.z * width * sz / mask.width,
        (c.x - a.x) * sx / row, (c.z - a.z) * sz / row,
        (a.x - cross.x * width / 2 - b.x) * sx, (a.z - cross.z * width / 2 - b.z) * sz);
      ctx.drawImage(mask, 0, i * row, mask.width, row, 0, 0, mask.width, row + 0.5);
    }
    // Broad contact occlusion anchors trunks and suggests shade beneath the canopy.
    ctx.setTransform(sx, 0, 0, sz, -b.x * sx, -b.z * sz); ctx.globalAlpha = 1;
    const radius = tree.height * 0.24;
    const gradient = ctx.createRadialGradient(tree.x, tree.z, 0, tree.x, tree.z, radius);
    gradient.addColorStop(0, '#000b'); gradient.addColorStop(0.35, '#0006'); gradient.addColorStop(1, '#0000');
    ctx.fillStyle = gradient; ctx.fillRect(tree.x - radius, tree.z - radius, radius * 2, radius * 2);
  }
  ctx.resetTransform();
  // A fixed penumbra is baked once; the mobile renderer only samples the result.
  const soft = document.createElement('canvas'); soft.width = canvas.width; soft.height = canvas.height;
  const sc = soft.getContext('2d')!; sc.filter = 'blur(0.65px)'; sc.drawImage(canvas, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(soft, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const shade = pixels.data[i + 3] / 255;
    // Keep blue skylight in shade, instead of multiplying everything by black.
    pixels.data[i] = Math.round(255 * (1 - shade * 0.48));
    pixels.data[i + 1] = Math.round(255 * (1 - shade * 0.41));
    pixels.data[i + 2] = Math.round(255 * (1 - shade * 0.29));
    pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas.toDataURL('image/webp', 0.92).split(',')[1];
}
