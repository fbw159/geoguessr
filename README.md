# 🌍 GeoGuessr · Freunde-Edition

Ein kleines, privates GeoGuessr für mich und meine Freunde – im Browser, ohne Login.

**Spielen:** https://fbw159.github.io/geoguessr/

## So funktioniert's

1. Seite öffnen und den eigenen Spieler auswählen (oder mit „Neuer Spieler“ anlegen – nur ein Name, kein Passwort).
2. Karte wählen (Welt, Europa, Deutschland, DACH, Kontinente oder ein einzelnes Land), Runden, Zeitlimit und Modus einstellen.
3. Street View anschauen, Pin auf die Karte setzen, „Raten“. Bis zu 100 Punkte pro Runde.
4. Nach dem Spiel landen die Punkte automatisch auf dem Konto des Spielers. Die **Bestenliste** vergleicht alle Spieler nach **Ø Punkten pro Guess** (Platz ab 10 Guesses).

## ⚔️ Competition Mode

Mehrere Spieler an eigenen Rechnern spielen **gleichzeitig dieselben Orte**:

1. Einer klickt auf „Competition Mode“ → „Neuer Wettkampf“ (Karte, 3/5/10 Runden, Zeitlimit) und bekommt einen Code samt Einladungslink.
2. Die anderen öffnen den Link (er enthält auch den Schlüssel) und wählen ihren Spieler.
3. Der Host drückt „Los!“ – Countdown, dann startet jede Runde für alle gleichzeitig.
4. Punkte pro Runde = Genauigkeit (0–100) × Tempo-Faktor (sofort 100 %, am Zeitlimit 70 %).
5. Nach jeder Runde sieht man alle Pins, am Ende gibt es eine Siegerehrung und auf Wunsch eine Revanche.

Wettkämpfe werden getrennt gespeichert (`data/competitions.json`) und erscheinen nur in der Wettkampf-Bestenliste.

Extras: Endlos-Modus (spielen, bis man auf „Beenden“ drückt), Zeitlimit, Standbild-Modus (NMPZ), Challenge-Links („Gleiche Orte als Challenge teilen“), Spielerprofile mit Statistik.

## Wo werden die Punkte gespeichert?

Spieler und Spiele liegen als JSON-Datei im Branch [`data`](../../blob/data/data/db.json) dieses Repos.
Lesen kann sie jeder; zum **Schreiben** braucht der Browser einmalig einen Schlüssel (einen GitHub-Token mit
`Contents: Read and write`, nur für dieses Repo). Der Schlüssel steckt im **Einladungslink**
(Einstellungen → „Einladungslink kopieren“). Wer den Link einmal öffnet, speichert ab dann automatisch.

Ohne Schlüssel wird ein Spiel lokal im Browser gesichert und automatisch hochgeladen, sobald der Schlüssel da ist.

## Technik

- Reines HTML/CSS/JavaScript, gehostet über GitHub Pages – kein Server, kein Build.
- Street View über den Google-Maps-Embed (ohne API-Key) mit festen Panorama-IDs.
- Karten: [MapLibre GL](https://maplibre.org/) mit dem Stil „Natur“ von [VersaTiles](https://versatiles.org/) (Vektorkarte, deutsche Namen, © OpenStreetMap-Mitwirkende). Natur (Wald, Wiesen, Felder) wird eine Zoomstufe früher eingeblendet als im Original, Städtenamen eine Stufe früher über `karten/orte.json` (Orte aus [Natural Earth](https://www.naturalearthdata.com/), gemeinfrei).
- Competition Mode: je Wettkampf eine JSON-Datei unter `data/matches/` auf dem Branch `data`; die Browser fragen sie alle ~2 s ab (mit ETag).
- Orte: ~26.000 Panoramen aus dem Datensatz von [WorldGuessr](https://github.com/codergautam/worldguessr)
  (PolyForm Noncommercial – hier rein privat genutzt). Deutschland, Österreich und Schweiz komplett, der Rest als Stichprobe.
- Punkteformel (GeoGuessr-Kurve, auf 100 skaliert): `100 · e^(−10 · Entfernung / Kartengröße)`; Kartengröße = Diagonale der Karte (Welt: 14.917 km).

Nur für den privaten Gebrauch.
