// ---------------------------------------------------------------------------
// Competition Mode: alle spielen gleichzeitig dieselben Orte, Tempo zählt mit.
//
// Ablauf: Host erstellt Wettkampf → Lobby (Code + Einladungslink inkl. Schlüssel)
// → Host drückt „Los!“ → Countdown → Runden → Rundenergebnis mit allen Pins → Siegerehrung.
//
// Technik: Jeder Wettkampf ist eine JSON-Datei auf dem Branch "data"
// (data/matches/<CODE>.json). Alle Browser fragen sie alle ~2 s ab (mit ETag, also sparsam).
// Rundenstarts sind feste Zeitpunkte; die Zeit bis zum Tipp misst jeder Browser selbst.
// Ergebnisse landen getrennt von der normalen Bestenliste in data/competitions.json.
//
// Wertung (Variante A): Punkte = Genauigkeit (0–100) × Tempo-Faktor,
// Tempo-Faktor fällt linear von 100 % (sofort) auf 70 % (Zeitlimit).
// ---------------------------------------------------------------------------
import { COMP_TIME_FACTOR_MIN as TIME_FACTOR_MIN, MAPS, SITE_URL } from './config.js';
import { $, $$, copyText, countryName, esc, flagImg, fmtDate, fmtDist, fmtNum, fmtTime, haversine, lsGet, lsSet, uid } from './util.js';
import { countryList, getMap, loadLocations, makePicker, maxDist, scoreFor } from './locations.js';
import * as store from './storage.js';
import { avatar, confirmDialog, currentScreen, openModal, show, toast } from './ui.js';
import { Overlay, actualMarkerEl, createMap, fitPoints, guessMarkerEl, nearCopy } from './maps.js';
import * as play from './playview.js';
import { showPointsInfo } from './info.js';

const MATCH_DIR = 'data/matches';
const COMP_FILE = 'data/competitions.json';
const START_DELAY = 8000;      // Countdown vor Runde 1 (ms)
const RESULT_PAUSE = 15000;    // Rundenergebnis bis zur nächsten Runde (ms)
const GRACE = 4000;            // Puffer nach Zeitablauf für späte Tipps (ms)
const FINAL_AUTO = 12000;      // nach der letzten Runde automatisch zur Siegerehrung (ms)
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let navigate = () => {};
let playerDialog = () => {};
const prefs = { map: 'world', rounds: 3, time: 60, mode: 'move', ...lsGet('gg.compPrefs', {}) };
const device = lsGet('gg.device', null) || (() => { const d = uid('d'); lsSet('gg.device', d); return d; })();

let C = null;          // laufender Wettkampf auf diesem Gerät
let crMap = null, crOv = null, cfMap = null, cfOv = null;
let hubData = null;    // competitions.json

const r5 = x => Math.round(x * 1e5) / 1e5;
const matchPath = code => `${MATCH_DIR}/${code}.json`;
const toLocal = ts => ts - (store.serverNow() - Date.now());
const medal = r => r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : `${r}.`;
const fmtSec = t => t == null ? '–' : `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(t)} s`;

export const compActive = () => !!C && C.m?.status === 'running' && !!C.me;
export const inviteUrl = code => `${SITE_URL}#m=${code}${store.getKey() ? `&key=${encodeURIComponent(store.getKey())}` : ''}`;

export function initCompetition(opts) {
  navigate = opts.navigate;
  playerDialog = opts.playerDialog;
  bindHub();
  bindLobby();
  bindResult();
  store.onChange(() => {
    if (currentScreen() === 'comp') renderHubPlayers();
    if (currentScreen() === 'comp-lobby' && C) renderLobby();
  });
}

// ============================== Menü (Hub) ==============================
export async function renderHub() {
  const hasKey = store.status().hasKey;
  $('#comp-nokey').classList.toggle('hidden', hasKey);
  $('#cc-create').disabled = !hasKey;
  $('#cj-join').disabled = !hasKey;
  renderHubPlayers();
  await loadLocations();
  const sel = $('#cc-map');
  sel.innerHTML = `<optgroup label="Karten">${MAPS.map(m => `<option value="${m.id}">${m.icon} ${esc(m.name)}</option>`).join('')}</optgroup>`
    + `<optgroup label="Einzelne Länder">${countryList().map(c => `<option value="c-${c.cc}">${esc(c.name)}</option>`).join('')}</optgroup>`;
  sel.value = prefs.map;
  if (!sel.value) { prefs.map = 'world'; sel.value = 'world'; }
  renderSegs();
  loadHubData();
}

function renderHubPlayers() {
  const sel = $('#cc-player');
  const players = store.view().players;
  const cur = sel.value || lsGet('gg.player', null);
  sel.innerHTML = players.map(p => `<option value="${esc(p.id)}">${esc(p.emoji || '')} ${esc(p.name)}</option>`).join('');
  if (players.some(p => p.id === cur)) sel.value = cur;
}

function renderSegs() {
  $$('#screen-comp .seg[data-copt]').forEach(seg => {
    const k = seg.dataset.copt;
    $$('button', seg).forEach(b => b.classList.toggle('sel', String(prefs[k]) === b.dataset.v));
  });
}

async function loadHubData() {
  try {
    const r = await store.readFile(COMP_FILE);
    hubData = r.data || { v: 1, matches: [] };
  } catch {
    hubData = hubData || { v: 1, matches: [] };
  }
  renderHubBoard();
}

function renderHubBoard() {
  const matches = hubData?.matches || [];
  const names = Object.fromEntries(store.view().players.map(p => [p.id, p]));
  const agg = {};
  for (const m of matches) {
    for (const r of m.results || []) {
      const a = agg[r.pid] ??= { pid: r.pid, name: r.name, matches: 0, wins: 0, podium: 0, total: 0, rounds: 0, acc: 0, t: 0, tn: 0 };
      a.name = names[r.pid]?.name || r.name;
      a.matches++;
      if (r.place === 1) a.wins++;
      if (r.place <= 3 && (m.results.length > 1)) a.podium++;
      a.total += r.total;
      a.rounds += m.rounds;
      a.acc += r.acc;
      if (r.tn) { a.t += r.t; a.tn += r.tn; }
    }
  }
  const rows = Object.values(agg).sort((a, b) => (b.wins - a.wins) || (b.total / b.rounds - a.total / a.rounds));
  $('#comp-lb-body').innerHTML = rows.map((a, i) => {
    const p = names[a.pid] || { name: a.name, color: '#8d99ae', emoji: '?' };
    return `
      <tr>
        <td class="td-rank">${i < 3 ? medal(i + 1) : `${i + 1}.`}</td>
        <td><span class="cell-player">${avatar(p, 'sm')}<span>${esc(a.name)}</span></span></td>
        <td class="num key-val">${a.wins}</td>
        <td class="num">${a.podium}</td>
        <td class="num">${a.matches}</td>
        <td class="num">${fmtNum(a.total / Math.max(1, a.rounds))}</td>
        <td class="num">${fmtNum(a.acc / Math.max(1, a.rounds))}</td>
        <td class="num">${a.tn ? fmtSec(a.t / a.tn) : '–'}</td>
      </tr>`;
  }).join('') || '<tr><td colspan="8" class="muted center">Noch keine Wettkämpfe – leg los!</td></tr>';

  $('#comp-recent').innerHTML = [...matches].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 12).map(m => {
    const res = [...(m.results || [])].sort((a, b) => a.place - b.place);
    return `
      <div class="comp-row">
        <span class="cr-date muted">${fmtDate(m.date)}</span>
        <span class="cr-map">${esc(m.mapName || getMap(m.map).name)} · ${m.rounds} R. · ${m.time} s${m.mode === 'nmpz' ? ' · NMPZ' : ''}</span>
        <span class="cr-res">${res.map(r => `<span class="cr-p">${r.place <= 3 ? medal(r.place) : `${r.place}.`} ${esc(names[r.pid]?.name || r.name)} <b>${fmtNum(r.total)}</b></span>`).join('')}</span>
      </div>`;
  }).join('') || '<p class="muted">Noch keine Wettkämpfe.</p>';
}

function bindHub() {
  $$('#screen-comp .seg[data-copt]').forEach(seg => seg.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const k = seg.dataset.copt;
    prefs[k] = k === 'mode' ? b.dataset.v : Number(b.dataset.v);
    lsSet('gg.compPrefs', prefs);
    renderSegs();
  }));
  $('#cc-map').addEventListener('change', e => { prefs.map = e.target.value; lsSet('gg.compPrefs', prefs); });
  $('#cc-new-player').onclick = () => playerDialog();
  $('#cc-create').onclick = createMatch;
  const join = () => {
    const code = $('#cj-code').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 4) { toast('Der Code hat 4 Zeichen.', 'error'); return; }
    openMatch(code);
  };
  $('#cj-join').onclick = join;
  $('#cj-code').onkeydown = e => { if (e.key === 'Enter') join(); };
  $('#comp-refresh').onclick = loadHubData;
  $('#comp-info').onclick = () => showPointsInfo('comp');
}

// ============================== Erstellen & Öffnen ==============================
async function createMatch() {
  const pid = $('#cc-player').value;
  const p = store.view().players.find(x => x.id === pid);
  if (!p) { toast('Bitte zuerst einen Spieler auswählen oder anlegen.', 'error'); return; }
  const btn = $('#cc-create');
  btn.disabled = true;
  btn.textContent = 'Erstelle…';
  try {
    await loadLocations();
    const data = await newMatch({
      host: pid, map: prefs.map, rounds: prefs.rounds, time: prefs.time, mode: prefs.mode,
      players: { [pid]: { name: p.name, color: p.color, emoji: p.emoji, device, joined: new Date().toISOString() } },
      order: [pid],
    });
    lsSet('gg.player', pid);
    openMatch(data.code, data);
  } catch (e) {
    toast(`Wettkampf konnte nicht erstellt werden: ${esc(e.message)}`, 'error', 7000);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Lobby öffnen';
  }
}

async function newMatch({ host, map, rounds, time, mode, players, order }) {
  const seed = uid('s');
  const picker = makePicker(map, seed, null);
  const locs = Array.from({ length: rounds }, () => picker()).map(r => [r[0], r[1], r[2], r[3], r[4]]);
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    const data = {
      v: 1, code, created: new Date().toISOString(), host,
      map, mapName: getMap(map).name, rounds, time, mode, seed, locs,
      status: 'lobby', players, order, starts: [], guesses: {},
    };
    try {
      await store.writeFile(matchPath(code), data, null, `Wettkampf ${code}: erstellt von ${players[host]?.name || '?'}`);
      return data;
    } catch (e) {
      if (!e.conflict) throw e; // Code existiert schon → neuen würfeln
    }
  }
  throw new Error('Kein freier Code gefunden');
}

export async function openMatch(code, data = null) {
  stopComp();
  C = {
    code, m: data, etag: null, me: null, phase: null, round: null,
    pending: {}, sending: {}, lastSend: {}, scheduling: {}, completeAt: {}, finalAt: null,
    pollTimer: null, tick: null, pollErr: 0, resultCount: -1, finishing: false, saving: false,
  };
  if (!store.status().hasKey) toast('Dieser Browser hat noch keinen Schlüssel – öffne am besten den Einladungslink.', 'error', 7000);
  await loadLocations();
  show('comp-lobby');
  $('#lobby-code').textContent = code;
  if (!data) {
    $('#lobby-players').innerHTML = '<div class="loading-card"><div class="spinner"></div><span>Lade Wettkampf…</span></div>';
    await poll(true);
    if (!C || !C.m) return;
  } else onData();
  if (!C) return;
  C.pollTimer = setTimeout(() => poll(), 1500);
  C.tick = setInterval(update, 250);
}

function stopComp() {
  if (!C) return;
  clearTimeout(C.pollTimer);
  clearInterval(C.tick);
  $('#comp-countdown').classList.add('hidden');
  if (currentScreen() === 'game') play.endPlay();
  C = null;
}

async function leaveTo(screen = 'comp') {
  stopComp();
  play.endPlay();
  navigate(screen);
}

// ============================== Abfragen & Schreiben ==============================
async function poll(once = false) {
  if (!C) return;
  const code = C.code;
  try {
    const r = await store.readFile(matchPath(code), C.etag);
    if (!C || C.code !== code) return;
    if (!r.notModified) {
      if (!r.data) {
        toast(`Wettkampf <b>${esc(code)}</b> gibt es nicht.`, 'error', 6000);
        leaveTo('comp');
        return;
      }
      C.m = r.data;
      C.etag = r.etag;
      onData();
    }
    if (C.pollErr >= 3) toast('Verbindung wieder da.', 'ok', 2000);
    C.pollErr = 0;
  } catch (e) {
    if (!C) return;
    C.pollErr++;
    if (C.pollErr === 3) toast('Verbindung zu GitHub hakt – versuche es weiter…', 'error', 5000);
  }
  if (!once && C && C.code === code) {
    const slow = C.phase === 'final';
    C.pollTimer = setTimeout(() => poll(), slow ? 4000 : 2000);
  }
}

function setData(m) {
  if (!C || !m) return;
  C.m = m;
  C.etag = null; // nächste Abfrage holt sicher den neuesten Stand
  onData();
}

async function mutate(fn, message) {
  const code = C.code;
  const r = await store.mutateFile(matchPath(code), m => {
    if (!m) return false;
    return fn(m);
  }, `Wettkampf ${code}: ${message}`);
  if (C && C.code === code && !r.unchanged) setData(r.data);
  else if (C && C.code === code && r.data) setData(r.data);
  return r;
}

// ============================== Zustand ==============================
function guessOf(i, pid) {
  return C.m.guesses?.[i]?.[pid] || (pid === C.me ? C.pending[i] : null) || null;
}
function allGuessed(i) {
  return C.m.order.length > 0 && C.m.order.every(pid => guessOf(i, pid));
}
function totals(upTo) {
  const t = {};
  for (const pid of C.m.order) {
    t[pid] = 0;
    for (let i = 0; i <= upTo; i++) t[pid] += guessOf(i, pid)?.s || 0;
  }
  return t;
}

function derive(now) {
  const m = C.m;
  if (m.status === 'cancelled') return { phase: 'cancelled' };
  if (m.status === 'lobby') return { phase: 'lobby' };
  const starts = m.starts || [];
  const last = m.rounds - 1;
  if (m.status === 'done') return { phase: 'final' };
  let i = starts.length - 1;
  if (i < 0) return { phase: 'lobby' };
  if (now < starts[i]) return i === 0 ? { phase: 'countdown', round: 0, at: starts[0] } : { phase: 'result', round: i - 1, nextAt: starts[i] };
  const deadline = starts[i] + m.time * 1000;
  if (!allGuessed(i) && now < deadline + GRACE) return { phase: 'round', round: i, deadline };
  if (C.completeAt[i] == null) C.completeAt[i] = Date.now();
  if (i === last) {
    if (C.finalAt == null) C.finalAt = Date.now() + FINAL_AUTO;
    if (Date.now() >= C.finalAt) return { phase: 'final' };
    return { phase: 'result', round: i, last: true };
  }
  return { phase: 'result', round: i, nextAt: null };
}

function update() {
  if (!C?.m) return;
  const now = store.serverNow();
  const st = derive(now);
  const changed = C.phase !== st.phase || C.round !== st.round;
  C.phase = st.phase;
  C.round = st.round;

  // Countdown-Overlay: vor Runde 1 komplett, vor weiteren Runden die letzten 3 Sekunden
  const nextStart = st.phase === 'countdown' ? st.at : st.phase === 'result' ? st.nextAt : null;
  const cd = $('#comp-countdown');
  if (nextStart && C.me && (st.phase === 'countdown' || nextStart - now < 3500)) {
    const nextRound = st.phase === 'countdown' ? 0 : st.round + 1;
    cd.classList.remove('hidden');
    $('#cd-label').textContent = `Runde ${nextRound + 1} von ${C.m.rounds} startet in`;
    $('#cd-num').textContent = Math.max(1, Math.ceil((nextStart - now) / 1000));
  } else cd.classList.add('hidden');

  switch (st.phase) {
    case 'cancelled':
      toast('Der Wettkampf wurde abgebrochen.', 'info', 5000);
      leaveTo('comp');
      return;
    case 'lobby':
    case 'countdown':
      if (changed) { show('comp-lobby'); renderLobby(); }
      break;
    case 'round':
      enterRound(st, changed);
      break;
    case 'result':
      if (changed) { play.endPlay(); show('comp-result'); C.resultCount = -1; renderResult(st.round); }
      tickResult(st, now);
      break;
    case 'final':
      if (changed) { play.endPlay(); show('comp-final'); renderFinal(); }
      break;
  }
  housekeeping(st, now);
}

function onData() {
  if (!C?.m) return;
  C.me = Object.entries(C.m.players || {}).find(([, p]) => p.device === device)?.[0] || null;
  if (C.phase === 'lobby' || C.phase === 'countdown' || C.phase == null) renderLobby();
  if (C.phase === 'round') updateRoundStatus();
  if (C.phase === 'result') renderResult(C.round);
  if (C.phase === 'final') renderFinal();
  // Revanche: Host hat einen neuen Wettkampf erstellt
  if (C.m.next && C.phase === 'final' && C.m.players?.[C.me]) {
    const next = C.m.next;
    toast('Revanche! Neue Lobby wird geöffnet…', 'ok', 3000);
    openMatch(next);
    return;
  }
  update();
}

// Aufgaben, die irgendein Browser übernehmen muss (zuerst der Host, sonst nach kurzer Wartezeit jeder)
function housekeeping(st, now) {
  const m = C.m;
  const isHost = C.me && C.me === m.host;
  // Eigenen Tipp erneut senden, falls er noch nicht angekommen ist
  for (const [i, g] of Object.entries(C.pending)) {
    if (!m.guesses?.[i]?.[C.me] && !C.sending[i] && Date.now() - (C.lastSend[i] || 0) > 3000) sendGuess(Number(i), g);
  }
  if (st.phase === 'result' && !st.last && st.nextAt == null) {
    const i = st.round;
    const responsible = isHost || Date.now() - C.completeAt[i] > 6000;
    if (responsible && !C.scheduling[i] && !(m.starts.length > i + 1)) {
      C.scheduling[i] = true;
      mutate(mm => {
        if (mm.status !== 'running' || mm.starts.length > i + 1) return false;
        mm.starts[i + 1] = store.serverNow() + RESULT_PAUSE;
      }, `Runde ${i + 2} geplant`).catch(() => {}).finally(() => { setTimeout(() => { if (C) C.scheduling[i] = false; }, 4000); });
    }
  }
  const lastDone = m.status === 'running' && m.starts.length === m.rounds && C.completeAt[m.rounds - 1] != null;
  if (lastDone && !m.saved && !C.saving) {
    const responsible = isHost || Date.now() - C.completeAt[m.rounds - 1] > 6000;
    if (responsible) finishMatch();
  }
}

// ============================== Lobby ==============================
function settingsText(m) {
  return `${esc(m.mapName || getMap(m.map).name)} · ${m.rounds} Runden · ${m.time} s pro Runde${m.mode === 'nmpz' ? ' · Standbild (NMPZ)' : ''}`;
}

function renderLobby() {
  if (!C?.m) return;
  const m = C.m;
  $('#lobby-code').textContent = m.code;
  $('#lobby-settings').innerHTML = settingsText(m);
  const isHost = C.me && C.me === m.host;
  const running = m.status === 'running';
  $('#lobby-players').innerHTML = m.order.map(pid => {
    const p = m.players[pid];
    return `<div class="lobby-player" style="--c:${esc(p.color)}">${avatar(p, 'md')}<span class="lp-name">${esc(p.name)}</span>${pid === m.host ? '<span class="lp-tag">👑 Host</span>' : ''}${pid === C.me ? '<span class="lp-tag lp-me">Du</span>' : ''}</div>`;
  }).join('');
  $('#lobby-count').textContent = `(${m.order.length})`;

  const showPick = !C.me && m.status === 'lobby';
  $('#lobby-pick').classList.toggle('hidden', !showPick);
  if (showPick) {
    const taken = new Set(m.order);
    const free = store.view().players.filter(p => !taken.has(p.id));
    $('#lobby-pick-grid').innerHTML = free.map(p => `
      <button class="player-card" data-join="${esc(p.id)}" style="--c:${esc(p.color)}">${avatar(p, 'lg')}<span class="pc-name">${esc(p.name)}</span></button>`).join('')
      + '<button class="player-card add-card" id="lobby-new"><span class="avatar avatar-lg add-av">+</span><span class="pc-name">Neuer Spieler</span></button>';
    $$('[data-join]', $('#lobby-pick-grid')).forEach(b => b.onclick = () => joinMatch(b.dataset.join));
    $('#lobby-new').onclick = () => playerDialog();
  }
  const startBtn = $('#lobby-start');
  startBtn.classList.toggle('hidden', !isHost || running);
  startBtn.textContent = m.order.length > 1 ? `Los! (${m.order.length} Spieler)` : 'Los!';
  $('#lobby-wait').classList.toggle('hidden', isHost || !C.me || running);
  $('#lobby-wait').innerHTML = `Warte, bis <b>${esc(m.players[m.host]?.name || 'der Host')}</b> den Wettkampf startet…`;
  $('#lobby-running').classList.toggle('hidden', !running || !!C.me);
  $('#lobby-leave').textContent = isHost ? 'Wettkampf abbrechen' : C.me ? 'Verlassen' : 'Zurück';
}

async function joinMatch(pid) {
  const p = store.view().players.find(x => x.id === pid);
  if (!p) return;
  try {
    await mutate(m => {
      if (m.status !== 'lobby') throw new Error('Der Wettkampf läuft schon.');
      const ex = m.players[pid];
      if (ex && ex.device !== device) throw new Error(`${p.name} ist schon von einem anderen Gerät dabei.`);
      for (const [id, x] of Object.entries(m.players)) {
        if (x.device === device && id !== pid) { delete m.players[id]; m.order = m.order.filter(o => o !== id); }
      }
      if (ex) return false;
      m.players[pid] = { name: p.name, color: p.color, emoji: p.emoji, device, joined: new Date().toISOString() };
      m.order.push(pid);
    }, `${p.name} ist beigetreten`);
    lsSet('gg.player', pid);
  } catch (e) {
    toast(esc(e.message), 'error', 5000);
  }
}

function bindLobby() {
  $('#lobby-copy').onclick = async () => {
    if (!C) return;
    const url = inviteUrl(C.code);
    if (await copyText(url)) toast('Einladungslink kopiert – wer ihn öffnet, landet direkt in der Lobby.', 'ok', 4000);
    else openModal(`<p class="modal-text">Einladungslink:</p><input class="copy-field" readonly value="${esc(url)}"><div class="modal-actions"><button class="btn btn-primary" data-x>OK</button></div>`,
      (root, close) => { root.querySelector('[data-x]').onclick = close; root.querySelector('input').select(); });
  };
  $('#lobby-start').onclick = async () => {
    if (!C?.m) return;
    if (C.m.order.length < 2 && !(await confirmDialog('Es ist noch niemand beigetreten. Trotzdem allein starten?', { ok: 'Allein starten' }))) return;
    const btn = $('#lobby-start');
    btn.disabled = true;
    try {
      await mutate(m => {
        if (m.status !== 'lobby') return false;
        m.status = 'running';
        m.startedAt = new Date().toISOString();
        m.starts = [store.serverNow() + START_DELAY];
      }, 'gestartet');
    } catch (e) {
      toast(`Start fehlgeschlagen: ${esc(e.message)}`, 'error', 6000);
    } finally { btn.disabled = false; }
  };
  $('#lobby-leave').onclick = async () => {
    if (!C?.m) return leaveTo('comp');
    const m = C.m;
    if (C.me && C.me === m.host && m.status === 'lobby') {
      if (!(await confirmDialog('Wettkampf für alle abbrechen?', { ok: 'Abbrechen', cancel: 'Zurück', danger: true }))) return;
      try { await mutate(mm => { mm.status = 'cancelled'; }, 'abgebrochen'); } catch { /* egal */ }
      return leaveTo('comp');
    }
    if (C.me && m.status === 'lobby') {
      const me = C.me;
      try { await mutate(mm => { if (!mm.players[me]) return false; delete mm.players[me]; mm.order = mm.order.filter(o => o !== me); }, `${m.players[me]?.name} hat verlassen`); } catch { /* egal */ }
    }
    leaveTo('comp');
  };
}

// ============================== Runde ==============================
function enterRound(st, changed) {
  const i = st.round;
  if (!C.me) {
    // Zuschauer (nicht beigetreten)
    if (changed) { show('comp-lobby'); renderLobby(); }
    return;
  }
  if (changed) {
    const m = C.m;
    const loc = m.locs[i];
    play.startRound({
      player: { ...m.players[C.me], id: C.me },
      loc,
      mapId: m.map,
      mode: m.mode,
      deadline: toLocal(st.deadline),
      hud: { map: m.mapName || getMap(m.map).name, round: `${i + 1} / ${m.rounds}`, score: totals(i - 1)[C.me] || 0 },
      onGuess: (guess, info) => submitGuess(i, guess, info),
      onQuit: quitRunning,
    });
    C.roundStartLocal = Date.now();
    if (guessOf(i, C.me)) { play.lockRound(); }
  }
  updateRoundStatus();
}

function updateRoundStatus() {
  if (!C?.m || C.phase !== 'round' || !C.me) return;
  const i = C.round;
  const m = C.m;
  const done = m.order.filter(pid => guessOf(i, pid)).length;
  play.setExtra(`<div class="hud-players">${m.order.map(pid => {
    const p = m.players[pid];
    const ok = !!guessOf(i, pid);
    return `<span class="hp${ok ? ' ok' : ''}" title="${esc(p.name)}${ok ? ' hat getippt' : ' überlegt noch'}">${avatar(p, 'sm')}${ok ? '<i>✓</i>' : ''}</span>`;
  }).join('')}</div>`);
  if (guessOf(i, C.me)) {
    const mine = guessOf(i, C.me);
    play.setWaiting(`✓ Getippt${mine.g ? ` nach ${fmtSec(mine.t)}` : ''} – warte auf die anderen (${done}/${m.order.length})`);
  }
}

function submitGuess(i, guess, { t }) {
  if (!C?.m || !C.me) return;
  const m = C.m;
  const [lat, lng] = m.locs[i];
  const T = m.time;
  const d = guess ? haversine(lat, lng, guess[0], guess[1]) : null;
  const acc = scoreFor(d, maxDist(m.map));
  const tt = guess ? Math.min(T, Math.round(t * 10) / 10) : T;
  const s = Math.round(acc * (1 - (1 - TIME_FACTOR_MIN) * tt / T));
  const entry = { g: guess ? [r5(guess[0]), r5(guess[1])] : null, d: d == null ? null : Math.round(d * 100) / 100, acc, t: tt, s };
  C.pending[i] = entry;
  updateRoundStatus();
  sendGuess(i, entry);
}

async function sendGuess(i, entry) {
  if (!C || C.sending[i]) return;
  const me = C.me;
  C.sending[i] = true;
  C.lastSend[i] = Date.now();
  try {
    await mutate(m => {
      m.guesses ??= {};
      m.guesses[i] ??= {};
      if (m.guesses[i][me]) return false;
      m.guesses[i][me] = entry;
    }, `${C.m.players[me]?.name} hat Runde ${i + 1} getippt`);
  } catch (e) {
    toast('Tipp wird erneut gesendet…', 'info', 2000);
  } finally {
    if (C) C.sending[i] = false;
  }
}

async function quitRunning() {
  if (!(await confirmDialog('Wettkampf verlassen? Deine restlichen Runden zählen dann 0 Punkte.', { ok: 'Verlassen', cancel: 'Weiterspielen', danger: true }))) return;
  leaveTo('comp');
}

// ============================== Rundenergebnis ==============================
function renderResult(i) {
  if (!C?.m || i == null) return;
  const m = C.m;
  const loc = m.locs[i];
  const a = [loc[0], loc[1]];
  const tot = totals(i);
  const rows = m.order.map(pid => ({ pid, p: m.players[pid], g: guessOf(i, pid), total: tot[pid] }))
    .sort((x, y) => (y.g?.s ?? -1) - (x.g?.s ?? -1) || (x.g?.t ?? 999) - (y.g?.t ?? 999));
  $('#cr-title').innerHTML = `Runde ${i + 1} <small>von ${m.rounds}</small>`;
  $('#cr-place').innerHTML = `${flagImg(loc[4])}<span class="place-name">${esc(countryName(loc[4]))}</span>`;
  $('#cr-gmaps').href = `https://www.google.com/maps/@?api=1&map_action=pano&pano=${encodeURIComponent(loc[3])}&viewpoint=${loc[0]},${loc[1]}&heading=${loc[2] || 0}`;
  $('#cr-body').innerHTML = rows.map((r, k) => `
    <tr class="${r.pid === C.me ? 'me' : ''}">
      <td class="td-rank">${r.g?.g ? medal(k + 1) : '–'}</td>
      <td><span class="cell-player">${avatar(r.p, 'sm')}<span>${esc(r.p.name)}</span></span></td>
      <td>${r.g ? (r.g.g ? fmtDist(r.g.d) : '<span class="muted">kein Tipp</span>') : '<span class="muted">…</span>'}</td>
      <td>${r.g?.g ? fmtSec(r.g.t) : '–'}</td>
      <td class="num">${r.g ? fmtNum(r.g.acc) : '–'}</td>
      <td class="num td-score">${r.g ? fmtNum(r.g.s) : '–'}</td>
      <td class="num">${fmtNum(r.total)}</td>
    </tr>`).join('');

  // Karte: nur neu einpassen, wenn neue Tipps dazugekommen sind
  const count = rows.filter(r => r.g).length;
  if (!crMap) { crMap = createMap($('#cr-map')); crOv = new Overlay(crMap); }
  crOv.clear();
  const pts = [a];
  for (const r of rows) {
    if (!r.g?.g) continue;
    const g = nearCopy(a, r.g.g);
    pts.push(g);
    crOv.line(a, g, r.p.color);
    crOv.marker(g, guessMarkerEl(r.p));
  }
  crOv.marker(a, actualMarkerEl(''));
  if (count !== C.resultCount) {
    C.resultCount = count;
    fitWithCard(crMap, pts, '.cr-card');
  }
}

function fitWithCard(map, pts, cardSel) {
  const card = document.querySelector(`.screen.active ${cardSel}`)?.getBoundingClientRect();
  fitPoints(map, pts, { padding: card ? { top: 60, bottom: 60, left: 60, right: card.width + 80 } : 60, maxZoom: 12 });
}

function tickResult(st, now) {
  const m = C.m;
  const isHost = C.me && C.me === m.host;
  const nextEl = $('#cr-next');
  $('#cr-final').classList.toggle('hidden', !st.last);
  $('#cr-skip').classList.toggle('hidden', !!st.last || !isHost);
  if (st.last) {
    nextEl.innerHTML = `🏆 Siegerehrung in ${Math.max(0, Math.ceil((C.finalAt - Date.now()) / 1000))} s`;
  } else if (st.nextAt) {
    nextEl.innerHTML = `Nächste Runde in <b>${Math.max(0, Math.ceil((st.nextAt - now) / 1000))} s</b>`;
  } else {
    const missing = m.order.filter(pid => !guessOf(st.round, pid)).length;
    nextEl.innerHTML = missing ? `Warte auf ${missing} ${missing === 1 ? 'Tipp' : 'Tipps'}…` : 'Nächste Runde wird vorbereitet…';
  }
}

function bindResult() {
  $('#cr-skip').onclick = async () => {
    if (!C?.m || C.phase !== 'result') return;
    const i = C.round;
    try {
      await mutate(m => {
        const want = store.serverNow() + 3500;
        if (m.starts.length > i + 1 && m.starts[i + 1] <= want) return false;
        m.starts[i + 1] = want;
      }, `Runde ${i + 2} vorgezogen`);
    } catch (e) { toast(esc(e.message), 'error'); }
  };
  $('#cr-final').onclick = () => { if (C) { C.finalAt = Date.now(); update(); } };
  $('#cf-hub').onclick = () => leaveTo('comp');
  $('#cf-rematch').onclick = rematch;
}

// ============================== Siegerehrung ==============================
function standings() {
  const m = C.m;
  return m.order.map(pid => {
    let total = 0, acc = 0, t = 0, tn = 0, perfect = 0;
    for (let i = 0; i < m.rounds; i++) {
      const g = guessOf(i, pid);
      if (!g) continue;
      total += g.s;
      acc += g.acc;
      if (g.g) { t += g.t; tn++; }
      if (g.acc >= 100) perfect++;
    }
    return { pid, p: m.players[pid], total, acc, t, tn, perfect };
  }).sort((a, b) => (b.total - a.total) || (a.t / Math.max(1, a.tn) - b.t / Math.max(1, b.tn)));
}

function renderFinal() {
  if (!C?.m) return;
  const m = C.m;
  const st = standings();
  const podium = [st[1], st[0], st[2]];
  $('#cf-sub').innerHTML = `${settingsText(m)} · Code ${esc(m.code)}`;
  $('#cf-podium').innerHTML = podium.map((s, k) => {
    if (!s) return '<div class="pod pod-empty"></div>';
    const place = [2, 1, 3][k];
    return `<div class="pod pod-${place}" style="--c:${esc(s.p.color)}">${avatar(s.p, place === 1 ? 'lg' : 'md')}<div class="pod-name">${esc(s.p.name)}</div><div class="pod-pts">${fmtNum(s.total)}</div><div class="pod-block">${place}</div></div>`;
  }).join('');
  $('#cf-body').innerHTML = st.map((s, k) => `
    <tr class="${s.pid === C.me ? 'me' : ''}">
      <td class="td-rank">${medal(k + 1)}</td>
      <td><span class="cell-player">${avatar(s.p, 'sm')}<span>${esc(s.p.name)}</span></span></td>
      <td class="num td-score">${fmtNum(s.total)}</td>
      <td class="num">${fmtNum(s.acc / m.rounds)}</td>
      <td class="num">${s.tn ? fmtSec(s.t / s.tn) : '–'}</td>
    </tr>`).join('');
  const saveEl = $('#cf-save');
  saveEl.className = `final-save ${m.saved ? 'save-ok' : ''}`;
  saveEl.innerHTML = m.saved ? '✓ In der Wettkampf-Bestenliste gespeichert' : '<span class="spinner-sm"></span> Ergebnis wird gespeichert…';
  $('#cf-rematch').classList.toggle('hidden', !(C.me && C.me === m.host));

  if (!cfMap) { cfMap = createMap($('#cf-map')); cfOv = new Overlay(cfMap); }
  cfOv.clear();
  const pts = [];
  m.locs.forEach((loc, i) => {
    const a = [loc[0], loc[1]];
    pts.push(a);
    for (const pid of m.order) {
      const g = guessOf(i, pid);
      if (!g?.g) continue;
      const gg = nearCopy(a, g.g);
      pts.push(gg);
      cfOv.line(a, gg, m.players[pid].color);
      cfOv.marker(gg, guessMarkerEl(m.players[pid]));
    }
    cfOv.marker(a, actualMarkerEl(String(i + 1)));
  });
  if (!C.finalFitted) { C.finalFitted = true; fitWithCard(cfMap, pts, '.cf-card'); }
}

async function finishMatch() {
  if (!C?.m || C.saving) return;
  C.saving = true;
  const m = C.m;
  const st = standings();
  const summary = {
    code: m.code, date: new Date().toISOString(), map: m.map, mapName: m.mapName, rounds: m.rounds, time: m.time, mode: m.mode, host: m.host,
    results: st.map((s, k) => ({ pid: s.pid, name: s.p.name, place: k + 1, total: s.total, acc: s.acc, t: Math.round(s.t * 10) / 10, tn: s.tn, perfect: s.perfect })),
  };
  try {
    await store.mutateFile(COMP_FILE, comp => {
      comp = comp || { v: 1, matches: [] };
      comp.matches ??= [];
      if (comp.matches.some(x => x.code === m.code)) return false;
      comp.matches.push(summary);
      return comp;
    }, `Wettkampf ${m.code}: Ergebnis (${summary.results.map(r => `${r.name} ${r.total}`).join(', ')})`, { create: true });
    await mutate(mm => {
      if (mm.saved && mm.status === 'done') return false;
      mm.saved = true;
      mm.status = 'done';
      mm.finishedAt = new Date().toISOString();
    }, 'beendet');
    hubData = null;
  } catch (e) {
    console.warn(e);
    setTimeout(() => { if (C) C.saving = false; }, 5000);
    return;
  }
  if (C) C.saving = false;
}

async function rematch() {
  if (!C?.m) return;
  const m = C.m;
  const btn = $('#cf-rematch');
  btn.disabled = true;
  try {
    const data = await newMatch({ host: m.host, map: m.map, rounds: m.rounds, time: m.time, mode: m.mode, players: m.players, order: [...m.order] });
    await mutate(mm => { mm.next = data.code; }, `Revanche → ${data.code}`).catch(() => {});
    openMatch(data.code, data);
  } catch (e) {
    toast(`Revanche fehlgeschlagen: ${esc(e.message)}`, 'error');
  } finally { btn.disabled = false; }
}
