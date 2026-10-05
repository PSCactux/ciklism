export interface CscMeasurement { revolutions: number; time: number }
export function parseCsc(data: DataView): CscMeasurement | null {
  if (data.byteLength < 1) return null;
  const flags = data.getUint8(0);
  if (!(flags & 2)) return null;
  const offset = flags & 1 ? 7 : 1;
  if (data.byteLength < offset + 4) return null;
  return { revolutions: data.getUint16(offset, true), time: data.getUint16(offset + 2, true) };
}
export class CadenceCalculator {
  private last: CscMeasurement | null = null;
  update(m: CscMeasurement): number | null {
    const previous = this.last;
    this.last = m;
    if (!previous) return null;
    const revolutions = (m.revolutions - previous.revolutions) & 0xffff;
    const time = (m.time - previous.time) & 0xffff;
    if (!revolutions || !time) return null;
    const rpm = revolutions * 60 * 1024 / time;
    // Reboots/corrupt notifications must not accelerate the rider to absurd speeds.
    return rpm <= 250 ? rpm : null;
  }
  reset() { this.last = null; }
}
