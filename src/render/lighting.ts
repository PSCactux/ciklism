import { RoutePath, type Route, type Vec3 } from '../domain/route';
import { groundAt, hash, roadside } from './geometry';
import { landscape, lakeFor, lakeRadius, riverProfile } from './scenery';

export type Daylight = 'dia' | 'amanecer' | 'atardecer';
/** Directions point from the sun towards the ground. Bake and renderer share them. */
export const LIGHTING = {
  dia: { direction: { x: -0.6, y: -0.8, z: 0.3 }, sun: '#fff0d7', intensity: 1.18, ambient: 0.62, warmth: 0.08 },
  amanecer: { direction: { x: 0.65, y: -0.28, z: -0.35 }, sun: '#ffdab3', intensity: 1.08, ambient: 0.53, warmth: 0.52 },
  atardecer: { direction: { x: -0.65, y: -0.25, z: 0.4 }, sun: '#ffd0a0', intensity: 1.16, ambient: 0.50, warmth: 0.65 },
} satisfies Record<Daylight, { direction: Vec3; sun: string; intensity: number; ambient: number; warmth: number }>;

export interface TreePlacement { x: number; y: number; z: number; height: number; yaw: number; lean: number; kind: 'pine' | 'spruce' | 'alder' }
/** Diffuse sun/sky contribution for static vertices. Called only during route preparation. */
export function surfaceIrradiance(normal: Vec3, daylight: Daylight): [number, number, number] {
  const light = LIGHTING[daylight], direction = light.direction;
  const normalLength = Math.hypot(normal.x, normal.y, normal.z) || 1;
  const direct = Math.max(0, -(normal.x * direction.x + normal.y * direction.y + normal.z * direction.z) /
    (normalLength * Math.hypot(direction.x, direction.y, direction.z))) * light.intensity;
  const sky = Math.max(0, Math.min(1, (normal.x * 0.2 + normal.y + normal.z * 0.3) / (normalLength * Math.hypot(0.2, 1, 0.3)) * 0.5 + 0.5));
  const sun = parseInt(light.sun.slice(1), 16), skyColor = [216, 230, 255], groundColor = [75, 73, 51];
  return [16, 8, 0].map((shift, i) => ((groundColor[i] * (1 - sky) + skyColor[i] * sky) * light.ambient +
    ((sun >>> shift) & 255) * direct) / 255 * 0.78) as [number, number, number];
}
/** Use canonical route order: reversing the ride must not move trees or their shadows. */
export function treeLayout(route: Route): TreePlacement[] {
  const path = new RoutePath(route), trees: TreePlacement[] = [];
  const biome = landscape(route), lake = lakeFor(route);
  for (let i = 0, d = 0; d < path.totalLength; i++, d += biome.treeStep) {
    for (const side of [-1, 1]) for (let cluster = 0; cluster < biome.clusters; cluster++) {
      const seed = i * 7 + side + 23 + cluster * 15001;
      const river = route.scenery === 'river';
      // Keep openings in the floodplain, with continuous woodland higher up.
      const clearing = river ? 0.22 + Math.max(0, Math.sin(d / 150 + cluster)) * 0.22 : 0.12;
      if (hash(seed, 2) < clearing) continue;
      const offset = river ? 14 + cluster * 28 + hash(seed, 3) * 24 :
        cluster === 0 ? 8 + hash(seed, 3) * 45 : 55 + hash(seed, 3) * 140;
      const p = roadside(path, d + (river ? hash(seed, 4) * 14 : 0), side * offset);
      const ground = groundAt(path, p.x, p.z);
      if (ground.distance < 6) continue;
      if (lake && lakeRadius(lake, p.x, p.z) < 1.16) continue;
      if (river) {
        const profile = riverProfile(ground.along);
        if (Math.abs(ground.lateral - profile.center) < profile.halfWidth + 8) continue;
      }
      trees.push({ x: p.x, y: ground.height, z: p.z, height: (8 + hash(seed, 7) * 9) * biome.treeHeight,
        kind: river ? hash(seed, 12) < 0.48 ? 'spruce' : 'alder' : 'pine',
        yaw: hash(seed, 9) * 6.28, lean: (hash(seed, 3) - 0.5) * 0.05 });
    }
  }
  return trees;
}

export function lightmapBounds(route: Route) {
  const xs = route.puntos.map(p => p.x), zs = route.puntos.map(p => p.z), margin = route.scenery === 'river' ? 540 : 320;
  const x = Math.floor(Math.min(...xs) - margin), z = Math.floor(Math.min(...zs) - margin);
  const width = Math.ceil(Math.max(...xs) + margin) - x, depth = Math.ceil(Math.max(...zs) + margin) - z;
  // At most 2048² RGBA plus mipmaps; only the current route/time is resident.
  const longest = Math.max(width, depth);
  const size = (length: number) => Math.max(512, 2 ** Math.ceil(Math.log2(2048 * length / longest)));
  return { x, z, width, depth, pixelsX: size(width), pixelsZ: size(depth) };
}
export function lightmapUV(route: Route, positions: number[]) {
  const b = lightmapBounds(route), uvs: number[] = [];
  for (let i = 0; i < positions.length; i += 3) uvs.push((positions[i] - b.x) / b.width, 1 - (positions[i + 2] - b.z) / b.depth);
  return uvs;
}
/** Version the recipe as well as inputs so a stale bake cannot silently match a route. */
export function lightingKey(route: Route, daylight: Daylight) {
  const recipe = JSON.stringify({ version: route.scenery === 'river' ? 6 : 4, route, light: LIGHTING[daylight], bounds: lightmapBounds(route) });
  let value = 2166136261;
  for (let i = 0; i < recipe.length; i++) value = Math.imul(value ^ recipe.charCodeAt(i), 16777619);
  return (value >>> 0).toString(16).padStart(8, '0');
}

/** Intersect a ray with the continuous height field during baking, never while riding. */
export function projectShadow(path: RoutePath, point: Vec3, direction: Vec3): Vec3 {
  let lo = 0, hi = (Math.max(0, point.y - groundAt(path, point.x, point.z).height) + 80) / -direction.y;
  for (let i = 0; i < 14; i++) {
    const t = (lo + hi) / 2, x = point.x + direction.x * t, z = point.z + direction.z * t;
    if (point.y + direction.y * t > groundAt(path, x, z).height) lo = t; else hi = t;
  }
  const t = (lo + hi) / 2;
  return { x: point.x + direction.x * t, y: point.y + direction.y * t, z: point.z + direction.z * t };
}
