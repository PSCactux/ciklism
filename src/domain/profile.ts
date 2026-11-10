import type { RoutePath } from './route';

/** A stretch worth announcing: long enough and steep enough to be felt on the bike. */
export interface Climb { start: number; end: number; gain: number; grade: number }
const STEP = 50, WINDOW = 4;

/** Climbs along the course in riding order. One that straddles a circuit's start line is not joined up. */
export function climbs(path: RoutePath): Climb[] {
  const heights: number[] = [];
  for (let d = 0; d <= path.totalLength; d += STEP) heights.push(path.sample(d).position.y);
  // Grade over the next 200 m: a short dip or flat inside a climb does not end it.
  const grade = (i: number) => (heights[Math.min(heights.length - 1, i + WINDOW)] - heights[i]) / (STEP * WINDOW);
  const found: Climb[] = [];
  let from = -1;
  for (let i = 0; i < heights.length; i++) {
    if (from < 0 && grade(i) >= 0.025) from = i;
    else if (from >= 0 && (grade(i) < 0.008 || i === heights.length - 1)) {
      // Trim to the real foot and summit inside the detected stretch.
      let top = from;
      for (let k = from; k <= Math.min(heights.length - 1, i + WINDOW); k++) if (heights[k] > heights[top]) top = k;
      const gain = heights[top] - heights[from], meters = (top - from) * STEP;
      if (gain >= 15 && meters >= 300) found.push({ start: from * STEP, end: top * STEP, gain, grade: gain / meters });
      from = -1;
    }
  }
  return found;
}
/** Where the rider is in relation to the climbs: on one, approaching one, or neither. */
export function stretchAt(list: readonly Climb[], distance: number) {
  const on = list.find(c => distance >= c.start && distance < c.end);
  if (on) return { on, next: null };
  return { on: null, next: list.find(c => c.start > distance) ?? null };
}
