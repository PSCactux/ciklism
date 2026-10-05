export interface Vec3 { x: number; y: number; z: number }
export interface Route {
  nombre: string; puntos: Vec3[]; revision?: number;
  scenery?: 'meadow' | 'lake' | 'river' | 'alpine' | 'reservoir' | 'chapel';
}
/** Old rides keep their history/XP, but a changed course gets its own records. */
export const routeRecordId = (id: string, route: Route) => route.revision ? `${id}@${route.revision}` : id;
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, n: number): Vec3 => ({ x: a.x * n, y: a.y * n, z: a.z * n });
export const length = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
export const normalize = (a: Vec3) => scale(a, 1 / (length(a) || 1));
export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export class RoutePath {
  readonly points: Vec3[];
  readonly cumulative: number[] = [0];
  readonly totalLength: number;
  readonly isCircuit: boolean;
  readonly climb: number;

  constructor(readonly route: Route, reversed = false) {
    if (!Array.isArray(route.puntos) || route.puntos.length < 2 || route.puntos.some(p =>
      ![p.x, p.y, p.z].every(Number.isFinite))) throw new Error('La ruta no es válida.');
    const points = reversed ? [...route.puntos].reverse() : route.puntos;
    // Drop repeated vertices so sampling and road normals always have a direction.
    this.points = points.filter((p, i) => i === 0 || length(sub(p, points[i - 1])) > 0.001);
    let climb = 0;
    for (let i = 1; i < this.points.length; i++) {
      this.cumulative.push(this.cumulative[i - 1] + length(sub(this.points[i], this.points[i - 1])));
      climb += Math.max(0, this.points[i].y - this.points[i - 1].y);
    }
    this.totalLength = this.cumulative.at(-1)!;
    if (this.totalLength <= 0) throw new Error('La ruta necesita longitud.');
    this.isCircuit = this.totalLength > 200 && length(sub(this.points[0], this.points.at(-1)!)) < 25;
    this.climb = climb;
  }

  sample(distance: number) {
    const d = clamp(distance, 0, this.totalLength);
    let lo = 1, hi = this.cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.cumulative[mid] < d) lo = mid + 1;
      else hi = mid;
    }
    const a = this.points[lo - 1], seg = sub(this.points[lo], a);
    const t = (d - this.cumulative[lo - 1]) / (this.cumulative[lo] - this.cumulative[lo - 1]);
    return { position: add(a, scale(seg, t)), forward: normalize(seg),
      slope: seg.y / (Math.hypot(seg.x, seg.z) || 1) };
  }

  positionAt(distance: number): Vec3 {
    if (this.isCircuit) return this.sample(((distance % this.totalLength) + this.totalLength) % this.totalLength).position;
    if (distance <= this.totalLength) return this.sample(distance).position;
    const end = this.sample(this.totalLength);
    return add(end.position, scale(end.forward, distance - this.totalLength));
  }
}
