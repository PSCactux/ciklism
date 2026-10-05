import { expect, it } from 'vitest';
import { RoutePath, type Route } from '../src/domain/route';
import { RideEngine } from '../src/domain/ride';
import { groundAt } from '../src/render/geometry';
import { previewPose, ROUTE_PREVIEWS } from '../src/render/preview';

const routes = import.meta.glob<Route>('../src/routes/*.json', { eager: true, import: 'default' });
it('frames every route above terrain in either direction without advancing the ride', () => {
  const poses = new Set<string>();
  for (const [file, route] of Object.entries(routes)) {
    const id = file.split('/').at(-1)!.replace('.json', '');
    expect(ROUTE_PREVIEWS[id]).toBeDefined();
    for (const reversed of [false, true]) {
      const path = new RoutePath(route, reversed), ride = new RideEngine(path);
      const { eye, target } = previewPose(path, ROUTE_PREVIEWS[id]);
      expect(Object.values(eye).concat(Object.values(target)).every(Number.isFinite)).toBe(true);
      expect(eye.y - groundAt(path, eye.x, eye.z).height).toBeGreaterThanOrEqual(34.99);
      expect(Math.hypot(eye.x - target.x, eye.y - target.y, eye.z - target.z)).toBeGreaterThan(50);
      expect(ride.state.distance).toBe(0); expect(ride.state.elapsedSeconds).toBe(0);
      poses.add(JSON.stringify({ eye, target }));
    }
  }
  expect(poses.size).toBe(Object.keys(routes).length * 2);
});
