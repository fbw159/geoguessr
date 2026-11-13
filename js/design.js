// ---------------------------------------------------------------------------
// Design-Umschalter: "Windows 95" (retro.css an) <-> "Original" (retro.css aus).
// Komplett eigenständig: keine Imports, greift nicht in Spiel, Spieler oder
// Punktestände ein. Die Wahl wird nur in diesem Browser gespeichert.
//
// Der Weg zurück zum Original ist absichtlich ein sehr umständlicher Prozess:
// Bestätigungen, Lizenzvertrag, Disketten-Sicherung, ein langsamer Ladebalken,
// der bei 99 % hängen bleibt, und Fehlermeldungen. Keine Fehlermeldung und kein
// Knopf darin hat irgendeine Wirkung – nur "Nein"/"Abbrechen" in den
// Bestätigungen VOR dem Ladebalken bricht den Wechsel ab.
// Zum Testen: ?dz-schnell in der Adresse lässt alles 10x schneller laufen.
// ---------------------------------------------------------------------------
const KEY = 'gg.design';
const link = document.getElementById('retro-css');
const SPEED = new URLSearchParams(location.search).has('dz-schnell') ? 0.1 : 1;

const isRetro = () => !!link && link.media !== 'not all';
function setDesign(d) {
  if (!link) return;
  link.media = d === 'original' ? 'not all' : 'all';
  try { localStorage.setItem(KEY, d); } catch { /* egal */ }
}

const layer = document.createElement('div');
layer.className = 'dz-layer';
document.body.appendChild(layer);

let busy = false;
let z = 10;
const wait = ms => new Promise(r => setTimeout(r, ms));
const sleep = ms => wait(ms * SPEED);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = list => list[Math.floor(Math.random() * list.length)];
const alertOpen = () => !!layer.querySelector('.dz-alert, .dz-full');

// ============================== Fenster ==============================
function topWin() {
  return [...layer.querySelectorAll('.dz-win')].sort((a, b) => b.style.zIndex - a.style.zIndex)[0] || null;
}
function activate(el) {
  layer.querySelectorAll('.dz-win').forEach(w => w.classList.toggle('dz-inactive', w !== el));
  el.style.zIndex = ++z;
}
function place(el, dx = 0, dy = 0) {
  const w = el.offsetWidth, h = el.offsetHeight;
  const x = Math.round((innerWidth - w) / 2 + dx), y = Math.round((innerHeight - h) / 2 + dy);
  el.style.left = `${Math.max(4, Math.min(innerWidth - w - 4, x))}px`;
  el.style.top = `${Math.max(4, Math.min(innerHeight - h - 4, y))}px`;
}
function makeDraggable(el) {
  const bar = el.querySelector('.dz-title');
  el.addEventListener('pointerdown', () => activate(el));
  bar.addEventListener('pointerdown', e => {
    if (e.target.closest('.dz-x')) return;
    const sx = e.clientX - el.offsetLeft, sy = e.clientY - el.offsetTop;
    bar.setPointerCapture(e.pointerId);
    const move = ev => {
      el.style.left = `${Math.max(60 - el.offsetWidth, Math.min(innerWidth - 60, ev.clientX - sx))}px`;
      el.style.top = `${Math.max(0, Math.min(innerHeight - 24, ev.clientY - sy))}px`;
    };
    const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', up); };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  });
}
function openWin({ title, body, size = '', alert = false, dx = 0, dy = 0, onClose }) {
  const el = document.createElement('div');
  el.className = `dz-win${size ? ` dz-w-${size}` : ''}${alert ? ' dz-alert' : ''}`;
  el.setAttribute('role', alert ? 'alertdialog' : 'dialog');
  el.setAttribute('aria-label', title);
  el.innerHTML = `<div class="dz-title"><span>${title}</span><button type="button" class="dz-x" aria-label="Schließen">×</button></div>${body}`;
  layer.appendChild(el);
  activate(el);
  place(el, dx, dy);
  makeDraggable(el);
  el.querySelector('.dz-x').onclick = () => onClose && onClose();
  return el;
}
function closeWin(el) {
  el.remove();
  const t = topWin();
  if (t) { activate(t); t.querySelector('.dz-default:not(:disabled)')?.focus(); }
}

// Kurzer "Ding"-Ton wie bei Windows (leise; ohne Ton ist es auch egal)
let audio = null;
function ding(icon) {
  if (!icon) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const notes = icon === 'error' ? [523, 392] : icon === 'warn' ? [659, 523] : [784];
    notes.forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain(), s = t + i * 0.12;
      o.type = 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.07, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.3);
      o.connect(g).connect(audio.destination);
      o.start(s);
      o.stop(s + 0.32);
    });
  } catch { /* kein Ton */ }
}

// Meldungsfenster. Ergebnis = Beschriftung des geklickten Knopfs.
function msg(icon, title, html, buttons = ['OK'], { details = '', dx = 0, dy = 0, closeAs = null } = {}) {
  return new Promise(resolve => {
    const btns = buttons.map((b, i) => `<button type="button" class="dz-btn${i === 0 ? ' dz-default' : ''}" data-b="${i}">${b}</button>`).join('')
      + (details ? '<button type="button" class="dz-btn" data-details>Details &gt;&gt;</button>' : '');
    const el = openWin({
      title, alert: true, dx, dy,
      body: `<div class="dz-body">${icon ? `<div class="dz-icon dz-icon-${icon}"></div>` : ''}<div class="dz-msg">${html}${details ? `<pre class="dz-details" hidden>${details}</pre>` : ''}</div></div>
        <div class="dz-btns">${btns}</div>`,
      onClose: () => finish(closeAs ?? buttons[buttons.length - 1]),
    });
    function finish(v) { closeWin(el); resolve(v); }
    el.querySelectorAll('[data-b]').forEach(b => { b.onclick = () => finish(buttons[+b.dataset.b]); });
    const db = el.querySelector('[data-details]');
    if (db) db.onclick = () => {
      const pre = el.querySelector('.dz-details');
      pre.hidden = !pre.hidden;
      db.innerHTML = pre.hidden ? 'Details &gt;&gt;' : '&lt;&lt; Details';
      const r = el.getBoundingClientRect();
      if (r.bottom > innerHeight - 4) el.style.top = `${Math.max(4, innerHeight - r.height - 4)}px`;
    };
    el.querySelector('.dz-default').focus();
    ding(icon);
  });
}

// Esc schließt das oberste Fenster; die Tastenkürzel der App ruhen, solange der Umschalter läuft
window.addEventListener('keydown', e => {
  if (!busy) return;
  e.stopPropagation();
  if (e.key === 'Escape' && !layer.querySelector('.dz-full')) {
    const t = topWin();
    if (t) { e.preventDefault(); t.querySelector('.dz-x').click(); }
  }
}, true);

// ============================== Texte ==============================
const STATUS = [
  ['Design-Assistent wird initialisiert …', 'SETUP.INF wird gelesen'],
  ['Suche nach Plug & Play-Geräten …', 'Gefunden: 1 Bildschirm, 1 Maus, 0 Disketten'],
  ['Registrierung wird gelesen …', 'HKEY_CURRENT_USER\\Control Panel\\Appearance'],
  ['16-Farben-Palette wird gesichert …', 'C:\\WINDOWS\\SYSTEM\\RETRO.PAL'],
  ['NOSTALGIE.VXD wird verschoben …', 'Von „C:\\WINDOWS\\SYSTEM“ nach „Papierkorb“'],
  ['ORIGINAL.CAB wird entpackt …', 'Diskette 3 von 14'],
  ['Comic Sans MS wird deinstalliert …', 'C:\\WINDOWS\\FONTS\\COMIC.TTF'],
  ['WordArt-Komponenten werden entfernt …', 'C:\\PROGRA~1\\WORDART\\REGENBOG.DLL'],
  ['Ecken werden abgerundet (das kann dauern) …', 'Ecke 512 von 1.024'],
  ['Farbverläufe werden berechnet …', 'Lila → Dunkellila → noch dunkleres Lila'],
  ['Pixel werden defragmentiert …', 'Cluster 4.711 von 65.535'],
  ['SYSTEM.INI und WIN.INI werden aktualisiert …', '[boot] design=original'],
  ['Schriftart „Nunito“ wird über 56k-Modem geladen …', 'Übertragungsrate: 3,2 KB/s'],
  ['Lauftext wird angehalten …', 'MARQUEE.EXE'],
  ['Baustellenschild wird abgebaut …', 'Bitte Schutzhelm aufsetzen'],
  ['Taskleiste wird ausgeblendet …', 'EXPLORER.EXE'],
];
const STALL_STATUS = [
  ['Installation wird abgeschlossen …', 'Fast fertig'],
  ['Fast fertig …', 'Wirklich fast fertig'],
  ['Die letzten Bytes werden kopiert …', 'Noch 1 Byte'],
  ['Warte auf Antwort von C:\\ …', 'Zeitüberschreitung in 30 Sekunden'],
  ['Es wird aufgeräumt …', 'C:\\WINDOWS\\TEMP\\~DESIGN.TMP'],
  ['Die letzten Pixel werden gezählt …', '1.048.575 von 1.048.576'],
  ['Registrierung wird komprimiert …', 'SYSTEM.DAT'],
  ['Bitte warten …', 'Bitte weiter warten'],
];
const ETA = ['ca. 3 Minuten', 'ca. 45 Sekunden', 'ca. 2 Minuten', 'ca. 11 Minuten', 'ca. 1 Minute', 'ca. 7 Sekunden', 'ca. 4 Minuten'];
const ETA_STALL = ['ca. 2 Sekunden', 'ca. 47 Stunden', 'unbekannt', 'ca. 1 Sekunde', 'ca. 3 Tage', 'ca. 26 Jahre', 'ca. 0 Sekunden', 'gleich', 'ca. 12 Minuten'];

const DUMP = `NOSTALGIE verursachte eine allgemeine Schutzverletzung
in Modul RETRO.DLL bei 0028:c0034b23.
Register:
EAX=c0034b23 CS=0028 EIP=c0034b23 EFLGS=00010246
EBX=00000095 SS=0030 ESP=c2a7fdf0 EBP=c2a7fe18
ECX=c2a7ff68 DS=0030 ESI=00000000 FS=0078
EDX=c00309ce ES=0030 EDI=c2a7fe68 GS=0000
Bytes bei CS:EIP:
8b 4c 24 04 e8 a3 ff ff ff c2 04 00 cc cc cc cc
Stapelwerte:
00000000 c0034a0e 00000095 c2a7fe68 00000000 c2a7ff68
bff7363b 00000001 0040a3c4 c00309ce 00000000 00000000`;

const ERR = {
  gpf: { icon: 'error', title: 'RETRO.DLL', buttons: ['Schließen'], details: DUMP,
    html: 'Dieses Programm hat eine ungültige Operation durchgeführt und wird geschlossen.<br><br>RETRO.DLL verursachte eine <b>allgemeine Schutzverletzung</b> in Modul NOSTALGIE.VXD bei 0028:C0034B23.<br><br><small>Falls das Problem weiterhin besteht, wenden Sie sich an den Hersteller.</small>' },
  inUse: { icon: 'warn', title: 'Fehler beim Löschen der Datei', buttons: ['Wiederholen', 'Abbrechen'],
    html: '<b>COMIC.TTF</b> kann nicht gelöscht werden: Zugriff verweigert.<br><br>Die Datei wird möglicherweise gerade von einem anderen Programm verwendet. Schließen Sie alle Programme, die Comic Sans MS verwenden, und versuchen Sie es erneut.' },
  memory: { icon: 'error', title: 'Nicht genügend Arbeitsspeicher', buttons: ['Wiederholen', 'Abbrechen'],
    html: 'Für diesen Vorgang ist nicht genügend Arbeitsspeicher verfügbar.<br><br>Verfügbar: 640 KB konventioneller Speicher<br>Benötigt: 1 Farbverlauf (ca. 4 MB)<br><br>Schließen Sie einige Fenster, und versuchen Sie es dann erneut.' },
  registry: { icon: 'question', title: 'Registrierungs-Editor', buttons: ['Ja', 'Nein'],
    html: 'Der Registrierungsschlüssel<br><b>HKEY_LOCAL_MACHINE\\Software\\GeoGuessr\\Design\\Retro\\Gefühle</b><br>ist beschädigt.<br><br>Soll versucht werden, ihn aus der Sicherung SYSTEM.DA0 wiederherzustellen?' },
  irq: { icon: 'warn', title: 'Geräte-Manager', buttons: ['Ignorieren', 'Abbrechen'],
    html: '<b>IRQ-Konflikt:</b> Die Grafikkarte und die Soundkarte verwenden beide Interrupt 5.<br><br>Plug & Play konnte den Konflikt nicht automatisch lösen. Ändern Sie die Jumper-Einstellungen auf der Karte oder klicken Sie auf „Ignorieren“.' },
  clock: { icon: 'question', title: 'Eigenschaften von Datum/Uhrzeit', buttons: ['Ja', 'Nein'],
    html: 'Die Systemuhr geht ca. <b>26 Jahre</b> nach.<br><br>Soll die Uhrzeit jetzt mit dem Zeitserver synchronisiert werden?' },
  swap: { icon: 'info', title: 'Virtueller Arbeitsspeicher', buttons: ['OK'],
    html: 'Die Auslagerungsdatei <b>WIN386.SWP</b> ist zu klein.<br><br>Windows vergrößert die Auslagerungsdatei. Während dieses Vorgangs werden Anforderungen an den Speicher eventuell verweigert.' },
  read: { icon: 'error', title: 'Fehler beim Lesen', buttons: ['Abbrechen', 'Wiederholen', 'Ignorieren'],
    html: 'Fehler beim Lesen von Laufwerk C:<br>Sektor nicht gefunden (Zylinder 1023, Kopf 7, Sektor 63).<br><br>Abbrechen, Wiederholen, Ignorieren?' },
  slow: { icon: 'info', title: 'Design wird geändert', buttons: ['Warten', 'Weiter warten'],
    html: 'Der Vorgang dauert länger als erwartet.<br><br>Möchten Sie weiter warten?' },
  memRead: { icon: 'error', title: 'EXPLORER.EXE – Anwendungsfehler', buttons: ['OK', 'Abbrechen'],
    html: 'Die Anweisung in „0x77f8a3f4“ verweist auf Speicher in „0x00000000“. Der Vorgang „read“ konnte nicht auf dem Speicher durchgeführt werden.<br><br>Klicken Sie auf „OK“, um das Programm zu beenden.<br>Klicken Sie auf „Abbrechen“, um das Programm zu debuggen.' },
  nostalgia: { icon: 'warn', title: 'Stapelüberlauf', buttons: ['OK'],
    details: 'NOSTALGIE.VXD: Stapelüberlauf\nRetro-Gefühle (verbleibend): 3\n  - Modem-Einwahlgeräusch\n  - Diskette einlegen\n  - "Bitte warten Sie ..."\nAktion: ignoriert',
    html: 'Stapelüberlauf in <b>NOSTALGIE.VXD</b>.<br><br>Es konnten nicht alle Retro-Gefühle entfernt werden. 3 Retro-Gefühle verbleiben im Arbeitsspeicher.' },
};
const showErr = e => msg(e.icon, e.title, e.html, e.buttons, { details: e.details, dx: rand(-120, 120), dy: rand(-100, 100) });

const EULA = `LIZENZVERTRAG FÜR DAS DESIGN „ORIGINAL“

WICHTIG – BITTE SORGFÄLTIG LESEN: Dieser Vertrag wird zwischen Ihnen (nachfolgend „der Ratende“) und der GeoGuessr Freunde-Edition (nachfolgend „wir“) geschlossen.

1. GEGENSTAND. Sie erhalten das Recht, abgerundete Ecken, Farbverläufe und die Schriftart Nunito auf beliebig vielen Bildschirmen zu betrachten.

2. VERZICHT. Mit dem Wechsel verzichten Sie freiwillig auf Lauftext, Baustellenschild, WordArt, 3D-Knöpfe, die Taskleiste samt Uhr sowie sämtliche Ansprüche auf Comic Sans MS.

3. HAFTUNG. Wir haften nicht für Nostalgie-Entzug, plötzliches Vermissen von Disketten oder das Bedürfnis, wieder ein Modem einwählen zu hören.

4. RÜCKGABE. Eine Rückkehr zu Windows 95 ist jederzeit über „Design“ möglich. Sie dauert ca. 2 Sekunden und erfordert keine Diskette.

5. LAUFZEIT. Dieser Vertrag gilt bis zum nächsten Designwechsel oder bis zum Jahr 2038, je nachdem, was zuerst eintritt.

6. PUNKTE. Ihre Punkte, Spiele und Platzierungen bleiben vom Designwechsel unberührt. Das ist der einzige ernst gemeinte Absatz.

7. SCHLUSSBESTIMMUNG. Sollten einzelne Bestimmungen unwirksam sein, ist das egal. Es ist nur ein Design.

Sie haben das Ende des Vertrags erreicht. Herzlichen Glückwunsch – das hat noch nie jemand geschafft.`;

// ============================== Schritte ==============================
function displayProps() {
  return new Promise(resolve => {
    let sel = isRetro() ? 'retro' : 'original';
    const tabs = ['Hintergrund', 'Bildschirmschoner', 'Darstellung', 'Einstellungen'];
    const el = openWin({
      title: 'Eigenschaften von Anzeige', size: 'lg',
      body: `<div class="dz-tabs">${tabs.map(t => `<button type="button" class="dz-tab${t === 'Darstellung' ? ' dz-sel' : ''}" data-tab="${t}">${t}</button>`).join('')}</div>
        <div class="dz-panel">
          <div class="dz-monitor"><div class="dz-screen"><div class="dz-mini"></div></div></div>
          <div class="dz-field"><span>Schema:</span>
            <div class="dz-list" role="listbox" aria-label="Schema">
              <button type="button" class="dz-item" role="option" data-d="retro">Windows 95 (Retro)</button>
              <button type="button" class="dz-item" role="option" data-d="original">Original (lila, rund, modern)</button>
            </div>
          </div>
        </div>
        <div class="dz-btns dz-right">
          <button type="button" class="dz-btn dz-default" data-ok>OK</button>
          <button type="button" class="dz-btn" data-cancel>Abbrechen</button>
          <button type="button" class="dz-btn" data-ok>Übernehmen</button>
        </div>`,
      onClose: () => done(null),
    });
    const screen = el.querySelector('.dz-screen');
    const paint = () => {
      screen.className = `dz-screen dz-${sel}`;
      el.querySelectorAll('.dz-item').forEach(i => {
        i.classList.toggle('dz-sel', i.dataset.d === sel);
        i.setAttribute('aria-selected', String(i.dataset.d === sel));
      });
    };
    paint();
    el.querySelectorAll('.dz-item').forEach(i => {
      i.onclick = () => { sel = i.dataset.d; paint(); };
      i.ondblclick = () => done(sel);
    });
    el.querySelectorAll('.dz-tab').forEach(t => {
      t.onclick = () => {
        if (t.dataset.tab !== 'Darstellung') msg('info', 'Eigenschaften von Anzeige', `Die Registerkarte „${t.dataset.tab}“ ist erst ab Windows 98 verfügbar.`);
      };
    });
    function done(v) { closeWin(el); resolve(v); }
    el.querySelectorAll('[data-ok]').forEach(b => { b.onclick = () => done(sel); });
    el.querySelector('[data-cancel]').onclick = () => done(null);
    el.querySelector('.dz-default').focus();
  });
}

function eula() {
  return new Promise(resolve => {
    const el = openWin({
      title: 'Lizenzvertrag', size: 'lg',
      body: `<div class="dz-body"><div class="dz-icon dz-icon-info"></div><div class="dz-msg">
          Bitte lesen Sie den folgenden Lizenzvertrag. Blättern Sie dazu mit der Bildlaufleiste bis ganz nach unten.
          <div class="dz-eula" tabindex="0">${EULA}</div>
          <label class="dz-check dz-off"><input type="checkbox" disabled> Ich habe den Lizenzvertrag gelesen und stimme zu.</label>
          <div class="dz-hint">Das Kästchen wird erst aktiv, wenn Sie bis zum Ende gelesen haben.</div>
        </div></div>
        <div class="dz-btns dz-right">
          <button type="button" class="dz-btn" disabled>&lt; Zurück</button>
          <button type="button" class="dz-btn dz-default" data-next disabled>Weiter &gt;</button>
          <button type="button" class="dz-btn" data-cancel>Abbrechen</button>
        </div>`,
      onClose: () => done(false),
    });
    const box = el.querySelector('.dz-eula'), cb = el.querySelector('input'), label = el.querySelector('.dz-check');
    const hint = el.querySelector('.dz-hint'), next = el.querySelector('[data-next]');
    const check = () => {
      if (!cb.disabled || box.scrollTop + box.clientHeight < box.scrollHeight - 6) return;
      cb.disabled = false;
      label.classList.remove('dz-off');
      hint.textContent = 'Danke fürs Lesen. Wirklich.';
    };
    box.addEventListener('scroll', check);
    const poll = setInterval(check, 400); // falls ein Scroll-Ereignis verloren geht
    check();
    cb.onchange = () => { next.disabled = !cb.checked; };
    function done(v) { clearInterval(poll); closeWin(el); resolve(v); }
    next.onclick = () => done(true);
    el.querySelector('[data-cancel]').onclick = () => done(false);
    box.focus();
  });
}

// Ladebalken-Zeiten (ms). Gezählt wird nur, solange keine Meldung offen ist.
const UP_MS = 20000;   // 0 → 99 %
const HOLD_MS = 20000; // Stillstand bei 99 %
const TICKS = 80;      // Schritte von 0 auf 99 %

// Zufällige, aber genau auf 99 % summierte Schritte – mit zwei sichtbaren Hängern
function progressSteps() {
  const w = Array.from({ length: TICKS }, (_, i) => (Math.random() < 0.08 ? 0 : rand(0.3, 1.7)) * (i > TICKS * 0.85 ? 0.35 : 1));
  for (let h = 0; h < 2; h++) {
    const start = 5 + Math.floor(Math.random() * (TICKS - 20));
    for (let i = start; i < start + 6; i++) w[i] = 0;
  }
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  return w.map(x => 99 * x / sum);
}

async function progressRun() {
  const el = openWin({
    title: 'Design wird geändert …',
    body: `<div class="dz-body" style="display:block">
        <div class="dz-anim" aria-hidden="true"><span class="dz-from">📁</span><span class="dz-doc">📄</span><span class="dz-to">🗑️</span></div>
        <div class="dz-line" data-st></div>
        <div class="dz-line" data-path></div>
        <div class="dz-progress"><div></div></div>
        <div class="dz-meta"><span data-eta></span><span data-pct>0 %</span></div>
      </div>
      <div class="dz-btns dz-right"><button type="button" class="dz-btn dz-default" data-abort>Abbrechen</button></div>`,
    onClose: () => abort(),
  });
  const bar = el.querySelector('.dz-progress > div'), st = el.querySelector('[data-st]'), path = el.querySelector('[data-path]');
  const eta = el.querySelector('[data-eta]'), pctEl = el.querySelector('[data-pct]');
  const abort = () => msg('error', 'Design wird geändert', 'Der Vorgang kann nicht abgebrochen werden, da er bereits zu 99 % abgeschlossen ist.');
  el.querySelector('[data-abort]').onclick = abort;

  let pct = 0, stalled = false;
  const show = () => { bar.style.width = `${pct}%`; pctEl.textContent = `${Math.floor(pct)} %`; };
  const text = () => {
    if (alertOpen()) return;
    const s = stalled ? pick(STALL_STATUS) : STATUS[Math.min(STATUS.length - 1, Math.floor(pct / 100 * STATUS.length))];
    st.textContent = s[0];
    path.textContent = s[1];
    eta.textContent = `Verbleibende Zeit: ${pick(stalled ? ETA_STALL : ETA)}`;
  };
  text();
  const textTimer = setInterval(text, 2300 * SPEED);

  // Eigene Uhr: läuft nur, solange keine Meldung offen ist
  let active = 0, last = performance.now();
  const clock = () => { const now = performance.now(); if (!alertOpen()) active += now - last; last = now; };
  const until = async ms => { for (clock(); active < ms * SPEED; clock()) await wait(50); };
  const pause = async p => { await p; last = performance.now(); }; // Zeit mit offener Meldung nicht mitzählen

  try {
    const errs = [[11, ERR.gpf], [24, ERR.inUse], [37, ERR.memory], [49, ERR.registry], [61, ERR.irq], [72, ERR.clock], [83, ERR.swap], [93, ERR.read]];
    const steps = progressSteps();
    for (let i = 0; i < TICKS; i++) {
      await until((i + 1) * UP_MS / TICKS);
      pct = Math.min(99, pct + steps[i]);
      show();
      if (errs.length && pct >= errs[0][0]) await pause(showErr(errs.shift()[1]));
    }
    // 99 % – und dann lange nichts
    pct = 99;
    show();
    stalled = true;
    text();
    for (const [at, err] of [[3000, ERR.slow], [7000, 'bsod'], [11000, ERR.memRead], [15000, ERR.nostalgia], [HOLD_MS, null]]) {
      await until(UP_MS + at);
      if (err === 'bsod') await pause(bsod());
      else if (err) await pause(showErr(err));
    }
    pct = 100;
    show();
    st.textContent = 'Fertig.';
    path.textContent = '';
    eta.textContent = 'Verbleibende Zeit: 0 Sekunden';
    await sleep(500);
  } finally {
    clearInterval(textTimer);
    closeWin(el);
  }
}

function bsod() {
  return new Promise(resolve => {
    const el = document.createElement('div');
    el.className = 'dz-full dz-bsod';
    el.innerHTML = `<div class="dz-bsod-inner">
        <div class="dz-bsod-head"><span>Windows</span></div>
        <p>Ein schwerer Ausnahmefehler 0E ist bei 0028:C0011E36 in VxD VMM(01) + 00010E36 aufgetreten. Das Design wird trotzdem weiter geändert.</p>
        <p>* Drücken Sie eine beliebige Taste, um fortzufahren.<br>
           * Drücken Sie STRG+ALT+ENTF, um den Computer neu zu starten. Dabei gehen alle nicht gespeicherten Retro-Gefühle verloren.</p>
        <p class="dz-center">Weiter mit beliebiger Taste <span class="dz-cursor">_</span></p>
      </div>`;
    layer.appendChild(el);
    ding('error');
    const go = e => {
      if (e.type === 'keydown') e.preventDefault();
      window.removeEventListener('keydown', go, true);
      el.removeEventListener('pointerdown', go);
      el.remove();
      resolve();
    };
    setTimeout(() => { window.addEventListener('keydown', go, true); el.addEventListener('pointerdown', go); }, 500);
  });
}

async function restartAndApply() {
  const r = await msg('question', 'Systemeinstellungsänderung',
    'Sie müssen den Computer neu starten, damit die neuen Einstellungen wirksam werden.<br><br>Möchten Sie den Computer jetzt neu starten?', ['Ja', 'Nein'], { closeAs: 'Nein' });
  if (r !== 'Ja') await msg('info', 'Systemeinstellungsänderung', 'Der Computer wird trotzdem neu gestartet.');
  const el = document.createElement('div');
  el.className = 'dz-full dz-shutdown';
  el.textContent = 'Bitte warten Sie, während der Computer heruntergefahren wird …';
  layer.appendChild(el);
  await sleep(2600);
  el.classList.add('dz-off');
  el.textContent = 'Sie können den Computer jetzt ausschalten.';
  await sleep(2600);
  setDesign('original');
  el.remove();
}

async function toOriginal() {
  const no = () => msg('info', 'Design', 'Der Vorgang wurde abgebrochen.<br>Das Design bleibt „Windows 95“.');
  if (await msg('question', 'Design ändern',
    'Möchten Sie das Design wirklich von <b>„Windows 95“</b> auf <b>„Original“</b> umstellen?', ['Ja', 'Nein']) !== 'Ja') return no();
  if (await msg('warn', 'Warnung',
    'Dabei werden folgende Komponenten entfernt:<ul><li>Lauftext</li><li>Baustellenschild</li><li>WordArt-Überschriften</li><li>Taskleiste mit Uhr</li><li>Comic Sans MS</li></ul>Möchten Sie trotzdem fortfahren?', ['Ja', 'Nein']) !== 'Ja') return no();
  if (!(await eula())) return no();
  if (await msg('question', 'Sicherung',
    'Möchten Sie vor der Änderung eine Sicherungskopie Ihres Designs auf Diskette erstellen?<br><br><small>Empfohlen. Benötigt 14 Disketten (3,5", 1,44 MB).</small>', ['Ja', 'Nein']) === 'Ja') {
    await msg('info', 'Sicherung', 'Bitte legen Sie <b>Diskette 1 von 14</b> in Laufwerk A: ein und klicken Sie dann auf „OK“.');
    await msg('error', 'A:\\', 'Auf A:\\ kann nicht zugegriffen werden.<br><br>Das Gerät ist nicht bereit.', ['Wiederholen', 'Abbrechen']);
    await msg('warn', 'Sicherung', 'Die Sicherungskopie konnte nicht erstellt werden. Es wird ohne Sicherung fortgefahren.');
  }
  let r;
  while ((r = await msg('warn', 'Letzte Warnung', 'Sind Sie wirklich, <i>wirklich</i> sicher?', ['Ja', 'Nein', 'Vielleicht'], { closeAs: 'Nein' })) === 'Vielleicht') {
    await msg('error', 'Ungültige Eingabe', '„Vielleicht“ ist keine gültige Antwort.<br>Bitte wählen Sie „Ja“ oder „Nein“.');
  }
  if (r !== 'Ja') return no();
  await progressRun();
  await restartAndApply();
}

async function toRetro() {
  const el = document.createElement('div');
  el.className = 'dz-full dz-boot';
  el.innerHTML = '<div class="dz-boot-logo">GeoGuessr 95<small>Freunde-Edition</small></div><div class="dz-boot-bar"></div>';
  layer.appendChild(el);
  await sleep(1800);
  setDesign('retro');
  el.remove();
  await msg('info', 'Design geändert', 'Willkommen zurück bei Windows 95!<br><br>Der Wechsel hat 1,8 Sekunden gedauert und keine einzige Diskette benötigt.');
}

async function run() {
  if (busy) return;
  busy = true;
  layer.classList.add('active');
  try {
    const choice = await displayProps();
    if (!choice || choice === (isRetro() ? 'retro' : 'original')) return;
    if (choice === 'retro') await toRetro();
    else await toOriginal();
  } catch (e) {
    console.error(e);
  } finally {
    layer.innerHTML = '';
    layer.classList.remove('active');
    busy = false;
  }
}

document.addEventListener('click', e => {
  if (!e.target.closest('[data-design]')) return;
  e.preventDefault();
  run();
});
