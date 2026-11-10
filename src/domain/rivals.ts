import { clamp, type RoutePath } from './route';

/** `pace` multiplies the rider's own usual speed; `climbing` is how much a slope slows this rival. */
export interface Rival { name: string; jersey: string; helmet: string; pace: number; climbing: number; lane: number }
/** Slowest first. Paces straddle 1, so there is always someone just ahead and someone to hold off. */
export const PELOTON: readonly Rival[] = [
  { name: 'Hugo', jersey: '#e2a23b', helmet: '#2f3437', pace: 0.74, climbing: 4.2, lane: -1.9 },
  { name: 'Carla', jersey: '#3f8fd0', helmet: '#f1efe6', pace: 0.80, climbing: 3.4, lane: 1.9 },
  { name: 'Dani', jersey: '#7b5fc7', helmet: '#e8e2f6', pace: 0.86, climbing: 3.9, lane: -1.15 },
  { name: 'Aitana', jersey: '#e06a8a', helmet: '#2f3437', pace: 0.91, climbing: 3.0, lane: 1.15 },
  { name: 'Tomás', jersey: '#2f9e79', helmet: '#f1efe6', pace: 0.95, climbing: 4.0, lane: -1.9 },
  { name: 'Nerea', jersey: '#f0e04a', helmet: '#33506b', pace: 0.99, climbing: 2.8, lane: 1.9 },
  { name: 'Rubén', jersey: '#c9483c', helmet: '#f1efe6', pace: 1.03, climbing: 3.6, lane: -1.15 },
  { name: 'Laia', jersey: '#f4f1e8', helmet: '#c9483c', pace: 1.07, climbing: 2.6, lane: 1.15 },
  { name: 'Íñigo', jersey: '#254f8f', helmet: '#f0e04a', pace: 1.12, climbing: 3.2, lane: -1.9 },
  { name: 'Sara', jersey: '#e9772c', helmet: '#f1efe6', pace: 1.18, climbing: 2.7, lane: 1.9 },
  { name: 'Marta', jersey: '#1f2a2e', helmet: '#d4ef9c', pace: 1.26, climbing: 2.4, lane: -1.15 },
];
export type RivalLevel = 'off' | 'easy' | 'even' | 'hard';
export const RIVAL_LEVELS: Record<Exclude<RivalLevel, 'off'>, number> = { easy: 0.9, even: 1, hard: 1.1 };

export interface RivalState {
  rival: Rival; index: number;
  /** Metres from the start line, laps included; `distance` is the same point on the course. */
  progress: number; distance: number; speedMps: number; crankAngle: number; finished: boolean;
}
export interface Gap { name: string; jersey: string; meters: number }
export interface Standing { place: number; riders: number; ahead: Gap | null; behind: Gap | null }

/** The rider's usual speed: the median of their last rides with a sensor that were long enough to count. */
export function usualPace(sessions: { mode: string; meters: number; seconds: number }[]): number | null {
  const speeds = sessions.filter(s => s.mode === 'sensor' && s.seconds >= 180 && s.meters > 0).slice(0, 5)
    .map(s => s.meters / s.seconds).sort((a, b) => a - b);
  return speeds.length ? speeds[Math.floor(speeds.length / 2)] : null;
}

export class Peloton {
  readonly riders: RivalState[];
  private elapsed = 0;
  /** A mass start: two abreast ahead of the rider, the quickest on the front row. */
  constructor(readonly path: RoutePath, readonly paceMps: number, rivals: readonly Rival[] = PELOTON) {
    this.riders = rivals.map((rival, index) => {
      const progress = Math.min(path.totalLength / 2, 5 + Math.floor(index / 2) * 3.2);
      return { rival, index, progress, distance: progress, speedMps: 0, crankAngle: index * 1.3, finished: false };
    });
  }
  tick(dt: number) {
    this.elapsed += dt;
    const total = this.path.totalLength;
    for (const r of this.riders) {
      if (r.finished) continue;
      const slope = this.path.sample(r.distance).slope;
      // Nobody holds a perfectly even effort: each rival drifts a little around their pace.
      const rhythm = 1 + 0.04 * Math.sin(this.elapsed / (37 + r.index * 5) + r.index * 1.7);
      const target = this.paceMps * r.rival.pace * clamp(1 - slope * r.rival.climbing, 0.5, 1.22) * rhythm;
      r.speedMps += (target - r.speedMps) * dt / (dt + 2.2);
      r.progress += r.speedMps * dt;
      r.crankAngle = (r.crankAngle + clamp(55 + r.speedMps * 4, 60, 100) / 60 * Math.PI * 2 * dt) % (Math.PI * 2);
      if (!this.path.isCircuit && r.progress >= total) { r.progress = total; r.finished = true; r.speedMps = 0; }
      r.distance = this.path.isCircuit ? r.progress % total : r.progress;
    }
  }
  /** A rival who has already crossed the line of an open course is ahead, whatever the metres say. */
  standing(progress: number): Standing {
    let place = 1, ahead: RivalState | null = null, behind: RivalState | null = null;
    for (const r of this.riders) {
      if (r.finished || r.progress > progress) {
        place++;
        if (!r.finished && (!ahead || r.progress < ahead.progress)) ahead = r;
      } else if (!behind || r.progress > behind.progress) behind = r;
    }
    const gap = (r: RivalState | null): Gap | null => r && { name: r.rival.name, jersey: r.rival.jersey, meters: Math.abs(r.progress - progress) };
    return { place, riders: this.riders.length + 1, ahead: gap(ahead), behind: gap(behind) };
  }
}
