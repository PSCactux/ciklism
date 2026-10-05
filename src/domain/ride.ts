import { add, clamp, normalize, RoutePath, scale, type Vec3 } from './route';
import { LapTimer, type LapRecord } from './laps';

export const GEARS = [2.6, 3.2, 3.9, 4.7, 5.6, 6.5, 7.4, 8.3, 9.2];
export interface RideState {
  distance: number; travelled: number; speedMps: number; cadenceRpm: number;
  elapsedSeconds: number; position: Vec3; forward: Vec3; slope: number;
  powerWatts: number; crankAngle: number; gear: number; lap: number;
  lapSeconds: number; climbMeters: number; finished: boolean;
  ghostDistance: number | null; deltaSeconds: number | null;
}
export function coastAcceleration(speed: number, slope: number) {
  const denominator = Math.sqrt(1 + slope * slope);
  const gravity = 80 * 9.80665 * slope / denominator;
  const rolling = speed > 0.01 ? 0.005 * 80 * 9.80665 / denominator : 0;
  const drag = 0.5 * 1.225 * 0.32 * speed * Math.abs(speed);
  return -(gravity + rolling + drag) / 80;
}

export class RideEngine {
  readonly timer: LapTimer;
  private age = Infinity;
  private cadence = 0;
  private speed = 0;
  private elapsed = 0;
  private distance = 0;
  private travelled = 0;
  private climb = 0;
  private crank = 0;
  private lapStarted = 0;
  private gear = 5;
  private factor = 1;
  private previousY: number;
  state: RideState;

  constructor(readonly path: RoutePath, record?: LapRecord, calibration = 1) {
    this.timer = new LapTimer(path.totalLength, record);
    this.previousY = path.sample(0).position.y;
    this.setCalibration(calibration);
    this.state = this.snapshot();
  }
  setCalibration(factor: number) { if (Number.isFinite(factor)) this.factor = clamp(factor, 0.4, 2.5); }
  shift(steps: number) { this.gear = clamp(this.gear + Math.trunc(steps), 0, GEARS.length - 1); }
  onCadence(rpm: number) {
    if (!Number.isFinite(rpm) || rpm < 0 || rpm > 250) return;
    this.cadence = rpm; this.age = 0;
  }
  invalidateCadence() { this.cadence = 0; this.age = Infinity; }

  tick(dt: number): RideState {
    if (!Number.isFinite(dt) || dt < 0 || dt > 0.25) throw new Error('El tick debe estar entre 0 y 250 ms.');
    if (this.state.finished || dt === 0) return this.state;
    this.age += dt;
    if (this.age > 3) this.cadence = 0;
    const slope = this.path.sample(this.distance).slope;
    this.speed = this.cadence > 0
      ? this.speed + (this.cadence / 60 * GEARS[this.gear] * this.factor - this.speed) * dt / (dt + 1.4)
      : Math.max(0, this.speed + coastAcceleration(this.speed, slope) * dt);
    let advance = this.speed * dt;
    let duration = dt;
    if (!this.path.isCircuit && this.distance + advance >= this.path.totalLength) {
      advance = this.path.totalLength - this.distance;
      duration = this.speed > 0 ? advance / this.speed : dt;
    }
    const beforeTime = this.elapsed;
    const beforeDistance = this.distance;
    this.elapsed += duration;
    this.travelled += advance;
    this.distance += advance;
    this.crank = (this.crank + this.cadence / 60 * Math.PI * 2 * duration) % (Math.PI * 2);
    if (this.path.isCircuit && this.distance >= this.path.totalLength) {
      const crossingTime = beforeTime + duration * (this.path.totalLength - beforeDistance) / advance;
      this.timer.complete(crossingTime - this.lapStarted);
      this.lapStarted = crossingTime;
      this.climb += Math.max(0, this.path.sample(this.path.totalLength).position.y - this.previousY);
      this.previousY = this.path.sample(0).position.y;
      this.distance -= this.path.totalLength;
    }
    if (this.path.isCircuit) this.timer.mark(this.distance, this.elapsed - this.lapStarted);
    const y = this.path.sample(this.distance).position.y;
    this.climb += Math.max(0, y - this.previousY);
    this.previousY = y;
    this.state = this.snapshot();
    return this.state;
  }

  private snapshot(): RideState {
    const here = this.path.sample(this.distance);
    const lapSeconds = this.elapsed - this.lapStarted;
    return { ...here, distance: this.distance, travelled: this.travelled, speedMps: this.speed,
      cadenceRpm: this.cadence, elapsedSeconds: this.elapsed, powerWatts: this.cadence * 2 * Math.PI / 60 * 25 * 0.97,
      crankAngle: this.crank, gear: this.gear, lap: this.timer.laps.length + 1, lapSeconds,
      climbMeters: this.climb, finished: !this.path.isCircuit && this.distance >= this.path.totalLength,
      ghostDistance: this.path.isCircuit ? this.timer.ghostDistance(lapSeconds) : null,
      deltaSeconds: this.path.isCircuit ? this.timer.delta(this.distance, lapSeconds) : null };
  }
}

/** Bounded fixed simulation steps, independent of screen refresh rate. */
export class RideClock {
  private previous: number | null = null;
  private accumulator = 0;
  reset() { this.previous = null; this.accumulator = 0; }
  advance(nowMs: number, tick: (dt: number) => void) {
    if (this.previous === null) { this.previous = nowMs; return; }
    const delta = Math.max(0, (nowMs - this.previous) / 1000);
    this.previous = nowMs;
    // Suspended tabs must not earn minutes or kilometres on their next frame.
    if (delta > 1) { this.accumulator = 0; return; }
    this.accumulator += delta;
    while (this.accumulator >= 1 / 30 - 1e-9) {
      tick(1 / 30); this.accumulator -= 1 / 30;
    }
  }
}

export function cameraPose(path: RoutePath, state: RideState, motion = true) {
  const effort = motion && state.cadenceRpm > 0 ? clamp(state.powerWatts / 220, 0, 1.6) : 0;
  const right = normalize({ x: state.forward.z, y: 0, z: -state.forward.x });
  const lateral = 0.03 * effort * Math.sin(state.crankAngle);
  const lean = 1.8 * Math.PI / 180 * effort * Math.sin(state.crankAngle);
  return {
    eye: add(add(state.position, { x: 0, y: 1.45 - 0.022 * effort * Math.cos(2 * state.crankAngle), z: 0 }), scale(right, lateral)),
    target: add(path.positionAt(state.distance + 12), { x: 0, y: 1.45, z: 0 }),
    up: normalize({ x: right.x * Math.sin(lean), y: Math.cos(lean), z: right.z * Math.sin(lean) }),
  };
}
