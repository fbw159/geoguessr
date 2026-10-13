// ---------------------------------------------------------------------------
// Karten mit MapLibre GL (Vektorkarte „Natur“ von VersaTiles, deutsche Namen).
// Unsere Koordinaten sind überall [lat, lng]; MapLibre will [lng, lat].
// ---------------------------------------------------------------------------
export const STYLE_URL = 'karten/natural.json';
const WORLD_BOUNDS = [[-175, -58], [178, 76]];

export const toLngLat = ([lat, lng]) => [lng, lat];

export function createMap(container, opts = {}) {
  const map = new maplibregl.Map({
    container,
    style: STYLE_URL,
    center: [10, 25],
    zoom: 0.5,
    minZoom: -1,
    maxZoom: 18,
    attributionControl: { compact: true },
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    renderWorldCopies: true,
    fadeDuration: 0,
    ...opts,
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  // Schneller zoomen als der Standard (Mausrad 1/450, Trackpad 1/100)
  map.scrollZoom.setWheelZoomRate(1 / 200);
  map.scrollZoom.setZoomRate(1 / 40);
  map._ready = new Promise(res => (map.loaded() ? res() : map.once('load', res)));
  map._ready.then(() => addOrte(map));
  new ResizeObserver(() => map.resize()).observe(map.getContainer());
  return map;
}

// ---------------------------------------------------------------------------
// Städtenamen etwas früher zeigen: Die Vektorkacheln enthalten Städte erst ab
// Zoom 6 und Kleinstädte ab Zoom 7. Für die Stufe davor blenden wir Orte aus
// Natural Earth (gemeinfrei, karten/orte.json) ein – unterhalb der normalen
// Ortsnamen, sodass doppelte Namen automatisch ausgeblendet werden.
// ---------------------------------------------------------------------------
const ORTE_URL = 'karten/orte.json';
let orteData = null;
function loadOrte() {
  return (orteData ||= fetch(ORTE_URL)
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
    .then(rows => ({
      type: 'FeatureCollection',
      features: rows.map(([lng, lat, n, p]) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { n, p } })),
    }))
    .catch(() => (orteData = null)));
}

const orteLayer = (id, minzoom, maxzoom, filter) => ({
  id, type: 'symbol', source: 'orte', minzoom, maxzoom, filter,
  layout: {
    'text-field': ['get', 'n'],
    'text-font': ['noto_sans_regular'],
    'text-size': ['interpolate', ['linear'], ['zoom'], 5, 11, 7, 12],
    'symbol-sort-key': ['-', ['get', 'p']],
  },
  paint: { 'text-color': 'rgb(46,46,63)', 'text-halo-color': 'rgba(255,255,255,0.8)', 'text-halo-width': 2, 'text-halo-blur': 1 },
});

async function addOrte(map) {
  const data = await loadOrte();
  if (!data) return;
  try {
    if (map.getSource('orte')) return;
    map.addSource('orte', { type: 'geojson', data });
    const before = map.getLayer('label-place-neighbourhood') ? 'label-place-neighbourhood' : undefined;
    map.addLayer(orteLayer('label-orte-gross', 5, 6, ['>=', ['get', 'p'], 100000]), before); // große Städte eine Stufe früher
    map.addLayer(orteLayer('label-orte', 6, 7, ['>=', ['get', 'p'], 0]), before);            // kleinere Städte eine Stufe früher
  } catch { /* Karte wurde inzwischen entfernt */ }
}

export function guessMarkerEl(p) {
  const el = document.createElement('div');
  el.className = 'mk-guess';
  el.style.setProperty('--c', p?.color || '#fecd19');
  el.textContent = p?.emoji || '';
  if (p?.name) el.title = p.name;
  return el;
}
export function actualMarkerEl(label = '') {
  const el = document.createElement('div');
  el.className = 'mk-actual';
  el.textContent = label;
  return el;
}
export function addMarker(map, latlng, el) {
  return new maplibregl.Marker({ element: el }).setLngLat(toLngLat(latlng)).addTo(map);
}

// Tipp so verschieben, dass die Linie den kürzeren Weg (ggf. über die Datumsgrenze) nimmt
export function nearCopy(a, g) {
  let lng = g[1];
  if (lng - a[1] > 180) lng -= 360;
  else if (a[1] - lng > 180) lng += 360;
  return [g[0], lng];
}

// Marker + gestrichelte Linien, die man gemeinsam leeren kann
export class Overlay {
  constructor(map) {
    this.map = map;
    this.markers = [];
    this.lines = [];
    map._ready.then(() => {
      if (!map.getSource('ov-lines')) {
        map.addSource('ov-lines', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({
          id: 'ov-lines', type: 'line', source: 'ov-lines',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['coalesce', ['get', 'color'], '#1a1446'], 'line-width': 3, 'line-dasharray': [0.2, 2.2], 'line-opacity': 0.9 },
        });
      }
      this.#flush();
    });
  }
  clear() {
    this.markers.forEach(m => m.remove());
    this.markers = [];
    this.lines = [];
    this.#flush();
  }
  marker(latlng, el) { this.markers.push(addMarker(this.map, latlng, el)); }
  line(a, b, color) { this.lines.push({ a, b, color }); this.#flush(); }
  #flush() {
    const src = this.map.getSource('ov-lines');
    if (!src) return;
    src.setData({
      type: 'FeatureCollection',
      features: this.lines.map(l => ({
        type: 'Feature',
        properties: l.color ? { color: l.color } : {},
        geometry: { type: 'LineString', coordinates: [toLngLat(l.a), toLngLat(l.b)] },
      })),
    });
  }
}

// Ausschnitt so wählen, dass alle Punkte sichtbar sind
export function fitPoints(map, pts, { padding = 60, maxZoom = 14 } = {}) {
  map.resize();
  if (!pts.length) return;
  if (pts.length === 1) { map.jumpTo({ center: toLngLat(pts[0]), zoom: Math.min(maxZoom, 5) }); return; }
  let minLat = 90, maxLat = -90, minLng = 1e9, maxLng = -1e9;
  for (const [lat, lng] of pts) {
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
  }
  fitBox(map, [[minLat, minLng], [maxLat, maxLng]], { padding, maxZoom });
}

// box = [[minLat, minLng], [maxLat, maxLng]] oder null für die ganze Welt
export function fitBox(map, box, { padding = 10, maxZoom = 14 } = {}) {
  map.resize();
  const c = map.getContainer();
  const w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return;
  const pad = typeof padding === 'number' ? { top: padding, bottom: padding, left: padding, right: padding } : { ...padding };
  // Polsterung darf nicht größer als die Karte sein
  const fx = Math.min(1, (w - 40) / Math.max(1, pad.left + pad.right));
  const fy = Math.min(1, (h - 40) / Math.max(1, pad.top + pad.bottom));
  for (const k of ['left', 'right']) pad[k] = Math.max(0, Math.floor(pad[k] * fx));
  for (const k of ['top', 'bottom']) pad[k] = Math.max(0, Math.floor(pad[k] * fy));
  const b = box ? [[box[0][1], box[0][0]], [box[1][1], box[1][0]]] : WORLD_BOUNDS;
  try {
    map.fitBounds(b, { padding: pad, maxZoom, duration: 0 });
  } catch {
    map.jumpTo({ center: [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2], zoom: 2 });
  }
}

