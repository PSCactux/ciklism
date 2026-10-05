import type { RoutePath } from '../domain/route';
const decimal = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
export const km = (meters: number) => decimal.format(meters / 1000);
export const number = (value: number) => decimal.format(value);
export const escape = (text: string) => text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
export function time(seconds: number) {
  const s = Math.floor(Math.max(0, seconds)), h = Math.floor(s / 3600);
  return `${h ? h + ':' : ''}${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
export function routeMap(path: RoutePath, className = '') {
  const xs = path.points.map(p => p.x), zs = path.points.map(p => p.z);
  const minX = Math.min(...xs), minZ = Math.min(...zs);
  const width = Math.max(...xs) - minX, height = Math.max(...zs) - minZ;
  const factor = 138 / Math.max(width, height, 1);
  const x = (n: number) => 11 + (138 - width * factor) / 2 + (n - minX) * factor;
  const y = (n: number) => 11 + (138 - height * factor) / 2 + (n - minZ) * factor;
  const line = path.points.map(p => `${x(p.x).toFixed(2)},${y(p.z).toFixed(2)}`).join(' ');
  return `<svg class="route-map ${className}" viewBox="0 0 160 160" aria-hidden="true"><polyline class="map-shadow" points="${line}"/><polyline points="${line}"/><circle cx="${x(path.points[0].x)}" cy="${y(path.points[0].z)}" r="4"/></svg>`;
}
export function elevation(path: RoutePath) {
  const ys = path.points.map(p => p.y), min = Math.min(...ys), range = Math.max(10, Math.max(...ys) - min);
  const points = path.points.map((p, i) => `${(path.cumulative[i] / path.totalLength * 400).toFixed(1)},${(63 - (p.y - min) / range * 52).toFixed(1)}`).join(' ');
  return `<svg class="elevation" viewBox="0 0 400 70" preserveAspectRatio="none" aria-label="Perfil de elevación"><polygon points="0,70 ${points} 400,70"/><polyline points="${points}"/><line id="elevation-position" x1="0" x2="0" y1="0" y2="70"/></svg>`;
}
