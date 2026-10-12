// ---------------------------------------------------------------------------
// Grundeinstellungen
// ---------------------------------------------------------------------------
export const REPO = {
  owner: 'fbw159',
  repo: 'geoguessr',
  dataBranch: 'data',          // Spielstände liegen auf einem eigenen Branch (löst keinen Pages-Build aus)
  dbPath: 'data/db.json',
};

export const SITE_URL = `https://${REPO.owner}.github.io/${REPO.repo}/`;

// Maximaldistanz der Weltkarte wie bei GeoGuessr (km) – Basis für die Punkteformel
export const WORLD_MAX_DIST = 14916.862;
// Punkte pro Runde: 0–100 (= Prozent). POINTS_VERSION kennzeichnet Spiele mit dieser Skala;
// ältere Spiele (0–5.000) werden ignoriert.
export const MAX_ROUND_SCORE = 100;
export const POINTS_VERSION = 2;
// Ab so vielen Guesses bekommt ein Spieler einen Platz in der Rangliste "Ø pro Guess"
export const MIN_GUESSES_FOR_RANK = 10;

export const PLAYER_COLORS = ['#fecd19', '#6cb928', '#e94560', '#4cc9f0', '#f77f00', '#b5179e', '#00b4a6', '#ff70a6', '#7b61ff', '#8d99ae'];
export const PLAYER_EMOJIS = ['🧭', '🌍', '🦊', '🐻', '🐼', '🦁', '🐸', '🐙', '🦄', '🐧', '🦉', '🚀', '⚽', '🎸', '🍕', '🌵', '👑', '😎', '🤠', '🗺️'];

// Kontinent je Ländercode
const C = {
  eu: 'AD AL AT AX BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SK SM UA VA XK',
  as: 'AE AF AM AZ BD BH BN BT CN GE HK ID IL IN IQ IR JO JP KG KH KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA SA SG SY TH TJ TL TM TR TW UZ VN YE',
  af: 'AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SL SN SO SS ST SZ TD TG TN TZ UG YT ZA ZM ZW',
  na: 'AG AI AW BB BL BM BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX NI PA PM PR SV SX TC TT US VC VG VI',
  sa: 'AR BO BR CL CO EC FK GF GY PE PY SR UY VE',
  oc: 'AS AU CK CX FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV UM VU WF WS',
};
export const CONTINENT = {};
for (const [k, list] of Object.entries(C)) for (const cc of list.split(' ')) CONTINENT[cc] = k;

export function continentOf(row) {
  const cc = row[4];
  if (cc === 'RU' && row[1] > 60) return 'as'; // Russland östlich des Urals
  return CONTINENT[cc] || 'xx';
}

// Vordefinierte Karten. Länderkarten werden dynamisch ergänzt (id "c-XX").
export const MAPS = [
  { id: 'world',    name: 'Welt',        icon: '🌍', desc: 'Überall, wo es Street View gibt', filter: () => true, maxDist: WORLD_MAX_DIST },
  { id: 'europe',   name: 'Europa',      icon: '🏰', desc: 'Vom Nordkap bis Gibraltar',        filter: r => continentOf(r) === 'eu' },
  { id: 'de',       name: 'Deutschland', icon: '🥨', desc: 'Kennst du deine Heimat?',          filter: r => r[4] === 'DE' },
  { id: 'dach',     name: 'DACH',        icon: '🏔️', desc: 'Deutschland, Österreich, Schweiz', filter: r => r[4] === 'DE' || r[4] === 'AT' || r[4] === 'CH' },
  { id: 'asia',     name: 'Asien',       icon: '🏯', desc: 'Von der Türkei bis Japan',         filter: r => continentOf(r) === 'as' },
  { id: 'africa',   name: 'Afrika',      icon: '🦁', desc: 'Savanne, Küste und Großstadt',     filter: r => continentOf(r) === 'af' },
  { id: 'namerica', name: 'Nordamerika', icon: '🗽', desc: 'Inkl. Mittelamerika & Karibik',    filter: r => continentOf(r) === 'na' },
  { id: 'samerica', name: 'Südamerika',  icon: '🦜', desc: 'Anden, Pampa, Regenwald',          filter: r => continentOf(r) === 'sa' },
  { id: 'oceania',  name: 'Ozeanien',    icon: '🦘', desc: 'Australien, Neuseeland & Inseln',  filter: r => continentOf(r) === 'oc' },
];

export const DEFAULT_PREFS = { map: 'world', rounds: 5, time: 0, mode: 'move' };
