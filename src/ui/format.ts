import type { RoutePath } from '../domain/route';
const decimal = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
export const km = (meters: number) => decimal.format(meters / 1000);
export const number = (value: number) => decimal.format(value);
export const escape = (text: string) => text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
export function time(seconds: number) {
  const s = Math.floor(Math.max(0, seconds)), h = Math.floor(s / 3600);
  return `${h ? h + ':' : ''}${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
/** Fits the course's plan view into the 160×160 map, leaving room for the markers. */
export function mapProjection(path: RoutePath) {
  const xs = path.points.map(p => p.x), zs = path.points.map(p => p.z);
  const minX = Math.min(...xs), minZ = Math.min(...zs);
  const width = Math.max(...xs) - minX, height = Math.max(...zs) - minZ;
  const factor = 138 / Math.max(width, height, 1);
  return (p: { x: number; z: number }): [number, number] => [11 + (138 - width * factor) / 2 + (p.x - minX) * factor,
    11 + (138 - height * factor) / 2 + (p.z - minZ) * factor];
}
const plot = (points: [number, number][]) => points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
export function routeMap(path: RoutePath, className = '') {
  const project = mapProjection(path), line = plot(path.points.map(project)), [x, y] = project(path.points[0]);
  return `<svg class="route-map ${className}" viewBox="0 0 160 160" aria-hidden="true"><polyline class="map-shadow" points="${line}"/><polyline points="${line}"/><circle cx="${x}" cy="${y}" r="4"/></svg>`;
}
/** The riding map: one line per sector so each can take the colour of its time, the finish, the rivals and the rider. */
export function rideMap(path: RoutePath, rivals: readonly { rival: { jersey: string } }[]) {
  const project = mapProjection(path), third = path.totalLength / 3;
  const sectors = [0, 1, 2].map(i => {
    const points = [project(path.sample(third * i).position)];
    path.points.forEach((p, n) => { if (path.cumulative[n] > third * i && path.cumulative[n] < third * (i + 1)) points.push(project(p)); });
    points.push(project(path.sample(third * (i + 1)).position));
    return `<polyline class="map-sector" id="map-sector-${i}" points="${plot(points)}"/>`;
  }).join('');
  const marks = [1, 2].map(i => project(path.sample(third * i).position)).map(([x, y]) => `<circle class="map-split" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="2"/>`).join('');
  const [fx, fy] = project(path.points.at(-1)!), [sx, sy] = project(path.points[0]);
  return `<svg class="route-map ride-map" viewBox="0 0 160 160" role="img" aria-label="Mapa de la ruta con tu posición"><polyline class="map-shadow" points="${plot(path.points.map(project))}"/>${sectors}${marks}
    ${path.isCircuit ? '' : `<circle class="map-start" cx="${sx.toFixed(2)}" cy="${sy.toFixed(2)}" r="3"/>`}<rect class="map-finish" x="${(fx - 5.5).toFixed(2)}" y="${(fy - 5.5).toFixed(2)}" width="11" height="11" rx="2"/>
    ${rivals.map((r, i) => `<circle class="map-rival" id="map-rival-${i}" r="2.6" fill="${r.rival.jersey}"/>`).join('')}<circle class="map-you" id="map-you" r="7"/></svg>`;
}
export function elevation(path: RoutePath, climbs: readonly { start: number; end: number }[] = []) {
  const steps = 200, heights = Array.from({ length: steps + 1 }, (_, i) => path.sample(path.totalLength * i / steps).position.y);
  const min = Math.min(...heights), range = Math.max(10, Math.max(...heights) - min);
  const at = (i: number) => `${(i / steps * 400).toFixed(1)},${(63 - (heights[i] - min) / range * 52).toFixed(1)}`;
  const points = heights.map((_, i) => at(i)).join(' ');
  const steep = climbs.map(c => {
    const from = Math.floor(c.start / path.totalLength * steps), to = Math.ceil(c.end / path.totalLength * steps);
    return `<polygon class="climb" points="${(from / steps * 400).toFixed(1)},70 ${heights.slice(from, to + 1).map((_, i) => at(from + i)).join(' ')} ${(to / steps * 400).toFixed(1)},70"/>`;
  }).join('');
  return `<svg class="elevation" viewBox="0 0 400 70" preserveAspectRatio="none" aria-label="Perfil de elevación"><polygon points="0,70 ${points} 400,70"/>${steep}<polyline points="${points}"/><line id="elevation-position" x1="0" x2="0" y1="0" y2="70"/></svg>`;
}
