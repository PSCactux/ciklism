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

const lines = new WeakMap<Route, Vec3[]>();
/** The line the road follows, in the course's own direction: its vertices with every corner
 * rounded, so heading and slope change gradually instead of snapping at each vertex. */
export function roadLine(route: Route): Vec3[] {
  let line = lines.get(route);
  if (line) return line;
  if (!Array.isArray(route.puntos) || route.puntos.length < 2 || route.puntos.some(p =>
    ![p.x, p.y, p.z].every(Number.isFinite))) throw new Error('La ruta no es válida.');
  // Drop repeated vertices so sampling and road normals always have a direction.
  const points = route.puntos.filter((p, i) => i === 0 || length(sub(p, route.puntos[i - 1])) > 0.001);
  const closed = points.length > 3 && length(sub(points[0], points.at(-1)!)) < 0.001, count = points.length;
  const corner = (i: number): Vec3[] => {
    const b = points[i], a = points[i === 0 ? count - 2 : i - 1], ab = sub(b, a), bc = sub(points[i + 1], b);
    const la = length(ab), lc = length(bc);
    const angle = Math.acos(clamp((ab.x * bc.x + ab.y * bc.y + ab.z * bc.z) / (la * lc), -1, 1));
    if (angle < 0.005) return [b];
    // Each corner may use a little under half of its two segments, so neighbours never overlap.
    const reach = Math.min(la, lc, 200) * 0.45, from = sub(b, scale(ab, reach / la)), to = add(b, scale(bc, reach / lc));
    const steps = clamp(Math.ceil(angle / 0.01), 3, 64);
    return Array.from({ length: steps + 1 }, (_, k) => {
      const t = k / steps;
      return add(add(scale(from, (1 - t) ** 2), scale(b, 2 * t * (1 - t))), scale(to, t * t));
    });
  };
  const inner = points.slice(1, -1).flatMap((_, i) => corner(i + 1)), seam = closed ? corner(0) : [];
  // A circuit rounds its start/finish corner too and still begins and ends on the same point.
  line = seam.length > 1 ? [...seam.slice(seam.length >> 1), ...inner, ...seam.slice(0, (seam.length >> 1) + 1)]
    : [points[0], ...inner, points.at(-1)!];
  // Rounding cuts corners; stretch the plan view back so the course keeps its advertised distance.
  const measure = (ps: Vec3[]) => ps.reduce((sum, p, i) => i ? sum + length(sub(p, ps[i - 1])) : 0, 0);
  const target = measure(points), origin = line[0];
  if (target <= 0) throw new Error('La ruta necesita longitud.');
  let fitted: Vec3[] = line;
  for (let pass = 0; pass < 3; pass++) {
    const k: number = target / measure(fitted);
    fitted = fitted.map(p => ({ x: origin.x + (p.x - origin.x) * k, y: p.y, z: origin.z + (p.z - origin.z) * k }));
  }
  lines.set(route, fitted);
  return fitted;
}

export class RoutePath {
  readonly points: Vec3[];
  readonly cumulative: number[] = [0];
  readonly totalLength: number;
  readonly isCircuit: boolean;
  readonly climb: number;

  constructor(readonly route: Route, reversed = false) {
    const line = roadLine(route);
    this.points = reversed ? [...line].reverse() : line;
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

  /** Heading at any distance: wraps on a circuit and holds the last one past an open end. */
  forwardAt(distance: number): Vec3 {
    const d = this.isCircuit ? ((distance % this.totalLength) + this.totalLength) % this.totalLength : distance;
    return this.sample(d).forward;
  }
  /** Turn per metre over the next stretch; positive curves to the right. */
  curvatureAt(distance: number, span = 10) {
    const a = this.forwardAt(distance), b = this.forwardAt(distance + span);
    return Math.atan2(b.x * a.z - b.z * a.x, a.x * b.x + a.z * b.z) / span;
  }

  positionAt(distance: number): Vec3 {
    if (this.isCircuit) return this.sample(((distance % this.totalLength) + this.totalLength) % this.totalLength).position;
    if (distance <= this.totalLength) return this.sample(distance).position;
    const end = this.sample(this.totalLength);
    return add(end.position, scale(end.forward, distance - this.totalLength));
  }
}
