import { expect, test, type Page } from '@playwright/test';

/** A Web Bluetooth cadence sensor that turns the cranks at `window.sensorRpm`. */
async function virtualSensor(page: Page) {
  await page.addInitScript(() => {
    const state = window as unknown as { sensorRpm: number };
    state.sensorRpm = 80;
    let revolutions = 0, time = 0, timer: ReturnType<typeof setTimeout>;
    const characteristic = new EventTarget() as EventTarget & Record<string, unknown>;
    const device = new EventTarget() as EventTarget & Record<string, unknown>;
    const gatt = { connected: false, connect: async () => { gatt.connected = true; return gatt; },
      disconnect: () => { gatt.connected = false; clearTimeout(timer); },
      getPrimaryService: async () => service };
    const service = { uuid: '00001816-0000-1000-8000-00805f9b34fb', device, getCharacteristic: async () => characteristic };
    Object.assign(device, { id: 'virtual', name: 'Sensor de prueba', gatt });
    const turn = () => {
      const seconds = 60 / state.sensorRpm;
      revolutions = (revolutions + 1) & 0xffff; time = (time + Math.round(seconds * 1024)) & 0xffff;
      const value = new DataView(new ArrayBuffer(5));
      value.setUint8(0, 2); value.setUint16(1, revolutions, true); value.setUint16(3, time, true);
      characteristic.value = value; characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
      timer = setTimeout(turn, seconds * 1000);
    };
    Object.assign(characteristic, { uuid: '00002a5b-0000-1000-8000-00805f9b34fb', service, value: null,
      startNotifications: async () => { clearTimeout(timer); turn(); } });
    Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { getAvailability: async () => true,
      requestDevice: async () => device, addEventListener() {}, removeEventListener() {} } });
  });
}
const shown = async (page: Page, selector: string) => Number((await page.locator(selector).innerText()).replace(',', '.').replace(/[^\d.]/g, ''));

test('calibration: sensor check, speed matched to the bike and its own levels in the ride', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await virtualSensor(page);
  await page.goto('/');
  await expect(page.locator('#world')).toHaveAttribute('data-ready', 'true', { timeout: 45000 });
  await page.getByRole('button', { name: 'Calibrar', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Calibra tu bici');
  await expect(dialog.locator('#cal-status')).toHaveText('Sin conectar');
  await expect(dialog.locator('#cal-register')).toBeDisabled();
  await dialog.locator('#bike-name').fill('Estática del salón');
  await dialog.locator('#bike-name').blur();
  await expect(dialog.getByRole('button', { name: 'Estática del salón' })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Conectar sensor' }).click();
  await expect(dialog.locator('#cal-status')).toHaveText('Sensor de prueba · señal correcta');
  await expect(dialog.locator('#cal-cadence')).toHaveText('80');
  await dialog.getByRole('button', { name: 'Poner a cero' }).click();
  await expect.poll(() => shown(page, '#cal-turns')).toBeGreaterThanOrEqual(3);
  await dialog.locator('#cal-speed').fill('24');
  await expect(dialog.locator('#cal-hint')).toContainText('Ritmo estable a 80 rpm', { timeout: 10000 });
  await dialog.getByRole('button', { name: 'Registrar nivel 1' }).click();
  await expect(dialog.locator('.cal-level')).toContainText('24,0 km/h a 80 rpm');
  await dialog.locator('#cal-speed').fill('28,5');
  await dialog.getByRole('button', { name: 'Registrar nivel 2' }).click();
  await dialog.locator('#cal-speed').fill('');
  await dialog.getByRole('button', { name: 'Registrar nivel 3' }).click();
  await expect(dialog.locator('.cal-level')).toHaveCount(3);
  await expect(dialog.locator('.cal-level').nth(2)).toContainText('28,5 km/h a 80 rpm');
  await expect(dialog.locator('.cal-level').nth(1)).toContainText('Ahora mismo: 28,5 km/h');
  await dialog.screenshot({ path: testInfo.outputPath('calibration.png') });
  await dialog.getByRole('button', { name: 'Quitar el nivel 3' }).click();
  await expect(dialog.locator('.cal-level')).toHaveCount(2);
  await dialog.locator('#route-levels').uncheck();
  // A second bike starts uncalibrated and does not disturb the first.
  await dialog.getByRole('button', { name: 'Añadir bici' }).click();
  await expect(dialog.locator('.cal-level')).toHaveCount(0);
  await expect(dialog.locator('#bike-name')).toHaveValue('Bici 2');
  await dialog.getByRole('button', { name: 'Estática del salón' }).click();
  await expect(dialog.locator('.cal-level')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Listo', exact: true }).click();

  await page.reload();
  await expect(page.locator('#world')).toHaveAttribute('data-ready', 'true', { timeout: 45000 });
  await page.getByRole('button', { name: 'Mi sensor', exact: true }).click();
  await expect(page.locator('.bike-note')).toHaveText('Estática del salón · calibrada · 2 niveles');
  await page.locator('#connect').click();
  await expect(page.getByRole('button', { name: 'Empezar a rodar' })).toBeEnabled();
  await page.getByRole('button', { name: 'Empezar a rodar' }).click();
  await expect(page.locator('.gear-control')).toContainText('NIVEL');
  await expect(page.locator('#gear')).toHaveText('1');
  await expect.poll(() => shown(page, '#speed'), { timeout: 20000 }).toBeCloseTo(24, 0);
  await page.getByRole('button', { name: 'Subir nivel' }).click();
  await expect.poll(() => shown(page, '#speed'), { timeout: 20000 }).toBeCloseTo(28.5, 0);
  await page.locator('.ride-tools summary').click();
  await expect(page.locator('#calibration-value')).toHaveText('28,5 km/h');
  await page.getByRole('button', { name: 'Marcar más velocidad' }).click();
  await expect(page.locator('#calibration-value')).toHaveText('28,8 km/h');
  await page.screenshot({ path: testInfo.outputPath('ride-levels.png') });
  expect(errors).toEqual([]);
});

test('every route and time of day can be ridden with the sensor from the first day', async ({ page }) => {
  await virtualSensor(page);
  await page.goto('/');
  await expect(page.locator('#world')).toHaveAttribute('data-ready', 'true', { timeout: 45000 });
  await expect(page.locator('.route-list')).not.toContainText('NIVEL');
  await page.getByRole('button', { name: /Puerto de la Ermita/ }).click();
  await expect(page.locator('#world')).toHaveAttribute('data-ready', 'true', { timeout: 45000 });
  await page.getByRole('group', { name: 'Hora del día' }).getByRole('button', { name: 'Atardecer' }).click();
  await expect(page.locator('#world')).toHaveAttribute('data-ready', 'true', { timeout: 45000 });
  await page.getByRole('button', { name: 'Mi sensor', exact: true }).click();
  await page.locator('#connect').click();
  await expect(page.getByRole('button', { name: 'Empezar a rodar' })).toBeEnabled();
});
