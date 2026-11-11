import { describe, expect, it } from 'vitest';
import { CadenceWindow, LevelGuide, levelForSlope, ratioFor, sanitizeBike, signalState, speedKmh } from '../src/domain/bike';
import { CadenceCalculator } from '../src/domain/cadence';
import { RideEngine } from '../src/domain/ride';
import { RoutePath } from '../src/domain/route';

const road = (rise: number) => new RoutePath({ nombre: 'Road', puntos: [{ x: 0, y: 0, z: 0 }, { x: 0, y: rise, z: 1000 }] });
function pedal(engine: RideEngine, seconds = 30, rpm = 80) {
  for (let i = 0; i < seconds * 30; i++) { engine.onCadence(rpm); engine.tick(1 / 30); }
  return engine.state;
}
describe('calibrating against the bike display', () => {
  it('derives the ratio that reproduces the speed read on the bike', () => {
    const ratio = ratioFor(24, 80)!;
    expect(speedKmh(ratio, 80)).toBeCloseTo(24, 9);
    expect(pedal(new RideEngine(road(0), undefined, 1, [ratio])).speedMps * 3.6).toBeCloseTo(24, 2);
    for (const [kmh, rpm] of [[0, 80], [24, 0], [24, 10], [120, 80], [NaN, 80]]) expect(ratioFor(kmh, rpm)).toBeNull();
  });
  it('only calls a cadence steady after three even seconds', () => {
    const w = new CadenceWindow();
    for (let t = 0; t < 2.5; t += 0.25) w.push(t, 80);
    expect(w.reading.steady).toBe(false);
    for (let t = 2.5; t <= 4; t += 0.25) w.push(t, 82);
    expect(w.reading).toMatchObject({ steady: true }); expect(w.reading.rpm).toBeGreaterThan(80);
    w.push(4.25, 40); expect(w.reading.steady).toBe(false);
    for (let t = 4.5; t <= 10; t += 0.25) w.push(t, 0);
    expect(w.reading.steady).toBe(false);
  });
  it('counts crank turns across reconnections and tells a silent sensor from a live one', () => {
    const c = new CadenceCalculator();
    c.update({ revolutions: 10, time: 0 }); c.update({ revolutions: 12, time: 1536 });
    c.reset(); c.update({ revolutions: 0, time: 0 }); c.update({ revolutions: 1, time: 768 });
    expect(c.turns).toBe(3);
    expect([signalState(false, 0), signalState(true, 1), signalState(true, 9)]).toEqual(['off', 'good', 'waiting']);
  });
  it('rides on the registered levels and lets the course ask for one', () => {
    const levels = [4, 5, 6, 7];
    const manual = new RideEngine(road(0), undefined, 1, levels);
    expect(manual.state).toMatchObject({ gear: 0, routeGear: null }); manual.shift(9);
    expect(pedal(manual).speedMps).toBeCloseTo(80 / 60 * 7, 3);
    manual.setRatio(3, 3.5); expect(pedal(manual).speedMps).toBeCloseTo(80 / 60 * 3.5, 3);
    expect(new RideEngine(road(0), undefined, 1, levels, true).state.gear).toBe(levelForSlope(0, 4));
    expect(new RideEngine(road(80), undefined, 1, levels, true).state).toMatchObject({ gear: 3, routeGear: 3 });
  });
  it('waits for a slope band to hold before asking for another level', () => {
    const guide = new LevelGuide(8);
    expect(guide.level).toBe(1);
    expect(guide.update(0.06, 1)).toBeNull(); expect(guide.update(0, 1)).toBeNull();
    expect(guide.update(0.06, 1)).toBeNull(); expect(guide.update(0.06, 1)).toBe(7);
    expect(levelForSlope(-0.05, 8)).toBe(0); expect(levelForSlope(0.2, 1)).toBe(0);
  });
  it('drops unusable stored levels', () => {
    expect(sanitizeBike(undefined)).toEqual({ levels: [], routeLevels: true });
    expect(sanitizeBike({ levels: [{ metersPerRev: 5 }, { metersPerRev: -1 }, {}], routeLevels: false }))
      .toEqual({ levels: [{ metersPerRev: 5 }], routeLevels: false });
  });
});
