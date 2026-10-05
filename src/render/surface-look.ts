import type { Route } from '../domain/route';
import type { Scenery } from './scenery';

/** Material/planting choices only; terrain, route physics and baked shadows stay compatible. */
const looks = {
  meadow: { tint: '#c8d5bc', dry: 0.06, step: 2.4, rows: 3, height: 0.9 },
  lake: { tint: '#bbd0c4', dry: 0.02, step: 2.4, rows: 3, height: 1.0 },
  river: { tint: '#c4d2c4', dry: 0, step: 2.4, rows: 3, height: 1.0 },
  alpine: { tint: '#bbb6a1', dry: 0.58, step: 5.5, rows: 1, height: 0.55 },
  reservoir: { tint: '#d0c7ad', dry: 0.38, step: 3.2, rows: 2, height: 0.75 },
  chapel: { tint: '#d1c4a7', dry: 0.48, step: 3.5, rows: 2, height: 0.7 },
} satisfies Record<Scenery, { tint: string; dry: number; step: number; rows: number; height: number }>;

export const surfaceLook = (route: Route) => looks[route.scenery ?? 'meadow'];
