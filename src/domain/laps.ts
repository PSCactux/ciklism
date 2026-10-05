import { clamp } from './route';

export interface TracePoint { distance: number; seconds: number }
export interface Sector { index: number; seconds: number; delta: number | null; best: boolean }
export interface Lap { number: number; seconds: number; record: boolean; sectors: Sector[] }
export interface LapRecord { bestSeconds: number | null; sectors: (number | null)[]; trace: TracePoint[] }
export const emptyRecord = (): LapRecord => ({ bestSeconds: null, sectors: [null, null, null], trace: [] });

function interpolate(points: TracePoint[], value: number, axis: 'seconds' | 'distance'): number | null {
  if (points.length < 2) return null;
  const other = axis === 'seconds' ? 'distance' : 'seconds';
  for (let i = 1; i < points.length; i++) {
    if (points[i][axis] >= value) {
      const a = points[i - 1], b = points[i];
      const k = clamp((value - a[axis]) / (b[axis] - a[axis] || 1), 0, 1);
      return a[other] + (b[other] - a[other]) * k;
    }
  }
  return points.at(-1)![other];
}

export class LapTimer {
  readonly laps: Lap[] = [];
  sectors: Sector[] = [];
  private trace: TracePoint[] = [{ distance: 0, seconds: 0 }];
  private previous: TracePoint = { distance: 0, seconds: 0 };
  private nextSplit = 25;
  private sectorStarted = 0;
  private best: LapRecord;

  constructor(readonly length: number, record: LapRecord = emptyRecord()) {
    this.best = structuredClone(record);
  }

  mark(distance: number, seconds: number) {
    const at = (boundary: number) => this.previous.seconds + (seconds - this.previous.seconds) *
      clamp((boundary - this.previous.distance) / (distance - this.previous.distance || 1), 0, 1);
    while (this.nextSplit < this.length && this.nextSplit <= distance) {
      this.trace.push({ distance: this.nextSplit, seconds: at(this.nextSplit) });
      this.nextSplit += 25;
    }
    while (this.sectors.length < 3 && distance >= this.length * (this.sectors.length + 1) / 3 - 1e-7) {
      const index = this.sectors.length;
      const end = at(this.length * (index + 1) / 3);
      const duration = end - this.sectorStarted;
      const previous = this.best.sectors[index] ?? null;
      const best = previous === null || duration < previous;
      this.sectors.push({ index, seconds: duration, delta: previous === null ? null : duration - previous, best });
      if (best) this.best.sectors[index] = duration;
      this.sectorStarted = end;
    }
    this.previous = { distance, seconds };
  }

  complete(seconds: number) {
    this.mark(this.length, seconds);
    const isRecord = this.best.bestSeconds === null || seconds < this.best.bestSeconds;
    const lap = { number: this.laps.length + 1, seconds, record: isRecord, sectors: this.sectors };
    this.laps.push(lap);
    // Never replace a saved all-time ghost with a slower first lap of this session.
    if (isRecord) {
      this.best.bestSeconds = seconds;
      this.best.trace = [...this.trace, { distance: this.length, seconds }];
    }
    this.trace = [{ distance: 0, seconds: 0 }];
    this.previous = { distance: 0, seconds: 0 };
    this.sectors = [];
    this.sectorStarted = 0;
    this.nextSplit = 25;
  }
  record(): LapRecord { return structuredClone(this.best); }
  ghostDistance(seconds: number) { return interpolate(this.best.trace, seconds, 'seconds'); }
  delta(distance: number, seconds: number) {
    const reference = interpolate(this.best.trace, distance, 'distance');
    return reference === null ? null : seconds - reference;
  }
}
