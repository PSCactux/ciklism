import { describe, expect, it } from 'vitest';
import { RoutePath, roadLine, type Route } from '../src/domain/route';
import { RideEngine, bendLean, cameraPose } from '../src/domain/ride';
import { LapTimer } from '../src/domain/laps';
import { climbs, stretchAt } from '../src/domain/profile';
import { sanitizeBikes } from '../src/domain/bike';
import { Narrator, sectorResult } from '../src/ui/narrator';
import { villages, barriers } from '../src/render/places';

const files = import.meta.glob<Route>('../src/routes/*.json', { eager: true, import: 'default' });
const routes = Object.fromEntries(Object.entries(files).map(([file, route]) => [file.split('/').at(-1)!.replace('.json', ''), route]));
const raw = (route: Route) => route.puntos.reduce((sum, p, i) => i ? sum + Math.hypot(p.x - route.puntos[i - 1].x, p.y - route.puntos[i - 1].y, p.z - route.puntos[i - 1].z) : 0, 0);

describe('rounded roads', () => {
  it('turns gradually everywhere, keeps the advertised distance and closes circuits on themselves', () => {
    for (const route of Object.values(routes)) {
      const path = new RoutePath(route), line = roadLine(route);
      expect(path.totalLength).toBeCloseTo(raw(route), 3);
      for (let i = 2; i < line.length; i++) {
        const a = Math.atan2(line[i - 1].x - line[i - 2].x, line[i - 1].z - line[i - 2].z), b = Math.atan2(line[i].x - line[i - 1].x, line[i].z - line[i - 1].z);
        expect(Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))), route.nombre).toBeLessThan(0.05);
      }
      if (path.isCircuit) {
        expect(line[0]).toEqual(line.at(-1));
        expect(Math.abs(path.curvatureAt(path.totalLength - 5))).toBeLessThan(0.02);
      }
      expect(new RoutePath(route, true).sample(0).position).toEqual(path.sample(path.totalLength).position);
    }
  });
  it('leans into a bend with speed, towards the inside, and not at all without motion', () => {
    const bend = new RoutePath({ nombre: 'Bend', puntos: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 200 }, { x: 150, y: 0, z: 330 }, { x: 350, y: 0, z: 330 }] });
    const at = bend.totalLength * 0.45;
    expect(bend.curvatureAt(at)).toBeGreaterThan(0);
    expect(bendLean(bend, at, 12)).toBeGreaterThan(bendLean(bend, at, 6));
    expect(bendLean(bend, 20, 12)).toBeCloseTo(0, 6);
    const engine = new RideEngine(bend); engine.jump(at);
    const state = { ...engine.state, speedMps: 12 };
    expect(cameraPose(bend, state).bend).toBeGreaterThan(0); expect(cameraPose(bend, state).up.x).toBeGreaterThan(0);
    expect(cameraPose(bend, state, false)).toMatchObject({ bend: 0, steer: 0 });
  });
});
describe('knowing where you are', () => {
  it('finds the climbs of a course and says how far the next summit is', () => {
    const hill = new RoutePath({ nombre: 'Hill', puntos: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1000 }, { x: 0, y: 60, z: 2000 }, { x: 0, y: 60, z: 3000 }, { x: 0, y: 20, z: 4000 }] });
    const found = climbs(hill);
    expect(found).toHaveLength(1);
    expect(found[0].start).toBeGreaterThan(800); expect(found[0].end).toBeLessThan(2300);
    expect(found[0].gain).toBeGreaterThan(50); expect(found[0].grade).toBeGreaterThan(0.045);
    expect(stretchAt(found, 500)).toMatchObject({ on: null, next: found[0] });
    expect(stretchAt(found, 1500).on).toBe(found[0]);
    expect(stretchAt(found, 3500)).toEqual({ on: null, next: null });
    expect(climbs(new RoutePath(routes.ovalo))).toEqual([]);
    expect(climbs(new RoutePath(routes.gran_fondo)).length).toBeGreaterThan(3);
  });
  it('colours sectors purple for a record, green for the best of the ride and orange otherwise', () => {
    const timer = new LapTimer(300, { bestSeconds: 30, sectors: [10, 10, 10], trace: [] }), seen: string[] = [];
    timer.onSector = s => seen.push(sectorResult(s));
    timer.mark(100, 9); timer.mark(200, 21); timer.complete(33);
    timer.mark(100, 9.5); timer.mark(200, 21); timer.complete(32.5);
    expect(seen).toEqual(['record', 'session', 'session', 'slower', 'session', 'session']);
  });
  it('times the three sectors of an open course too', () => {
    const engine = new RideEngine(new RoutePath({ nombre: 'Open', puntos: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 300 }] })), seen: number[] = [];
    engine.timer.onSector = s => seen.push(s.index);
    while (!engine.state.finished) { engine.onCadence(80); engine.tick(1 / 30); }
    expect(seen).toEqual([0, 1, 2]); expect(engine.timer.laps).toEqual([]);
    expect(engine.timer.record().sectors.every(s => s !== null && s > 0)).toBe(true);
  });
  it('announces climbs, villages, places and the last kilometre once each', () => {
    const path = new RoutePath({ nombre: 'Hill', puntos: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1000 }, { x: 0, y: 60, z: 2000 }, { x: 0, y: 60, z: 4000 }] });
    const narrator = new Narrator(path, climbs(path), [{ distance: 600, name: 'Villar del Prado' }]), engine = new RideEngine(path), said: string[] = [];
    const standing = (place: number) => ({ place, riders: 12, ahead: { name: 'Marta', jersey: '#000', meters: 5 }, behind: { name: 'Hugo', jersey: '#000', meters: 5 } });
    for (let d = 0; d < path.totalLength; d += 20) {
      engine.jump(d);
      const state = { ...engine.state, elapsedSeconds: d / 8, standing: standing(d < 1500 ? 6 : 5) };
      said.push(...narrator.update(state, []).map(c => c.text));
    }
    expect(said.filter(t => t.startsWith('Entras en'))).toEqual(['Entras en Villar del Prado']);
    expect(said.filter(t => t.startsWith('Empieza la subida'))).toHaveLength(1);
    expect(said.filter(t => t.startsWith('Cima'))).toHaveLength(1);
    expect(said).toContain('Adelantas a Hugo · vas 5º'); expect(said).toContain('Último kilómetro');
    expect(narrator.stretch({ ...engine.state, distance: 1500 })).toMatch(/^Subida · cima a/);
  });
});
describe('bikes and scenery', () => {
  it('keeps a calibration saved before bikes had names, and never leaves the rider without a bike', () => {
    expect(sanitizeBikes(undefined, { levels: [{ metersPerRev: 5 }], routeLevels: false }))
      .toEqual([{ id: 'bici-1', name: 'Mi bici', levels: [{ metersPerRev: 5 }], routeLevels: false }]);
    expect(sanitizeBikes([{ id: 'a', name: ' Estática ', levels: [] }, { name: 'sin id' }, { id: 'b', levels: [{ metersPerRev: -2 }] }]))
      .toEqual([{ id: 'a', name: 'Estática', levels: [], routeLevels: true }, { id: 'b', name: 'Bici 2', levels: [], routeLevels: true }]);
    expect(sanitizeBikes([])).toHaveLength(1);
  });
  it('places named villages clear of the road and guards only real bends', () => {
    for (const [id, route] of Object.entries(routes)) {
      const towns = villages(route), path = new RoutePath(route);
      expect(new Set(towns.map(t => t.name)).size).toBe(towns.length);
      for (const town of towns) {
        expect(town.houses.length).toBeGreaterThanOrEqual(2);
        expect(town.distance).toBeGreaterThan(200); expect(town.distance).toBeLessThan(path.totalLength - 200);
      }
      if (id === 'gran_fondo') { expect(towns.length).toBeGreaterThan(8); expect(barriers(route).guards.posts.length).toBeGreaterThan(100); }
    }
    expect(barriers(routes.valle).guards.posts).toEqual([]);
  });
});
