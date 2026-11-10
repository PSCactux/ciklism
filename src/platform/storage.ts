import { openDB, type DBSchema } from 'idb';
import { z } from 'zod';
import { addOutcome, emptyTotals, earned, reward, type Totals } from '../domain/progress';
import type { Session } from '../domain/session';
import { emptyRecord, type LapRecord } from '../domain/laps';
import { sanitizeBikes, type Bike } from '../domain/bike';
import type { RivalLevel } from '../domain/rivals';

interface Profile { totals: Totals; achievements: string[] }
export interface Settings { calibration: Record<string, number>; motion: boolean; quality: 'auto' | 'high' | 'low'; bikes: Bike[]; activeBike: string; rivals: RivalLevel }
export const defaultSettings = (): Settings => ({ calibration: {}, motion: true, quality: 'auto', bikes: sanitizeBikes(undefined), activeBike: 'bici-1', rivals: 'even' });
interface MegaBiciDB extends DBSchema {
  sessions: { key: string; value: Session };
  records: { key: string; value: LapRecord };
  recovery: { key: string; value: Session };
  meta: { key: string; value: Profile | Settings };
}
const n = z.number().finite().nonnegative();
const sector = z.object({ index: z.number().int().min(0).max(2), seconds: n,
  delta: z.number().finite().nullable(), best: z.boolean(), sessionBest: z.boolean().optional() });
const record = z.object({ bestSeconds: n.nullable(), sectors: z.array(n.nullable()).max(3),
  trace: z.array(z.object({ distance: n, seconds: n })).max(10000) });
const session = z.object({
  id: z.string().min(1).max(100), startedAt: n, routeId: z.string().max(100), routeName: z.string().max(200),
  reversed: z.boolean(), mode: z.enum(['demo', 'sensor']), deviceName: z.string().max(200),
  meters: n, seconds: n, climbMeters: n, light: z.string().max(50), finishedRoute: z.boolean(),
  laps: z.array(z.object({ number: z.number().int().positive(), seconds: n, record: z.boolean(),
    sectors: z.array(sector).max(3) })).max(10000),
  samples: z.array(z.object({ seconds: n, meters: n, speed: n, cadence: n, altitude: z.number().finite() })).max(100000),
  record, xp: n, achievements: z.array(z.string().max(100)).max(100),
  place: z.number().int().positive().optional(), riders: z.number().int().positive().optional(),
});
// Copies exported before the rename carry the old format name and stay importable.
const bike = z.object({ id: z.string().min(1).max(60), name: z.string().max(30), routeLevels: z.boolean(),
  levels: z.array(z.object({ metersPerRev: z.number().finite().positive() })).max(32) });
export const backupSchema = z.object({ format: z.enum(['megabici', 'ciklism']), version: z.literal(1),
  sessions: z.array(session).max(10000), bikes: z.array(bike).max(20).optional(),
});
export function parseBackup(text: string): Session[] {
  if (text.length > 50 * 1024 * 1024) throw new Error('El archivo supera los 50 MB.');
  const result = backupSchema.safeParse(JSON.parse(text));
  if (!result.success) throw new Error('No es una copia compatible de MegaBici (versión 1).');
  const ids = new Set<string>();
  for (const s of result.data.sessions) {
    if (ids.has(s.id)) throw new Error('La copia contiene sesiones duplicadas.');
    ids.add(s.id);
    const trace = s.record.trace;
    if (trace.some((p, i) => i > 0 && (p.distance <= trace[i - 1].distance || p.seconds < trace[i - 1].seconds))) {
      throw new Error('El rastro del récord no es válido.');
    }
  }
  return result.data.sessions;
}
export const recordKey = (routeId: string, reversed: boolean, mode: string) => `${routeId}:${reversed ? 'reverse' : 'forward'}:${mode}`;
export class SessionStore {
  // The database keeps its original name so rides saved before the rename are still there.
  private db = openDB<MegaBiciDB>('ciklism-shared', 1, { upgrade(db) {
    db.createObjectStore('sessions', { keyPath: 'id' });
    db.createObjectStore('records'); db.createObjectStore('meta'); db.createObjectStore('recovery');
  } });
  async profile(): Promise<Profile> {
    return (await (await this.db).get('meta', 'profile') as Profile | undefined) ?? { totals: emptyTotals(), achievements: [] };
  }
  async settings(): Promise<Settings> {
    const stored = await (await this.db).get('meta', 'settings') as Partial<Settings> & { bike?: unknown } | undefined;
    const { bike, ...rest } = stored ?? {}, bikes = sanitizeBikes(stored?.bikes, bike);
    return { ...defaultSettings(), ...rest, bikes, activeBike: bikes.find(b => b.id === stored?.activeBike)?.id ?? bikes[0].id };
  }
  async saveSettings(settings: Settings) { await (await this.db).put('meta', settings, 'settings'); }
  async sessions() { return (await (await this.db).getAll('sessions')).sort((a, b) => b.startedAt - a.startedAt); }
  async record(key: string) { return (await (await this.db).get('records', key)) ?? emptyRecord(); }
  async save(s: Session): Promise<Session> {
    const tx = (await this.db).transaction(['sessions', 'records', 'meta'], 'readwrite');
    const existing = await tx.objectStore('sessions').get(s.id);
    if (existing) { await tx.done; return existing; }
    const p = (await tx.objectStore('meta').get('profile') as Profile | undefined) ?? { totals: emptyTotals(), achievements: [] };
    // Demo can explore every route, but never changes real rider achievements or records.
    if (s.mode === 'sensor') {
      const totals = addOutcome(p.totals, s);
      s.xp = reward(s); s.achievements = earned(totals, s, p.achievements);
      await tx.objectStore('meta').put({ totals, achievements: [...p.achievements, ...s.achievements] }, 'profile');
    }
    const key = recordKey(s.routeId, s.reversed, s.mode);
    const previous = await tx.objectStore('records').get(key);
    const best = previous && previous.bestSeconds !== null &&
      (s.record.bestSeconds === null || previous.bestSeconds <= s.record.bestSeconds) ? structuredClone(previous) : structuredClone(s.record);
    best.sectors = [0, 1, 2].map(i => {
      const candidates = [previous?.sectors[i], s.record.sectors[i]].filter((v): v is number => v != null);
      return candidates.length ? Math.min(...candidates) : null;
    });
    await tx.objectStore('records').put(best, key);
    await tx.objectStore('sessions').put(s);
    await tx.done;
    return s;
  }
  async export() {
    return JSON.stringify({ format: 'megabici', version: 1, sessions: await this.sessions(), bikes: (await this.settings()).bikes }, null, 2);
  }
  async checkpoint(session: Session) { await (await this.db).put('recovery', session, 'active'); }
  async clearCheckpoint() { await (await this.db).delete('recovery', 'active'); }
  async recover() {
    const draft = await (await this.db).get('recovery', 'active');
    if (!draft) return false;
    await this.save(draft); await this.clearCheckpoint(); return true;
  }
  async import(text: string) {
    const sessions = parseBackup(text).sort((a, b) => a.startedAt - b.startedAt);
    // Validate the entire file before modifying storage. IDs make imports repeatable.
    let count = 0;
    for (const s of sessions) {
      if (await (await this.db).get('sessions', s.id)) continue;
      await this.save({ ...s, xp: 0, achievements: [] }); count++;
    }
    // Bikes travel with the copy; one already on this device keeps its own calibration.
    const bikes = backupSchema.parse(JSON.parse(text)).bikes ?? [], settings = await this.settings();
    const added = bikes.filter(b => !settings.bikes.some(own => own.id === b.id));
    if (added.length) await this.saveSettings({ ...settings, bikes: sanitizeBikes([...settings.bikes, ...added]) });
    return count;
  }
}
