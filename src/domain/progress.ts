import type { Lap } from './laps';

export const LEVELS = ['Principiante', 'Cicloturista', 'Rodador', 'Gregario', 'Escalador',
  'Cazaetapas', 'Contrarrelojista', 'Escapado', 'Líder', 'Campeón'];
/** Orders the catalogue from gentle to demanding; nothing is locked behind a level. */
export const routeLevel: Record<string, number> = { ovalo: 1, ruta_inicial: 1, valle: 2, puerto: 3, embalse: 4, ermita: 5,
  gran_vuelta: 6, valle_largo: 7, gran_fondo: 8 };
export interface Outcome {
  meters: number; seconds: number; climbMeters: number; laps: Lap[];
  finishedRoute: boolean; light: string;
  /** Final place among the riders on the road, when the ride had rivals. */
  place?: number; riders?: number;
}
export interface Totals { xp: number; meters: number; seconds: number; climbMeters: number; sessions: number; laps: number }
export const emptyTotals = (): Totals => ({ xp: 0, meters: 0, seconds: 0, climbMeters: 0, sessions: 0, laps: 0 });
export function reward(o: Outcome) {
  return Math.floor(o.meters / 100) + Math.floor(o.climbMeters) + Math.floor(o.seconds / 60) +
    o.laps.length * 10 + o.laps.filter(l => l.record).length * 50 +
    o.laps.flatMap(l => l.sectors).filter(s => s.best).length * 15 + (o.finishedRoute ? 25 : 0);
}
export function levelFor(xp: number) {
  const index = Math.min(LEVELS.length - 1, Math.floor(Math.sqrt(Math.max(0, xp) / 500)));
  const from = 500 * index ** 2;
  const next = index === LEVELS.length - 1 ? null : 500 * (index + 1) ** 2;
  return { number: index + 1, name: LEVELS[index], from, next,
    progress: next === null ? 1 : (xp - from) / (next - from) };
}
export function addOutcome(t: Totals, o: Outcome): Totals {
  return { xp: t.xp + reward(o), meters: t.meters + o.meters, seconds: t.seconds + o.seconds,
    climbMeters: t.climbMeters + o.climbMeters, sessions: t.sessions + 1, laps: t.laps + o.laps.length };
}
export const ACHIEVEMENTS = [
  ['primeros_pedales', 'Primeros pedales', 'Termina tu primera salida'],
  ['diez_km', 'Diez kilómetros', 'Acumula 10 km'],
  ['cien_km', 'Cien kilómetros', 'Acumula 100 km'],
  ['media_hora', 'Media hora seguida', 'Rueda 30 minutos en una salida'],
  ['escalador', 'Escalador', 'Acumula 500 m de desnivel'],
  ['rey_montana', 'Rey de la montaña', 'Acumula 2.000 m de desnivel'],
  ['primer_record', 'A tu propia rueda', 'Consigue un récord de vuelta'],
  ['tres_vueltas', 'Tres seguidas', 'Cierra tres vueltas en una salida'],
  ['sector_morado', 'Sector morado', 'Consigue un récord de sector'],
  ['madrugador', 'Madrugador', 'Rueda al amanecer'],
  ['ultima_luz', 'Última luz', 'Rueda al atardecer'],
  ['ruta_completa', 'Hasta el final', 'Completa una ruta'],
  ['podio', 'Al podio', 'Acaba entre los tres primeros'],
  ['victoria', 'Brazos en alto', 'Gana a todos tus rivales'],
] as const;
export function earned(t: Totals, o: Outcome, already: string[]): string[] {
  // A place only counts once there has been a race: a finished course or a full lap.
  const raced = o.place !== undefined && (o.finishedRoute || o.laps.length > 0);
  const conditions = [t.sessions >= 1, t.meters >= 1e4, t.meters >= 1e5, o.seconds >= 1800,
    t.climbMeters >= 500, t.climbMeters >= 2000, o.laps.some(l => l.record), o.laps.length >= 3,
    o.laps.some(l => l.sectors.some(s => s.best)), o.light === 'amanecer', o.light === 'atardecer', o.finishedRoute,
    raced && o.place! <= 3, raced && o.place === 1];
  return ACHIEVEMENTS.filter((a, i) => conditions[i] && !already.includes(a[0])).map(a => a[0]);
}
