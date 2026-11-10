import { icons } from './icons';
import { number } from './format';
import { DEFAULT_RATIO, MAX_LEVELS, speedKmh, type Bike, type BikeSetup, type Signal } from '../domain/bike';
import { escape as esc } from './format';

export interface CalibrationLive {
  signal: Signal; status: string; detail: string; canConnect: boolean;
  cadence: number; turns: number; secondsSinceData: number | null;
  reading: { rpm: number; steady: boolean };
}
const REFERENCE_RPM = 80;

export function levelsList(bike: BikeSetup) {
  const count = bike.levels.length;
  return `<div class="section-heading"><h3>Niveles de tu bici</h3><span>${count ? `${count} ${count === 1 ? 'registrado' : 'registrados'}` : 'Ninguno todavía'}</span></div>
    ${count ? `<div class="cal-levels">${bike.levels.map((level, i) => `<div class="cal-level"><span class="cal-level-number">${i + 1}</span><div><strong>${number(speedKmh(level.metersPerRev, REFERENCE_RPM))} km/h a ${REFERENCE_RPM} rpm</strong><small data-cal-now="${i}"></small></div><button class="secondary" data-cal-redo="${i}" disabled aria-label="Medir de nuevo el nivel ${i + 1}">Repetir</button><button class="icon-button" data-cal-remove="${i}" aria-label="Quitar el nivel ${i + 1}">${icons.close}</button></div>`).join('')}</div>`
    : '<p class="muted cal-empty">Hasta que registres el primero, MegaBici usa sus nueve marchas de serie.</p>'}
    ${count > 1 ? `<div class="settings-row"><label for="route-levels">Que la ruta marque el nivel<small>En las subidas MegaBici te pide un nivel más duro y en llano uno más suave. Tú lo pones en la bici.</small></label><input class="switch" type="checkbox" role="switch" id="route-levels" ${bike.routeLevels ? 'checked' : ''}/></div>` : ''}
    ${count ? '<button class="text-button" data-action="cal-clear">Borrar todos los niveles</button>' : ''}`;
}

export function calibrationView(bikes: readonly Bike[], bike: Bike) {
  return `<p class="muted">Comprueba que el sensor funciona y haz que la velocidad cuadre con la que marca tu bici. Se guarda en este dispositivo y sigue ahí cuando cierras la app: solo hay que hacerlo una vez por bici.</p>
    <section class="settings-section"><h3>${icons.bike} Tu bici</h3>
      <div class="bike-tabs" role="group" aria-label="Bicis guardadas">${bikes.map(b => `<button data-bike="${esc(b.id)}" aria-pressed="${b.id === bike.id}">${esc(b.name)}</button>`).join('')}<button class="bike-add" data-action="bike-add">Añadir bici</button></div>
      <div class="bike-edit"><label for="bike-name">Nombre</label><input id="bike-name" maxlength="30" autocomplete="off" value="${esc(bike.name)}"/><button class="text-button" data-action="bike-remove" ${bikes.length > 1 ? '' : 'hidden'}>Quitar esta bici</button></div></section>
    <section class="settings-section"><h3>${icons.bluetooth} 1 · Sensor</h3>
      <div class="cal-status"><i class="signal-light" id="cal-light" data-signal="off"></i><div><strong id="cal-status" role="status"></strong><span id="cal-detail"></span></div><button class="secondary" id="cal-connect" data-action="connect">Conectar sensor</button></div>
      <div class="cal-stats"><div><small>CADENCIA</small><strong id="cal-cadence">0</strong><span>rpm</span></div><div><small>PEDALADAS</small><strong id="cal-turns">0</strong><button class="text-button" data-action="cal-zero">Poner a cero</button></div><div><small>ÚLTIMA SEÑAL</small><strong id="cal-last">—</strong><span id="cal-last-unit"></span></div></div>
      <p class="muted">Da diez pedaladas: el contador tiene que subir diez.</p></section>
    <section class="settings-section"><h3>${icons.gauge} 2 · Velocidad y niveles</h3>
      <p class="muted">Pon tu bici en su nivel más suave y pedalea a ritmo constante. Escribe la velocidad que marca tu bici y regístralo. Después sube un punto en la bici y repite. Si tu bici marca lo mismo en todos los niveles, basta con escribir la velocidad la primera vez.</p>
      <div class="cal-measure"><label for="cal-speed">Tu bici marca</label><div class="cal-stepper"><button data-cal-step="-1" aria-label="Medio kilómetro por hora menos">−</button><input id="cal-speed" inputmode="decimal" autocomplete="off" placeholder="0,0" aria-describedby="cal-hint"/><span>km/h</span><button data-cal-step="1" aria-label="Medio kilómetro por hora más">+</button></div>
        <button class="primary" id="cal-register" data-action="cal-register" ${bike.levels.length >= MAX_LEVELS ? 'hidden' : ''}>Registrar nivel ${bike.levels.length + 1}</button></div>
      <p class="cal-hint" id="cal-hint" role="status"></p>
      <div id="cal-levels">${levelsList(bike)}</div></section>
    <button class="primary full-width" data-action="close">Listo</button>`;
}

/** What the rider typed as the bike's own reading: a speed, nothing, or something unusable. */
export function typedSpeed(root: ParentNode): number | null | 'invalid' {
  const text = root.querySelector<HTMLInputElement>('#cal-speed')?.value.trim().replace(',', '.') ?? '';
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 1 && value <= 99 ? value : 'invalid';
}
export function stepSpeed(root: ParentNode, bike: BikeSetup, rpm: number, direction: number) {
  const input = root.querySelector<HTMLInputElement>('#cal-speed');
  if (!input) return;
  const typed = typedSpeed(root);
  // An empty field starts from what MegaBici would show now, so a few taps reach the bike's reading.
  const from = typeof typed === 'number' ? typed
    : Math.round(speedKmh(bike.levels.at(-1)?.metersPerRev ?? DEFAULT_RATIO, rpm || REFERENCE_RPM) * 2) / 2 - direction * 0.5;
  input.value = number(Math.min(99, Math.max(1, from + direction * 0.5)));
}

export function updateCalibration(root: ParentNode, bike: BikeSetup, live: CalibrationLive) {
  const text = (id: string, value: string) => { const el = root.querySelector(`#${id}`); if (el && el.textContent !== value) el.textContent = value; };
  root.querySelector<HTMLElement>('#cal-light')?.setAttribute('data-signal', live.signal);
  text('cal-status', live.status); text('cal-detail', live.detail);
  const connect = root.querySelector<HTMLButtonElement>('#cal-connect');
  if (connect && !connect.hasAttribute('data-busy')) {
    connect.disabled = !live.canConnect;
    connect.textContent = live.signal === 'off' ? 'Conectar sensor' : 'Cambiar de sensor';
  }
  text('cal-cadence', String(Math.round(live.cadence))); text('cal-turns', String(live.turns));
  text('cal-last', live.secondsSinceData === null ? '—' : live.secondsSinceData < 1 ? 'Ahora' : `Hace ${Math.round(live.secondsSinceData)}`);
  text('cal-last-unit', live.secondsSinceData === null || live.secondsSinceData < 1 ? '' : 's');
  const typed = typedSpeed(root), measurable = typeof typed === 'number' && live.reading.steady;
  const register = root.querySelector<HTMLButtonElement>('#cal-register');
  if (register) register.disabled = typed === null ? !bike.levels.length : !measurable;
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-cal-redo]')) button.disabled = !measurable;
  text('cal-hint', typed === 'invalid' ? 'Escribe la velocidad en km/h, por ejemplo 24,5.'
    : typed === null ? (bike.levels.length ? `Sin velocidad escrita, el nivel ${bike.levels.length + 1} se registra con la misma que el anterior.` : 'Escribe la velocidad que marca tu bici para registrar el primer nivel.')
    : live.signal === 'off' ? 'Conecta el sensor para poder medir.'
    : live.reading.steady ? `Ritmo estable a ${Math.round(live.reading.rpm)} rpm. Ya puedes registrarlo.`
    : live.cadence > 0 ? 'Mantén el ritmo unos segundos…' : 'Pedalea a ritmo constante para medir.');
  for (const el of root.querySelectorAll<HTMLElement>('[data-cal-now]')) {
    const level = bike.levels[Number(el.dataset.calNow)];
    const now = level && live.cadence > 0 ? `Ahora mismo: ${number(speedKmh(level.metersPerRev, live.cadence))} km/h` : '';
    if (el.textContent !== now) el.textContent = now;
  }
}
