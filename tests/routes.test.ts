import { expect, it } from 'vitest';
import { RoutePath, routeRecordId, type Route } from '../src/domain/route';
import { groundAt, roadside, terrainCells, TILE_SIZE } from '../src/render/geometry';
import { lakeFor, lakeRadius, riverProfile } from '../src/render/scenery';
import { treeLayout } from '../src/render/lighting';

const files = import.meta.glob<Route>('../src/routes/*.json', { eager: true, import: 'default' });
const routes = Object.fromEntries(Object.entries(files).map(([file, route]) => [file.split('/').at(-1)!.replace('.json', ''), route]));
it('has distinct course lengths measured from geometry, with long point-to-point journeys', () => {
  for (const [id, km] of Object.entries({ ovalo: 1, ruta_inicial: 4, valle: 12, puerto: 20, embalse: 8, ermita: 15 })) {
    const path = new RoutePath(routes[id]);
    expect(path.totalLength / 1000).toBeCloseTo(km, 1);
    expect(path.isCircuit).toBe(!['valle', 'puerto'].includes(id));
    expect(new RoutePath(routes[id], true).totalLength).toBeCloseTo(path.totalLength, 6);
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1], b = path.points[i];
      expect(Math.abs(b.y - a.y) / Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(0.15);
    }
  }
  expect(new Set(Object.values(routes).map(r => r.scenery)).size).toBe(6);
});
it('isolates records of extended courses without changing IDs of legacy rides', () => {
  expect(routeRecordId('valle', routes.valle)).toBe('valle@2');
  expect(routeRecordId('valle', { nombre: 'Old valley', puntos: routes.valle.puntos })).toBe('valle');
  expect(routeRecordId('ovalo', routes.ovalo)).toBe('ovalo');
});
it('carves water below the route and keeps banks independent of riding direction', () => {
  for (const id of ['ruta_inicial', 'embalse', 'valle']) {
    const route = routes[id], path = new RoutePath(route), reversed = new RoutePath(route, true), lake = lakeFor(route);
    if (lake) {
      expect(groundAt(path, lake.x, lake.z).height).toBeLessThan(lake.level - 3);
      for (const tree of treeLayout(route)) {
        if (lakeRadius(lake, tree.x, tree.z) < 1.16) expect(tree.y).toBeGreaterThan(lake.level);
      }
    }
    for (let d = 0; d <= path.totalLength; d += 37) {
      const p = path.sample(d).position;
      expect(groundAt(path, p.x, p.z).height).toBeCloseTo(p.y - 1.2, 5);
      const bank = roadside(path, d, lake ? 45 : riverProfile(d).center);
      expect(groundAt(path, bank.x, bank.z)).toEqual(groundAt(reversed, bank.x, bank.z));
      if (!lake) expect(groundAt(path, bank.x, bank.z).height).toBeLessThan(p.y - 2.5);
    }
  }
});
it('keeps long-course terrain proportional to road length and covers every riding position', () => {
  const path = new RoutePath(routes.puerto), cells = terrainCells(path);
  expect(cells.length).toBeLessThan(1500);
  const keys = new Set(cells.map(c => `${c.x},${c.z}`));
  expect(keys.size).toBe(cells.length);
  for (let d = 0; d <= path.totalLength; d += 61) {
    const p = path.sample(d).position;
    expect(keys.has(`${Math.floor(p.x / TILE_SIZE) * TILE_SIZE},${Math.floor(p.z / TILE_SIZE) * TILE_SIZE}`)).toBe(true);
  }
});

it('keeps interpolated terrain triangles below the asphalt on steep courses', () => {
  for (const route of Object.values(routes)) {
    const path = new RoutePath(route);
    for (let d = 0; d < path.totalLength; d += 37) for (const side of [-2.8, 0, 2.8]) {
      const p = roadside(path, d, side), x = Math.floor(p.x / 12) * 12, z = Math.floor(p.z / 12) * 12;
      const corners = [[x, z], [x + 12, z], [x + 12, z + 12], [x, z + 12]], center = [x + 6, z + 6];
      for (let i = 0; i < 4; i++) {
        const [a, b, c] = [center, corners[i], corners[(i + 1) % 4]];
        const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
        const u = ((b[1] - c[1]) * (p.x - c[0]) + (c[0] - b[0]) * (p.z - c[1])) / den;
        const v = ((c[1] - a[1]) * (p.x - c[0]) + (a[0] - c[0]) * (p.z - c[1])) / den;
        if (Math.min(u, v, 1 - u - v) < -1e-8) continue;
        const height = groundAt(path, ...a as [number, number]).height * u +
          groundAt(path, ...b as [number, number]).height * v + groundAt(path, ...c as [number, number]).height * (1 - u - v);
        expect(height, `${route.nombre} at ${d} m / ${side}`).toBeLessThan(p.y + 0.025);
      }
    }
  }
});
