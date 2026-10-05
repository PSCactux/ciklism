import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const ble = vi.hoisted(() => ({ initialize: vi.fn(), requestDevice: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), startNotifications: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@capacitor-community/bluetooth-le', () => ({ BleClient: ble, numberToUUID: (n: number) => n.toString(16) }));
import { BleCadenceSource, bluetoothSupport } from '../src/platform/cadence';
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  vi.stubGlobal('window', { isSecureContext: true }); vi.stubGlobal('navigator', { bluetooth: {} });
  ble.initialize.mockResolvedValue(undefined); ble.requestDevice.mockResolvedValue({ deviceId: 'pedal', name: 'Pedal' });
  ble.connect.mockResolvedValue(undefined); ble.disconnect.mockResolvedValue(undefined); ble.startNotifications.mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('BLE adapter lifecycle', () => {
  it('subscribes to CSC and publishes cadences rather than raw measurements', async () => {
    const source = new BleCadenceSource(), rpm = vi.fn(); source.onCadence = rpm;
    await source.initialize(); await source.choose();
    expect(source.info).toMatchObject({ status: 'connected', name: 'Pedal' });
    expect(ble.startNotifications).toHaveBeenCalledWith('pedal', '1816', '2a5b', expect.any(Function));
    const notify = ble.startNotifications.mock.calls[0][3];
    notify(new DataView(Uint8Array.from([2, 1, 0, 0, 0]).buffer));
    notify(new DataView(Uint8Array.from([2, 2, 0, 0, 3]).buffer));
    expect(rpm).toHaveBeenCalledWith(80); await source.stop();
  });
  it('reconnects without opening a new chooser, and stop cancels future retries', async () => {
    const source = new BleCadenceSource(); await source.initialize(); await source.choose();
    ble.connect.mock.calls[0][1](); expect(source.info.status).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(1000);
    expect(ble.connect).toHaveBeenCalledTimes(2); expect(ble.requestDevice).toHaveBeenCalledTimes(1);
    ble.connect.mock.calls[1][1](); await source.stop();
    await vi.advanceTimersByTimeAsync(30000); expect(ble.connect).toHaveBeenCalledTimes(2);
    expect(source.info.status).toBe('idle');
  });
  it('does not resurrect a connection that completed after stop', async () => {
    let resolve!: () => void;
    ble.connect.mockImplementation(() => new Promise<void>(r => { resolve = r; }));
    const source = new BleCadenceSource(); await source.initialize();
    const pending = source.choose(); await vi.advanceTimersByTimeAsync(0);
    await source.stop(); resolve(); await pending;
    expect(source.info.status).toBe('idle'); expect(ble.startNotifications).not.toHaveBeenCalled();
  });
  it('reports browsers without Bluetooth or HTTPS before a ride starts', () => {
    vi.stubGlobal('navigator', {}); expect(bluetoothSupport().available).toBe(false);
    vi.stubGlobal('window', { isSecureContext: false }); expect(bluetoothSupport().message).toContain('HTTPS');
  });
});
