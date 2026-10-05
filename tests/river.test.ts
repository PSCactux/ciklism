import { expect, it } from 'vitest';
import { RoutePath, type Route } from '../src/domain/route';
import { groundAt, riverRibbon, roadside } from '../src/render/geometry';
import { riverProfile } from '../src/render/scenery';
import { treeLayout } from '../src/render/lighting';

const route: Route = { nombre: 'River slope', scenery: 'river',
  puntos: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 30, z: 1200 }] };
const path = new RoutePath(route);

it('keeps the meandering channel below the water and both road shoulders dry', () => {
  for (let d = 20; d < path.totalLength - 20; d += 13) {
    const { center, halfWidth } = riverProfile(d);
    const river = roadside(path, d, center), road = path.sample(d).position;
    expect(groundAt(path, river.x, river.z).height).toBeLessThan(road.y - 4);
    for (const offset of [-5.3, 5.3, center - halfWidth - 9, center + halfWidth + 9]) {
      const p = roadside(path, d, offset);
      expect(groundAt(path, p.x, p.z).height).toBeGreaterThan(road.y - 2.6);
    }
  }
});

it('joins water tiles exactly and keeps trees above the channel on canonical terrain', () => {
  const a = riverRibbon(path, 0, 192), b = riverRibbon(path, 192, 384);
  expect(a.positions.slice(-15)).toEqual(b.positions.slice(0, 15));
  for (const tree of treeLayout(route)) {
    const ground = groundAt(path, tree.x, tree.z), profile = riverProfile(ground.along);
    expect(Math.abs(ground.lateral - profile.center)).toBeGreaterThanOrEqual(profile.halfWidth + 8);
    expect(tree.y).toBe(ground.height);
  }
});
