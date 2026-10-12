// ---------------------------------------------------------------------------
// Speicher: Spieler & Punktestände als JSON-Datei im GitHub-Repo (Branch "data").
// Lesen geht immer (öffentliches Repo). Schreiben braucht einen Schlüssel
// (fine-grained Token mit Contents: write nur für dieses Repo), der einmalig
// über den Einladungslink oder die Einstellungen im Browser hinterlegt wird.
// Änderungen landen zuerst in einer lokalen Warteschlange und werden dann
// hochgeladen – so geht nichts verloren, auch wenn GitHub mal hakt.
// ---------------------------------------------------------------------------
import { POINTS_VERSION, REPO } from './config.js';
import { b64decodeUtf8, b64encodeUtf8, lsDel, lsGet, lsSet, sleep, uid } from './util.js';

const K = { key: 'gg.key', cache: 'gg.db', queue: 'gg.queue' };
const API = `https://api.github.com/repos/${REPO.owner}/${REPO.repo}`;
const RAW = `https://raw.githubusercontent.com/${REPO.owner}/${REPO.repo}/${REPO.dataBranch}/${REPO.dbPath}`;

const emptyDb = () => ({ version: 1, players: [], games: [] });

// Nur Spiele mit der aktuellen Punkteskala (0–100 pro Runde) zählen
const isCurrentGame = g => g && g.pv === POINTS_VERSION;

function normalize(db) {
  if (!db || typeof db !== 'object') return emptyDb();
  return {
    version: db.version || 1,
    players: Array.isArray(db.players) ? db.players : [],
    games: Array.isArray(db.games) ? db.games.filter(isCurrentGame) : [],
  };
}

const state = {
  remote: lsGet(K.cache, null) ? normalize(lsGet(K.cache, null)) : null,
  queue: lsGet(K.queue, []),
  status: 'loading',   // loading | ok | nokey | badkey | readonly | saving | offline | error
  lastError: null,
  badKey: false,
  loadedOnce: false,
};

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { viewCache = null; for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } }

// ---------------- Schlüssel ----------------
export const getKey = () => (lsGet(K.key, '') || '').trim();
export function setKey(k) { lsSet(K.key, String(k || '').trim()); state.badKey = false; emit(); }
export function clearKey() { lsDel(K.key); state.badKey = false; emit(); }

function headers(withKey = true) {
  const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const k = withKey ? getKey() : '';
  if (k) h.Authorization = `Bearer ${k}`;
  return h;
}

// ---------------- Lesen ----------------
async function fetchRemote() {
  const url = `${API}/contents/${REPO.dbPath}?ref=${REPO.dataBranch}&_=${Date.now()}`;
  let useKey = !!getKey();
  let res;
  try {
    res = await fetch(url, { headers: headers(useKey), cache: 'no-store' });
  } catch (e) {
    throw new Error('Keine Verbindung zu GitHub');
  }
  if (res.status === 401 && useKey) {
    state.badKey = true;
    useKey = false;
    res = await fetch(url, { headers: headers(false), cache: 'no-store' });
  } else if (useKey) {
    state.badKey = false;
  }
  if (res.status === 404) return { db: emptyDb(), sha: null };
  if (!res.ok) {
    // z. B. Rate-Limit ohne Schlüssel → nur-lesend über raw.githubusercontent.com
    const raw = await fetch(RAW, { cache: 'no-store' }).catch(() => null);
    if (raw && raw.ok) return { db: normalize(await raw.json()), sha: null, readOnly: true };
    throw new Error(`GitHub antwortet mit Fehler ${res.status}`);
  }
  const j = await res.json();
  let text;
  if (j.content && j.encoding === 'base64') {
    text = b64decodeUtf8(j.content);
  } else {
    // Dateien > 1 MB kommen ohne Inhalt → über die Blob-API holen
    const b = await fetch(j.git_url, { headers: headers(useKey), cache: 'no-store' });
    if (!b.ok) throw new Error('Spielstand-Datei konnte nicht geladen werden');
    text = b64decodeUtf8((await b.json()).content);
  }
  return { db: normalize(JSON.parse(text)), sha: j.sha };
}

// ---------------- Schreiben ----------------
function serialize(db) {
  const line = x => '  ' + JSON.stringify(x);
  return `{\n "version": ${db.version || 1},\n "players": [\n${db.players.map(line).join(',\n')}\n ],\n "games": [\n${db.games.map(line).join(',\n')}\n ]\n}\n`;
}

async function putRemote(db, sha, message) {
  const body = { message, content: b64encodeUtf8(serialize(db)), branch: REPO.dataBranch };
  if (sha) body.sha = sha;
  const res = await fetch(`${API}/contents/${REPO.dbPath}`, {
    method: 'PUT',
    headers: { ...headers(true), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 409 || res.status === 422) { const e = new Error('Konflikt'); e.conflict = true; throw e; }
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    const e = new Error('Schlüssel ungültig oder ohne Schreibrecht für dieses Repo'); e.auth = true; throw e;
  }
  if (!res.ok) throw new Error(`Speichern fehlgeschlagen (${res.status})`);
  const j = await res.json();
  return j.content?.sha || null;
}

// ---------------- Operationen ----------------
function applyOp(db, op) {
  switch (op.op) {
    case 'addPlayer':
      if (!db.players.some(p => p.id === op.data.id)) db.players.push(op.data);
      break;
    case 'updatePlayer': {
      const p = db.players.find(x => x.id === op.id);
      if (p) Object.assign(p, op.patch);
      break;
    }
    case 'deletePlayer':
      db.players = db.players.filter(p => p.id !== op.id);
      db.games = db.games.filter(g => g.player !== op.id);
      break;
    case 'addGame':
      if (isCurrentGame(op.data) && !db.games.some(g => g.id === op.data.id)) db.games.push(op.data);
      break;
  }
  return db;
}

function describe(ops, db) {
  const name = id => db.players.find(p => p.id === id)?.name || '?';
  const parts = ops.map(op => {
    switch (op.op) {
      case 'addPlayer': return `Neuer Spieler: ${op.data.name}`;
      case 'updatePlayer': return `Spieler geändert: ${name(op.id)}`;
      case 'deletePlayer': return 'Spieler gelöscht';
      case 'addGame': return `Spiel: ${name(op.data.player)} – ${op.data.score.toLocaleString('de-DE')} Punkte (${op.data.mapName})`;
      default: return op.op;
    }
  });
  return parts.length === 1 ? parts[0] : `${parts.length} Änderungen: ${parts.join(' · ')}`.slice(0, 250);
}

let viewCache = null;
export function view() {
  if (viewCache) return viewCache;
  const db = normalize(JSON.parse(JSON.stringify(state.remote || emptyDb())));
  for (const op of state.queue) applyOp(db, op);
  viewCache = db;
  return db;
}

export function status() {
  return {
    status: state.status,
    pending: state.queue.length,
    lastError: state.lastError,
    hasKey: !!getKey(),
    loadedOnce: state.loadedOnce,
  };
}

let flushing = null;
export function flush() {
  if (!flushing) flushing = doFlush().finally(() => { flushing = null; });
  return flushing;
}

async function doFlush() {
  if (!state.queue.length) return true;
  if (!getKey()) { state.status = 'nokey'; emit(); return false; }
  const ops = state.queue.slice();
  state.status = 'saving'; emit();
  for (let attempt = 0; attempt < 7; attempt++) {
    try {
      const { db, sha, readOnly } = await fetchRemote();
      if (state.badKey) { state.status = 'badkey'; state.lastError = 'Schlüssel ungültig'; emit(); return false; }
      if (readOnly) throw new Error('GitHub ist gerade nicht erreichbar');
      for (const op of ops) applyOp(db, op);
      await putRemote(db, sha, describe(ops, db));
      state.remote = db;
      lsSet(K.cache, db);
      const done = new Set(ops.map(o => o.oid));
      state.queue = state.queue.filter(o => !done.has(o.oid));
      lsSet(K.queue, state.queue);
      state.status = 'ok'; state.lastError = null; state.loadedOnce = true;
      emit();
      if (state.queue.length) return doFlush(); // in der Zwischenzeit neu dazugekommen
      return true;
    } catch (e) {
      if (e.conflict) { await sleep(500 + Math.random() * 1200 * (attempt + 1)); continue; }
      if (e.auth) { state.status = 'badkey'; state.lastError = e.message; emit(); return false; }
      state.status = navigator.onLine === false ? 'offline' : 'error';
      state.lastError = e.message;
      emit();
      return false;
    }
  }
  state.status = 'error'; state.lastError = 'Zu viele gleichzeitige Änderungen – versuche es gleich nochmal';
  emit();
  return false;
}

function enqueue(op) {
  op.oid = uid('o');
  state.queue.push(op);
  lsSet(K.queue, state.queue);
  emit();
  return flush();
}

// ---------------- Öffentliche API ----------------
export async function refresh() {
  try {
    const { db, readOnly } = await fetchRemote();
    state.remote = db;
    lsSet(K.cache, db);
    state.loadedOnce = true;
    if (state.badKey) state.status = 'badkey';
    else if (!getKey()) state.status = 'nokey';
    else state.status = readOnly ? 'readonly' : 'ok';
    state.lastError = null;
    emit();
    if (state.queue.length && getKey() && !state.badKey) flush();
    return true;
  } catch (e) {
    state.status = navigator.onLine === false ? 'offline' : 'error';
    state.lastError = e.message;
    emit();
    return false;
  }
}

export function addPlayer({ name, color, emoji }) {
  const data = { id: uid('p'), name: String(name).trim().slice(0, 24), color, emoji, created: new Date().toISOString() };
  enqueue({ op: 'addPlayer', data });
  return data.id;
}
export function updatePlayer(id, patch) { return enqueue({ op: 'updatePlayer', id, patch }); }
export function deletePlayer(id) { return enqueue({ op: 'deletePlayer', id }); }
export function addGame(game) { return enqueue({ op: 'addGame', data: game }); }

// Prüft, ob ein Schlüssel Schreibrechte hat – ohne etwas zu verändern:
// PUT mit absichtlich falscher sha → 409 heißt "berechtigt", 401/403/404 heißt "nicht berechtigt".
export async function testKey(key) {
  try {
    const res = await fetch(`${API}/contents/${REPO.dbPath}`, {
      method: 'PUT',
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${key.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Schlüsseltest', content: b64encodeUtf8(serialize(view())), sha: '0000000000000000000000000000000000000000', branch: REPO.dataBranch }),
    });
    if (res.status === 409 || res.status === 422) return { ok: true };
    if (res.ok) return { ok: true };
    if (res.status === 401) return { ok: false, reason: 'Der Schlüssel ist ungültig oder abgelaufen.' };
    return { ok: false, reason: 'Der Schlüssel hat keine Schreibrechte für dieses Repo (Contents: Read and write fehlt?).' };
  } catch {
    return { ok: false, reason: 'GitHub ist gerade nicht erreichbar.' };
  }
}

// ---------------------------------------------------------------------------
// Allgemeine JSON-Dateien auf dem Daten-Branch (für den Competition Mode)
// ---------------------------------------------------------------------------
// Serverzeit: aus dem Commit-Datum der eigenen Schreibzugriffe geschätzt.
// Nur wenn die PC-Uhr deutlich abweicht (> 1,5 s), wird korrigiert.
let serverOffset = 0;
const offsets = [];
export const serverNow = () => Date.now() + serverOffset;
function noteServerDate(dateStr, t0, t1) {
  const s = Date.parse(dateStr);
  if (!s) return;
  offsets.push(s + 500 - (t0 + t1) / 2); // Commit-Zeit hat nur Sekunden → +0,5 s
  if (offsets.length > 9) offsets.shift();
  const med = [...offsets].sort((a, b) => a - b)[Math.floor(offsets.length / 2)];
  serverOffset = Math.abs(med) > 1500 ? med : 0;
}

async function decodeContent(j, useKey) {
  if (j.content && j.encoding === 'base64') return b64decodeUtf8(j.content);
  const b = await fetch(j.git_url, { headers: headers(useKey), cache: 'no-store' });
  if (!b.ok) throw new Error('Datei konnte nicht geladen werden');
  return b64decodeUtf8((await b.json()).content);
}

// Liest eine Datei. Mit etag: bei unveränderter Datei { notModified: true } (zählt nicht gegen GitHubs Limit).
export async function readFile(path, etag = null) {
  const h = headers(true);
  if (etag) h['If-None-Match'] = etag;
  let res;
  try {
    res = await fetch(`${API}/contents/${path}?ref=${REPO.dataBranch}`, { headers: h, cache: 'no-store' });
  } catch {
    throw new Error('Keine Verbindung zu GitHub');
  }
  if (res.status === 304) return { notModified: true, etag };
  if (res.status === 404) return { data: null, sha: null, etag: null };
  if (!res.ok) throw new Error(`GitHub antwortet mit Fehler ${res.status}`);
  const j = await res.json();
  return { data: JSON.parse(await decodeContent(j, true)), sha: j.sha, etag: res.headers.get('ETag') };
}

// Schreibt eine Datei (sha = null → neu anlegen; existiert sie schon, gibt es einen Konflikt)
export async function writeFile(path, data, sha, message) {
  const body = { message, content: b64encodeUtf8(JSON.stringify(data)), branch: REPO.dataBranch };
  if (sha) body.sha = sha;
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(`${API}/contents/${path}`, {
      method: 'PUT',
      headers: { ...headers(true), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Keine Verbindung zu GitHub');
  }
  const t1 = Date.now();
  if (res.status === 409 || res.status === 422) { const e = new Error('Konflikt'); e.conflict = true; throw e; }
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    const e = new Error('Schlüssel fehlt, ist ungültig oder hat kein Schreibrecht'); e.auth = true; throw e;
  }
  if (!res.ok) throw new Error(`Speichern fehlgeschlagen (${res.status})`);
  const j = await res.json();
  if (j.commit?.committer?.date) noteServerDate(j.commit.committer.date, t0, t1);
  return { sha: j.content?.sha || null };
}

// Lesen → ändern → schreiben, bei gleichzeitigen Änderungen automatisch wiederholen.
// fn(draft) ändert draft (oder gibt ein neues Objekt zurück); return false = nichts zu tun.
export async function mutateFile(path, fn, message, { create = false } = {}) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const cur = await readFile(path);
    if (cur.data == null && !create) { const e = new Error('Datei nicht gefunden'); e.notFound = true; throw e; }
    const draft = cur.data == null ? null : JSON.parse(JSON.stringify(cur.data));
    const out = fn(draft);
    if (out === false) return { data: cur.data, unchanged: true };
    const next = out === undefined ? draft : out;
    try {
      await writeFile(path, next, cur.sha, message);
      return { data: next };
    } catch (e) {
      if (!e.conflict) throw e;
      await sleep(250 + Math.random() * 600 * (attempt + 1));
    }
  }
  throw new Error('Zu viele gleichzeitige Änderungen – bitte gleich nochmal versuchen');
}
