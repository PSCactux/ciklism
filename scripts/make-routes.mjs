// Generates the long courses in src/routes. Deterministic: rerunning it rewrites the same files.
// After changing a course here, regenerate its lighting with `npm run bake:lighting`.
import { writeFile } from 'node:fs/promises';

const SEGMENT = 500;
const round = n => Math.round(n * 1000) / 1000;
const wave = (terms, s) => terms.reduce((sum, [amplitude, period, phase]) => sum + amplitude * Math.sin(s / period + phase), 0);
function measure(points) {
  let length = 0, climb = 0, steepest = 0, sharpest = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], flat = Math.hypot(b.x - a.x, b.z - a.z);
    length += Math.hypot(flat, b.y - a.y); climb += Math.max(0, b.y - a.y);
    steepest = Math.max(steepest, Math.abs(b.y - a.y) / flat);
    if (i > 1) {
      const p = points[i - 2];
      let turn = Math.abs(Math.atan2(b.x - a.x, b.z - a.z) - Math.atan2(a.x - p.x, a.z - p.z));
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      sharpest = Math.max(sharpest, turn * 180 / Math.PI);
    }
  }
  return { length, climb, steepest, sharpest };
}
/** Stretch the plan view until the ridden length, slopes included, is the advertised one. */
function fit(build, km) {
  let scale = 1, points = build(scale);
  for (let i = 0; i < 12; i++) { scale *= km * 1000 / measure(points).length; points = build(scale); }
  return points.map(p => ({ x: round(p.x), y: round(p.y), z: round(p.z) }));
}
/** A road that wanders around one bearing, so it never comes back near itself. */
function journey({ km, bearing, sway, altitude }) {
  const count = Math.round(km * 1000 / SEGMENT);
  return fit(scale => {
    const points = [{ x: 0, y: altitude(0), z: 0 }];
    for (let i = 1; i <= count; i++) {
      const s = (i - 0.5) * SEGMENT, heading = bearing + wave(sway, s), last = points[i - 1];
      points.push({ x: last.x + Math.sin(heading) * SEGMENT * scale, y: altitude(i * SEGMENT), z: last.z + Math.cos(heading) * SEGMENT * scale });
    }
    return points;
  }, km);
}
/** A closed loop: a circle pushed in and out by a few slow harmonics. */
function loop({ km, shape, altitude }) {
  const count = Math.round(km * 1000 / SEGMENT), radius = km * 1000 / (2 * Math.PI);
  return fit(scale => {
    const points = [];
    for (let i = 0; i < count; i++) {
      const angle = i / count * 2 * Math.PI, r = radius * scale * (1 + shape.reduce((sum, [amplitude, lobes, phase]) => sum + amplitude * Math.sin(angle * lobes + phase), 0));
      points.push({ x: Math.sin(angle) * r, y: altitude(angle), z: -Math.cos(angle) * r });
    }
    return [...points.map(p => ({ ...p, x: p.x - points[0].x, z: p.z - points[0].z })), { x: 0, y: points[0].y, z: 0 }];
  }, km);
}

const routes = {
  gran_vuelta: { nombre: 'Gran Vuelta de las Colinas', scenery: 'chapel',
    puntos: loop({ km: 30, shape: [[0.13, 2, 0.6], [0.08, 3, 2.1], [0.035, 5, 4.0]],
      altitude: angle => 110 + 62 * Math.sin(angle - 0.9) + 48 * Math.sin(angle * 3 + 0.5) + 18 * Math.sin(angle * 7 + 2.2) }) },
  valle_largo: { nombre: 'Travesía del Valle Largo', scenery: 'river',
    puntos: journey({ km: 45, bearing: 0.5, sway: [[0.7, 3300, 0.4], [0.16, 1250, 2.6]],
      altitude: s => 20 + s * 0.0031 + 26 * Math.sin(s / 2900 + 1.1) + 9 * Math.sin(s / 870 + 0.3) }) },
  gran_fondo: { nombre: 'Gran Fondo de la Sierra', scenery: 'alpine',
    puntos: journey({ km: 60, bearing: -0.35, sway: [[0.72, 3500, 2.2], [0.15, 1400, 0.9]],
      altitude: s => 130 + s * 0.0052 + 150 * Math.sin(s / 4100 - 1.2) + 46 * Math.sin(s / 1500 + 0.7) + 14 * Math.sin(s / 620 + 2.9) }) },
};
for (const [id, route] of Object.entries(routes)) {
  const m = measure(route.puntos);
  await writeFile(new URL(`../src/routes/${id}.json`, import.meta.url), JSON.stringify(route, null, 2) + '\n');
  console.log(`${id}: ${(m.length / 1000).toFixed(2)} km, ${Math.round(m.climb)} m de ascenso, pendiente máx. ${(m.steepest * 100).toFixed(1)} %, giro máx. ${m.sharpest.toFixed(1)}°, ${route.puntos.length} puntos`);
}
