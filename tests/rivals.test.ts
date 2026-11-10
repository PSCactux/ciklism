import { describe, expect, it } from 'vitest';
import { PELOTON, Peloton, usualPace } from '../src/domain/rivals';
import { RideEngine } from '../src/domain/ride';
import { RoutePath } from '../src/domain/route';
import { earned, emptyTotals } from '../src/domain/progress';

const road = (length: number, rise = 0) => new RoutePath({ nombre: 'Road', puntos: [{ x: 0, y: 0, z: 0 }, { x: 0, y: rise, z: length }] });
function pedal(engine: RideEngine, seconds: number, rpm = 80) {
  for (let i = 0; i < seconds * 30 && !engine.state.finished; i++) { engine.onCadence(rpm); engine.tick(1 / 30); }
  return engine.state;
}
describe('rivals', () => {
  it('starts the rider at the back of the grid and lets them ride through the slower half', () => {
    const engine = new RideEngine(road(20000)), pace = 80 / 60 * 6.5;
    engine.race(new Peloton(engine.path, pace));
    expect(engine.state.standing).toMatchObject({ place: 12, riders: 12, behind: null });
    expect(engine.state.standing!.ahead).toMatchObject({ name: PELOTON[0].name, meters: 5 });
    const after = pedal(engine, 600).standing!;
    // Six rivals are paced below the rider's own speed and five above it.
    expect(after.place).toBe(6);
    expect(after.ahead!.meters).toBeGreaterThan(0); expect(after.behind!.meters).toBeGreaterThan(0);
    expect(engine.state.rivals.every(r => r.speedMps > pace * 0.6 && r.speedMps < pace * 1.4)).toBe(true);
  });
  it('slows rivals on a climb, the poorer climbers most', () => {
    const flat = new Peloton(road(20000), 8), climb = new Peloton(road(20000, 1200), 8);
    for (let i = 0; i < 30 * 120; i++) { flat.tick(1 / 30); climb.tick(1 / 30); }
    const lost = climb.riders.map((r, i) => r.progress / flat.riders[i].progress);
    expect(Math.max(...lost)).toBeLessThan(0.9);
    expect(lost[0]).toBeLessThan(lost[10]);
  });
  it('ranks a rival who has crossed the line ahead, and stops the race with the rider', () => {
    const engine = new RideEngine(road(400));
    engine.race(new Peloton(engine.path, 80 / 60 * 6.5));
    const end = pedal(engine, 120);
    expect(end.finished).toBe(true);
    const finished = end.rivals.filter(r => r.finished).length;
    expect(finished).toBeGreaterThan(0); expect(end.standing!.place).toBe(finished + 1);
    const frozen = end.rivals.map(r => r.progress); engine.tick(1 / 30);
    expect(engine.state.rivals.map(r => r.progress)).toEqual(frozen);
  });
  it('laps a circuit without leaving it', () => {
    const loop = new RoutePath({ nombre: 'Loop', puntos: [{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, { x: 100, y: 0, z: 100 }, { x: 0, y: 0, z: 100 }, { x: 0, y: 0, z: 0 }] });
    const peloton = new Peloton(loop, 9);
    for (let i = 0; i < 30 * 200; i++) peloton.tick(1 / 30);
    for (const r of peloton.riders) {
      expect(r.progress).toBeGreaterThan(loop.totalLength); expect(r.finished).toBe(false);
      expect(r.distance).toBeCloseTo(r.progress % loop.totalLength, 6);
    }
  });
  it('paces rivals on recent sensor rides only', () => {
    const ride = (mode: string, kmh: number, seconds = 1800) => ({ mode, seconds, meters: kmh / 3.6 * seconds });
    expect(usualPace([])).toBeNull();
    expect(usualPace([ride('demo', 40), ride('sensor', 30, 60)])).toBeNull();
    expect(usualPace([ride('sensor', 22), ride('demo', 45), ride('sensor', 26), ride('sensor', 24)])! * 3.6).toBeCloseTo(24, 6);
  });
  it('rewards a podium and a win only after a real race', () => {
    const outcome = { meters: 5000, seconds: 900, climbMeters: 10, laps: [], light: 'dia', riders: 12 };
    expect(earned(emptyTotals(), { ...outcome, finishedRoute: false, place: 1 }, [])).not.toContain('victoria');
    expect(earned(emptyTotals(), { ...outcome, finishedRoute: true, place: 3 }, [])).toContain('podio');
    expect(earned(emptyTotals(), { ...outcome, finishedRoute: true, place: 1 }, [])).toEqual(expect.arrayContaining(['podio', 'victoria']));
    expect(earned(emptyTotals(), { ...outcome, finishedRoute: true }, [])).not.toContain('podio');
  });
});
