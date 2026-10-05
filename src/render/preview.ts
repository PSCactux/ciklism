import { RoutePath, type Vec3 } from '../domain/route';
import { groundAt } from './geometry';
import { lakeFor } from './scenery';

export interface PreviewView { fraction: number; height: number; behind: number; side: number; ahead: number; lakeFocus?: boolean }
export const ROUTE_PREVIEWS: Record<string, PreviewView> = {
  ovalo: { fraction: 0.14, height: 35, behind: 60, side: -28, ahead: 65 },
  ruta_inicial: { fraction: 0.48, height: 65, behind: 80, side: 100, ahead: 100, lakeFocus: true },
  valle: { fraction: 0.24, height: 68, behind: 95, side: -44, ahead: 215 },
  puerto: { fraction: 0.56, height: 52, behind: 95, side: 55, ahead: 85 },
  embalse: { fraction: 0.9, height: 90, behind: 110, side: 140, ahead: 140, lakeFocus: true },
  ermita: { fraction: 0.72, height: 48, behind: 90, side: 55, ahead: 100 },
};
const FALLBACK = { fraction: 0.35, height: 90, behind: 120, side: -80, ahead: 90 };

/** Presentation only: the ride still starts at distance zero. */
export function previewPose(path: RoutePath, view: PreviewView = FALLBACK): { eye: Vec3; target: Vec3 } {
  const distance = path.totalLength * view.fraction;
  const sample = path.sample(distance), f = sample.forward;
  const length = Math.hypot(f.x, f.z) || 1;
  const eye = { x: sample.position.x - f.x / length * view.behind + f.z / length * view.side,
    y: sample.position.y + view.height,
    z: sample.position.z - f.z / length * view.behind - f.x / length * view.side };
  eye.y = Math.max(eye.y, groundAt(path, eye.x, eye.z).height + 35);
  const target = path.positionAt(Math.min(path.totalLength, distance + view.ahead));
  const lake = view.lakeFocus ? lakeFor(path.route) : null;
  if (lake) return { eye, target: { x: target.x * 0.6 + lake.x * 0.4, y: target.y * 0.6 + lake.level * 0.4 + 5,
    z: target.z * 0.6 + lake.z * 0.4 } };
  return { eye, target: { ...target, y: target.y + 5 } };
}
