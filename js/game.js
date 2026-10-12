// ---------------------------------------------------------------------------
// Normales Spiel (allein oder als Gruppe "LTT"): Runden, Ergebnis, Spielende
// ---------------------------------------------------------------------------
import { MAX_ROUND_SCORE, POINTS_VERSION, SITE_URL } from './config.js';
import { $, b64url, copyText, countryName, esc, flagImg, fmtDist, fmtNum, fmtTime, haversine, lsGet, lsSet, uid } from './util.js';
import { getMap, makePicker, maxDist, scoreFor } from './locations.js';
import * as store from './storage.js';
import { avatar, confirmDialog, currentScreen, modalOpen, openModal, show, toast } from './ui.js';
import { Overlay, actualMarkerEl, createMap, fitPoints, guessMarkerEl, nearCopy } from './maps.js';
import * as play from './playview.js';

let G = null;               // laufendes Spiel
let rmap = null, rOv = null;
let fmap = null, fOv = null;
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
  const endless = !rounds;
  const locs = endless ? [picker()] : Array.from({ length: rounds }, () => picker());
  G = {
    id: uid('g'), player, mapId, map: getMap(mapId), rounds: endless ? 0 : rounds, endless, time, mode, seed, challenge,
    picker, locs, idx: 0, results: [], maxD: maxDist(mapId),
  };
  $('#btn-stop-result').classList.toggle('hidden', !endless);
  startRound();
}

function startRound() {
  if (!G.locs[G.idx]) G.locs[G.idx] = G.picker(); // Endlos: nächster Ort erst bei Bedarf
  const total = G.results.reduce((a, x) => a + x.s, 0);
  play.startRound({
    player: G.player,
    loc: G.locs[G.idx],
    mapId: G.mapId,
    mode: G.mode,
    deadline: G.time ? Date.now() + G.time * 1000 : 0,
    hud: { map: G.map.name, round: G.endless ? `${G.idx + 1} / ∞` : `${G.idx + 1} / ${G.rounds}`, score: total },
    onGuess: handleGuess,
    onSkip: () => { G.locs[G.idx] = G.picker(); return G.locs[G.idx]; },
    onStop: G.endless ? stopEndless : null,
    onQuit: quitGame,
  });
}

function gmapsLink(r) {
  return `https://www.google.com/maps/@?api=1&map_action=pano&pano=${encodeURIComponent(r.pano)}&viewpoint=${r.p[0]},${r.p[1]}&heading=${r.heading || 0}`;
}

// ----------------------------- Raten & Ergebnis -----------------------------
function handleGuess(guess, { t }) {
  if (!G) return;
  const [lat, lng, heading, pano, cc] = G.locs[G.idx];
  const d = guess ? haversine(lat, lng, guess[0], guess[1]) : null;
  const s = scoreFor(d, G.maxD);
  const res = { p: [lat, lng], cc, pano, heading, g: guess, d, s, t: Math.round(t) };
  G.results.push(res);
  const rec = lsGet('gg.recent', []);
  rec.push(pano);
  lsSet('gg.recent', rec.slice(-800));
  showResult(res);
}

function animateBar(el, pct) {
  el.style.transition = 'none';
  el.style.width = '0%';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.style.transition = '';
    el.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }));
}
export { animateBar };

function showResult(r) {
  show('result');
  G.resultAt = Date.now();
  const total = G.results.reduce((a, x) => a + x.s, 0);
  $('#result-headline').innerHTML = r.g ? `${fmtNum(r.s)} <small>Punkte</small>` : 'Zeit abgelaufen!';
  $('#result-sub').innerHTML = r.g
    ? `Dein Tipp war <b>${fmtDist(r.d)}</b> vom Ziel entfernt.`
    : 'Kein Pin gesetzt – diese Runde gibt es 0 Punkte.';
  animateBar($('#result-bar'), (r.s / MAX_ROUND_SCORE) * 100);
  $('#result-place').innerHTML = `${flagImg(r.cc)}<span class="place-name">${esc(countryName(r.cc))}</span><span class="muted">Runde ${G.idx + 1}${G.endless ? '' : `/${G.rounds}`} · Gesamt ${fmtNum(total)} · Ø ${fmtNum(total / G.results.length)}</span>`;
  $('#result-gmaps').href = gmapsLink(r);
  $('#btn-next').textContent = !G.endless && G.idx + 1 >= G.rounds ? 'Ergebnis anzeigen' : 'Nächste Runde';

  if (!rmap) { rmap = createMap($('#result-map')); rOv = new Overlay(rmap); }
  rOv.clear();
  const a = r.p;
  rOv.marker(a, actualMarkerEl(''));
  if (r.g) {
    const g = nearCopy(a, r.g);
    rOv.line(a, g);
    rOv.marker(g, guessMarkerEl(G.player));
    fitPoints(rmap, [a, g], { padding: 90, maxZoom: 14 });
  } else {
    fitPoints(rmap, [a], { maxZoom: 5 });
  }
  setTimeout(() => $('#btn-next').focus(), 50);
}

function nextRound() {
  if (!G || currentScreen() !== 'result') return;
  if (Date.now() - (G.resultAt || 0) < 400) return; // Doppelklick-Schutz
  G.idx++;
  if (!G.endless && G.idx >= G.rounds) { finishGame(); return; }
  startRound();
}

// ----------------------------- Spielende -----------------------------
async function finishGame() {
  play.lockRound();
  const n = G.results.length;
  const total = G.results.reduce((a, x) => a + x.s, 0);
  const max = n * MAX_ROUND_SCORE;
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
    pv: POINTS_VERSION,
    date: new Date().toISOString(),
  };
  if (G.endless) game.endless = true;
  if (G.challenge) game.challenge = true;
  G.finished = game;

  show('final');
  $('#final-player').innerHTML = `${avatar(G.player, 'md')}<div><div class="fp-name">${esc(G.player.name)}</div><div class="muted">${esc(G.map.name)} · ${n} ${n === 1 ? 'Runde' : 'Runden'}${G.endless ? ' (Endlos)' : ''}${G.time ? ` · ${fmtTime(G.time)} min` : ''}${G.mode === 'nmpz' ? ' · NMPZ' : ''}</div></div>`;
  $('#final-score').textContent = fmtNum(total);
  $('#final-max').textContent = ` / ${fmtNum(max)} · Ø ${fmtNum(total / n)} pro Guess`;
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

  if (!fmap) { fmap = createMap($('#final-map')); fOv = new Overlay(fmap); }
  fOv.clear();
  const pts = [];
  G.results.forEach((r, i) => {
    const a = r.p;
    pts.push(a);
    if (r.g) {
      const g = nearCopy(a, r.g);
      pts.push(g);
      fOv.line(a, g);
      fOv.marker(g, guessMarkerEl(G.player));
    }
    fOv.marker(a, actualMarkerEl(String(i + 1)));
  });
  fitFinal(fmap, pts);

  setSaveStatus('saving');
  const ok = await store.addGame(game);
  if (G?.finished?.id !== game.id) return;
  const st = store.status();
  setSaveStatus(ok ? 'ok' : (!st.hasKey ? 'local' : (st.status === 'badkey' ? 'badkey' : 'error')));
}

// Karte so einpassen, dass die Ergebniskarte rechts nichts verdeckt
export function fitFinal(map, pts, cardSel = '.final-card') {
  const card = document.querySelector(`.screen.active ${cardSel}`)?.getBoundingClientRect();
  const wide = window.innerWidth > 760;
  fitPoints(map, pts, {
    padding: wide && card ? { top: 50, bottom: 50, left: 50, right: card.width + 70 } : { top: 50, left: 50, right: 50, bottom: window.innerHeight * 0.7 + 30 },
    maxZoom: 12,
  });
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
  return `${SITE_URL}#c=${b64url({ m: G.mapId, r: G.results.length, t: G.time, mo: G.mode, s: G.seed, n: G.player.name, p: g.score })}`;
}

async function quitGame() {
  if (!G) return;
  if (await confirmDialog('Spiel abbrechen? Die bisherigen Runden werden <b>nicht</b> gespeichert.', { ok: 'Spiel abbrechen', cancel: 'Weiterspielen', danger: true })) {
    play.endPlay();
    G = null;
    navigate('setup');
  }
}

// ----------------------------- Bedienelemente -----------------------------
function bindControls() {
  $('#btn-next').onclick = () => nextRound();
  $('#btn-stop-result').onclick = () => stopEndless();
  $('#btn-again').onclick = () => {
    if (!G) return navigate('setup');
    startGame({ player: G.player, mapId: G.mapId, rounds: G.endless ? 0 : G.rounds, time: G.time, mode: G.mode });
  };
  $('#btn-share').onclick = async () => {
    if (!G?.finished) return;
    const url = challengeUrl();
    if (await copyText(url)) toast('Challenge-Link kopiert – wer ihn öffnet, spielt genau deine Orte.', 'ok');
    else openModal(`<p class="modal-text">Challenge-Link:</p><input class="copy-field" readonly value="${esc(url)}"><div class="modal-actions"><button class="btn btn-primary" data-close>OK</button></div>`,
      (root, close) => { root.querySelector('[data-close]').onclick = close; root.querySelector('input').select(); });
  };
  document.addEventListener('keydown', e => {
    if (modalOpen() || e.target.matches?.('input, textarea, select')) return;
    if (e.code !== 'Space' && e.key !== 'Enter') return;
    if (currentScreen() === 'result') { e.preventDefault(); nextRound(); }
  });
}

// Endlos-Modus: Spiel beenden und die bisherigen Runden speichern
async function stopEndless() {
  if (!G || !G.endless || G.finished) return;
  if (!G.results.length) {
    if (await confirmDialog('Noch keine Runde geraten – Spiel ohne Speichern beenden?', { ok: 'Beenden', cancel: 'Weiterspielen' })) {
      play.endPlay();
      G = null;
      navigate('setup');
    }
    return;
  }
  if (currentScreen() === 'game' && !play.isLocked()) {
    const n = G.results.length;
    const ok = await confirmDialog(`Spiel beenden und die ${n} ${n === 1 ? 'geratene Runde' : 'geratenen Runden'} speichern? Die aktuelle Runde zählt nicht.`, { ok: 'Beenden & speichern', cancel: 'Weiterspielen' });
    if (!ok || !G || G.finished) return;
    // Lief während der Rückfrage die Zeit ab, zählt diese Runde nicht
    if (G.results.length > n) G.results.length = n;
  }
  finishGame();
}

export const gameActive = () => !!G && !G.finished;
