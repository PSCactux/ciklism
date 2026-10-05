import type { RideState } from './ride';
import type { Outcome } from './progress';
import type { LapRecord } from './laps';
export interface Sample { seconds: number; meters: number; speed: number; cadence: number; altitude: number }
export interface Session extends Outcome {
  id: string; startedAt: number; routeId: string; routeName: string; reversed: boolean;
  mode: 'demo' | 'sensor'; deviceName: string; samples: Sample[]; record: LapRecord;
  xp: number; achievements: string[];
}
export class SessionRecorder {
  samples: Sample[] = [];
  private second = -1;
  onState(s: RideState) {
    const second = Math.floor(s.elapsedSeconds);
    if (second <= this.second) return;
    this.second = second;
    this.samples.push({ seconds: s.elapsedSeconds, meters: s.travelled, speed: s.speedMps,
      cadence: s.cadenceRpm, altitude: s.position.y });
  }
}
