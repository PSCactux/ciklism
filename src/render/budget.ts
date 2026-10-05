/** Presentation policy only: physics always uses its existing fixed timestep. */
export type Quality = 'auto' | 'high' | 'low';
export function frameLimit(quality: Quality, touch: boolean) {
  return quality === 'low' || (quality === 'auto' && touch) ? 30 : 60;
}

/** Use CPU submission cost and missed presentation intervals. GPU work is often
 * asynchronous; measuring only scene.render() misses a saturated GPU entirely. */
export class AdaptiveResolution {
  scale = 1;
  private pressure: number[] = [];
  private stableWindows = 0;
  reset() { this.scale = 1; this.idle(); this.stableWindows = 0; }
  idle() { this.pressure = []; }
  sample(cpuMs: number, intervalMs: number, targetFps: number) {
    const budget = 1000 / targetFps;
    if (!Number.isFinite(cpuMs + intervalMs) || intervalMs <= 0 || intervalMs > 250) {
      this.idle(); return false;
    }
    this.pressure.push(Math.max(cpuMs / (budget * 0.8), intervalMs / (budget * 1.4)));
    if (this.pressure.length < 120) return false;
    const p90 = this.pressure.sort((a, b) => a - b)[108];
    this.pressure = [];
    if (p90 > 1 && this.scale < 2) {
      this.scale += 0.25; this.stableWindows = 0; return true;
    }
    if (p90 < 0.75) {
      if (++this.stableWindows >= 5 && this.scale > 1) {
        this.scale -= 0.25; this.stableWindows = 0; return true;
      }
    } else this.stableWindows = 0;
    return false;
  }
}
