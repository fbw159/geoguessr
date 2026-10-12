// Kleine Helfer
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function uid(prefix = '') {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return prefix + Date.now().toString(36) + [...a].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 8);
}

const nf = new Intl.NumberFormat('de-DE');
export const fmtNum = n => nf.format(Math.round(n || 0));

export function fmtDist(km) {
  if (km == null || !isFinite(km)) return '–';
  if (km < 1) return `${nf.format(Math.round(km * 1000))} m`;
  if (km < 10) return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(km)} km`;
  return `${nf.format(Math.round(km))} km`;
}

const dtf = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
export const fmtDate = iso => { try { return dtf.format(new Date(iso)); } catch { return ''; } };

export function fmtTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

let regionNames = null;
export function countryName(cc) {
  if (!cc) return '';
  try {
    regionNames ??= new Intl.DisplayNames(['de'], { type: 'region' });
    return regionNames.of(cc.toUpperCase()) || cc;
  } catch { return cc; }
}
export const flagUrl = (cc, w = 40) => `https://flagcdn.com/w${w}/${String(cc).toLowerCase()}.png`;
export const flagImg = (cc, cls = 'flag') => cc ? `<img class="${cls}" src="${flagUrl(cc)}" alt="" loading="lazy" onerror="this.style.display='none'">` : '';

// Entfernung in km (Haversine)
export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371.0088, toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad, dLng = (lng2 - lng1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Reproduzierbarer Zufall (für Challenges)
export function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// UTF-8-sicheres Base64
export function b64encodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function b64decodeUtf8(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
export const b64url = obj => b64encodeUtf8(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function unb64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return JSON.parse(b64decodeUtf8(s));
}

export function lsGet(k, def) {
  try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; }
}
export function lsSet(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* egal */ }
}
export function lsDel(k) {
  try { localStorage.removeItem(k); } catch { /* egal */ }
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}
