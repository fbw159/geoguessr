// ---------------------------------------------------------------------------
// Spiellogik: Street View, Rate-Karte, Timer, Rundenergebnis, Spielende
// ---------------------------------------------------------------------------
import { MAX_ROUND_SCORE, SITE_URL } from './config.js';
import { $, b64url, copyText, countryName, esc, flagImg, fmtDist, fmtNum, fmtTime, haversine, lsGet, lsSet, uid } from './util.js';
import { boundsOf, getMap, makePicker, maxDist, scoreFor } from './locations.js';
import * as store from './storage.js';
import { avatar, confirmDialog, currentScreen, modalOpen, openModal, show, toast } from './ui.js';

// Kartenkacheln: OpenStreetMap im deutschen Stil (deutsche Ortsnamen)
const TILE_URL = 'https://tile.openstreetmap.de/{z}/{x}/{y}.png';
const TILE_OPTS = {
  maxZoom: 18,
  attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende',
};

let G = null;               // laufendes Spiel
let gmap = null, guessMarker = null;
let rmap = null, rLayer = null;
let fmap = null, fLayer = null;
let timerId = null, hideTimer = null, loadTimer = null;
const panel = { pinned: lsGet('gg.mapPinned', false), level: lsGet('gg.mapLevel', 1), hover: false };
let navigate = () => {};

const r5 = x => Math.round(x * 1e5) / 1e5;

export function initGame(opts) {
  navigate = opts.navigate;
  bindControls();
}

// ----------------------------- Start -----------------------------
export function startGame({ player, mapId, rounds, time, mode, seed, challenge = null }) {
  const isChallenge = !!seed;
  seed = seed || uid('s');
  const recent = new Set(lsGet('gg.recent', []));
  const picker = makePicker(mapId, seed, isChallenge ? null : recent);
  const locs = Array.from({ length: rounds }, () => picker());
  G = {
    id: uid('g'), player, mapId, map: getMap(mapId), rounds, time, mode, seed, challenge,
    picker, locs, idx: 0, results: [], maxD: maxDist(mapId), guess: null, locked: false, roundStart: 0,
  };
  show('game');
  initGuessMap();
  startRound();
}

function startRound() {
  G.guess = null;
  G.locked = false;
  if (guessMarker) { guessMarker.remove(); guessMarker = null; }
  updateGuessBtn();
  loadStreetView(G.locs[G.idx]);
  $('#nmpz-block').classList.toggle('hidden', G.mode !== 'nmpz');
  updateHud();
  requestAnimationFrame(() => { gmap.invalidateSize({ animate: false }); resetGuessView(); });
  G.roundStart = Date.now();
  startTimer();
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

function gmapsLink(r) {
  return `https://www.google.com/maps/@?api=1&map_action=pano&pano=${encodeURIComponent(r.pano)}&viewpoint=${r.p[0]},${r.p[1]}&heading=${r.heading || 0}`;
}

// ----------------------------- HUD & Timer -----------------------------
function updateHud() {
  const total = G.results.reduce((a, x) => a + x.s, 0);
  $('#hud-player').innerHTML = `${avatar(G.player, 'sm')}<span>${esc(G.player.name)}</span>`;
  $('#hud-map').textContent = G.map.name;
  $('#hud-round').textContent = `${G.idx + 1} / ${G.rounds}`;
  $('#hud-score').textContent = fmtNum(total);
}

function startTimer() {
  stopTimer();
  const el = $('#timer');
  if (!G.time) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden', 'urgent');
  const end = Date.now() + G.time * 1000;
  const tick = () => {
    const left = (end - Date.now()) / 1000;
    el.textContent = fmtTime(left);
    el.classList.toggle('urgent', left <= 10);
    if (left <= 0) { stopTimer(); submitGuess(true); }
  };
  tick();
  timerId = setInterval(tick, 200);
}
function stopTimer() { if (timerId) clearInterval(timerId); timerId = null; }

// ----------------------------- Rate-Karte -----------------------------
const guessIcon = p => L.divIcon({
  className: 'mk', html: `<div class="mk-guess" style="--c:${esc(p.color || '#fecd19')}">${esc(p.emoji || '')}</div>`,
  iconSize: [34, 34], iconAnchor: [17, 17],
});
const actualIcon = (label = '') => L.divIcon({
  className: 'mk', html: `<div class="mk-actual">${label}</div>`, iconSize: [28, 28], iconAnchor: [14, 14],
});

function initGuessMap() {
  if (!gmap) {
    gmap = L.map('guess-map', { zoomControl: false, worldCopyJump: true, minZoom: 1, zoomSnap: 0.25, wheelPxPerZoomLevel: 90 });
    L.tileLayer(TILE_URL, TILE_OPTS).addTo(gmap);
    gmap.attributionControl.setPrefix(false);
    gmap.on('click', e => setGuess(e.latlng));
    new ResizeObserver(() => gmap.invalidateSize({ animate: false })).observe($('#guess-map'));
  }
  applyPanel();
}

function resetGuessView() {
  const b = boundsOf(G.mapId);
  if (b) gmap.fitBounds(b, { padding: [8, 8] });
  else gmap.setView([25, 5], 1);
}

function setGuess(latlng) {
  if (!G || G.locked) return;
  const w = latlng.wrap();
  G.guess = [w.lat, w.lng];
  if (!guessMarker) guessMarker = L.marker(latlng, { icon: guessIcon(G.player), interactive: false }).addTo(gmap);
  else guessMarker.setLatLng(latlng);
  updateGuessBtn();
}

function updateGuessBtn() {
  const b = $('#btn-guess');
  const has = !!G?.guess;
  b.disabled = !has;
  b.textContent = has ? 'Raten' : 'Pin auf die Karte setzen';
}

function applyPanel() {
  const p = $('#guess-panel');
  p.classList.toggle('expanded', panel.pinned || panel.hover);
  p.dataset.level = panel.level;
  $('#gp-pin').classList.toggle('on', panel.pinned);
}

// ----------------------------- Raten & Ergebnis -----------------------------
function submitGuess(timeout = false) {
  if (!G || G.locked) return;
  if (!G.guess && !timeout) return;
  G.locked = true;
  stopTimer();
  const loc = G.locs[G.idx];
  const [lat, lng, heading, pano, cc] = loc;
  const d = G.guess ? haversine(lat, lng, G.guess[0], G.guess[1]) : null;
  const s = scoreFor(d, G.maxD);
  const res = { p: [lat, lng], cc, pano, heading, g: G.guess, d, s, t: Math.round((Date.now() - G.roundStart) / 1000) };
  G.results.push(res);
  const rec = lsGet('gg.recent', []);
  rec.push(pano);
  lsSet('gg.recent', rec.slice(-800));
  showResult(res);
}

function ensureMap(which) {
  if (which === 'result' && !rmap) {
    rmap = L.map('result-map', { worldCopyJump: false, zoomSnap: 0.25, minZoom: 1 });
    L.tileLayer(TILE_URL, TILE_OPTS).addTo(rmap);
    rmap.attributionControl.setPrefix(false);
    rLayer = L.layerGroup().addTo(rmap);
  }
  if (which === 'final' && !fmap) {
    fmap = L.map('final-map', { worldCopyJump: false, zoomSnap: 0.25, minZoom: 1 });
    L.tileLayer(TILE_URL, TILE_OPTS).addTo(fmap);
    fmap.attributionControl.setPrefix(false);
    fLayer = L.layerGroup().addTo(fmap);
  }
}

// Tipp so verschieben, dass die Linie den kürzeren Weg (ggf. über die Datumsgrenze) nimmt
function nearCopy(a, g) {
  let lng = g[1];
  if (lng - a[1] > 180) lng -= 360;
  else if (a[1] - lng > 180) lng += 360;
  return [g[0], lng];
}

function animateBar(el, pct) {
  el.style.transition = 'none';
  el.style.width = '0%';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.style.transition = '';
    el.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }));
}

function showResult(r) {
  show('result');
  G.resultAt = Date.now();
  const total = G.results.reduce((a, x) => a + x.s, 0);
  $('#result-headline').innerHTML = r.g ? `${fmtNum(r.s)} <small>Punkte</small>` : 'Zeit abgelaufen!';
  $('#result-sub').innerHTML = r.g
    ? `Dein Tipp war <b>${fmtDist(r.d)}</b> vom Ziel entfernt.`
    : 'Kein Pin gesetzt – diese Runde gibt es 0 Punkte.';
  animateBar($('#result-bar'), (r.s / MAX_ROUND_SCORE) * 100);
  $('#result-place').innerHTML = `${flagImg(r.cc)}<span class="place-name">${esc(countryName(r.cc))}</span><span class="muted">Runde ${G.idx + 1}/${G.rounds} · Gesamt ${fmtNum(total)}</span>`;
  $('#result-gmaps').href = gmapsLink(r);
  $('#btn-next').textContent = G.idx + 1 >= G.rounds ? 'Ergebnis anzeigen' : 'Nächste Runde';

  ensureMap('result');
  rLayer.clearLayers();
  rmap.invalidateSize({ animate: false });
  const a = r.p;
  L.marker(a, { icon: actualIcon('') }).addTo(rLayer);
  if (r.g) {
    const g = nearCopy(a, r.g);
    L.polyline([a, g], { color: '#1a1446', weight: 3, dashArray: '2 9', lineCap: 'round', opacity: .85 }).addTo(rLayer);
    L.marker(g, { icon: guessIcon(G.player) }).addTo(rLayer);
    rmap.fitBounds(L.latLngBounds([a, g]), { padding: [80, 80], maxZoom: 15 });
  } else {
    rmap.setView(a, 5);
  }
  setTimeout(() => $('#btn-next').focus(), 50);
}

function nextRound() {
  if (!G || currentScreen() !== 'result') return;
  if (Date.now() - (G.resultAt || 0) < 400) return; // Doppelklick-Schutz
  G.idx++;
  if (G.idx >= G.rounds) { finishGame(); return; }
  show('game');
  startRound();
}

// ----------------------------- Spielende -----------------------------
async function finishGame() {
  const total = G.results.reduce((a, x) => a + x.s, 0);
  const max = G.rounds * MAX_ROUND_SCORE;
  const game = {
    id: G.id,
    player: G.player.id,
    map: G.mapId,
    mapName: G.map.name,
    mode: G.mode,
    time: G.time,
    seed: G.seed,
    rounds: G.results.map(r => ({
      p: [r5(r.p[0]), r5(r.p[1])], cc: r.cc,
      g: r.g ? [r5(r.g[0]), r5(r.g[1])] : null,
      d: r.d == null ? null : Math.round(r.d * 100) / 100,
      s: r.s, t: r.t,
    })),
    score: total,
    max,
    date: new Date().toISOString(),
  };
  if (G.challenge) game.challenge = true;
  G.finished = game;

  show('final');
  $('#final-player').innerHTML = `${avatar(G.player, 'md')}<div><div class="fp-name">${esc(G.player.name)}</div><div class="muted">${esc(G.map.name)} · ${G.rounds} Runden${G.time ? ` · ${fmtTime(G.time)} min` : ''}${G.mode === 'nmpz' ? ' · NMPZ' : ''}</div></div>`;
  $('#final-score').textContent = fmtNum(total);
  $('#final-max').textContent = ` / ${fmtNum(max)}`;
  animateBar($('#final-bar'), (total / max) * 100);
  $('#final-rounds').innerHTML = G.results.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><span class="cell-place">${flagImg(r.cc)}${esc(countryName(r.cc))}</span></td>
      <td>${r.g ? fmtDist(r.d) : '<span class="muted">kein Tipp</span>'}</td>
      <td class="td-score">${fmtNum(r.s)}</td>
    </tr>`).join('');

  const ch = G.challenge;
  const chEl = $('#final-challenge');
  if (ch && ch.n != null && ch.p != null) {
    const diff = total - ch.p;
    const verdict = diff > 0 ? `🎉 Du hast <b>${esc(ch.n)}</b> um ${fmtNum(diff)} Punkte geschlagen!`
      : diff < 0 ? `😅 <b>${esc(ch.n)}</b> war ${fmtNum(-diff)} Punkte besser.`
      : `🤝 Unentschieden mit <b>${esc(ch.n)}</b>!`;
    chEl.innerHTML = `<div class="challenge-result">Challenge: ${esc(ch.n)} hatte ${fmtNum(ch.p)} Punkte.<br>${verdict}</div>`;
  } else chEl.innerHTML = '';

  ensureMap('final');
  fLayer.clearLayers();
  fmap.invalidateSize({ animate: false });
  const pts = [];
  G.results.forEach((r, i) => {
    const a = r.p;
    pts.push(a);
    if (r.g) {
      const g = nearCopy(a, r.g);
      pts.push(g);
      L.polyline([a, g], { color: '#1a1446', weight: 2.5, dashArray: '2 8', lineCap: 'round', opacity: .8 }).addTo(fLayer);
      L.marker(g, { icon: guessIcon(G.player) }).addTo(fLayer);
    }
    L.marker(a, { icon: actualIcon(String(i + 1)) }).addTo(fLayer);
  });
  if (pts.length) {
    const card = $('.final-card').getBoundingClientRect();
    const wide = window.innerWidth > 760;
    fmap.fitBounds(L.latLngBounds(pts), {
      paddingTopLeft: [50, 50],
      paddingBottomRight: wide ? [card.width + 70, 50] : [50, window.innerHeight * 0.7 + 30],
      maxZoom: 12,
    });
  }

  setSaveStatus('saving');
  const ok = await store.addGame(game);
  if (G?.finished?.id !== game.id) return;
  const st = store.status();
  setSaveStatus(ok ? 'ok' : (!st.hasKey ? 'local' : (st.status === 'badkey' ? 'badkey' : 'error')));
}

function setSaveStatus(kind) {
  const el = $('#final-save');
  const txt = {
    saving: '<span class="spinner-sm"></span> Wird gespeichert…',
    ok: '✓ Punkte gespeichert',
    local: '💾 Auf diesem Gerät gesichert. Hochgeladen wird, sobald dieser Browser den Schlüssel hat (Einladungslink öffnen oder Einstellungen).',
    badkey: '⚠ Der gespeicherte Schlüssel funktioniert nicht – Spiel ist lokal gesichert. Bitte in den Einstellungen prüfen.',
    error: '⚠ Upload gerade nicht möglich – lokal gesichert, wird automatisch nachgeholt.',
  }[kind];
  el.className = `final-save save-${kind}`;
  el.innerHTML = txt;
}

function challengeUrl() {
  const g = G.finished;
  return `${SITE_URL}#c=${b64url({ m: G.mapId, r: G.rounds, t: G.time, mo: G.mode, s: G.seed, n: G.player.name, p: g.score })}`;
}

// ----------------------------- Bedienelemente -----------------------------
function bindControls() {
  $('#btn-guess').onclick = () => submitGuess();
  $('#btn-next').onclick = () => nextRound();
  $('#btn-reset-view').onclick = () => G && loadStreetView(G.locs[G.idx]);
  $('#btn-skip').onclick = () => {
    if (!G || G.locked) return;
    G.locs[G.idx] = G.picker();
    loadStreetView(G.locs[G.idx]);
    toast('Neuer Ort geladen', 'info', 1800);
  };
  $('#btn-quit').onclick = async () => {
    if (!G) return;
    if (await confirmDialog('Spiel abbrechen? Die bisherigen Runden werden <b>nicht</b> gespeichert.', { ok: 'Spiel abbrechen', cancel: 'Weiterspielen', danger: true })) {
      stopTimer();
      G = null;
      $('#sv-frame').src = 'about:blank';
      navigate('setup');
    }
  };
  $('#btn-again').onclick = () => {
    if (!G) return navigate('setup');
    startGame({ player: G.player, mapId: G.mapId, rounds: G.rounds, time: G.time, mode: G.mode });
  };
  $('#btn-share').onclick = async () => {
    if (!G?.finished) return;
    const url = challengeUrl();
    if (await copyText(url)) toast('Challenge-Link kopiert – wer ihn öffnet, spielt genau deine Orte.', 'ok');
    else openModal(`<p class="modal-text">Challenge-Link:</p><input class="copy-field" readonly value="${esc(url)}"><div class="modal-actions"><button class="btn btn-primary" data-close>OK</button></div>`,
      (root, close) => { root.querySelector('[data-close]').onclick = close; root.querySelector('input').select(); });
  };

  // Rate-Karte: Hover vergrößert, Pin hält groß, +/- ändert Größe
  const p = $('#guess-panel');
  p.addEventListener('mouseenter', () => { clearTimeout(hideTimer); panel.hover = true; applyPanel(); });
  p.addEventListener('mouseleave', () => { clearTimeout(hideTimer); hideTimer = setTimeout(() => { panel.hover = false; applyPanel(); }, 700); });
  $('#gp-pin').onclick = () => { panel.pinned = !panel.pinned; lsSet('gg.mapPinned', panel.pinned); applyPanel(); };
  $('#gp-bigger').onclick = () => { panel.level = Math.min(3, panel.level + 1); lsSet('gg.mapLevel', panel.level); applyPanel(); };
  $('#gp-smaller').onclick = () => { panel.level = Math.max(0, panel.level - 1); lsSet('gg.mapLevel', panel.level); applyPanel(); };

  document.addEventListener('keydown', e => {
    if (modalOpen() || e.target.matches?.('input, textarea, select')) return;
    if (e.code !== 'Space' && e.key !== 'Enter') return;
    const s = currentScreen();
    if (s === 'game' && G?.guess && !G.locked) { e.preventDefault(); submitGuess(); }
    else if (s === 'result') { e.preventDefault(); nextRound(); }
  });
}

export const gameActive = () => !!G && !G.finished;
