import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { RoutePath, type Route } from '../src/domain/route';
import { groundAt, terrainTile, TILE_SIZE } from '../src/render/geometry';
import { LIGHTING, lightingKey, lightmapBounds, lightmapUV, projectShadow, surfaceIrradiance, treeLayout, type Daylight } from '../src/render/lighting';
import manifest from '../public/lighting/manifest.json';

const routes = import.meta.glob<Route>('../src/routes/*.json', { eager: true, import: 'default' });
describe('precomputed lighting', () => {
  it('lights sun-facing slopes more strongly while preserving sky fill in shade', () => {
    const d = LIGHTING.atardecer.direction;
    const lit = surfaceIrradiance({ x: -d.x, y: 0.5, z: -d.z }, 'atardecer');
    const shade = surfaceIrradiance({ x: d.x, y: 0.5, z: d.z }, 'atardecer');
    expect(lit[0]).toBeGreaterThan(shade[0]);
    expect(shade.every(v => v > 0 && Number.isFinite(v))).toBe(true);
    expect(shade[2] / shade[0]).toBeGreaterThan(lit[2] / lit[0]);
  });
  it('ships current bakes for every route/time and bounds resident GPU memory', () => {
    const keys: string[] = [];
    for (const route of Object.values(routes)) for (const daylight of Object.keys(LIGHTING) as Daylight[]) {
      const key = lightingKey(route, daylight); keys.push(key);
      const entry = manifest[key as keyof typeof manifest];
      expect(entry, `${route.nombre}/${daylight}: run npm run bake:lighting`).toBeDefined();
      const bounds = lightmapBounds(route);
      expect(entry).toMatchObject(bounds);
      expect(bounds.pixelsX * bounds.pixelsZ * 4 * 4 / 3).toBeLessThanOrEqual(2048 ** 2 * 4 * 4 / 3);
      const data = readFileSync(new URL(`../public/lighting/${entry.file}`, import.meta.url));
      expect(data.length).toBe(entry.bytes);
      expect(data.toString('ascii', 0, 4)).toBe('RIFF');
      expect(data.toString('ascii', 8, 12)).toBe('WEBP');
    }
    expect(Object.keys(manifest).sort()).toEqual(keys.sort());
  });
  it('projects low sunlight further and intersects the actual sloping height field', () => {
    const path = new RoutePath({ nombre: 'Slope', puntos: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 50, z: 1000 }] });
    const point = { x: 100, z: 400, y: groundAt(path, 100, 400).height + 15 };
    const day = projectShadow(path, point, LIGHTING.dia.direction);
    const evening = projectShadow(path, point, LIGHTING.atardecer.direction);
    for (const hit of [day, evening]) {
      expect(Math.abs(hit.y - groundAt(path, hit.x, hit.z).height)).toBeLessThan(0.03);
      expect(hit.x).toBeLessThan(point.x);
    }
    expect(Math.hypot(evening.x - point.x, evening.z - point.z)).toBeGreaterThan(Math.hypot(day.x - point.x, day.z - point.z));
  });
  it('keeps world-space shadow UVs continuous across terrain detail boundaries', () => {
    const path = new RoutePath(Object.values(routes)[0]);
    const a = terrainTile(path, 0, 0, 24), b = terrainTile(path, TILE_SIZE, 0, 48);
    const edge = (mesh: typeof a) => {
      const uv = lightmapUV(path.route, mesh.positions);
      return mesh.positions.flatMap((x, i) => i % 3 === 0 && x === TILE_SIZE ? [[mesh.positions[i + 2], ...uv.slice(i / 3 * 2, i / 3 * 2 + 2)]] : []).sort((a, b) => a[0] - b[0]);
    };
    expect(edge(a)).toEqual(edge(b));
    const bounds = lightmapBounds(path.route);
    expect(lightmapUV(path.route, [bounds.x, 0, bounds.z, bounds.x + bounds.width, 0, bounds.z + bounds.depth])).toEqual([0, 1, 1, 0]);
  });
  it('places every shadow caster inside its map and invalidates maps after route edits', () => {
    for (const route of Object.values(routes)) {
      const trees = treeLayout(route), bounds = lightmapBounds(route);
      expect(trees.length).toBeGreaterThan(20);
      for (const tree of trees) {
        expect(tree.x).toBeGreaterThan(bounds.x); expect(tree.x).toBeLessThan(bounds.x + bounds.width);
        expect(tree.z).toBeGreaterThan(bounds.z); expect(tree.z).toBeLessThan(bounds.z + bounds.depth);
      }
      const edited = structuredClone(route); edited.puntos[0].y += 1;
      expect(lightingKey(edited, 'dia')).not.toBe(lightingKey(route, 'dia'));
    }
  });
});
