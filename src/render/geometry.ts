import { RoutePath, type Vec3 } from '../domain/route';
import { landscape, lakeFor, lakeRadius, riverProfile } from './scenery';

export interface Geometry { positions: number[]; indices: number[]; uvs: number[]; colors: number[]; normals?: number[] }
export function hash(n: number, seed = 0) {
  let h = Math.imul(n ^ seed, 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth world-space fields are evaluated while building meshes, never per pixel. */
export function groundNoise(x: number, z: number, scale: number, seed = 0) {
  x /= scale; z /= scale;
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const at = (a: number, b: number) => hash(Math.imul(a, 73856093) ^ Math.imul(b, 19349663), seed);
  return (at(ix, iz) * (1-u) + at(ix+1, iz) * u) * (1-v) +
    (at(ix, iz+1) * (1-u) + at(ix+1, iz+1) * u) * v;
}
export function roadHeight(offset: number) { return 0.04 + 0.075 * Math.max(0, 1 - (offset / 3) ** 2); }
export function roadSurface(path: RoutePath, offsets: number[], from: number, to: number, lift = 0): Geometry {
  const data = ribbon(path, offsets, 4, false, from, to);
  for (let i = 0; i < data.positions.length / 3; i++) data.positions[i * 3 + 1] += roadHeight(offsets[i % offsets.length]) + lift;
  return data;
}
/** Sparse repairs share the asphalt draw call. No repeating crack in the base map. */
export function roadRepairs(path: RoutePath, from: number, to: number, data: Geometry) {
  for (let section = Math.ceil(from / 73); section * 73 + 9 < to; section++) {
    if (hash(section, 312) > 0.34) continue;
    const d = section * 73 + hash(section, 18) * 4;
    const lateral = (hash(section, 98) - 0.5) * 4.0, half = 0.22 + hash(section, 33) * 0.55;
    const length = 0.7 + hash(section, 31) * 3.4, base = data.positions.length / 3;
    const shade = 0.65 + hash(section, 76) * 0.18;
    for (let row = 0; row < 4; row++) for (const side of [-1, 1]) {
      const distance = d + row * length / 3;
      const offset = lateral + side * half * (0.85 + hash(section * 8 + row, side) * 0.25);
      const p = roadside(path, distance, offset);
      data.positions.push(p.x, p.y + roadHeight(offset) + 0.008, p.z);
      data.uvs.push(offset / 8, distance / 8);
      data.colors.push(shade, shade, shade, 1);
      if (row < 3 && side === -1) {
        const a = base + row * 2;
        data.indices.push(a, a+1, a+2, a+1, a+3, a+2);
      }
    }
  }
}
export function roadside(path: RoutePath, distance: number, offset: number): Vec3 {
  const s = path.sample(distance), h = Math.hypot(s.forward.x, s.forward.z) || 1;
  return { x: s.position.x + s.forward.z / h * offset, y: s.position.y,
    z: s.position.z - s.forward.x / h * offset };
}

/** Shared terrain and road data; no platform or Babylon dependency. */
export function ribbon(path: RoutePath, offsets: number[], step: number, terrain = false,
  from = 0, to = path.totalLength, height = 0): Geometry {
  const positions: number[] = [], indices: number[] = [], uvs: number[] = [], colors: number[] = [];
  const rows = Math.ceil((to - from) / step) + 1;
  for (let row = 0; row < rows; row++) {
    const d = Math.min(to, from + row * step);
    for (let col = 0; col < offsets.length; col++) {
      const lateral = offsets[col];
      const p = roadside(path, d, lateral);
      const rise = terrain ? terrainRise(d, lateral) : 0;
      positions.push(p.x, p.y + rise + height, p.z);
      uvs.push(lateral / 8, d / 8);
      const variation = terrain ? 0.86 + 0.14 * Math.sin(d / 80 + lateral / 22) : 1;
      colors.push(variation, variation, variation, 1);
      if (row < rows - 1 && col < offsets.length - 1) {
        const a = row * offsets.length + col, b = a + offsets.length;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  return { positions, indices, uvs, colors };
}
export function terrainRise(distance: number, offset: number) {
  const blend = Math.min(1, Math.max(0, (Math.abs(offset) - 7) / 80));
  return blend * (5 + Math.sin(distance / 130 + offset / 100) * 8 + Math.sin(distance / 340 - offset / 70) * 14);
}

/** A single height field avoids overlapping terrain ribbons covering other legs of a circuit. */
export function groundAt(path: RoutePath, x: number, z: number) {
  let closest = Infinity, altitude = 0, lateral = 0, along = 0, travelled = 0;
  const points = path.route.puntos;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    const ex = x - a.x - dx * t, ez = z - a.z - dz * t;
    const distance = ex * ex + ez * ez;
    if (distance < closest) {
      closest = distance; altitude = a.y + (b.y - a.y) * t;
      lateral = (ex * dz - ez * dx) / (Math.hypot(dx, dz) || 1);
      along = travelled + Math.hypot(dx, b.y - a.y, dz) * t;
    }
    travelled += Math.hypot(dx, b.y - a.y, dz);
  }
  closest = Math.sqrt(closest);
  const blend = Math.min(1, Math.max(0, (closest - 9) / 100));
  let height = altitude - 1.2 + blend * landscape(path.route).relief *
    (8 + Math.sin(x / 110 + z / 170) * 10 + Math.sin(z / 230 - x / 160) * 10);
  const lake = lakeFor(path.route);
  if (lake && closest > 14) {
    const radius = lakeRadius(lake, x, z);
    const bank = Math.min(1, Math.max(0, (1.16 - radius) / 0.16)) * Math.min(1, (closest - 14) / 25);
    height += (lake.level - 4 - Math.max(0, 1 - radius) * 8 - height) * bank;
  }
  if (path.route.scenery === 'river') {
    const river = riverProfile(along), edge = Math.abs(lateral - river.center) - river.halfWidth;
    // A low alluvial floor rises into irregular wooded slopes on both sides.
    const slope = Math.max(0, (lateral < 0 ? -lateral - 24 : lateral - 85) / 260);
    const rise = Math.pow(Math.min(1.8, slope), 1.25) *
      (68 + 25 * Math.sin(along / 280) + 18 * Math.sin(along / 113 + 1.2));
    const detail = Math.sin(x / 19 + z / 31) * 1.6 + Math.sin(x / 43 - z / 27) * 2.3;
    height = Math.max(altitude - 1.4, altitude - 1.2 + rise + Math.min(1, closest / 45) * detail);
    if (closest < 9) height = altitude - 1.2;
    // The channel is submerged; six metres of uneven bank meet the meadow.
    const bank = Math.min(1, Math.max(0, (edge + 2) / 8));
    const smoothBank = bank * bank * (3 - 2 * bank);
    if (edge < 6) height = altitude - 5.1 + smoothBank * (height - altitude + 5.1);
  }
  return { height, distance: closest, lateral, along };
}

export function riverRibbon(path: RoutePath, from: number, to: number): Geometry {
  const data: Geometry = { positions: [], indices: [], uvs: [], colors: [], normals: [] };
  const rows = Math.ceil((to - from) / 4);
  for (let row = 0; row <= rows; row++) {
    const d = Math.min(to, from + row * 4), river = riverProfile(d);
    for (let col = 0; col < 5; col++) {
      const across = col / 4, p = roadside(path, d, river.center + (across * 2 - 1) * (river.halfWidth + 3));
      data.positions.push(p.x, p.y - 2.6, p.z); data.uvs.push(across, d / 16);
      // Share the calm-water normal across batches; ripples supply local detail.
      data.normals!.push(0, 1, 0);
      data.colors.push(1, 1, 1, 1);
      if (row < rows && col < 4) {
        const a = row * 5 + col, b = a + 5;
        data.indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  return data;
}
export const TILE_SIZE = 192;
/** A low ridge with a buried foot, instead of a sphere protruding from the ground. */
export function distantHill(): Geometry {
  const data: Geometry = { positions: [], indices: [], colors: [], uvs: [] };
  const segments = 32, rings = 8;
  for (let ring = 0; ring <= rings; ring++) for (let i = 0; i <= segments; i++) {
    const radius = ring / rings, a = i / segments * Math.PI * 2;
    const ridge = (1 - radius * radius) ** 2 * (0.85 + Math.sin(a * 3 + radius * 4) * radius * 0.08);
    data.positions.push(Math.cos(a) * radius * 0.5, ridge, Math.sin(a) * radius * 0.5);
    data.uvs.push(i / segments, radius); data.colors.push(1, 1, 1, 1);
    if (ring < rings && i < segments) {
      const n = ring * (segments + 1) + i;
      data.indices.push(n, n + segments + 1, n + 1, n + 1, n + segments + 1, n + segments + 2);
    }
  }
  return data;
}
/** Tiles share the same boundary vertices. Coarse interiors retain fine edges,
 * so different resolutions never leave cracks at a tile boundary. */
export function terrainCells(path: RoutePath) {
  const cells = new Map<string, { x: number; z: number }>();
  const add = (x: number, z: number) => cells.set(`${x},${z}`, { x: x * TILE_SIZE, z: z * TILE_SIZE });
  // A corridor scales with kilometres ridden, not the area of a route's rectangle.
  for (let d = 0; d <= path.totalLength + TILE_SIZE / 2; d += TILE_SIZE / 2) {
    const p = path.sample(Math.min(d, path.totalLength)).position;
    const cx = Math.floor(p.x / TILE_SIZE), cz = Math.floor(p.z / TILE_SIZE);
    for (let z = -3; z <= 3; z++) for (let x = -3; x <= 3; x++) add(cx + x, cz + z);
  }
  const lake = lakeFor(path.route);
  if (lake) for (let z = Math.floor((lake.z - lake.rz * 1.2) / TILE_SIZE); z <= (lake.z + lake.rz * 1.2) / TILE_SIZE; z++) {
    for (let x = Math.floor((lake.x - lake.rx * 1.2) / TILE_SIZE); x <= (lake.x + lake.rx * 1.2) / TILE_SIZE; x++) add(x, z);
  }
  return [...cells.values()];
}
export function* terrainTiles(path: RoutePath): Generator<Geometry> {
  for (const { x, z } of terrainCells(path)) {
    const distance = groundAt(path, x + TILE_SIZE / 2, z + TILE_SIZE / 2).distance;
    yield terrainTile(path, x, z, distance < 180 ? 12 : distance < 250 ? 24 : 48);
  }
}
/** Anchor small objects to the rendered triangles, including coarse tile edges. */
export function terrainHeightAt(path: RoutePath, x: number, z: number) {
  const tx = Math.floor(x / TILE_SIZE) * TILE_SIZE, tz = Math.floor(z / TILE_SIZE) * TILE_SIZE;
  const distance = groundAt(path, tx + TILE_SIZE/2, tz + TILE_SIZE/2).distance;
  const step = distance < 180 ? 12 : distance < 250 ? 24 : 48;
  const cx = tx + Math.floor((x-tx)/step) * step, cz = tz + Math.floor((z-tz)/step) * step;
  const corners = [[cx,cz], [cx+step,cz], [cx+step,cz+step], [cx,cz+step]], border: number[][] = [];
  corners.forEach((p, i) => {
    const q = corners[(i+1)%4];
    const outer = (p[0] === q[0] && (p[0] === tx || p[0] === tx+TILE_SIZE)) ||
      (p[1] === q[1] && (p[1] === tz || p[1] === tz+TILE_SIZE));
    const count = outer ? step/12 : 1;
    for (let n = 0; n < count; n++) border.push([p[0]+(q[0]-p[0])*n/count, p[1]+(q[1]-p[1])*n/count]);
  });
  const a = [cx+step/2,cz+step/2];
  for (let i = 0; i < border.length; i++) {
    const b = border[i], c = border[(i+1)%border.length];
    const den = (b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
    const u = ((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(z-c[1]))/den;
    const v = ((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(z-c[1]))/den;
    if (u >= -1e-8 && v >= -1e-8 && u+v <= 1+1e-8) return u * groundAt(path,a[0],a[1]).height +
      v * groundAt(path,b[0],b[1]).height + (1-u-v) * groundAt(path,c[0],c[1]).height;
  }
  return groundAt(path,x,z).height;
}
export function terrainTile(path: RoutePath, x: number, z: number, step: number): Geometry {
  const data: Geometry = { positions: [], indices: [], colors: [], uvs: [], normals: [] };
  // Every tile has a 12 m boundary; each cell is a fan, with extra vertices on
  // coarse outer edges. The shared height function gives exactly matching seams.
  const vertex = (px: number, pz: number) => {
    const index = data.positions.length / 3;
    const ground = groundAt(path, px, pz);
    data.positions.push(px, ground.height, pz);
    const nx = groundAt(path, px - 1, pz).height - groundAt(path, px + 1, pz).height;
    const nz = groundAt(path, px, pz - 1).height - groundAt(path, px, pz + 1).height;
    const length = Math.hypot(nx, 2, nz);
    data.normals!.push(nx / length, 2 / length, nz / length);
    data.uvs.push(px / 8, pz / 8);
    const shade = 0.62 + groundNoise(px, pz, 67, 9) * 0.32 + groundNoise(px, pz, 19, 25) * 0.14;
    const dry = groundNoise(px, pz, 35, 51) * 0.08;
    data.colors.push(shade * (1 + dry), shade, shade * (1.02 - dry), 1);
    return index;
  };
  const cache = new Map<string, number>();
  const at = (px: number, pz: number) => {
    const key = `${px},${pz}`;
    if (!cache.has(key)) cache.set(key, vertex(px, pz));
    return cache.get(key)!;
  };
  for (let dz = 0; dz < TILE_SIZE; dz += step) for (let dx = 0; dx < TILE_SIZE; dx += step) {
    const corners = [[x + dx, z + dz], [x + dx + step, z + dz],
      [x + dx + step, z + dz + step], [x + dx, z + dz + step]];
    const border: number[] = [];
    corners.forEach((p, i) => {
      const q = corners[(i + 1) % 4];
      const outer = (p[0] === q[0] && (p[0] === x || p[0] === x + TILE_SIZE)) ||
        (p[1] === q[1] && (p[1] === z || p[1] === z + TILE_SIZE));
      const count = outer ? step / 12 : 1;
      for (let n = 0; n < count; n++) border.push(at(p[0] + (q[0] - p[0]) * n / count, p[1] + (q[1] - p[1]) * n / count));
    });
    const center = at(x + dx + step / 2, z + dz + step / 2);
    border.forEach((p, i) => data.indices.push(center, p, border[(i + 1) % border.length]));
  }
  return data;
}
export function markings(path: RoutePath, from = 0, to = path.totalLength): Geometry {
  const merged: Geometry = { positions: [], indices: [], uvs: [], colors: [] };
  for (let d = Math.ceil(from / 12) * 12; d + 4 <= Math.min(to, path.totalLength); d += 12) {
    const part = roadSurface(path, [-0.06, 0.06], d, d + 4, 0.02);
    const offset = merged.positions.length / 3;
    merged.positions.push(...part.positions); merged.indices.push(...part.indices.map(n => n + offset));
    merged.uvs.push(...part.uvs); merged.colors.push(...part.colors);
  }
  return merged;
}

export function shoulderBanks(path: RoutePath, from: number, to: number): Geometry {
  const data: Geometry = { positions: [], indices: [], uvs: [], colors: [] };
  for (const side of [-1, 1]) {
    const offsets = side < 0 ? [-5.3, -4.4, -3.65, -3] : [3, 3.65, 4.4, 5.3];
    const part = ribbon(path, offsets, 4, false, from, to);
    for (let i = 0; i < part.positions.length; i += 3) {
      const offset = Math.abs(offsets[i / 3 % offsets.length]);
      const blend = Math.max(0, Math.min(1, (offset - 3.4) / 1.9));
      const ground = groundAt(path, part.positions[i], part.positions[i + 2]).height;
      part.positions[i + 1] = (part.positions[i + 1] + roadHeight(3)) * (1-blend) + (ground + 0.015) * blend;
    }
    const base = data.positions.length / 3;
    data.positions.push(...part.positions); data.indices.push(...part.indices.map(i => i + base));
    data.uvs.push(...part.uvs); data.colors.push(...part.colors);
  }
  return data;
}
