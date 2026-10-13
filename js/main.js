// ---------------------------------------------------------------------------
// Einstieg: Spielerauswahl, Spiel-Setup, Bestenliste, Einstellungen
// ---------------------------------------------------------------------------
import { DEFAULT_PREFS, MAPS, MAX_ROUND_SCORE, MIN_GUESSES_FOR_RANK, PLAYER_COLORS, PLAYER_EMOJIS, REPO, SITE_URL } from './config.js';
import { $, $$, b64url, copyText, countryName, esc, flagImg, fmtDate, fmtDist, fmtNum, fmtTime, lsGet, lsSet, unb64url } from './util.js';
import { countryList, getMap, loadLocations, pool } from './locations.js';
import * as store from './storage.js';
import { avatar, confirmDialog, currentScreen, openModal, show, toast } from './ui.js';
import { gameActive, initGame, startGame } from './game.js';
import { initPlayView } from './playview.js';
import { compActive, initCompetition, openMatch, renderHub } from './competition.js';
import { renderInfoBox, showPointsInfo } from './info.js';

const prefs = { ...DEFAULT_PREFS, ...lsGet('gg.prefs', {}) };
let currentPlayerId = lsGet('gg.player', null);
let challenge = null;
let keyFromLink = false;
let pendingMatch = null;
let locationsReady = false;
let lbSort = 'avgRound';

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new?' + new URLSearchParams({
  name: 'GeoGuessr Spielstaende',
  description: `Schreibzugriff für die Punktestände von ${REPO.owner}/${REPO.repo} (nur dieses Repo auswählen!)`,
  expires_in: 'none',
  contents: 'write',
}).toString();

// ============================== Start ==============================
async function boot() {
  readHash();
  initPlayView();
  initGame({ navigate });
  initCompetition({ navigate, playerDialog });
  bindNav();
  bindFullscreen();
  bindSetup();
  bindLeaderboard();
  bindSettings();
  store.onChange(onStoreChange);
  window.addEventListener('hashchange', async () => {
    if (!readHash() || gameActive() || compActive()) return;
    if (keyFromLink) { await store.refresh(); await checkKeyFromLink(); }
    if (pendingMatch) { const code = pendingMatch; pendingMatch = null; openMatch(code); }
    else navigate('home');
  });

  navigate('home');
  renderSyncBadge();

  loadLocations()
    .then(() => { locationsReady = true; renderInfoBox($('#points-info')); if (currentScreen() === 'setup') renderSetup(); })
    .catch(e => toast(`Orte konnten nicht geladen werden: ${esc(e.message)}`, 'error', 10000));

  await store.refresh();
  if (keyFromLink) await checkKeyFromLink();
  if (pendingMatch) { const code = pendingMatch; pendingMatch = null; openMatch(code); }
  setInterval(() => { if (store.status().pending && store.status().hasKey) store.flush(); }, 60000);
  window.addEventListener('online', () => store.flush());
  window.addEventListener('beforeunload', e => { if (gameActive() || compActive()) { e.preventDefault(); e.returnValue = ''; } });
}

async function checkKeyFromLink() {
  keyFromLink = false;
  const r = await store.testKey(store.getKey());
  if (r.ok) toast('🔑 Schlüssel gespeichert – eure Punkte werden ab jetzt automatisch gespeichert.', 'ok', 6000);
  else toast(`Der Schlüssel aus dem Link funktioniert nicht: ${esc(r.reason)}`, 'error', 9000);
  store.flush();
}

function readHash() {
  if (!location.hash || location.hash.length < 3) return false;
  const h = new URLSearchParams(location.hash.slice(1));
  let handled = false;
  if (h.get('key')) {
    const k = h.get('key').trim();
    // Gleicher Schlüssel wie schon gespeichert → nichts tun (Link darf beliebig oft geöffnet werden)
    if (k !== store.getKey()) { store.setKey(k); keyFromLink = true; }
    handled = true;
  }
  if (h.get('m')) {
    const code = h.get('m').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length === 4) pendingMatch = code;
    handled = true;
  }
  if (h.get('c')) {
    try {
      const c = unb64url(h.get('c'));
      if (c && c.m && c.s) challenge = c;
    } catch { toast('Der Challenge-Link ist ungültig.', 'error'); }
    handled = true;
  }
  if (handled) history.replaceState(null, '', location.pathname + location.search);
  return handled;
}

function navigate(screen) {
  if (screen === 'setup' && !currentPlayer()) screen = 'home';
  if (screen === 'home') renderHome();
  if (screen === 'setup') renderSetup();
  if (screen === 'leaderboard') renderLeaderboard();
  if (screen === 'settings') renderSettings();
  if (screen === 'comp') renderHub();
  show(screen);
}

// Vollbild: Knöpfe mit [data-fs]; mit ?vollbild in der Adresse geht es beim ersten Klick automatisch in den Vollbildmodus
function bindFullscreen() {
  const supported = !!document.documentElement.requestFullscreen;
  const update = () => $$('[data-fs]').forEach(b => {
    b.classList.toggle('on', !!document.fullscreenElement);
    b.title = document.fullscreenElement ? 'Vollbild beenden' : 'Vollbild';
  });
  if (!supported) { $$('[data-fs]').forEach(b => b.classList.add('hidden')); return; }
  document.addEventListener('click', e => {
    if (!e.target.closest('[data-fs]')) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  });
  document.addEventListener('fullscreenchange', update);
  if (new URLSearchParams(location.search).has('vollbild')) {
    const go = e => {
      if (e.target.closest?.('[data-fs]')) return;
      document.removeEventListener('pointerdown', go, true);
      if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    };
    document.addEventListener('pointerdown', go, true);
  }
  update();
}

function bindNav() {
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-nav]');
    if (!t) return;
    e.preventDefault();
    navigate(t.dataset.nav);
  });
  $('#sync-badge').onclick = () => navigate('settings');
}

function onStoreChange() {
  renderSyncBadge();
  const s = currentScreen();
  if (s === 'home') renderHome();
  else if (s === 'leaderboard') renderLeaderboard();
  else if (s === 'settings') renderSettings();
  else if (s === 'setup') renderSetupPlayer();
}

const currentPlayer = () => store.view().players.find(p => p.id === currentPlayerId) || null;
const medal = r => r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : `#${r}`;

// ============================== Statistik ==============================
// Rangfolge nach Ø pro Guess; Platz erst ab MIN_GUESSES_FOR_RANK Guesses
function rankByAverage(stats) {
  return stats.filter(s => s.rounds >= MIN_GUESSES_FOR_RANK)
    .sort((a, b) => (b.avgRound - a.avgRound) || (b.rounds - a.rounds));
}

function playerStats(db, mapFilter = null) {
  const by = new Map(db.players.map(p => [p.id, {
    player: p, total: 0, games: 0, rounds: 0, bestPct: 0, best: 0, bestMax: 0, perfect: 0, distSum: 0, distN: 0, last: null,
  }]));
  for (const g of db.games) {
    if (mapFilter && g.map !== mapFilter) continue;
    const s = by.get(g.player);
    if (!s) continue;
    const n = g.rounds?.length || 0;
    s.total += g.score || 0;
    s.games++;
    s.rounds += n;
    const pct = n ? g.score / (n * MAX_ROUND_SCORE) : 0;
    if (pct > s.bestPct || (pct === s.bestPct && g.score > s.best)) { s.bestPct = pct; s.best = g.score; s.bestMax = n * MAX_ROUND_SCORE; }
    for (const r of g.rounds || []) {
      if (r.s >= MAX_ROUND_SCORE) s.perfect++;
      if (r.d != null) { s.distSum += r.d; s.distN++; }
    }
    if (!s.last || g.date > s.last) s.last = g.date;
  }
  return [...by.values()].map(s => ({ ...s, avgRound: s.rounds ? s.total / s.rounds : 0, avgDist: s.distN ? s.distSum / s.distN : null }));
}

// ============================== Sync-Anzeige ==============================
function renderSyncBadge() {
  const st = store.status();
  const el = $('#sync-badge');
  const pend = st.pending ? ` (${st.pending})` : '';
  const map = {
    loading: ['⏳ Lade…', 'neutral', 'Spielstände werden geladen'],
    ok: ['☁️ Synchron', 'good', 'Alles ist im GitHub-Repo gespeichert'],
    saving: ['⏳ Speichere…', 'neutral', 'Wird ins GitHub-Repo hochgeladen'],
    nokey: [`💾 Nur lokal${pend}`, 'warn', 'Dieser Browser hat noch keinen Schlüssel – Punkte werden nur hier gesichert. Klicken für Details.'],
    badkey: [`⚠️ Schlüssel ungültig${pend}`, 'bad', 'Der hinterlegte Schlüssel funktioniert nicht. Klicken für Details.'],
    readonly: ['👁️ Nur lesen', 'warn', 'GitHub ist gerade nur lesend erreichbar'],
    offline: [`⚠️ Offline${pend}`, 'bad', st.lastError || 'Keine Verbindung'],
    error: [`⚠️ Sync-Fehler${pend}`, 'bad', st.lastError || 'Fehler'],
  };
  const [txt, cls, title] = map[st.status] || map.loading;
  el.textContent = txt;
  el.className = `sync-badge sb-${cls}`;
  el.title = title;
}

// ============================== Home ==============================
function renderHome() {
  const db = store.view();
  const st = store.status();
  const stats = playerStats(db);
  const ranked = rankByAverage(stats);
  const rankOf = id => ranked.findIndex(s => s.player.id === id) + 1;
  const statOf = id => stats.find(s => s.player.id === id);
  const grid = $('#player-grid');

  if (!db.players.length && !st.loadedOnce && st.status !== 'error' && st.status !== 'offline') {
    grid.innerHTML = '<div class="loading-card"><div class="spinner"></div><span>Lade Spieler…</span></div>';
  } else {
    grid.innerHTML = db.players.map(p => {
      const s = statOf(p.id);
      const r = rankOf(p.id);
      const last = p.id === currentPlayerId;
      return `
        <button class="player-card${last ? ' last' : ''}" data-pid="${esc(p.id)}" style="--c:${esc(p.color)}">
          ${r ? `<span class="pc-rank" title="Platz ${r} nach Ø Punkten pro Guess">${medal(r)}</span>` : ''}
          ${avatar(p, 'lg')}
          <span class="pc-name">${esc(p.name)}</span>
          ${s.rounds ? `<span class="pc-avg" title="Durchschnittliche Punkte pro Guess (max. 100)">${fmtNum(s.avgRound)}<small>Ø pro Guess</small></span>` : ''}
          <span class="pc-stats">${s.rounds ? `${fmtNum(s.rounds)} ${s.rounds === 1 ? 'Guess' : 'Guesses'} · ${s.games} ${s.games === 1 ? 'Spiel' : 'Spiele'}` : 'noch nicht gespielt'}</span>
          ${last ? '<span class="pc-last">zuletzt gespielt</span>' : ''}
        </button>`;
    }).join('') + `
      <button class="player-card add-card" id="btn-add-player">
        <span class="avatar avatar-lg add-av">+</span>
        <span class="pc-name">Neuer Spieler</span>
        <span class="pc-stats">Einfach Namen eingeben</span>
      </button>`;
    $$('[data-pid]', grid).forEach(b => b.onclick = () => selectPlayer(b.dataset.pid));
    $('#btn-add-player').onclick = () => playerDialog();
  }
  renderChallengeBanner();
}

function renderChallengeBanner() {
  const el = $('#challenge-banner');
  if (!challenge) { el.classList.add('hidden'); return; }
  const m = getMap(challenge.m);
  el.classList.remove('hidden');
  el.innerHTML = `
    <span class="cb-icon">🎯</span>
    <div class="cb-text">
      <b>Challenge${challenge.n ? ` von ${esc(challenge.n)}` : ''}</b>: ${esc(m.name)} · ${challenge.r} Runden${challenge.t ? ` · ${fmtTime(challenge.t)} min` : ''}${challenge.mo === 'nmpz' ? ' · NMPZ' : ''}${challenge.p != null ? ` · zu schlagen: <b>${fmtNum(challenge.p)}</b> Punkte` : ''}
      <div class="muted">Wähle deinen Spieler, um genau dieselben Orte zu spielen.</div>
    </div>
    <button class="chip" id="cb-close" title="Challenge verwerfen">✕</button>`;
  $('#cb-close').onclick = () => { challenge = null; renderChallengeBanner(); };
}

async function selectPlayer(id) {
  currentPlayerId = id;
  lsSet('gg.player', id);
  if (challenge) {
    if (!locationsReady) { toast('Orte werden noch geladen …', 'info', 1500); await loadLocations(); locationsReady = true; }
    const c = challenge;
    challenge = null;
    const rounds = Math.max(1, Math.min(20, parseInt(c.r, 10) || 5));
    startGame({ player: currentPlayer(), mapId: c.m, rounds, time: parseInt(c.t, 10) || 0, mode: c.mo === 'nmpz' ? 'nmpz' : 'move', seed: String(c.s), challenge: c });
    return;
  }
  navigate('setup');
}

// ============================== Spieler-Dialog ==============================
function playerDialog(existing = null) {
  const db = store.view();
  let color = existing?.color || PLAYER_COLORS[db.players.length % PLAYER_COLORS.length];
  let emoji = existing?.emoji || PLAYER_EMOJIS[(db.players.length + 2) % PLAYER_EMOJIS.length];
  openModal(`
    <h2 class="modal-title">${existing ? 'Spieler bearbeiten' : 'Neuer Spieler'}</h2>
    <div class="pd-preview" id="pd-preview"></div>
    <label class="field"><span>Name</span><input id="pd-name" maxlength="24" autocomplete="off" value="${esc(existing?.name || '')}" placeholder="z. B. Max"></label>
    <div class="field"><span>Farbe</span><div class="swatches" id="pd-colors">${PLAYER_COLORS.map(c => `<button type="button" class="swatch" data-c="${c}" style="--c:${c}" title="${c}"></button>`).join('')}</div></div>
    <div class="field"><span>Symbol</span><div class="emojis" id="pd-emojis">${PLAYER_EMOJIS.map(e => `<button type="button" class="emoji-btn" data-e="${e}">${e}</button>`).join('')}</div></div>
    <p class="pd-error" id="pd-error"></p>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-x>Abbrechen</button>
      <button class="btn btn-primary" data-ok>${existing ? 'Speichern' : 'Anlegen'}</button>
    </div>`, (root, close) => {
    const name = $('#pd-name', root);
    const paint = () => {
      $('#pd-preview', root).innerHTML = `${avatar({ color, emoji, name: name.value }, 'lg')}<span class="pd-name">${esc(name.value.trim() || 'Name')}</span>`;
      $$('.swatch', root).forEach(b => b.classList.toggle('sel', b.dataset.c === color));
      $$('.emoji-btn', root).forEach(b => b.classList.toggle('sel', b.dataset.e === emoji));
    };
    paint();
    name.oninput = paint;
    $$('.swatch', root).forEach(b => b.onclick = () => { color = b.dataset.c; paint(); });
    $$('.emoji-btn', root).forEach(b => b.onclick = () => { emoji = b.dataset.e; paint(); });
    $('[data-x]', root).onclick = close;
    const submit = () => {
      const n = name.value.trim().replace(/\s+/g, ' ');
      const err = $('#pd-error', root);
      if (!n) { err.textContent = 'Bitte einen Namen eingeben.'; name.focus(); return; }
      const dupe = store.view().players.some(p => p.id !== existing?.id && p.name.toLowerCase() === n.toLowerCase());
      if (dupe) { err.textContent = 'Diesen Namen gibt es schon.'; name.focus(); return; }
      close();
      if (existing) {
        store.updatePlayer(existing.id, { name: n, color, emoji });
        toast(`${esc(n)} gespeichert`, 'ok');
      } else {
        store.addPlayer({ name: n, color, emoji });
        toast(`<b>${esc(n)}</b> ist angelegt – zum Spielen einfach anklicken.`, 'ok');
      }
    };
    $('[data-ok]', root).onclick = submit;
    name.onkeydown = e => { if (e.key === 'Enter') submit(); };
  });
}

// ============================== Setup ==============================
function renderSetupPlayer() {
  const p = currentPlayer();
  if (p) $('#setup-player').innerHTML = `${avatar(p, 'sm')}<span>${esc(p.name)}</span>`;
}

function renderSetup() {
  if (!currentPlayer()) return;
  renderSetupPlayer();
  $('#map-grid').innerHTML = MAPS.map(m => `
    <button class="map-card${prefs.map === m.id ? ' sel' : ''}" data-map="${m.id}">
      <span class="mc-icon">${m.icon}</span>
      <span class="mc-name">${esc(m.name)}</span>
      <span class="mc-desc">${esc(m.desc)}</span>
      ${locationsReady ? `<span class="mc-count">${fmtNum(pool(m.id).length)} Orte</span>` : ''}
    </button>`).join('');
  const sel = $('#country-select');
  if (locationsReady) {
    sel.innerHTML = '<option value="">– Land auswählen –</option>' + countryList().map(c =>
      `<option value="c-${c.cc}"${prefs.map === `c-${c.cc}` ? ' selected' : ''}>${esc(c.name)} (${fmtNum(c.n)} Orte)</option>`).join('');
  } else sel.innerHTML = '<option>Lade Länder…</option>';
  sel.classList.toggle('sel', prefs.map.startsWith('c-'));
  $$('.seg').forEach(seg => {
    const k = seg.dataset.opt;
    $$('button', seg).forEach(b => b.classList.toggle('sel', String(prefs[k]) === b.dataset.v));
  });
  const btn = $('#btn-start');
  btn.disabled = !locationsReady;
  btn.textContent = locationsReady ? `Spiel starten · ${getMap(prefs.map).name}` : 'Lade Orte…';
}

function savePrefs() { lsSet('gg.prefs', prefs); renderSetup(); }

function bindSetup() {
  $('#map-grid').addEventListener('click', e => {
    const b = e.target.closest('[data-map]');
    if (!b) return;
    prefs.map = b.dataset.map;
    savePrefs();
  });
  $('#country-select').addEventListener('change', e => {
    prefs.map = e.target.value || 'world';
    savePrefs();
  });
  $$('.seg').forEach(seg => seg.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const k = seg.dataset.opt;
    prefs[k] = k === 'mode' ? b.dataset.v : Number(b.dataset.v);
    savePrefs();
  }));
  $('#setup-info').onclick = () => showPointsInfo('normal', prefs.map);
  $('#btn-start').onclick = () => {
    const p = currentPlayer();
    if (!p || !locationsReady) return;
    if (!pool(prefs.map).length) { toast('Für diese Karte gibt es keine Orte.', 'error'); return; }
    startGame({ player: p, mapId: prefs.map, rounds: prefs.rounds, time: prefs.time, mode: prefs.mode });
  };
}

// ============================== Bestenliste ==============================
function renderLeaderboard() {
  const db = store.view();
  const sel = $('#lb-map');
  const before = sel.value || 'all';
  const usedMaps = [...new Set(db.games.map(g => g.map))];
  sel.innerHTML = '<option value="all">Alle Karten</option>' + usedMaps.map(id =>
    `<option value="${esc(id)}">${esc(db.games.find(g => g.map === id)?.mapName || getMap(id).name)}</option>`).join('');
  sel.value = usedMaps.includes(before) ? before : 'all';
  const filter = sel.value === 'all' ? null : sel.value;

  const stats = playerStats(db, filter);
  const val = s => s[lbSort];
  let played;
  if (lbSort === 'avgRound') {
    // Ø pro Guess: Platz erst ab MIN_GUESSES_FOR_RANK, danach die übrigen (ohne Platz)
    const ranked = rankByAverage(stats);
    const rest = stats.filter(s => s.games && !ranked.includes(s)).sort((a, b) => b.avgRound - a.avgRound);
    played = [...ranked.map((s, i) => ({ s, rank: i + 1 })), ...rest.map(s => ({ s, rank: 0 }))];
  } else {
    played = stats.filter(s => s.games).sort((a, b) => {
      if (lbSort === 'avgDist') return (a.avgDist ?? 1e12) - (b.avgDist ?? 1e12);
      if (lbSort === 'best') return b.bestPct - a.bestPct;
      return (val(b) - val(a)) || (b.avgRound - a.avgRound);
    }).map((s, i) => ({ s, rank: i + 1 }));
  }
  const idle = filter ? [] : stats.filter(s => !s.games);

  $$('.lb-table th[data-sort]').forEach(th => th.classList.toggle('sorted', th.dataset.sort === lbSort));
  $('#lb-body').innerHTML = played.map(({ s, rank }) => `
    <tr data-profile="${esc(s.player.id)}" class="clickable">
      <td class="td-rank">${rank ? medal(rank) : `<span class="muted rank-note" title="Platz ab ${MIN_GUESSES_FOR_RANK} Guesses">–</span>`}</td>
      <td><span class="cell-player">${avatar(s.player, 'sm')}<span>${esc(s.player.name)}</span></span></td>
      <td class="num key-val">${fmtNum(s.avgRound)}</td>
      <td class="num">${fmtNum(s.rounds)}${!rank && lbSort === 'avgRound' ? ` <span class="muted rank-note">(ab ${MIN_GUESSES_FOR_RANK})</span>` : ''}</td>
      <td class="num">${s.games}</td>
      <td class="num">${fmtNum(s.total)}</td>
      <td class="num">${Math.round(s.bestPct * 100)} % <span class="muted small">(${fmtNum(s.best)})</span></td>
      <td class="num">${s.perfect}</td>
      <td class="num">${fmtDist(s.avgDist)}</td>
    </tr>`).join('') + idle.map(s => `
    <tr data-profile="${esc(s.player.id)}" class="clickable idle">
      <td class="td-rank">–</td>
      <td><span class="cell-player">${avatar(s.player, 'sm')}<span>${esc(s.player.name)}</span></span></td>
      <td class="num muted" colspan="7">noch keine Spiele</td>
    </tr>`).join('') || '<tr><td colspan="9" class="muted center">Noch keine Spiele – los geht’s!</td></tr>';

  const games = db.games.filter(g => !filter || g.map === filter).sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 25);
  const pl = id => db.players.find(p => p.id === id);
  $('#recent-games').innerHTML = games.map(g => {
    const p = pl(g.player);
    const pct = g.max ? g.score / g.max : 0;
    return `
      <button class="game-row" data-game="${esc(g.id)}">
        ${avatar(p, 'sm')}
        <span class="gr-name">${esc(p?.name || '?')}</span>
        <span class="gr-map">${esc(g.mapName || getMap(g.map).name)} · ${g.rounds.length}${g.endless ? ' (∞)' : ''} R.${g.mode === 'nmpz' ? ' · NMPZ' : ''}${g.challenge ? ' · 🎯' : ''}</span>
        <span class="gr-bar"><span style="width:${Math.round(pct * 100)}%"></span></span>
        <span class="gr-score">${fmtNum(g.score)} <small class="muted">Ø ${fmtNum(g.score / Math.max(1, g.rounds.length))}</small></span>
        <span class="gr-date muted">${fmtDate(g.date)}</span>
      </button>`;
  }).join('') || '<p class="muted">Noch keine Spiele.</p>';
}

function bindLeaderboard() {
  $('#lb-map').addEventListener('change', renderLeaderboard);
  $$('.lb-table th[data-sort]').forEach(th => th.onclick = () => { lbSort = th.dataset.sort; renderLeaderboard(); });
  $('#lb-body').addEventListener('click', e => {
    const tr = e.target.closest('[data-profile]');
    if (tr) profileDialog(tr.dataset.profile);
  });
  $('#recent-games').addEventListener('click', e => {
    const b = e.target.closest('[data-game]');
    if (b) gameDialog(b.dataset.game);
  });
  $('#btn-refresh').onclick = async () => {
    const ok = await store.refresh();
    toast(ok ? 'Aktualisiert' : 'GitHub gerade nicht erreichbar', ok ? 'ok' : 'error', 1800);
  };
}

function profileDialog(pid) {
  const db = store.view();
  const p = db.players.find(x => x.id === pid);
  if (!p) return;
  const s = playerStats(db).find(x => x.player.id === pid);
  const games = db.games.filter(g => g.player === pid).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  // Lieblingskarte & bestes Land
  const mapCount = {};
  games.forEach(g => { mapCount[g.mapName || g.map] = (mapCount[g.mapName || g.map] || 0) + 1; });
  const favMap = Object.entries(mapCount).sort((a, b) => b[1] - a[1])[0]?.[0];
  openModal(`
    <div class="profile-head">${avatar(p, 'lg')}<div><h2 class="modal-title">${esc(p.name)}</h2><div class="muted">dabei seit ${fmtDate(p.created).split(',')[0]}</div></div></div>
    <div class="tiles">
      <div class="tile tile-key"><b>${fmtNum(s.avgRound)}</b><span>Ø pro Guess</span></div>
      <div class="tile"><b>${fmtNum(s.rounds)}</b><span>Guesses (${s.games} ${s.games === 1 ? 'Spiel' : 'Spiele'})</span></div>
      <div class="tile"><b>${fmtNum(s.total)}</b><span>Gesamtpunkte</span></div>
      <div class="tile"><b>${s.perfect}</b><span>Volltreffer</span></div>
      <div class="tile"><b>${fmtDist(s.avgDist)}</b><span>Ø Entfernung</span></div>
      <div class="tile"><b>${esc(favMap || '–')}</b><span>Lieblingskarte</span></div>
    </div>
    <h3 class="h3">Letzte Spiele</h3>
    <div class="profile-games">${games.slice(0, 30).map(g => `
      <button class="game-row" data-game="${esc(g.id)}">
        <span class="gr-map">${esc(g.mapName || g.map)} · ${g.rounds.length}${g.endless ? ' (∞)' : ''} R.${g.mode === 'nmpz' ? ' · NMPZ' : ''}</span>
        <span class="gr-bar"><span style="width:${Math.round((g.max ? g.score / g.max : 0) * 100)}%"></span></span>
        <span class="gr-score">${fmtNum(g.score)} <small class="muted">Ø ${fmtNum(g.score / Math.max(1, g.rounds.length))}</small></span>
        <span class="gr-date muted">${fmtDate(g.date)}</span>
      </button>`).join('') || '<p class="muted">Noch keine Spiele.</p>'}</div>
    <div class="modal-actions"><button class="btn btn-primary" data-x>Schließen</button></div>`, (root, close) => {
    $('[data-x]', root).onclick = close;
    $$('[data-game]', root).forEach(b => b.onclick = () => gameDialog(b.dataset.game));
  });
}

function gameDialog(gid) {
  const db = store.view();
  const g = db.games.find(x => x.id === gid);
  if (!g) return;
  const p = db.players.find(x => x.id === g.player);
  const chUrl = g.seed ? `${SITE_URL}#c=${b64url({ m: g.map, r: g.rounds.length, t: g.time, mo: g.mode, s: g.seed, n: p?.name, p: g.score })}` : null;
  openModal(`
    <div class="profile-head">${avatar(p, 'md')}<div><h2 class="modal-title">${fmtNum(g.score)} <small class="muted">/ ${fmtNum(g.max)}</small></h2>
      <div class="muted">${esc(p?.name || '?')} · ${esc(g.mapName || g.map)} · ${g.rounds.length} Runden${g.endless ? ' (Endlos)' : ''} · Ø ${fmtNum(g.score / Math.max(1, g.rounds.length))} pro Guess · ${fmtDate(g.date)}${g.mode === 'nmpz' ? ' · NMPZ' : ''}${g.time ? ` · ${fmtTime(g.time)} min` : ''}</div></div></div>
    <table class="rounds-table">
      <thead><tr><th>#</th><th>Ort</th><th>Entfernung</th><th>Punkte</th></tr></thead>
      <tbody>${g.rounds.map((r, i) => `<tr><td>${i + 1}</td><td><span class="cell-place">${flagImg(r.cc)}${esc(countryName(r.cc))}</span></td><td>${r.g ? fmtDist(r.d) : '<span class="muted">kein Tipp</span>'}</td><td class="td-score">${fmtNum(r.s)}</td></tr>`).join('')}</tbody>
    </table>
    <div class="modal-actions">
      ${chUrl ? '<button class="btn btn-ghost" data-ch>🔗 Diese Orte als Challenge teilen</button>' : ''}
      <button class="btn btn-primary" data-x>Schließen</button>
    </div>`, (root, close) => {
    $('[data-x]', root).onclick = close;
    const ch = $('[data-ch]', root);
    if (ch) ch.onclick = async () => { if (await copyText(chUrl)) toast('Challenge-Link kopiert', 'ok'); };
  });
}

// ============================== Einstellungen ==============================
function renderSettings() {
  const st = store.status();
  const db = store.view();
  const ks = $('#key-status');
  let html;
  if (st.hasKey && st.status === 'badkey') html = '<div class="ks ks-bad">⚠️ Der hinterlegte Schlüssel funktioniert nicht (ungültig, abgelaufen oder ohne Schreibrecht). Bitte neuen Einladungslink öffnen oder Schlüssel neu eintragen.</div>';
  else if (st.hasKey) html = '<div class="ks ks-good">✅ Dieser Browser speichert Punkte automatisch im GitHub-Repo.</div>';
  else html = '<div class="ks ks-warn">💾 Noch kein Schlüssel auf diesem Gerät – Spiele werden vorerst nur hier im Browser gesichert und automatisch hochgeladen, sobald der Schlüssel da ist.</div>';
  if (st.pending) html += `<div class="ks ks-info">⏳ ${st.pending} ${st.pending === 1 ? 'Änderung wartet' : 'Änderungen warten'} auf den Upload.${st.lastError ? ` <span class="muted">(${esc(st.lastError)})</span>` : ''}</div>`;
  ks.innerHTML = html;
  $('#key-setup').classList.toggle('hidden', st.hasKey && st.status !== 'badkey');
  $('#key-actions').classList.toggle('hidden', !st.hasKey);
  $('#token-link').href = TOKEN_URL;
  $('#repo-name-hint').textContent = `${REPO.owner}/${REPO.repo}`;
  $('#repo-link').href = `https://github.com/${REPO.owner}/${REPO.repo}`;
  $('#data-info').textContent = `${db.players.length} Spieler · ${db.games.length} Spiele gespeichert · Datei: ${REPO.dataBranch}/${REPO.dbPath}`;

  const stats = playerStats(db);
  $('#manage-players').innerHTML = db.players.map(p => {
    const s = stats.find(x => x.player.id === p.id);
    return `
      <div class="mp-row">
        ${avatar(p, 'sm')}
        <span class="mp-name">${esc(p.name)}</span>
        <span class="muted small">${s.games} ${s.games === 1 ? 'Spiel' : 'Spiele'} · ${fmtNum(s.total)} Punkte</span>
        <span class="mp-actions">
          <button class="chip" data-edit="${esc(p.id)}">✏️ Bearbeiten</button>
          <button class="chip chip-danger" data-del="${esc(p.id)}">🗑 Löschen</button>
        </span>
      </div>`;
  }).join('') + '<button class="btn btn-ghost" id="mp-add">+ Neuer Spieler</button>';
  $('#mp-add').onclick = () => playerDialog();
}

function bindSettings() {
  $('#manage-players').addEventListener('click', async e => {
    const ed = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    const db = store.view();
    if (ed) playerDialog(db.players.find(p => p.id === ed.dataset.edit));
    if (del) {
      const p = db.players.find(x => x.id === del.dataset.del);
      if (!p) return;
      const n = db.games.filter(g => g.player === p.id).length;
      if (await confirmDialog(`Spieler <b>${esc(p.name)}</b>${n ? ` und alle ${n} Spiele` : ''} wirklich löschen? Das kann nicht rückgängig gemacht werden.`, { ok: 'Löschen', danger: true })) {
        store.deletePlayer(p.id);
        if (currentPlayerId === p.id) { currentPlayerId = null; lsSet('gg.player', null); }
        toast(`${esc(p.name)} gelöscht`, 'info');
      }
    }
  });

  const saveKey = async () => {
    const input = $('#key-input');
    const key = input.value.trim();
    if (!key) { input.focus(); return; }
    const btn = $('#btn-key-save');
    btn.disabled = true; btn.textContent = 'Prüfe…';
    const r = await store.testKey(key);
    btn.disabled = false; btn.textContent = 'Speichern';
    if (!r.ok) { toast(esc(r.reason), 'error', 7000); return; }
    store.setKey(key);
    input.value = '';
    toast('🔑 Schlüssel gespeichert – Punkte werden jetzt automatisch gespeichert.', 'ok', 5000);
    await store.refresh();
    store.flush();
    renderSettings();
  };
  $('#btn-key-save').onclick = saveKey;
  $('#key-input').onkeydown = e => { if (e.key === 'Enter') saveKey(); };

  $('#btn-invite').onclick = async () => {
    const url = `${SITE_URL}#key=${encodeURIComponent(store.getKey())}`;
    if (await copyText(url)) toast('Einladungslink kopiert – einfach an deine Freunde schicken.', 'ok', 5000);
    else openModal(`<p class="modal-text">Einladungslink:</p><input class="copy-field" readonly value="${esc(url)}"><div class="modal-actions"><button class="btn btn-primary" data-x>OK</button></div>`,
      (root, close) => { $('[data-x]', root).onclick = close; $('input', root).select(); });
  };
  $('#btn-key-test').onclick = async () => {
    const r = await store.testKey(store.getKey());
    toast(r.ok ? '✅ Verbindung klappt – Schreibrecht vorhanden.' : esc(r.reason), r.ok ? 'ok' : 'error', 6000);
  };
  $('#btn-key-remove').onclick = async () => {
    if (await confirmDialog('Schlüssel von diesem Gerät entfernen? Danach werden Punkte hier nur noch lokal gesichert.', { ok: 'Entfernen', danger: true })) {
      store.clearKey();
      renderSettings();
    }
  };
  $('#btn-export').onclick = () => {
    const blob = new Blob([JSON.stringify(store.view(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `geoguessr-spielstaende-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
}

boot();
