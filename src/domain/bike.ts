import { clamp } from './route';

/** One resistance level of the rider's own bike: metres travelled per crank turn at that level. */
export interface BikeLevel { metersPerRev: number }
/** Levels are registered on the real bike, in order; `routeLevels` lets the course pick among them. */
export interface BikeSetup { levels: BikeLevel[]; routeLevels: boolean }
export const MAX_LEVELS = 32;
export const DEFAULT_RATIO = 5.6;
/** A saved bike: riders with more than one keep a calibration for each. */
export interface Bike extends BikeSetup { id: string; name: string }
export const emptyBike = (): BikeSetup => ({ levels: [], routeLevels: true });
export const newBike = (name: string): Bike => ({ id: `bici-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`, name, ...emptyBike() });
export const speedKmh = (metersPerRev: number, rpm: number) => rpm / 60 * metersPerRev * 3.6;
/** Ratio that makes the app show the speed read on the bike's own display at this cadence. */
export function ratioFor(kmh: number, rpm: number): number | null {
  if (!Number.isFinite(kmh) || !Number.isFinite(rpm) || kmh < 1 || kmh > 99 || rpm < 20) return null;
  const ratio = kmh / 3.6 / (rpm / 60);
  return ratio >= 0.5 && ratio <= 25 ? ratio : null;
}
export function sanitizeBike(value: unknown): BikeSetup {
  const bike = value as Partial<BikeSetup> | undefined;
  const levels = Array.isArray(bike?.levels) ? bike.levels.filter(l => Number.isFinite(l?.metersPerRev) && l.metersPerRev > 0)
    .slice(0, MAX_LEVELS).map(l => ({ metersPerRev: l.metersPerRev })) : [];
  return { levels, routeLevels: bike?.routeLevels !== false };
}

/** Stored bikes, repaired if needed. A calibration saved before bikes had names becomes the first one. */
export function sanitizeBikes(value: unknown, legacy?: unknown): Bike[] {
  const stored = Array.isArray(value) ? value.filter(b => typeof b?.id === 'string' && b.id) : [];
  const bikes = stored.slice(0, 20).map((b, i) => ({ id: String(b.id).slice(0, 60),
    name: (typeof b.name === 'string' && b.name.trim() ? b.name.trim() : `Bici ${i + 1}`).slice(0, 30), ...sanitizeBike(b) }));
  return bikes.length ? bikes : [{ id: 'bici-1', name: 'Mi bici', ...sanitizeBike(legacy) }];
}

export type Signal = 'off' | 'waiting' | 'good';
/** Connected is not enough: the sensor also has to be sending fresh crank data. */
export function signalState(connected: boolean, secondsSinceData: number): Signal {
  return !connected ? 'off' : secondsSinceData <= 3 ? 'good' : 'waiting';
}

/** Recent cadence, sampled at a fixed pace, to tell a steady rhythm from a passing value. */
export class CadenceWindow {
  private samples: { at: number; rpm: number }[] = [];
  constructor(readonly seconds = 5) {}
  reset() { this.samples = []; }
  push(at: number, rpm: number) {
    this.samples.push({ at, rpm });
    while (this.samples.length && at - this.samples[0].at > this.seconds) this.samples.shift();
  }
  get reading(): { rpm: number; steady: boolean } {
    if (!this.samples.length) return { rpm: 0, steady: false };
    const values = this.samples.map(s => s.rpm), min = Math.min(...values), max = Math.max(...values);
    const span = this.samples.at(-1)!.at - this.samples[0].at;
    return { rpm: values.reduce((sum, v) => sum + v, 0) / values.length,
      steady: span >= 3 && min >= 20 && max - min <= 12 };
  }
}

/** Flat ground asks for an easy level and a 6 % climb for the hardest one. */
export function levelForSlope(slope: number, count: number) {
  return Math.round(clamp((slope + 0.01) / 0.07, 0, 1) * (Math.max(1, count) - 1));
}
/** Follows the slope band, but only after it has held, so a short bump never asks for a change. */
export class LevelGuide {
  level: number;
  private candidate: number;
  private held = 0;
  constructor(readonly count: number, slope = 0) { this.level = this.candidate = levelForSlope(slope, count); }
  update(slope: number, dt: number): number | null {
    const wanted = levelForSlope(slope, this.count);
    if (wanted === this.level) { this.candidate = wanted; this.held = 0; return null; }
    if (wanted !== this.candidate) { this.candidate = wanted; this.held = 0; }
    this.held += dt;
    if (this.held < 1.5) return null;
    this.level = wanted; this.held = 0;
    return wanted;
  }
}
