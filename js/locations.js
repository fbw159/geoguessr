// Orte laden, Kartenpools bilden, Orte (reproduzierbar) auswählen
import { MAPS, MAX_ROUND_SCORE } from './config.js';
import { countryName, haversine, hashString, mulberry32 } from './util.js';

let rows = null;
const pools = new Map();
const dists = new Map();

export async function loadLocations() {
  if (rows) return rows;
  const res = await fetch('data/locations.json');
  if (!res.ok) throw new Error('Orte konnten nicht geladen werden');
  rows = (await res.json()).rows; // [lat, lng, heading, panoId, cc]
  return rows;
}

export function getMap(id) {
  if (id && id.startsWith('c-')) {
    const cc = id.slice(2).toUpperCase();
    return { id: `c-${cc}`, name: countryName(cc), cc, icon: '', desc: '', filter: r => r[4] === cc };
  }
  return MAPS.find(m => m.id === id) || MAPS[0];
}

export function mapName(id) { return getMap(id).name; }

export function pool(id) {
  if (!pools.has(id)) {
    const m = getMap(id);
    const idx = [];
    for (let i = 0; i < rows.length; i++) if (m.filter(rows[i])) idx.push(i);
    pools.set(id, idx);
  }
  return pools.get(id);
}

// Diagonale der Bounding-Box (km) – wie bei GeoGuessr die Basis für die Punkteformel
export function maxDist(id) {
  const m = getMap(id);
  if (m.maxDist) return m.maxDist;
  if (dists.has(id)) return dists.get(id);
  const p = pool(id);
  let minLat = 90, maxLat = -90, minA = 999, maxA = -999, minB = 999, maxB = -999;
  for (const i of p) {
    const [lat, lng] = rows[i];
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minA) minA = lng;
    if (lng > maxA) maxA = lng;
    const l2 = lng < 0 ? lng + 360 : lng; // für Karten über die Datumsgrenze
    if (l2 < minB) minB = l2;
    if (l2 > maxB) maxB = l2;
  }
  const [lo, hi] = (maxA - minA) <= (maxB - minB) ? [minA, maxA] : [minB, maxB];
  const d = Math.max(50, haversine(minLat, lo, maxLat, hi));
  dists.set(id, d);
  return d;
}

// Kartenausschnitt für die Rate-Karte (null = ganze Welt)
export function boundsOf(id) {
  const m = getMap(id);
  if (m.id === 'world') return null;
  const p = pool(id);
  let minLat = 90, maxLat = -90, minA = 999, maxA = -999, minB = 999, maxB = -999;
  for (const i of p) {
    const [lat, lng] = rows[i];
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    minA = Math.min(minA, lng); maxA = Math.max(maxA, lng);
    const l2 = lng < 0 ? lng + 360 : lng;
    minB = Math.min(minB, l2); maxB = Math.max(maxB, l2);
  }
  const [lo, hi] = (maxA - minA) <= (maxB - minB) ? [minA, maxA] : [minB, maxB];
  return [[minLat, lo], [maxLat, hi]];
}

export function scoreFor(distKm, maxD) {
  if (distKm == null || !isFinite(distKm)) return 0;
  if (distKm <= 0.025) return MAX_ROUND_SCORE;
  return Math.round(MAX_ROUND_SCORE * Math.exp(-10 * distKm / maxD));
}

// Länder mit genügend Orten für eine eigene Karte
export function countryList(min = 30) {
  const count = {};
  for (const r of rows) count[r[4]] = (count[r[4]] || 0) + 1;
  return Object.entries(count)
    .filter(([, n]) => n >= min)
    .map(([cc, n]) => ({ cc, n, name: countryName(cc) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

// Liefert eine Funktion, die nacheinander Orte zieht. Gleicher Seed + gleiche Karte
// = gleiche Orte (für Challenges). `avoid` = Set kürzlich gespielter panoIds.
export function makePicker(mapId, seed, avoid = null) {
  const p = pool(mapId);
  const rng = mulberry32(hashString(String(seed)));
  const used = new Set();
  return function next() {
    for (let tries = 0; tries < 300; tries++) {
      const i = p[Math.floor(rng() * p.length)];
      if (used.has(i)) continue;
      if (avoid && tries < 200 && avoid.has(rows[i][3])) continue;
      used.add(i);
      return rows[i];
    }
    for (const i of p) if (!used.has(i)) { used.add(i); return rows[i]; }
    return rows[p[Math.floor(rng() * p.length)]];
  };
}
