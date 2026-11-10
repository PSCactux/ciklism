import { RoutePath, type Route } from '../domain/route';
import { groundAt, hash, roadside, terrainHeightAt } from './geometry';
import { lakeFor, lakeRadius, riverProfile } from './scenery';

/** Where something stands. Everything here follows the course's own direction, like the trees. */
export interface Spot { x: number; y: number; z: number; yaw: number; size: number; seed: number }
export interface Rail extends Spot { pitch: number; length: number }
export interface Village { distance: number; name: string; houses: Spot[]; signs: Spot[] }

const FIRST = ['Villar', 'Aldea', 'Puebla', 'Casas', 'Venta', 'Molino', 'Fuente', 'Torre', 'Santa Marta', 'Robledo'];
const LAST = ['del Prado', 'de la Sierra', 'del Río', 'de los Pinos', 'del Collado', 'de Arriba', 'de la Vega', 'del Olmo', 'de las Eras', 'del Castañar'];
const seedOf = (route: Route) => [...route.nombre].reduce((sum, ch) => sum * 31 + ch.charCodeAt(0) | 0, 7);

/** Free ground: clear of the road, the water and the river bed. */
function clear(path: RoutePath, x: number, z: number, margin: number) {
  const ground = groundAt(path, x, z), lake = lakeFor(path.route);
  if (ground.distance < margin || (lake && lakeRadius(lake, x, z) < 1.22)) return false;
  if (path.route.scenery !== 'river') return true;
  const river = riverProfile(ground.along);
  return Math.abs(ground.lateral - river.center) > river.halfWidth + 12;
}
const yawOf = (path: RoutePath, distance: number) => { const f = path.sample(distance).forward; return Math.atan2(f.x, f.z); };
/** The river runs on the right of the road, so anything beside a river course goes on the left. */
const sideOf = (route: Route, n: number, salt: number) => route.scenery === 'river' ? -1 : hash(n, salt) < 0.5 ? -1 : 1;
function stand(path: RoutePath, distance: number, lateral: number, yaw: number, size: number, seed: number, margin: number): Spot | null {
  const p = roadside(path, Math.min(path.totalLength, Math.max(0, distance)), lateral);
  return clear(path, p.x, p.z, margin) ? { x: p.x, y: terrainHeightAt(path, p.x, p.z), z: p.z, yaw, size, seed } : null;
}

/** Small named villages give the course places to pass through. */
export function villages(route: Route): Village[] {
  const path = new RoutePath(route), length = path.totalLength, base = seedOf(route);
  const count = length < 2500 ? 1 : Math.min(14, Math.max(1, Math.round(length / 5000)));
  const found: Village[] = [], names = new Set<string>();
  for (let i = 0; i < count; i++) {
    const distance = length * (i + 0.5) / count + (hash(i, base) - 0.5) * length / count * 0.4;
    if (distance < 220 || distance > length - 220) continue;
    const houses: Spot[] = [], heading = yawOf(path, distance);
    for (let k = 0, n = 4 + Math.floor(hash(i * 31 + 5, base) * 5); k < n; k++) {
      const seed = base + i * 97 + k * 13, side = sideOf(route, seed, 3);
      // Houses face the road, each turned a little its own way.
      const house = stand(path, distance + (hash(seed, 1) - 0.5) * 170, side * (16 + hash(seed, 2) * 42),
        heading + side * Math.PI / 2 + (hash(seed, 4) - 0.5) * 0.5, 0.85 + hash(seed, 5) * 0.4, seed, 13);
      if (house && houses.every(h => Math.hypot(h.x - house.x, h.z - house.z) > 12)) houses.push(house);
    }
    if (houses.length < 2) continue;
    let name = '';
    for (let n = 0; !name || names.has(name); n++) name = `${FIRST[Math.floor(hash(i + n * 7, base + 11) * FIRST.length)]} ${LAST[Math.floor(hash(i + n * 5, base + 23) * LAST.length)]}`;
    names.add(name);
    // One name board for each direction of travel, on the rider's right.
    const signs = [[-110, 4.9, 0], [110, -4.9, Math.PI]].map(([along, lateral, turn]) => {
      const p = roadside(path, distance + along, lateral);
      return { x: p.x, y: p.y, z: p.z, yaw: yawOf(path, distance + along) + turn, size: 1, seed: i };
    });
    found.push({ distance, name, houses, signs });
  }
  return found;
}
function clusters(route: Route, allowed: string[], block: number, chance: number, salt: number,
  place: (path: RoutePath, n: number, distance: number, side: number) => (Spot | null)[]) {
  if (!allowed.includes(route.scenery ?? 'meadow')) return [];
  const path = new RoutePath(route), base = seedOf(route) + salt, spots: Spot[] = [];
  for (let n = 0, d = block * 0.6; d < path.totalLength - 60; n++, d += block) {
    if (hash(n, base) > chance) continue;
    for (const spot of place(path, n * 101 + base, d + hash(n, base + 1) * block * 0.5, sideOf(route, n, base + 2))) if (spot) spots.push(spot);
  }
  return spots;
}
/** Flocks of sheep grazing near the road. */
export const flocks = (route: Route) => clusters(route, ['meadow', 'lake', 'river', 'chapel', 'reservoir'], 700, 0.55, 401, (path, seed, d, side) => {
  const lateral = side * (16 + hash(seed, 1) * 38);
  return Array.from({ length: 5 + Math.floor(hash(seed, 2) * 5) }, (_, k) => stand(path, d + (hash(seed + k, 3) - 0.5) * 26,
    lateral + (hash(seed + k, 4) - 0.5) * 22, hash(seed + k, 5) * 6.28, 0.85 + hash(seed + k, 6) * 0.35, seed + k, 9));
});
/** Round hay bales left in the fields after the harvest. */
export const bales = (route: Route) => clusters(route, ['meadow', 'chapel', 'reservoir'], 520, 0.45, 577, (path, seed, d, side) => {
  const lateral = side * (20 + hash(seed, 1) * 55);
  return Array.from({ length: 3 + Math.floor(hash(seed, 2) * 4) }, (_, k) => stand(path, d + (hash(seed + k, 3) - 0.5) * 60,
    lateral + (hash(seed + k, 4) - 0.5) * 34, hash(seed + k, 5) * 6.28, 0.9 + hash(seed + k, 6) * 0.25, seed + k, 12));
});
/** Wind turbines on the high ground, well back from the road. */
export const turbines = (route: Route) => clusters(route, ['meadow', 'chapel', 'reservoir', 'alpine'], 2600, 0.7, 733, (path, seed, d, side) => {
  const lateral = side * (190 + hash(seed, 1) * 150);
  return Array.from({ length: 2 + Math.floor(hash(seed, 2) * 2) }, (_, k) => stand(path, d + k * 110, lateral + (hash(seed + k, 4) - 0.5) * 60,
    hash(seed, 5) * 6.28, 0.9 + hash(seed + k, 6) * 0.25, seed + k, 140));
});
/** Wooden field fences along some stretches, and steel barriers on the outside of the sharper bends. */
export function barriers(route: Route) {
  const path = new RoutePath(route), base = seedOf(route) + 911, wood = ['meadow', 'lake', 'river', 'chapel', 'reservoir'].includes(route.scenery ?? 'meadow');
  const fences = { posts: [] as Spot[], rails: [] as Rail[] }, guards = { posts: [] as Spot[], rails: [] as Rail[] };
  const run = (into: typeof fences, from: number, to: number, lateral: number, step: number, lift: (p: { x: number; y: number; z: number }) => number) => {
    let previous: Spot | null = null;
    for (let d = from; d <= to; d += step) {
      const p = roadside(path, d, lateral), post: Spot = { x: p.x, y: lift(p), z: p.z, yaw: yawOf(path, d), size: 1, seed: 0 };
      into.posts.push(post);
      if (previous) {
        const dx = post.x - previous.x, dy = post.y - previous.y, dz = post.z - previous.z;
        into.rails.push({ x: (post.x + previous.x) / 2, y: (post.y + previous.y) / 2, z: (post.z + previous.z) / 2, yaw: Math.atan2(dx, dz),
          pitch: -Math.atan2(dy, Math.hypot(dx, dz)), length: Math.hypot(dx, dy, dz), size: 1, seed: 0 });
      }
      previous = post;
    }
  };
  for (let n = 0, d = 60; d < path.totalLength - 260; n++, d += 240) {
    if (!wood || hash(n, base) > 0.4) continue;
    run(fences, d, d + 110 + hash(n, base + 1) * 110, sideOf(route, n, base + 2) * 6.6, 3, p => terrainHeightAt(path, p.x, p.z));
  }
  // A bend is guarded on its outside for as long as it stays tight.
  let from = -1, turn = 0;
  for (let d = 40; d < path.totalLength - 40; d += 8) {
    const curve = path.curvatureAt(d, 24), tight = Math.abs(curve) > 0.0032;
    if (tight && from < 0) { from = d; turn = Math.sign(curve); }
    if (from >= 0 && (!tight || Math.sign(curve) !== turn)) {
      if (d - from > 30) run(guards, from, d, -turn * 3.75, 4, p => p.y + 0.02);
      from = -1;
    }
  }
  return { fences, guards };
}
