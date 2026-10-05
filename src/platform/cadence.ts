import { Capacitor } from '@capacitor/core';
import { BleClient, numberToUUID, type BleDevice } from '@capacitor-community/bluetooth-le';
import { CadenceCalculator, parseCsc } from '../domain/cadence';

const SERVICE = numberToUUID(0x1816), MEASUREMENT = numberToUUID(0x2a5b);
export type SensorStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';
export interface SensorInfo { status: SensorStatus; name: string; message: string }
export function bluetoothSupport(): { available: boolean; message: string } {
  if (Capacitor.isNativePlatform()) return { available: true, message: 'Conecta Pedal o un sensor de cadencia Bluetooth.' };
  if (!window.isSecureContext) return { available: false, message: 'Abre Ciklism mediante HTTPS para conectar tu sensor. Puedes explorar las rutas en demo.' };
  if (!('bluetooth' in navigator)) return { available: false,
    message: 'Este navegador no permite conectar sensores. En iPhone, usa la app Ciklism; en ordenador, un navegador con Web Bluetooth. Aquí puedes probar el modo demo.' };
  return { available: true, message: 'Enciende tu sensor y pedalea para activarlo.' };
}
export class BleCadenceSource {
  private device: BleDevice | null = null;
  private calculator = new CadenceCalculator();
  private generation = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;
  private initialized = false;
  info: SensorInfo = { status: 'idle', name: '', message: '' };
  onChange: (info: SensorInfo) => void = () => {};
  onCadence: (rpm: number) => void = () => {};

  private update(status: SensorStatus, message = '') {
    this.info = { status, name: this.device?.name || 'Sensor de cadencia', message };
    this.onChange(this.info);
  }
  async initialize() {
    if (!bluetoothSupport().available) return;
    if (!this.initialized) { await BleClient.initialize({ androidNeverForLocation: true }); this.initialized = true; }
  }
  async choose() {
    // Initialization is done before the button is enabled, preserving browser user activation.
    if (!this.initialized && Capacitor.isNativePlatform()) await this.initialize();
    if (!this.initialized) throw new Error('Bluetooth aún no está preparado.');
    const device = await BleClient.requestDevice({ services: [SERVICE] });
    await this.stop();
    this.device = device;
    const generation = ++this.generation;
    this.update('connecting');
    try { await this.connect(generation); }
    catch (error) {
      if (generation !== this.generation) return;
      ++this.generation;
      clearTimeout(this.retry);
      this.update('error', messageOf(error));
      await BleClient.disconnect(device.deviceId).catch(() => {});
      throw error;
    }
  }
  private async connect(generation: number) {
    const device = this.device;
    if (!device || generation !== this.generation) return;
    this.calculator.reset();
    await BleClient.connect(device.deviceId, () => {
      if (generation !== this.generation) return;
      this.calculator.reset();
      this.update('reconnecting', 'Se ha perdido la señal. Intentando reconectar…');
      this.schedule(generation);
    }, { timeout: 10000 });
    if (generation !== this.generation) { await BleClient.disconnect(device.deviceId); return; }
    await BleClient.startNotifications(device.deviceId, SERVICE, MEASUREMENT, value => {
      if (generation !== this.generation) return;
      const measurement = parseCsc(value);
      if (!measurement) return;
      const rpm = this.calculator.update(measurement);
      if (rpm !== null) this.onCadence(rpm);
    });
    if (generation !== this.generation) { await BleClient.disconnect(device.deviceId); return; }
    this.attempts = 0; this.update('connected');
  }
  private schedule(generation: number) {
    clearTimeout(this.retry);
    if (this.attempts >= 5) { this.update('error', 'No se ha podido reconectar. Acerca el sensor y vuelve a conectarlo.'); return; }
    this.retry = setTimeout(async () => {
      if (generation !== this.generation) return;
      this.attempts++;
      try { await this.connect(generation); }
      catch (error) {
        if (generation !== this.generation) return;
        this.update('reconnecting', messageOf(error)); this.schedule(generation);
      }
    }, Math.min(1000 * 2 ** this.attempts, 8000));
  }
  async stop() {
    ++this.generation; clearTimeout(this.retry); this.attempts = 0;
    const device = this.device; this.device = null; this.calculator.reset();
    if (device) await BleClient.disconnect(device.deviceId).catch(() => {});
    this.update('idle');
  }
}
export function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }
