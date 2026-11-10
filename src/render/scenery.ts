import type { Route } from '../domain/route';

export type Scenery = 'meadow' | 'lake' | 'river' | 'alpine' | 'reservoir' | 'chapel';
/** `rise` is how high the land climbs away from the road, `woods` how much of it is wooded (0 to 1),
 * `farms` how much of the gentle ground is cultivated, and `species` the trees that grow there. */
export const landscapes = {
  meadow: { grass: '#a6ce84', relief: 0.65, treeStep: 38, clusters: 2, treeHeight: 0.8, rise: 26, woods: 0.36, farms: 0.85, species: ['alder', 'pine', 'alder'] },
  lake: { grass: '#92bf8e', relief: 0.9, treeStep: 28, clusters: 2, treeHeight: 1.1, rise: 55, woods: 0.55, farms: 0.35, species: ['pine', 'spruce', 'pine'] },
  river: { grass: '#adc797', relief: 1.15, treeStep: 14, clusters: 16, treeHeight: 1.4, rise: 0, woods: 0, farms: 0, species: ['spruce', 'alder'] },
  alpine: { grass: '#bbb6a1', relief: 3.2, treeStep: 48, clusters: 1, treeHeight: 0.7, rise: 210, woods: 0.3, farms: 0, species: ['spruce', 'pine', 'spruce'] },
  reservoir: { grass: '#c4bc89', relief: 1.7, treeStep: 38, clusters: 2, treeHeight: 0.9, rise: 80, woods: 0.3, farms: 0.5, species: ['pine', 'pine', 'alder'] },
  chapel: { grass: '#c6bc86', relief: 2.0, treeStep: 34, clusters: 2, treeHeight: 0.85, rise: 60, woods: 0.3, farms: 0.7, species: ['pine', 'alder', 'pine'] },
} satisfies Record<Scenery, { grass: string; relief: number; treeStep: number; clusters: number; treeHeight: number;
  rise: number; woods: number; farms: number; species: ('pine' | 'spruce' | 'alder')[] }>;
export const landscape = (route: Route) => landscapes[route.scenery ?? 'meadow'];

/** Metres from the road. Terrain, water and planting use the same meandering banks. */
export function riverProfile(distance: number) {
  return { center: 43 + Math.sin(distance / 135) * 9 + Math.sin(distance / 51) * 2.5,
    halfWidth: 12 + Math.sin(distance / 97 + 0.7) * 3 + Math.sin(distance / 33) * 1.2 };
}

export interface Lake { x: number; z: number; rx: number; rz: number; level: number }
const lakes = new WeakMap<Route, Lake | null>();
/** A fixed basin inside the loop; shared by terrain, water and the offline baker. */
export function lakeFor(route: Route): Lake | null {
  if (lakes.has(route)) return lakes.get(route)!;
  let lake: Lake | null = null;
  if (route.scenery === 'lake' || route.scenery === 'reservoir') {
    const xs = route.puntos.map(p => p.x), zs = route.puntos.map(p => p.z);
    lake = { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2,
      rx: (Math.max(...xs) - Math.min(...xs)) * 0.31, rz: (Math.max(...zs) - Math.min(...zs)) * 0.30,
      level: Math.min(...route.puntos.map(p => p.y)) - 2.5 };
  }
  lakes.set(route, lake); return lake;
}
export function lakeRadius(lake: Lake, x: number, z: number) {
  return Math.hypot((x - lake.x) / lake.rx, (z - lake.z) / lake.rz);
}
