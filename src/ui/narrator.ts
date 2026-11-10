import type { RideState } from '../domain/ride';
import type { Lap, Sector } from '../domain/laps';
import type { RoutePath } from '../domain/route';
import { stretchAt, type Climb } from '../domain/profile';
import { km, number, time } from './format';

export type Tone = 'info' | 'level' | 'record' | 'session' | 'slower' | 'up' | 'down';
/** A short line shown over the road. A new cue of the same `kind` replaces one still waiting. */
export interface Cue { text: string; tone: Tone; seconds: number; kind: string }
const gap = (meters: number) => meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${km(meters)} km`;
export const sectorResult = (s: Sector) => s.best ? 'record' : s.sessionBest ? 'session' : 'slower';

/** Turns what happens on the road into cues: climbs, places won and lost, laps and what is left. */
export class Narrator {
  private place: number | null = null;
  private gear: number | null = null;
  private laps = 0;
  private climb: Climb | null = null;
  private left = Infinity;
  private nextPlace = 0;
  private lastDistance = 0;
  /** `places` are the villages on the way, in riding order. */
  constructor(private path: RoutePath, private climbs: readonly Climb[], private places: readonly { distance: number; name: string }[] = []) {}

  update(s: RideState, laps: readonly Lap[]): Cue[] {
    const cues: Cue[] = [], cue = (text: string, tone: Tone = 'info', kind = text, seconds = 4.5) => cues.push({ text, tone, seconds, kind });
    if (s.routeGear !== this.gear) {
      this.gear = s.routeGear;
      if (s.routeGear !== null) cue(`Pon tu bici en el nivel ${s.routeGear + 1}`, 'level', 'level', 7);
    }
    if (s.standing) {
      // The mass start reshuffles everyone at once; places only become news once the race has settled.
      if (this.place !== null && s.elapsedSeconds > 20 && s.standing.place !== this.place) {
        if (s.standing.place < this.place) cue(`Adelantas a ${s.standing.behind?.name ?? 'un rival'} · vas ${s.standing.place}º`, 'up', 'place');
        else cue(`${s.standing.ahead?.name ?? 'Un rival'} te adelanta · vas ${s.standing.place}º`, 'down', 'place');
      }
      this.place = s.standing.place;
    }
    if (laps.length > this.laps) {
      const lap = laps.at(-1)!; this.laps = laps.length;
      cue(`Vuelta ${lap.number} · ${time(lap.seconds)}${lap.record ? ' · tu mejor vuelta' : ''}`, lap.record ? 'record' : 'info', 'lap', 6);
    }
    // A new lap of a circuit passes through the same villages again.
    if (s.distance < this.lastDistance - 100) this.nextPlace = 0;
    this.lastDistance = s.distance;
    while (this.nextPlace < this.places.length && s.distance > this.places[this.nextPlace].distance + 80) this.nextPlace++;
    const place = this.places[this.nextPlace];
    if (place && s.distance >= place.distance - 110) { cue(`Entras en ${place.name}`, 'info', 'village', 5); this.nextPlace++; }
    const on = stretchAt(this.climbs, s.distance).on;
    if (on !== this.climb) {
      if (on) cue(`Empieza la subida · ${km(on.end - on.start)} km al ${number(on.grade * 100)} %`, 'info', 'climb', 6);
      else if (this.climb && s.distance >= this.climb.end) cue(`Cima · ${Math.round(this.climb.gain)} m de subida superados`, 'session', 'climb', 5);
      this.climb = on;
    }
    if (!this.path.isCircuit) {
      const left = this.path.totalLength - s.distance, total = this.path.totalLength;
      const crossed = (mark: number) => this.left > mark && left <= mark && left > 0;
      if (total >= 3000 && crossed(1000)) cue('Último kilómetro', 'level', 'left', 6);
      else if (total >= 12000 && crossed(5000)) cue('Quedan 5 km', 'info', 'left');
      else if (total >= 6000 && crossed(total / 2)) cue(`Mitad de ruta · quedan ${km(left)} km`, 'info', 'left');
      this.left = left;
    }
    return cues;
  }
  sector(s: Sector): Cue {
    const against = s.delta === null || s.best ? '' : ` · +${number(s.delta)} s sobre tu récord`;
    return { text: `Sector ${s.index + 1} · ${time(s.seconds)}${s.best ? ' · récord' : against}`, tone: sectorResult(s), seconds: 6, kind: 'sector' };
  }
  /** Where the rider is in relation to the climbs, in a few words. */
  stretch(s: RideState) {
    const { on, next } = stretchAt(this.climbs, s.distance);
    if (on) return `Subida · cima a ${gap(on.end - s.distance)}`;
    return next && next.start - s.distance < 3000 ? `Subida en ${gap(next.start - s.distance)}` : '';
  }
}
