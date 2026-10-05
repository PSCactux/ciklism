import './ui/style.css';
import { icons } from './ui/icons';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { routes, type RouteOption } from './routes/catalog';
import { RoutePath } from './domain/route';
import { GEARS, RideClock, RideEngine } from './domain/ride';
import { ACHIEVEMENTS, emptyTotals, levelFor } from './domain/progress';
import { SessionRecorder, type Session } from './domain/session';
import { SessionStore, recordKey } from './platform/storage';
import { BleCadenceSource, bluetoothSupport, messageOf } from './platform/cadence';
import type { Daylight, RideScene } from './render/scene';
import { elevation, escape as esc, km, number, routeMap, time } from './ui/format';

const root = document.querySelector<HTMLDivElement>('#app')!;
root.innerHTML = `<canvas id="world" aria-label="Ruta de ciclismo en tres dimensiones"></canvas>
  <div id="interface"></div><div id="loading" role="status"><div class="spinner"></div><span>Preparando tu próxima salida…</span></div>
  <div id="toast" role="status" hidden><span></span><button data-action="dismiss" aria-label="Cerrar aviso">×</button></div><dialog id="dialog"></dialog>`;
const ui = document.querySelector<HTMLDivElement>('#interface')!;
const canvas = document.querySelector<HTMLCanvasElement>('#world')!;
const loader = document.querySelector<HTMLDivElement>('#loading')!;
const dialog = document.querySelector<HTMLDialogElement>('#dialog')!;
const toast = document.querySelector<HTMLDivElement>('#toast')!;
const store = new SessionStore();
const sensor = new BleCadenceSource();
const clock = new RideClock();
let renderer: RideScene;
let option: RouteOption = routes[0];
let reversed = false, daylight: Daylight = 'dia', mode: 'demo' | 'sensor' = 'demo';
let path = option.path, engine: RideEngine | null = null, recorder = new SessionRecorder();
let running = false, busy = false, startedAt = 0, sessionId = '', demoRpm = 80;
let routeLoadFailed = false;
let lastHud = 0, toastTimer: ReturnType<typeof setTimeout>, sourceReady = false;
let latestCadence = 0, lastCadenceAt = 0;
let profile = { totals: emptyTotals(), achievements: [] as string[] };
let settings: Awaited<ReturnType<SessionStore['settings']>> = { calibration: {}, motion: true, quality: 'auto' };
let lastCheckpoint = 0, checkpointFailed = false;

let routeFilter = 'all', historyFilter = 'all';
let dialogOpener: HTMLElement | null = null;
function notify(message: string, persistent = false) {
  clearTimeout(toastTimer); toast.querySelector('span')!.textContent = message; toast.hidden = false;
  if (!persistent) toastTimer = setTimeout(() => { toast.hidden = true; }, 6500);
}
function loading(message?: string) {
  loader.hidden = !message;
  if (message) loader.querySelector('span')!.textContent = message;
}
function brand() { return `<a class="brand" href="./" aria-label="Ciklism, inicio">${icons.bike}<span>ciklism<span class="brand-dot">.</span></span></a>`; }
function header() {
  const level = levelFor(profile.totals.xp);
  return `<header class="app-header">${brand()}<nav aria-label="Navegación principal"><button class="nav-active" data-action="home" aria-current="page">${icons.route}<span>Explorar</span></button><button data-action="history">${icons.history}<span>Mis salidas</span></button><button data-action="settings" aria-label="Ajustes">${icons.settings}<span>Ajustes</span></button></nav><button class="profile-chip" data-action="profile" aria-label="Mi progreso, nivel ${level.number}"><span class="level-avatar">${level.number}</span><span>${level.name}<small>${profile.totals.xp} XP</small></span></button></header>`;
}
function home() {
  document.body.classList.remove('riding');
  path = new RoutePath(option.route, reversed);
  const support = bluetoothSupport(), level = levelFor(profile.totals.xp);
  const shown = routes.filter(r => routeFilter === 'all' || (routeFilter === 'easy' ? r.path.climb < 50 : r.path.climb >= 50));
  ui.innerHTML = `${header()}<main class="home-layout"><section class="route-panel" aria-labelledby="explore-title">
    <div class="eyebrow">UN BUEN DÍA PARA RODAR</div><h1 id="explore-title">Tu próxima<br> escapada.</h1>
    <p class="intro">Elige un camino. Encuentra tu ritmo.</p>
    <div class="section-heading"><h2>Explora las rutas</h2><span>${routes.length} recorridos</span></div>
    <div class="filter-tabs" role="group" aria-label="Filtrar rutas">${[['all', 'Todas'], ['easy', 'Suaves'], ['climb', 'Con subida']].map(([id, text]) => `<button data-route-filter="${id}" aria-pressed="${routeFilter === id}">${text}</button>`).join('')}</div>
    <div class="route-list" role="group" aria-label="Rutas disponibles">${shown.map(r => `<button class="route-card ${r.id === option.id ? 'selected' : ''}" data-route="${r.id}" aria-pressed="${r.id === option.id}">
      <div class="route-thumb">${routeMap(r.path)}</div><div class="route-info"><span class="route-type">${r.path.isCircuit ? 'CIRCUITO' : 'TRAVESÍA'}${r.level > level.number ? ` · NIVEL ${r.level}` : ''}</span><strong>${esc(r.route.nombre)}</strong><span>${km(r.path.totalLength)} km <b>·</b> ${Math.round(r.path.climb)} m de ascenso</span></div><span class="route-selected">${r.id === option.id ? icons.check : ''}</span></button>`).join('')}</div>
    <div class="local-note">${icons.bike}<div><strong>A tu ritmo, en cualquier pantalla.</strong><span>Tu próxima salida empieza aquí.</span></div></div>
    </section><section class="route-preview" aria-label="Vista previa de la ruta">
      <div class="preview-top"><span class="preview-tag"><i></i> VISTA PREVIA</span><button class="glass-button" data-action="reverse" aria-pressed="${reversed}">${icons.reverse}<span>${reversed ? 'Sentido inverso' : 'Cambiar sentido'}</span></button></div>
      <div class="preview-bottom"><div class="preview-title"><div class="preview-pills"><span>${path.climb < 50 ? 'Ritmo tranquilo' : 'Con subida'}</span><span>${path.isCircuit ? 'Circuito' : 'Travesía'}</span></div><h2>${esc(option.route.nombre)}</h2><p>${esc(option.description)}</p></div>
      <div class="ride-setup"><div class="setup-top"><div class="segmented" role="group" aria-label="Fuente de cadencia"><button data-mode="sensor" aria-pressed="${mode === 'sensor'}">${icons.bluetooth} Mi sensor</button><button data-mode="demo" aria-pressed="${mode === 'demo'}">${icons.play} Explorar en demo</button></div><label class="light-select"><span class="sr-only">Hora del día</span><select id="daylight"><option value="dia" ${daylight === 'dia' ? 'selected' : ''}>Día</option><option value="amanecer" ${daylight === 'amanecer' ? 'selected' : ''}>Amanecer</option><option value="atardecer" ${daylight === 'atardecer' ? 'selected' : ''}>Atardecer</option></select></label></div>
      <div class="sensor-setup" ${mode === 'demo' ? 'hidden' : ''}><div class="sensor-heading">${icons.bluetooth}<strong>Conecta tu cadencia</strong><span id="sensor-status" role="status"></span></div><p id="sensor-help">${esc(support.message)}</p><button id="connect" class="secondary" data-action="connect" ${!support.available || !sourceReady ? 'disabled' : ''}>Conectar sensor</button></div>
      <div class="start-row"><div class="route-facts"><div><strong>${km(path.totalLength)} <small>km</small></strong><span>Distancia</span></div><div><strong>${Math.round(path.climb)} <small>m</small></strong><span>Ascenso</span></div></div><div class="start-dock"><div class="dock-route"><strong>${esc(option.route.nombre)}</strong><span>${km(path.totalLength)} km · ${Math.round(path.climb)} m de ascenso</span></div><button class="primary start-button" id="start" data-action="start">${mode === 'demo' ? 'Probar la ruta' : 'Empezar a rodar'}</button></div></div>
      <p class="setup-note" id="start-help">${mode === 'demo' ? 'Prueba libre · Sin sensor · No modifica tus récords' : 'Tu cadencia mueve la bici. Tu salida se guarda en este dispositivo.'}</p></div></div>
    </section></main>`;
  updateSensorUI(); updateStart();
  previewObserver.disconnect();
  previewObserver.observe(ui.querySelector('.route-preview')!);
  requestAnimationFrame(positionMobileCanvas);
}
function positionMobileCanvas() {
  if (engine) {
    for (const el of [canvas, loader]) for (const key of ['top', 'left', 'width', 'height']) el.style.removeProperty(key);
    return;
  }
  const preview = ui.querySelector<HTMLElement>('.route-preview');
  if (!preview) return;
  const rect = preview.getBoundingClientRect();
  for (const el of [canvas, loader]) {
    el.style.top = `${rect.top + window.scrollY}px`; el.style.left = `${rect.left + window.scrollX}px`;
    el.style.width = `${rect.width}px`; el.style.height = `${rect.height}px`;
  }
}
const previewObserver = new ResizeObserver(positionMobileCanvas);
window.addEventListener('resize', positionMobileCanvas);
function updateStart() {
  const start = ui.querySelector<HTMLButtonElement>('#start');
  if (!start) return;
  const locked = mode === 'sensor' && option.level > levelFor(profile.totals.xp).number;
  const lightLocked = mode === 'sensor' && daylight !== 'dia' && levelFor(profile.totals.xp).number < (daylight === 'amanecer' ? 2 : 3);
  if (routeLoadFailed && !busy) {
    start.disabled = !renderer; start.dataset.action = 'retry-route'; start.textContent = 'Reintentar';
    const help = ui.querySelector('#start-help');
    if (help) help.textContent = 'La vista no ha podido abrirse. Puedes reintentar o elegir otra ruta.';
    return;
  }
  start.dataset.action = 'start';
  start.disabled = busy || !renderer || canvas.dataset.ready !== 'true' || (mode === 'sensor' && sensor.info.status !== 'connected') || locked || lightLocked;
  start.innerHTML = busy ? 'Preparando…' : locked || lightLocked ? `${icons.lock} Disponible en nivel ${locked ? option.level : daylight === 'amanecer' ? 2 : 3}` : `${mode === 'demo' ? 'Probar la ruta' : 'Empezar a rodar'}`;
  start.setAttribute('aria-describedby', 'start-help');
  const help = ui.querySelector('#start-help');
  if (help) help.textContent = locked || lightLocked ? 'Suma experiencia con tu sensor para desbloquearlo o explóralo ahora en demo.' : mode === 'demo' ? 'Prueba libre · Sin sensor · No modifica tus récords' : 'Tu cadencia mueve la bici. Tu salida se guarda en este dispositivo.';
}
function updateSensorUI() {
  const el = ui.querySelector('#sensor-status');
  if (el) el.textContent = sensor.info.status === 'connected' ? `Conectado a ${sensor.info.name}` : sensor.info.message;
  const badge = ui.querySelector('#source-badge');
  if (badge) {
    badge.textContent = mode === 'demo' ? 'DEMO · CADENCIA SIMULADA' : sensor.info.status === 'connected' ? sensor.info.name : sensor.info.status === 'error' ? 'SIN SEÑAL · CONECTA EL SENSOR' : 'SIN SEÑAL · RECONECTANDO';
    badge.classList.toggle('warning', mode !== 'demo' && sensor.info.status !== 'connected');
  }
  const reconnect = ui.querySelector<HTMLElement>('#reconnect');
  if (reconnect) reconnect.hidden = mode === 'demo' || sensor.info.status !== 'error';
  updateStart();
}
async function loadRoute() {
  busy = true; routeLoadFailed = false; updateStart(); canvas.dataset.ready = 'false';
  path = new RoutePath(option.route, reversed);
  loading('Preparando el camino…');
  try { await renderer.load(path, daylight, loading, option.preview); }
  catch (error) { routeLoadFailed = true; throw error; }
  finally { busy = false; loading(); updateStart(); }
}
function rideUI() {
  document.body.classList.add('riding');
  previewObserver.disconnect(); positionMobileCanvas(); window.scrollTo(0, 0);
  ui.innerHTML = `<div class="ride-overlay"><header class="ride-header">${brand()}<div class="ride-route-name"><strong>${esc(option.route.nombre)}</strong><span id="source-badge"></span></div><div class="ride-header-actions"><button class="icon-button" data-action="focus" aria-label="Ocultar datos secundarios" aria-pressed="false" title="Vista despejada">${icons.focus}</button><button class="glass-button" data-action="pause" id="pause-top">${icons.pause}<span>Pausar</span></button></div></header>
    <section class="hud" aria-label="Datos de la salida"><div class="speed"><small>VELOCIDAD</small><div><span id="speed">0</span><small>km/h</small></div></div><div class="hud-metric"><small>CADENCIA</small><div><span id="cadence">0</span><small>rpm</small></div></div><div class="hud-metric secondary-metric"><small>DISTANCIA</small><div><span id="distance">0,0</span><small>km</small></div></div><div class="hud-metric secondary-metric"><small>TIEMPO</small><div><span id="elapsed">00:00</span></div></div><div class="hud-metric optional-metric"><small>ASCENSO</small><div><span id="climb">0</span><small>m</small></div></div></section>
    <div class="ride-side"><button class="map-toggle glass-button" data-action="map" aria-expanded="false" aria-controls="ride-map">${icons.route}<span>Mapa</span></button><div class="route-mini" id="ride-map">${routeMap(path)}<span id="lap-label">VUELTA 1</span></div><div class="ghost-info" id="ghost-info" hidden></div><button class="glass-button" id="reconnect" data-action="connect" hidden>Reconectar sensor</button></div>
    <div class="pause-cover" id="pause-cover" hidden role="dialog" aria-modal="true" aria-labelledby="pause-title"><div><span class="pause-symbol">${icons.pause}</span><span class="eyebrow">TÓMATE UN RESPIRO</span><h2 id="pause-title">Tu salida, en pausa.</h2><p>El camino seguirá aquí cuando vuelvas.</p><div class="pause-stats"><span><strong id="pause-distance"></strong> km recorridos</span><span><strong id="pause-time"></strong> de actividad</span></div><button class="primary" data-action="pause">${icons.play} Seguir rodando</button><button class="secondary full-width" data-action="settings">${icons.settings} Ajustes de la experiencia</button><button class="text-button" data-action="finish">Terminar y guardar</button></div></div>
    <footer class="ride-controls"><div class="route-progress" role="progressbar" aria-label="Progreso de la ruta" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="route-progress-fill"></span></div><div class="ride-controls-top"><div class="gear-control"><button data-shift="-1" aria-label="Bajar marcha">−</button><div><strong id="gear">6ª</strong><small>MARCHA</small></div><button data-shift="1" aria-label="Subir marcha">+</button></div>
    <div class="profile-strip">${elevation(path)}<div><span id="slope">0 %</span><span id="remaining">${km(path.totalLength)} km hasta meta</span></div></div><button class="finish-button" data-action="finish">${icons.finish}<span>Terminar</span></button></div>
    <details class="ride-tools"><summary>${icons.settings}<span>${mode === 'demo' ? 'Cadencia de prueba' : 'Ajuste de velocidad'}</span><span class="tools-hint">Ajustar</span></summary><div class="demo-control" ${mode === 'demo' ? '' : 'hidden'}><label for="demo-rpm">Cadencia demo <output id="demo-output">${demoRpm} rpm</output></label><input id="demo-rpm" type="range" min="0" max="140" step="1" value="${demoRpm}" aria-label="Cadencia demo"/></div><div class="ride-calibration" ${mode === 'sensor' ? '' : 'hidden'}><span>Calibración del sensor</span><button data-calibration="-1" aria-label="Reducir ajuste de velocidad">−</button><output id="calibration-value">×${number(calibration())}</output><button data-calibration="1" aria-label="Aumentar ajuste de velocidad">+</button></div></details></footer></div>`;
  updateSensorUI(); updateHud();
}
function syncPauseUI() {
  if (!engine) return;
  const cover = ui.querySelector<HTMLElement>('#pause-cover'); if (cover) cover.hidden = running;
  const button = ui.querySelector('#pause-top'); if (button) button.innerHTML = `${running ? icons.pause : icons.play}<span>${running ? 'Pausar' : 'Continuar'}</span>`;
  for (const el of ui.querySelectorAll<HTMLElement>('.ride-header, .hud, .ride-side, .ride-controls')) el.inert = !running;
  if (!running) {
    ui.querySelector('#pause-distance')!.textContent = km(engine.state.travelled);
    ui.querySelector('#pause-time')!.textContent = time(engine.state.elapsedSeconds);
    cover?.querySelector<HTMLButtonElement>('[data-action="pause"]')?.focus();
  } else ui.querySelector<HTMLButtonElement>('#pause-top')?.focus();
}
async function requestFinish() {
  if (!engine || busy) return;
  if (running) await pause();
  if (!engine) return;
  modal('¿Guardamos esta salida?', `<div class="confirm-icon">${icons.finish}</div><p class="muted">Llevas <strong>${km(engine.state.travelled)} km</strong> en <strong>${time(engine.state.elapsedSeconds)}</strong>. La salida está en pausa y se guardará en Mis salidas.</p><div class="dialog-actions confirm-actions"><button class="secondary" data-action="resume">Seguir rodando</button><button class="primary" data-action="save-finish">Guardar salida ${icons.check}</button></div>`, 'confirm');
}
function calibrationKey() { return sensor.info.name || 'por defecto'; }
function calibration() { return settings.calibration[calibrationKey()] ?? 1; }
async function start() {
  if (busy || engine || !renderer || ui.querySelector<HTMLButtonElement>('#start')?.disabled) return;
  if (mode === 'sensor' && sensor.info.status !== 'connected') return;
  busy = true; updateStart();
  try {
    const record = await store.record(recordKey(option.recordId, reversed, mode));
    engine = new RideEngine(path, record, mode === 'demo' ? 1 : calibration());
    if (mode === 'sensor' && performance.now() - lastCadenceAt < 3000) engine.onCadence(latestCadence);
    recorder = new SessionRecorder(); startedAt = Date.now();
    sessionId = crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
    lastCheckpoint = 0; checkpointFailed = false;
    clock.reset(); running = true; rideUI(); await keepAwake();
  } finally { busy = false; }
}
async function keepAwake() {
  try { if ((await KeepAwake.isSupported()).isSupported) await KeepAwake.keepAwake(); }
  catch { notify('No se ha podido mantener la pantalla encendida. Revisa el bloqueo automático.'); }
}
async function pause() {
  if (!engine || busy) return;
  running = !running; clock.reset();
  if (running) { if (mode === 'sensor') engine.invalidateCadence(); await keepAwake(); }
  else { await KeepAwake.allowSleep().catch(() => {}); await checkpoint(); }
  syncPauseUI();
}
function makeSession(): Session {
  const s = engine!.state;
  return { id: sessionId, startedAt, routeId: option.recordId, routeName: option.route.nombre, reversed, mode,
    deviceName: mode === 'demo' ? 'Cadencia simulada' : sensor.info.name, light: daylight,
    meters: s.travelled, seconds: s.elapsedSeconds, climbMeters: s.climbMeters,
    laps: structuredClone(engine!.timer.laps), finishedRoute: s.finished, samples: [...recorder.samples],
    record: engine!.timer.record(), xp: 0, achievements: [] };
}
async function checkpoint() {
  if (!engine || engine.state.elapsedSeconds < 1) return;
  try { await store.checkpoint(makeSession()); }
  catch (error) { if (!checkpointFailed) notify(`No se ha podido guardar el punto de recuperación: ${messageOf(error)}`, true); checkpointFailed = true; }
}
async function finish() {
  if (!engine || busy) return;
  busy = true; running = false; clock.reset();
  await KeepAwake.allowSleep().catch(() => {});
  try {
    const saved = await store.save(makeSession());
    await store.clearCheckpoint();
    profile = await store.profile(); engine = null;
    await sensor.stop(); home(); renderer.showPreview(option.preview);
    showSession(saved, true);
  } catch (error) {
    notify(`La salida sigue abierta: no se ha podido guardar. ${messageOf(error)}`, true);
    syncPauseUI();
  } finally { busy = false; updateStart(); }
}
function updateHud() {
  if (!engine) return;
  const s = engine.state;
  const values: Record<string, string> = { speed: number(s.speedMps * 3.6), cadence: String(Math.round(s.cadenceRpm)),
    distance: km(s.travelled), elapsed: time(s.elapsedSeconds), climb: String(Math.round(s.climbMeters)),
    gear: `${s.gear + 1}ª`, slope: `${s.slope >= 0 ? '+' : ''}${number(s.slope * 100)} %`,
    remaining: `${km(path.totalLength - s.distance)} km ${path.isCircuit ? 'hasta meta' : 'por delante'}`,
    'lap-label': path.isCircuit ? `VUELTA ${s.lap} · ${time(s.lapSeconds)}` : 'EN RUTA' };
  for (const [id, value] of Object.entries(values)) {
    const el = ui.querySelector(`#${id}`); if (el) el.textContent = value;
  }
  for (const direction of [-1, 1]) {
    const button = ui.querySelector<HTMLButtonElement>(`[data-shift="${direction}"]`);
    if (button) button.disabled = direction < 0 ? s.gear === 0 : s.gear === GEARS.length - 1;
  }
  const progress = Math.min(100, Math.max(0, s.distance / path.totalLength * 100));
  const fill = ui.querySelector<HTMLElement>('#route-progress-fill'); if (fill) fill.style.width = `${progress}%`;
  ui.querySelector('.route-progress')?.setAttribute('aria-valuenow', String(Math.round(progress)));
  const line = ui.querySelector('#elevation-position'), x = String(s.distance / path.totalLength * 400);
  line?.setAttribute('x1', x); line?.setAttribute('x2', x);
  const ghost = ui.querySelector<HTMLElement>('#ghost-info');
  if (ghost) { ghost.hidden = s.deltaSeconds === null;
    ghost.textContent = s.deltaSeconds === null ? '' : `${s.deltaSeconds > 0 ? '+' : ''}${number(s.deltaSeconds)} s · tu mejor vuelta`; }
}
function modal(title: string, html: string, view = 'default') {
  if (!dialog.open) dialogOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dialog.dataset.view = view;
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  dialog.innerHTML = `<div class="dialog-heading"><div><span class="eyebrow">CIKLISM / ${view === 'history' ? 'ACTIVIDAD' : view === 'settings' ? 'TU EXPERIENCIA' : view === 'profile' ? 'PROGRESO' : 'TU SALIDA'}</span><h2 id="dialog-title">${esc(title)}</h2></div><button class="icon-button" data-action="close" aria-label="Cerrar">${icons.close}</button></div><div class="dialog-body">${html}</div>`;
  if (!dialog.open) dialog.showModal();
  ui.inert = true;
  ui.setAttribute('aria-hidden', 'true');
}
dialog.addEventListener('close', () => {
  if (dialog.open) return;
  ui.inert = false;
  ui.removeAttribute('aria-hidden');
  if (dialogOpener?.isConnected && !dialogOpener.closest('[inert]')) dialogOpener.focus();
  else if (engine && !running) ui.querySelector<HTMLButtonElement>('#pause-cover [data-action="pause"]')?.focus();
  else ui.querySelector<HTMLButtonElement>('#start')?.focus();
});
async function history() {
  const all = await store.sessions(), sessions = all.filter(s => historyFilter === 'all' || s.mode === historyFilter);
  const total = sessions.reduce((sum, s) => ({ meters: sum.meters + s.meters, seconds: sum.seconds + s.seconds }), { meters: 0, seconds: 0 });
  modal('Mis salidas', `<p class="muted">Cada recorrido, en un mismo lugar. Tu historial se guarda en este dispositivo.</p>
    <div class="history-overview"><div><strong>${sessions.length}</strong><span>salidas ${historyFilter === 'demo' ? 'de prueba' : historyFilter === 'sensor' ? 'con sensor' : 'en total'}</span></div><div><strong>${km(total.meters)}<small> km</small></strong><span>distancia acumulada</span></div><div><strong>${time(total.seconds)}</strong><span>tiempo en ruta</span></div></div>
    <div class="filter-tabs" role="group" aria-label="Filtrar salidas">${[['all', 'Todas'], ['sensor', 'Con sensor'], ['demo', 'Demo']].map(([id, label]) => `<button data-history-filter="${id}" aria-pressed="${historyFilter === id}">${label}</button>`).join('')}</div>
    <div class="history-list">${sessions.length ? sessions.map(s => `<button class="history-row" data-session="${esc(s.id)}"><span class="history-route-icon">${icons.route}</span><span class="history-route"><strong>${esc(s.routeName)}</strong><small>${new Date(s.startedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })} · ${time(s.seconds)}</small></span><span class="session-mode ${s.mode}">${s.mode === 'demo' ? 'Demo' : 'Sensor'}</span><span class="history-distance">${km(s.meters)} <small>km</small></span></button>`).join('') : `<div class="empty-state"><span class="empty-icon">${icons.route}</span><h3>${all.length ? 'Todavía no hay salidas de este tipo.' : 'Aquí empieza tu historia.'}</h3><p>${all.length ? 'Prueba con otro filtro para ver tus recorridos.' : 'Elige una ruta y disfruta de tu primera salida. La guardaremos aquí al terminar.'}</p>${!all.length ? '<button class="primary" data-action="close">Explorar las rutas</button>' : ''}</div>`}</div>
    <div class="backup-panel"><div><strong>Tu historial, contigo</strong><p>Exporta una copia para llevarlo a otro dispositivo.</p></div><div class="dialog-actions"><button class="secondary" data-action="export" ${all.length ? '' : 'disabled'}>${icons.download} Exportar copia</button><label class="secondary file-button">${icons.upload} Importar copia<input type="file" id="import-file" accept="application/json,.json"/></label></div></div>`, 'history');
}
function chart(s: Session) {
  if (s.samples.length < 2) return '';
  const maximum = Math.max(1, ...s.samples.map(p => p.speed));
  const line = s.samples.filter((_, i) => i % Math.max(1, Math.ceil(s.samples.length / 400)) === 0)
    .map(p => `${(p.seconds / Math.max(1, s.seconds) * 500).toFixed(1)},${(110 - p.speed / maximum * 95).toFixed(1)}`).join(' ');
  return `<div class="session-chart"><span>VELOCIDAD · ${number(maximum * 3.6)} km/h máx.</span><svg viewBox="0 0 500 120" role="img" aria-label="Velocidad durante la sesión"><polygon points="0,120 ${line} 500,120"/><polyline points="${line}"/></svg><div><span>Inicio</span><span>${time(s.seconds)}</span></div></div>`;
}
function showSession(s: Session, justFinished = false) {
  modal(justFinished ? 'Bien rodado.' : 'Detalle de la salida', `${!justFinished ? '<button class="back-link" data-action="history">← Todas las salidas</button>' : ''}<div class="summary-intro"><span class="eyebrow">${s.mode === 'demo' ? 'EXPLORACIÓN DEMO' : 'SALIDA GUARDADA'}</span><h3>${esc(s.routeName)}</h3><p>${s.finishedRoute ? 'Ruta completada · ' : ''}${new Date(s.startedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })} · ${esc(s.deviceName)}</p></div>
    <div class="summary-stats"><div><strong>${km(s.meters)}</strong><span>kilómetros</span></div><div><strong>${time(s.seconds)}</strong><span>tiempo</span></div><div><strong>${Math.round(s.climbMeters)}</strong><span>metros ↗</span></div><div><strong>${number(s.seconds ? s.meters / s.seconds * 3.6 : 0)}</strong><span>km/h media</span></div></div>${chart(s)}
    ${s.laps.length ? `<h3>Vueltas</h3><div class="laps-list">${s.laps.map(l => `<div><span>Vuelta ${l.number}</span><strong>${time(l.seconds)}</strong><span>${l.record ? '★ Mejor marca' : ''}</span></div>`).join('')}</div>` : ''}
    ${s.mode === 'sensor' ? `<div class="reward"><strong>+${s.xp} XP</strong><span>Cada pedalada cuenta.</span></div>` : '<p class="muted">La demo no suma experiencia ni cambia tus récords reales.</p>'}
    ${s.achievements.map(id => `<p class="achievement-earned">✦ ${esc(ACHIEVEMENTS.find(a => a[0] === id)?.[1] ?? id)}</p>`).join('')}
    <button class="primary full-width" data-action="close">${justFinished ? 'Volver al camino' : 'Cerrar'}</button>`, 'summary');
}
function showProfile() {
  const level = levelFor(profile.totals.xp);
  modal('Tu camino', `<div class="profile-summary"><span class="level-avatar">${level.number}</span><h3>${level.name}</h3><p>${profile.totals.xp} XP ${level.next ? `· próximo nivel a ${level.next} XP` : ''}</p><progress max="1" value="${level.progress}" aria-label="Progreso hacia el siguiente nivel"></progress><p>${km(profile.totals.meters)} km · ${profile.totals.sessions} salidas · ${Math.round(profile.totals.climbMeters)} m de desnivel</p></div><div class="section-heading"><h3>Tus logros</h3><span>${profile.achievements.length} de ${ACHIEVEMENTS.length}</span></div><div class="achievements">${ACHIEVEMENTS.map(a => `<div class="achievement ${profile.achievements.includes(a[0]) ? 'earned' : ''}"><span>${profile.achievements.includes(a[0]) ? icons.trophy : icons.lock}</span><strong>${a[1]}</strong><small>${a[2]}</small><span class="achievement-status">${profile.achievements.includes(a[0]) ? 'Conseguido' : 'Por desbloquear'}</span></div>`).join('')}</div><p class="muted progress-note">Las salidas con sensor suman experiencia. Las demos son para explorar.</p>`, 'profile');
}
function showSettings() {
  modal('A tu manera', `<p class="muted">Encuentra el equilibrio entre detalle, comodidad y autonomía.</p><section class="settings-section"><h3>${icons.focus} Pantalla y movimiento</h3><div class="settings-row"><label for="quality">Calidad visual<small>Automática adapta el detalle. Ahorro prioriza la autonomía. Alta muestra todos los efectos.</small></label><select id="quality">${[['auto', 'Automática'], ['high', 'Alta'], ['low', 'Ahorro']].map(([id, label]) => `<option value="${id}" ${settings.quality === id ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div class="settings-row"><label for="motion">Balanceo al pedalear<small>Un movimiento suave que acompaña tus pedaladas. Desactívalo si prefieres una cámara estable.</small></label><input class="switch" type="checkbox" role="switch" id="motion" ${settings.motion ? 'checked' : ''}/></div></section><section class="settings-section"><h3>${icons.bike} Durante la salida</h3><div class="shortcut-row"><span>Cambiar de marcha</span><span><kbd>+</kbd> <kbd>−</kbd> o botones táctiles</span></div><div class="shortcut-row"><span>Pausar y continuar</span><span><kbd>Espacio</kbd></span></div><p class="muted">Usa el botón de vista despejada para ocultar datos secundarios y disfrutar del camino.</p></section><div class="settings-note">${icons.lock}<p>Tu historial y tus ajustes viven en este dispositivo. Puedes llevarte tus salidas desde <strong>Mis salidas → Exportar copia</strong>.</p></div><button class="primary full-width" data-action="close">Listo ${icons.check}</button>`, 'settings');
}
async function exportBackup() {
  const data = await store.export();
  const filename = `ciklism-${new Date().toISOString().slice(0, 10)}.json`;
  if (Capacitor.isNativePlatform()) {
    const result = await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: 'Copia de Ciklism', url: result.uri, dialogTitle: 'Guardar o compartir tu historial' });
    return;
  }
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

root.addEventListener('click', async event => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('button, a.brand');
  if (!target) return;
  try {
    if (target.matches('a.brand')) { event.preventDefault(); if (engine) { if (running) await pause(); } else if (!busy) home(); return; }
    if (target.dataset.routeFilter) {
      routeFilter = target.dataset.routeFilter; home();
      ui.querySelector<HTMLButtonElement>(`[data-route-filter="${routeFilter}"]`)?.focus(); return;
    }
    if (target.dataset.historyFilter) { historyFilter = target.dataset.historyFilter; await history(); dialog.querySelector<HTMLButtonElement>(`[data-history-filter="${historyFilter}"]`)?.focus(); return; }
    if (target.dataset.route && !busy && !engine) {
      option = routes.find(r => r.id === target.dataset.route)!; home(); ui.querySelector<HTMLButtonElement>(`[data-route="${option.id}"]`)?.focus(); await loadRoute(); return;
    }
    if (target.dataset.mode && !engine && !busy) { mode = target.dataset.mode as typeof mode; home(); ui.querySelector<HTMLButtonElement>(`[data-mode="${mode}"]`)?.focus(); return; }
    if (target.dataset.shift && engine) { engine.shift(Number(target.dataset.shift)); updateHud(); return; }
    if (target.dataset.calibration && engine) {
      const value = Math.round((calibration() + Number(target.dataset.calibration) * 0.05) * 100) / 100;
      settings.calibration[calibrationKey()] = Math.min(2.5, Math.max(0.4, value));
      engine.setCalibration(calibration()); await store.saveSettings(settings);
      ui.querySelector('#calibration-value')!.textContent = `×${number(calibration())}`; return;
    }
    if (target.dataset.session) {
      const s = (await store.sessions()).find(s => s.id === target.dataset.session); if (s) showSession(s); return;
    }
    switch (target.dataset.action) {
      case 'dismiss': toast.hidden = true; break;
      case 'start': await start(); break;
      case 'pause': await pause(); break;
      case 'finish': await requestFinish(); break;
      case 'save-finish': dialog.close(); await finish(); break;
      case 'resume': dialog.close(); if (engine && !running) await pause(); break;
      case 'home': if (!engine && !busy) home(); break;
      case 'focus': {
        const focused = ui.querySelector('.ride-overlay')!.classList.toggle('focus-mode');
        target.setAttribute('aria-pressed', String(focused));
        target.setAttribute('aria-label', focused ? 'Mostrar datos secundarios' : 'Ocultar datos secundarios'); break;
      }
      case 'map': {
        const open = ui.querySelector('.ride-side')!.classList.toggle('map-open');
        target.setAttribute('aria-expanded', String(open)); break;
      }
      case 'retry-route': if (!busy && !engine) { toast.hidden = true; await loadRoute(); } break;
      case 'reverse': if (!busy && !engine) { reversed = !reversed; home(); ui.querySelector<HTMLButtonElement>('[data-action="reverse"]')?.focus(); await loadRoute(); } break;
      case 'connect': target.setAttribute('disabled', ''); try { await sensor.choose(); } finally { target.removeAttribute('disabled'); } break;
      case 'history': await history(); break;
      case 'profile': showProfile(); break;
      case 'settings': showSettings(); break;
      case 'export': await exportBackup(); break;
      case 'close': dialog.close(); break;
    }
  } catch (error) { if (!(error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'AbortError'))) notify(messageOf(error), true); }
});
root.addEventListener('input', event => {
  const input = event.target as HTMLInputElement;
  if (input.id === 'demo-rpm') { demoRpm = Number(input.value); ui.querySelector('#demo-output')!.textContent = `${demoRpm} rpm`; }
});
root.addEventListener('change', async event => {
  const input = event.target as HTMLInputElement;
  try {
    if (input.id === 'daylight' && !busy && !engine) { daylight = input.value as Daylight; await loadRoute(); }
    if (input.id === 'quality' || input.id === 'motion') {
      if (input.id === 'quality') settings.quality = input.value as typeof settings.quality;
      else settings.motion = input.checked;
      renderer.setOptions(settings.quality, settings.motion); await store.saveSettings(settings);
    }
    if (input.id === 'import-file' && input.files?.[0]) {
      if (input.files[0].size > 50 * 1024 * 1024) throw new Error('La copia supera los 50 MB.');
      const count = await store.import(await input.files[0].text());
      profile = await store.profile(); home(); await history(); notify(`${count} salidas importadas.`);
    }
  } catch (error) { notify(messageOf(error), true); }
});
document.addEventListener('keydown', event => {
  if (!engine || dialog.open) return;
  if (!running && event.key === 'Tab') {
    const buttons = [...ui.querySelectorAll<HTMLButtonElement>('#pause-cover button:not(:disabled)')].filter(button => button.getClientRects().length > 0);
    if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
    return;
  }
  if ((event.target as HTMLElement).matches('input, select, button, summary')) return;
  if (event.code === 'Space') { event.preventDefault(); void pause(); }
  if (event.key === 'ArrowUp' || event.key === '+') engine.shift(1);
  if (event.key === 'ArrowDown' || event.key === '-') engine.shift(-1);
});
document.addEventListener('visibilitychange', () => { if (document.hidden && running) void pause(); });
window.addEventListener('beforeunload', event => { if (engine && engine.state.elapsedSeconds > 0) { event.preventDefault(); } });
sensor.onChange = info => { updateSensorUI(); if (engine && mode === 'sensor' && info.status === 'connected') engine.setCalibration(calibration()); };
sensor.onCadence = rpm => {
  latestCadence = rpm; lastCadenceAt = performance.now();
  if (engine && mode === 'sensor' && running) engine.onCadence(rpm);
};

async function boot() {
  [profile, settings] = await Promise.all([store.profile(), store.settings()]);
  const recovered = await store.recover();
  if (recovered) { profile = await store.profile(); notify('Se ha recuperado la última salida interrumpida en Mis salidas.', true); }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) settings.motion = false;
  home();
  const { RideScene } = await import('./render/scene');
  renderer = new RideScene(canvas); renderer.setOptions(settings.quality, settings.motion);
  renderer.onFrame = now => {
    if (!engine || !running) return;
    clock.advance(now, dt => {
      if (!engine) return;
      if (mode === 'demo') engine.onCadence(demoRpm);
      engine.tick(dt); recorder.onState(engine.state);
    });
    if (!engine) return;
    renderer.update(engine.state);
    if (now - lastHud > 100) { updateHud(); lastHud = now; }
    if (engine.state.elapsedSeconds - lastCheckpoint > 15) { lastCheckpoint = engine.state.elapsedSeconds; void checkpoint(); }
    if (engine.state.finished) void finish();
  };
  renderer.onContextLost = () => { if (running) void pause(); notify('La escena se ha interrumpido. La salida está en pausa mientras se recupera.', true); };
  renderer.onCompatibilityMode = () => notify('Se han simplificado algunos materiales para abrir la ruta en este navegador.');
  await loadRoute().catch(error => notify(messageOf(error), true));
  try { if (!Capacitor.isNativePlatform()) await sensor.initialize(); sourceReady = bluetoothSupport().available; }
  catch (error) { notify(`Bluetooth no está disponible: ${messageOf(error)}`); }
  if (!engine) home();
  if (Capacitor.isNativePlatform()) {
    await App.addListener('appStateChange', ({ isActive }) => { if (!isActive && running) void pause(); });
    await App.addListener('backButton', () => { if (dialog.open) dialog.close(); else if (running) void pause(); });
  } else if ('serviceWorker' in navigator && import.meta.env.PROD) {
    // Updates wait until every old tab is closed; a ride is never reloaded mid-session.
    await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  }
}
boot().catch(error => { loading(); notify(`No se ha podido iniciar Ciklism: ${messageOf(error)}. Comprueba que tu navegador admite WebGL y almacenamiento local.`, true); });
