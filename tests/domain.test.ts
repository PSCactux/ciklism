import { describe, expect, it } from 'vitest';
import { CadenceCalculator, parseCsc } from '../src/domain/cadence';
import { RoutePath } from '../src/domain/route';
import { GEARS, RideClock, RideEngine, cameraPose } from '../src/domain/ride';
import { LapTimer } from '../src/domain/laps';
import { emptyTotals, addOutcome, levelFor, reward } from '../src/domain/progress';
import { markings, ribbon } from '../src/render/geometry';
import { parseBackup } from '../src/platform/storage';

const flat = () => new RoutePath({ nombre: 'Flat', puntos: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1000 }] });
function pedal(engine: RideEngine, seconds = 30, rpm = 80) {
  for (let i = 0; i < seconds * 30; i++) { engine.onCadence(rpm); engine.tick(1 / 30); }
  return engine.state;
}
describe('Android cadence and riding contract', () => {
  it('reads little-endian crank data, including wheel data before the crank payload', () => {
    expect(parseCsc(new DataView(Uint8Array.from([2, 0x34, 0x12, 0, 4]).buffer))).toEqual({ revolutions: 0x1234, time: 1024 });
    expect(parseCsc(new DataView(Uint8Array.from([3, 0, 0, 0, 0, 0, 0, 3, 0, 0, 8]).buffer))).toEqual({ revolutions: 3, time: 2048 });
    for (const bytes of [[], [1, 0, 0], [2, 1], [3, 0, 0, 0, 0]]) expect(parseCsc(new DataView(Uint8Array.from(bytes).buffer))).toBeNull();
  });
  it('handles both 16-bit wraps and ignores duplicate notifications', () => {
    const c = new CadenceCalculator();
    expect(c.update({ revolutions: 65535, time: 65000 })).toBeNull();
    expect(c.update({ revolutions: 0, time: 232 })).toBe(80);
    expect(c.update({ revolutions: 0, time: 232 })).toBeNull();
    c.reset(); expect(c.update({ revolutions: 50, time: 1000 })).toBeNull();
    expect(c.update({ revolutions: 49, time: 1001 })).toBeNull();
  });
  it('matches Android sixth gear: 80 rpm converges to 31.2 km/h', () => {
    expect(pedal(new RideEngine(flat())).speedMps * 3.6).toBeCloseTo(31.2, 2);
  });
  it('keeps declared gear speed on climbs and applies calibration', () => {
    const climb = new RoutePath({ nombre: 'Climb', puntos: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 60, z: 1000 }] });
    expect(pedal(new RideEngine(climb)).speedMps).toBeCloseTo(pedal(new RideEngine(flat())).speedMps, 6);
    expect(pedal(new RideEngine(flat(), undefined, 1.5)).speedMps * 3.6).toBeCloseTo(46.8, 2);
  });
  it('expires cadence after three seconds while preserving freewheel inertia', () => {
    const e = new RideEngine(flat()); pedal(e, 10);
    const speed = e.state.speedMps;
    for (let i = 0; i < 100; i++) e.tick(1 / 30);
    expect(e.state.cadenceRpm).toBe(0); expect(e.state.speedMps).toBeGreaterThan(0);
    expect(e.state.speedMps).toBeLessThan(speed);
  });
  it('coasts downhill without cadence and clamps gears', () => {
    const descent = new RoutePath({ nombre: 'Downhill', puntos: [{ x: 0, y: 60, z: 0 }, { x: 0, y: 0, z: 1000 }] });
    const e = new RideEngine(descent); e.shift(100); pedal(e, 10, 0);
    expect(e.state.speedMps).toBeGreaterThan(0); expect(e.state.gear).toBe(GEARS.length - 1);
    e.shift(-100); e.tick(1 / 30); expect(e.state.gear).toBe(0);
  });
  it('stops exactly at an open route end without adding extra distance', () => {
    const short = new RoutePath({ nombre: 'Short', puntos: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }] });
    const e = new RideEngine(short); pedal(e, 30);
    expect(e.state.finished).toBe(true); expect(e.state.travelled).toBeCloseTo(10, 8);
    expect(e.tick(1 / 30)).toEqual(e.state);
  });
  it('produces identical simulation at 30, 60 and 120 Hz', () => {
    const results = [30, 60, 120].map(hz => {
      const e = new RideEngine(flat()), clock = new RideClock();
      for (let i = 0; i <= hz * 10; i++) clock.advance(i * 1000 / hz, dt => { e.onCadence(80); e.tick(dt); });
      return e.state.travelled;
    });
    expect(results[0]).toBeCloseTo(results[1], 7); expect(results[1]).toBeCloseTo(results[2], 7);
  });
  it('does not simulate a suspended minute on the next frame', () => {
    const c = new RideClock(); let seconds = 0;
    c.advance(0, dt => { seconds += dt; }); c.advance(60000, dt => { seconds += dt; });
    expect(seconds).toBe(0);
  });
});
describe('routes, camera and geometry', () => {
  it('rejects degenerate routes, skips duplicate vertices and reverses consistently', () => {
    expect(() => new RoutePath({ nombre: 'Bad', puntos: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }] })).toThrow();
    const route = { nombre: 'Valid', puntos: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 10, z: 100 }] };
    const p = new RoutePath(route), r = new RoutePath(route, true);
    expect(p.sample(0).forward.z).toBeGreaterThan(0);
    expect(r.sample(0).position.z).toBe(100); expect(r.climb).toBe(0);
    expect(p.totalLength).toBe(r.totalLength);
  });
  it('keeps the camera looking ahead at the finish and disables bob for reduced motion', () => {
    const p = flat(), e = new RideEngine(p); const s = pedal(e, 200);
    const pose = cameraPose(p, s, false);
    expect(pose.target.z).toBeGreaterThan(pose.eye.z);
    expect(pose.up.x).toBeCloseTo(0); expect(pose.up.y).toBe(1); expect(pose.up.z).toBeCloseTo(0);
    expect(pose.eye.y).toBe(1.45);
  });
  it('builds valid, finite indexed road and marking meshes from every bundled route', async () => {
    const fs = await import('node:fs/promises');
    for (const file of await fs.readdir(new URL('../src/routes', import.meta.url))) {
      if (!file.endsWith('.json')) continue;
      const p = new RoutePath(JSON.parse(await fs.readFile(new URL(`../src/routes/${file}`, import.meta.url), 'utf8')));
      for (const data of [ribbon(p, [-3, 3], 5), markings(p)]) {
        expect(data.positions.every(Number.isFinite)).toBe(true);
        expect(data.indices.every(i => i >= 0 && i < data.positions.length / 3)).toBe(true);
        expect(data.uvs.length).toBe(data.positions.length / 3 * 2);
      }
    }
  });
});
describe('records and progress', () => {
  it('preserves an all-time ghost when the first new lap is slower', () => {
    const t = new LapTimer(300, { bestSeconds: 30, sectors: [10, 10, 10],
      trace: [{ distance: 0, seconds: 0 }, { distance: 150, seconds: 15 }, { distance: 300, seconds: 30 }] });
    t.mark(150, 20); t.complete(40);
    expect(t.record().bestSeconds).toBe(30); expect(t.ghostDistance(15)).toBe(150);
    expect(t.laps[0].record).toBe(false);
  });
  it('interpolates crossed sectors and traces at their exact distances', () => {
    const t = new LapTimer(300); t.mark(250, 25); t.complete(30);
    expect(t.laps[0].sectors.map(s => s.seconds)).toEqual([10, 10, 10]);
    expect(t.ghostDistance(15)).toBe(150); expect(t.delta(150, 14)).toBe(-1);
  });
  it('matches the Android distance, climbing, time and completion rewards', () => {
    const o = { meters: 10000, seconds: 1800, climbMeters: 100, laps: [], finishedRoute: true, light: 'dia' };
    expect(reward(o)).toBe(255); expect(addOutcome(emptyTotals(), o).sessions).toBe(1);
    expect(levelFor(499).number).toBe(1); expect(levelFor(500).number).toBe(2);
    expect(levelFor(2000).number).toBe(3);
  });
  it('rejects malformed and incompatible backups before writing data', () => {
    expect(() => parseBackup('{')).toThrow();
    expect(() => parseBackup(JSON.stringify({ format: 'ciklism', version: 2, sessions: [] }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ format: 'ciklism', version: 1, sessions: [{ meters: -1 }] }))).toThrow();
    expect(parseBackup(JSON.stringify({ format: 'ciklism', version: 1, sessions: [] }))).toEqual([]);
  });
});
