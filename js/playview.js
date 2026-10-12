// ---------------------------------------------------------------------------
// Spielansicht (Street View + Rate-Karte + Timer + HUD) – gemeinsam genutzt vom
// normalen Spiel (game.js) und vom Competition Mode (competition.js).
// ---------------------------------------------------------------------------
import { $, esc, fmtNum, fmtTime, lsGet, lsSet } from './util.js';
import { boundsOf } from './locations.js';
import { createMap, fitBox, guessMarkerEl } from './maps.js';
import { avatar, currentScreen, modalOpen, show, toast } from './ui.js';

let R = null;               // aktuelle Runde
let gmap = null, guessMarker = null;
let timerId = null, loadTimer = null, hideTimer = null;
const panel = { pinned: lsGet('gg.mapPinned', false), level: lsGet('gg.mapLevel', 1), hover: false };

/**
 * Startet eine Runde in der Spielansicht.
 * opts: { player, loc, mapId, mode, deadline (ms, 0 = ohne Zeitlimit), hud: {map, round, score},
 *         onGuess(guess|null, {timeout, t}), onSkip?() → neuer Ort, onStop?(), onQuit() }
 */
export function startRound(opts) {
  R = { ...opts, guess: null, locked: false, startedAt: Date.now() };
  show('game');
  ensureGuessMap();
  if (guessMarker) { guessMarker.remove(); guessMarker = null; }
  updateGuessBtn();
  loadStreetView(R.loc);
  $('#nmpz-block').classList.toggle('hidden', R.mode !== 'nmpz');
  $('#btn-skip').classList.toggle('hidden', !R.onSkip);
  $('#btn-stop').classList.toggle('hidden', !R.onStop);
  setHud(R.hud || {});
  setExtra(R.extra || '');
  setWaiting(null);
  requestAnimationFrame(() => fitBox(gmap, boundsOf(R.mapId), { padding: 8, maxZoom: 12 }));
  startTimer();
}

export function endPlay() {
  stopTimer();
  R = null;
  setWaiting(null);
  $('#sv-frame').src = 'about:blank';
}

export const isLocked = () => !R || R.locked;
export const roundActive = () => !!R && !R.locked;
export function lockRound() { if (R) R.locked = true; stopTimer(); updateGuessBtn(); }

export function setHud({ map, round, score, scoreLabel } = {}) {
  if (!R) return;
  $('#hud-player').innerHTML = `${avatar(R.player, 'sm')}<span>${esc(R.player.name)}</span>`;
  if (map != null) $('#hud-map').textContent = map;
  if (round != null) $('#hud-round').textContent = round;
  if (score != null) $('#hud-score').textContent = typeof score === 'number' ? fmtNum(score) : score;
  $('#hud-score-label').textContent = scoreLabel || 'Punkte';
}
export function setExtra(html) {
  const el = $('#hud-extra');
  el.innerHTML = html || '';
  el.classList.toggle('hidden', !html);
}
export function setWaiting(html) {
  const el = $('#play-wait');
  el.innerHTML = html || '';
  el.classList.toggle('hidden', !html);
}

// ----------------------------- Street View -----------------------------
// Keyless Google-Maps-Embed mit Panorama-ID. Das Iframe ist nach oben verschoben,
// damit die Adress-Karte von Google (oben links) außerhalb des sichtbaren Bereichs liegt.
function svUrl([lat, lng, heading, pano]) {
  return `https://www.google.com/maps/embed?pb=!4v${Date.now()}!6m8!1m7!1s${pano}!2m2!1d${lat}!2d${lng}!3f${heading}!4f0!5f0.7820865974627469`;
}

function loadStreetView(loc) {
  const f = $('#sv-frame');
  const spin = $('#sv-loading');
  spin.classList.remove('hidden');
  clearTimeout(loadTimer);
  f.onload = () => { clearTimeout(loadTimer); loadTimer = setTimeout(() => spin.classList.add('hidden'), 500); };
  loadTimer = setTimeout(() => spin.classList.add('hidden'), 8000);
  f.src = svUrl(loc);
}

// ----------------------------- Timer -----------------------------
function startTimer() {
  stopTimer();
  const el = $('#timer');
  if (!R.deadline) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden', 'urgent');
  const tick = () => {
    if (!R) return stopTimer();
    const left = (R.deadline - Date.now()) / 1000;
    el.textContent = fmtTime(left);
    el.classList.toggle('urgent', left <= 10);
    if (left <= 0) { stopTimer(); submit(true); }
  };
  tick();
  timerId = setInterval(tick, 200);
}
function stopTimer() { if (timerId) clearInterval(timerId); timerId = null; }

// ----------------------------- Rate-Karte -----------------------------
function ensureGuessMap() {
  if (!gmap) {
    gmap = createMap($('#guess-map'));
    gmap.on('click', e => setGuess(e.lngLat));
  }
  applyPanel();
}

function setGuess(lngLat) {
  if (!R || R.locked) return;
  const w = lngLat.wrap();
  R.guess = [w.lat, w.lng];
  if (!guessMarker) guessMarker = new maplibregl.Marker({ element: guessMarkerEl(R.player) }).setLngLat(lngLat).addTo(gmap);
  else guessMarker.setLngLat(lngLat);
  updateGuessBtn();
}

function updateGuessBtn() {
  const b = $('#btn-guess');
  const has = !!R?.guess && !R.locked;
  b.disabled = !has;
  b.textContent = R?.locked ? 'Getippt ✓' : has ? 'Raten' : 'Pin auf die Karte setzen';
}

function applyPanel() {
  const p = $('#guess-panel');
  p.classList.toggle('expanded', panel.pinned || panel.hover);
  p.dataset.level = panel.level;
  $('#gp-pin').classList.toggle('on', panel.pinned);
}

function submit(timeout = false) {
  if (!R || R.locked) return;
  if (!R.guess && !timeout) return;
  R.locked = true;
  stopTimer();
  updateGuessBtn();
  const t = Math.max(0, (Date.now() - R.startedAt) / 1000);
  R.onGuess(R.guess, { timeout, t });
}

// ----------------------------- Bedienelemente -----------------------------
export function initPlayView() {
  $('#btn-guess').onclick = () => submit();
  $('#btn-reset-view').onclick = () => R && loadStreetView(R.loc);
  $('#btn-skip').onclick = () => {
    if (!R || R.locked || !R.onSkip) return;
    const loc = R.onSkip();
    if (!loc) return;
    R.loc = loc;
    loadStreetView(loc);
    toast('Neuer Ort geladen', 'info', 1800);
  };
  $('#btn-stop').onclick = () => R?.onStop?.();
  $('#btn-quit').onclick = () => R?.onQuit?.();

  // Rate-Karte: Hover vergrößert, Pin hält groß, +/- ändert Größe.
  // Kommt der Mauszeiger mit gedrückter Taste herein (man dreht gerade Street View),
  // wird die Karte kurz "durchlässig" und klappt nicht auf – so reißt das Ziehen nicht ab.
  const p = $('#guess-panel');
  let openTimer = null, passTimer = null, pressedInside = false;
  const passThrough = () => {
    clearTimeout(openTimer);
    p.classList.add('passthrough');
    clearTimeout(passTimer);
    passTimer = setTimeout(() => p.classList.remove('passthrough'), 350);
  };
  p.addEventListener('pointerdown', () => { pressedInside = true; });
  window.addEventListener('pointerup', () => {
    if (pressedInside && !p.matches(':hover')) {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { panel.hover = false; applyPanel(); }, 700);
    }
    pressedInside = false;
  }, true);
  window.addEventListener('blur', () => { pressedInside = false; });
  p.addEventListener('pointerenter', e => {
    if (e.buttons && !pressedInside) { passThrough(); return; }
    clearTimeout(hideTimer);
    if (panel.hover) return;
    clearTimeout(openTimer);
    openTimer = setTimeout(() => { panel.hover = true; applyPanel(); }, 150);
  });
  p.addEventListener('pointermove', e => { if (e.buttons && !pressedInside) passThrough(); });
  p.addEventListener('pointerleave', () => {
    clearTimeout(openTimer);
    clearTimeout(hideTimer);
    if (pressedInside) return; // Karte wird gerade verschoben → offen lassen
    hideTimer = setTimeout(() => { panel.hover = false; applyPanel(); }, 700);
  });
  $('#gp-pin').onclick = () => { panel.pinned = !panel.pinned; lsSet('gg.mapPinned', panel.pinned); applyPanel(); };
  $('#gp-bigger').onclick = () => { panel.level = Math.min(3, panel.level + 1); lsSet('gg.mapLevel', panel.level); applyPanel(); };
  $('#gp-smaller').onclick = () => { panel.level = Math.max(0, panel.level - 1); lsSet('gg.mapLevel', panel.level); applyPanel(); };

  document.addEventListener('keydown', e => {
    if (modalOpen() || e.target.matches?.('input, textarea, select')) return;
    if (e.code !== 'Space' && e.key !== 'Enter') return;
    if (currentScreen() === 'game' && R?.guess && !R.locked) { e.preventDefault(); submit(); }
  });
}
