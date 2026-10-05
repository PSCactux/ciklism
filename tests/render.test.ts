import { describe, expect, it } from 'vitest';
import { AdaptiveResolution, frameLimit } from '../src/render/budget';
import { terrainTile, terrainHeightAt, TILE_SIZE, shoulderBanks, groundAt, roadHeight, roadSurface, roadRepairs } from '../src/render/geometry';
import { RoutePath } from '../src/domain/route';

const path = new RoutePath({ nombre: 'Slope', puntos: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 50, z: 1000 }] });
describe('terrain continuity', () => {
  it('anchors decoration to actual fine and coarse triangle surfaces', () => {
    for (const [x, step] of [[0, 12], [192, 48]]) {
      const mesh = terrainTile(path, x, 0, step);
      for (let i = 0; i < mesh.indices.length; i += 33) {
        const points = mesh.indices.slice(i, i+3).map(n => mesh.positions.slice(n*3, n*3+3));
        const center = [0,1,2].map(axis => points.reduce((sum, p) => sum+p[axis], 0)/3);
        expect(terrainHeightAt(path, center[0], center[2])).toBeCloseTo(center[1], 7);
      }
    }
  });
  it('matches positions and lighting normals across fine/coarse tile boundaries', () => {
    const fine = terrainTile(path, 0, 0, 24), coarse = terrainTile(path, TILE_SIZE, 0, 48);
    const edge = (data: typeof fine) => data.positions.reduce<number[][]>((vertices, x, i) => {
      if (i % 3 === 0 && x === TILE_SIZE) vertices.push([...data.positions.slice(i, i + 3), ...data.normals!.slice(i, i + 3)]);
      return vertices;
    }, []).sort((a, b) => a[2] - b[2]);
    expect(edge(fine)).toEqual(edge(coarse));
    expect(edge(fine)).toHaveLength(TILE_SIZE / 12 + 1);
    for (const data of [fine, coarse]) {
      expect(data.normals!.every(Number.isFinite)).toBe(true);
      for (let i = 0; i < data.indices.length; i += 3) {
        const [a, b, c] = data.indices.slice(i, i + 3).map(n => data.positions.slice(n * 3, n * 3 + 3));
        // Babylon's left-handed winding faces the sky.
        expect((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0])).toBeGreaterThan(0);
      }
    }
    expect(coarse.indices.length).toBeLessThan(fine.indices.length / 2);
  });
  it('joins the road shoulder to the actual ground on both sides of a slope', () => {
    const mesh = shoulderBanks(path, 0, 192);
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const [x, y, z] = mesh.positions.slice(i, i + 3);
      const roadY = path.sample(z * Math.hypot(1, 0.05)).position.y + roadHeight(3);
      const groundY = groundAt(path, x, z).height + 0.015;
      if (Math.abs(x) > 5.2) expect(y).toBeCloseTo(groundY, 8);
      else if (Math.abs(x) === 3) expect(y).toBeCloseTo(roadY, 8);
      else { expect(y).toBeLessThan(roadY); expect(y).toBeGreaterThan(groundY); }
    }
  });
  it('keeps the road crown continuous across tiles and repairs within the carriageway', () => {
    const offsets = [-3, -1.5, 0, 1.5, 3];
    const a = roadSurface(path, offsets, 0, 192), b = roadSurface(path, offsets, 192, 384);
    expect(a.positions.slice(-15)).toEqual(b.positions.slice(0, 15));
    expect(roadHeight(0) - roadHeight(3)).toBeCloseTo(0.075);
    expect(roadHeight(-3)).toBe(roadHeight(3));
    const roadVertices = a.positions.length;
    roadRepairs(path, 0, 192, a);
    for (let i = roadVertices; i < a.positions.length; i += 3) {
      expect(Math.abs(a.positions[i])).toBeLessThan(3);
      expect(a.positions[i+1]).toBeCloseTo(path.sample(a.positions[i+2] * Math.hypot(1, .05)).position.y + roadHeight(a.positions[i]) + .008, 6);
    }
  });
});
describe('presentation budget', () => {
  it('caps touch auto and savings at 30, independent of simulation', () => {
    expect(frameLimit('auto', true)).toBe(30); expect(frameLimit('low', false)).toBe(30);
    expect(frameLimit('high', true)).toBe(60); expect(frameLimit('auto', false)).toBe(60);
  });
  it('reacts to a GPU bottleneck even when CPU submission is fast and bounds the scale', () => {
    const budget = new AdaptiveResolution();
    for (let i = 0; i < 120; i++) budget.sample(2, 35, 60);
    expect(budget.scale).toBe(1.25);
    for (let i = 0; i < 1200; i++) budget.sample(2, 35, 60);
    expect(budget.scale).toBe(2);
  });
  it('recovers slowly after sustained headroom without oscillating on a single good frame', () => {
    const budget = new AdaptiveResolution();
    for (let i = 0; i < 120; i++) budget.sample(20, 40, 60);
    for (let i = 0; i < 599; i++) budget.sample(2, 1000 / 60, 60);
    expect(budget.scale).toBe(1.25);
    budget.sample(2, 1000 / 60, 60); expect(budget.scale).toBe(1);
    for (let i = 0; i < 1200; i++) budget.sample(2, 1000 / 30, 30);
    expect(budget.scale).toBe(1);
  });
  it('discards interrupted sampling windows and time spent in the background', () => {
    const budget = new AdaptiveResolution();
    for (let i = 0; i < 119; i++) budget.sample(30, 40, 60);
    budget.idle(); budget.sample(1, 60000, 60);
    expect(budget.sample(1, 16.7, 60)).toBe(false); expect(budget.scale).toBe(1);
  });
});
