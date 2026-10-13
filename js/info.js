// ---------------------------------------------------------------------------
// Erklärung der Punktevergabe (Infobox auf der Startseite + Detail-Dialog)
// Alle Beispielwerte werden mit derselben Formel berechnet wie im Spiel.
// ---------------------------------------------------------------------------
import { COMP_TIME_FACTOR_MIN, MIN_GUESSES_FOR_RANK, WORLD_MAX_DIST } from './config.js';
import { $$, esc, fmtDist, fmtNum } from './util.js';
import { getMap, loadLocations, maxDist, scoreFor } from './locations.js';
import { openModal } from './ui.js';

const FRACTIONS = [0.0005, 0.007, 0.035, 0.1, 0.2, 0.4]; // Anteile der Kartengröße für die Beispieltabellen
const COMP_EXAMPLE = { acc: 80, time: 60, at: [0, 10, 20, 30, 45, 60] };

// Auf „schöne“ Werte runden (7, 100, 500, 1.500 …)
function niceRound(km) {
  if (km < 1) return Math.max(0.1, Math.round(km * 10) / 10);
  const p = 10 ** Math.floor(Math.log10(km));
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10];
  const n = km / p;
  return steps.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a)) * p;
}

// Größte „schöne“ Entfernung, die noch 100 Punkte gibt (Volltreffer)
function fullHitDist(D) {
  const km = D * Math.log(100 / 99.5) / 10;
  if (km < 1) return Math.floor(km * 10) / 10;
  const p = 10 ** Math.floor(Math.log10(km));
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8];
  return steps.filter(x => x * p <= km).pop() * p;
}
const pct = f => `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(f * 100)} %`;

const compPoints = (acc, t, T) => Math.round(acc * (1 - (1 - COMP_TIME_FACTOR_MIN) * t / T));
const minFactorPct = Math.round(COMP_TIME_FACTOR_MIN * 100);

function distanceTable(mapId) {
  const D = maxDist(mapId);
  const rows = FRACTIONS.map((f, i) => { const d = i === 0 ? fullHitDist(D) : niceRound(D * f); return { d, s: scoreFor(d, D) }; });
  return `
    <div class="info-col">
      <div class="info-col-head">${esc(getMap(mapId).name)} <span class="muted">· Kartengröße ${fmtDist(D)}</span></div>
      <table class="info-table">
        <thead><tr><th>Tipp daneben um</th><th>Punkte</th></tr></thead>
        <tbody>${rows.map(r => `
          <tr><td>${fmtDist(r.d)}</td><td><span class="info-bar"><span style="width:${r.s}%"></span></span><b>${r.s}</b></td></tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function normalHtml(mapId) {
  const extra = mapId && mapId !== 'world' && mapId !== 'de' ? distanceTable(mapId) : '';
  const fullWorld = fmtDist(fullHitDist(WORLD_MAX_DIST));
  const fullDe = fmtDist(fullHitDist(maxDist('de')));
  return `
    <p class="info-lead">Pro Runde gibt es <b>0 bis 100 Punkte</b> – je näher dein Pin am echten Ort liegt, desto mehr.</p>
    <div class="info-formula">Punkte = 100 × e<sup>−10 × Entfernung ÷ Kartengröße</sup></div>
    <p>Die Punkte fallen zuerst schnell und dann immer langsamer (dieselbe Kurve wie bei GeoGuessr).
      Die <b>Kartengröße</b> ist die Diagonale der gewählten Karte. Deshalb kostet auf der Weltkarte ein Fehler von 100 km fast nichts,
      in Deutschland dagegen eine Menge – jede Karte ist im eigenen Maßstab gleich schwer.</p>
    <div class="info-cols">${distanceTable('world')}${distanceTable('de')}${extra}</div>
    <ul class="info-list">
      <li><b>100 Punkte = Volltreffer</b> – auf der Weltkarte bis ca. ${fullWorld}, in Deutschland bis ca. ${fullDe} daneben.</li>
      <li>Die <b>Zeit</b> spielt im normalen Spiel keine Rolle. Mit Zeitlimit wird ein gesetzter Pin bei Ablauf automatisch abgegeben; ohne Pin gibt es 0 Punkte.</li>
      <li>Die <b>Bestenliste</b> sortiert nach <b>Ø pro Guess</b> = alle Punkte ÷ Anzahl geratener Orte (0–100).
        So ist es egal, ob jemand 3, 10 oder endlos viele Runden spielt. Einen Platz gibt es ab ${MIN_GUESSES_FOR_RANK} Guesses.</li>
    </ul>`;
}

function compHtml() {
  const { acc, time, at } = COMP_EXAMPLE;
  return `
    <p class="info-lead">Im Wettkampf zählen <b>Genauigkeit und Tempo</b>.</p>
    <div class="info-formula">Punkte = Genauigkeit × Tempo-Faktor</div>
    <p>Die <b>Genauigkeit</b> (0–100) wird genau wie im normalen Spiel berechnet. Der <b>Tempo-Faktor</b> liegt bei 100 %, wenn du sofort tippst,
      und sinkt gleichmäßig auf ${minFactorPct} % am Ende der Rundenzeit. Langsam, aber genau ist also immer noch gut – schnell und daneben bringt nichts.</p>
    <div class="info-cols">
      <div class="info-col">
        <div class="info-col-head">Beispiel: Genauigkeit ${acc}, Rundenzeit ${time} s</div>
        <table class="info-table">
          <thead><tr><th>Getippt nach</th><th>Tempo-Faktor</th><th>Punkte</th></tr></thead>
          <tbody>${at.map(t => {
            const f = 1 - (1 - COMP_TIME_FACTOR_MIN) * t / time;
            const s = compPoints(acc, t, time);
            return `<tr><td>${t} s</td><td>${pct(f)}</td><td><span class="info-bar"><span style="width:${s}%"></span></span><b>${s}</b></td></tr>`;
          }).join('')}</tbody>
        </table>
      </div>
    </div>
    <ul class="info-list">
      <li><b>Kein Tipp</b> bis zum Ende der Rundenzeit = 0 Punkte. Ein gesetzter Pin wird automatisch abgegeben (mit ${minFactorPct} %).</li>
      <li><b>Sieger</b> ist, wer über alle Runden die meisten Punkte hat. Bei Gleichstand gewinnt, wer im Schnitt schneller getippt hat.</li>
      <li>Die <b>Wettkampf-Bestenliste</b> sortiert nach Siegen, danach nach Ø Punkten pro Runde. Wettkämpfe zählen <b>nicht</b> in der normalen Bestenliste.</li>
    </ul>`;
}

// Detail-Dialog mit zwei Reitern
export async function showPointsInfo(tab = 'normal', mapId = null) {
  await loadLocations();
  openModal(`
    <h2 class="modal-title">ℹ️ So werden die Punkte berechnet</h2>
    <div class="info-tabs">
      <button class="info-tab" data-tab="normal">🎯 Normales Spiel</button>
      <button class="info-tab" data-tab="comp">⚔️ Competition Mode</button>
    </div>
    <div class="info-pane" data-pane="normal">${normalHtml(mapId)}</div>
    <div class="info-pane" data-pane="comp">${compHtml()}</div>
    <div class="modal-actions"><button class="btn btn-primary" data-x>Verstanden</button></div>`, (root, close) => {
    root.closest('.modal-box').classList.add('modal-wide');
    const select = t => {
      $$('.info-tab', root).forEach(b => b.classList.toggle('sel', b.dataset.tab === t));
      $$('.info-pane', root).forEach(p => p.classList.toggle('hidden', p.dataset.pane !== t));
    };
    $$('.info-tab', root).forEach(b => b.onclick = () => select(b.dataset.tab));
    root.querySelector('[data-x]').onclick = () => { root.closest('.modal-box').classList.remove('modal-wide'); close(); };
    select(tab);
  });
}

// Kurze Infobox für die Startseite
export function renderInfoBox(el) {
  el.innerHTML = `
    <h2 class="info-box-title">ℹ️ So werden Punkte vergeben</h2>
    <div class="info-box-grid">
      <div class="info-box-item">
        <div class="info-box-head">🎯 Normales Spiel</div>
        <p>Pro Runde <b>0–100 Punkte</b> – je näher dein Pin, desto mehr. Die Größe der Karte zählt mit:
          100 km daneben bringt auf der Weltkarte noch ${scoreFor(100, WORLD_MAX_DIST)} Punkte, in Deutschland nur ${scoreFor(100, maxDist('de'))}.
          Die Bestenliste vergleicht den <b>Durchschnitt pro Guess</b>.</p>
        <button class="chip" data-info="normal">Mehr dazu</button>
      </div>
      <div class="info-box-item">
        <div class="info-box-head">⚔️ Competition Mode</div>
        <p>Genauigkeit wie im normalen Spiel <b>× Tempo-Faktor</b>: sofort getippt 100 %, am Ende der Rundenzeit ${minFactorPct} %.
          Beispiel: ${COMP_EXAMPLE.acc} Genauigkeit nach 10 von ${COMP_EXAMPLE.time} s → <b>${compPoints(COMP_EXAMPLE.acc, 10, COMP_EXAMPLE.time)} Punkte</b>.</p>
        <button class="chip" data-info="comp">Mehr dazu</button>
      </div>
    </div>`;
  $$('[data-info]', el).forEach(b => b.onclick = () => showPointsInfo(b.dataset.info));
}
