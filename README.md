# 🌍 GeoGuessr · Freunde-Edition

Ein kleines, privates GeoGuessr für mich und meine Freunde – im Browser, ohne Login.

**Spielen:** https://fbw159.github.io/geoguessr/

## So funktioniert's

1. Seite öffnen und den eigenen Spieler auswählen (oder mit „Neuer Spieler“ anlegen – nur ein Name, kein Passwort).
2. Karte wählen (Welt, Europa, Deutschland, DACH, Kontinente oder ein einzelnes Land), Runden, Zeitlimit und Modus einstellen.
3. Street View anschauen, Pin auf die Karte setzen, „Raten“. Bis zu 5.000 Punkte pro Runde.
4. Nach dem Spiel landen die Punkte automatisch auf dem Konto des Spielers. Die **Bestenliste** zeigt alle Spieler.

Extras: Zeitlimit, Standbild-Modus (NMPZ), Challenge-Links („Gleiche Orte als Challenge teilen“), Spielerprofile mit Statistik.

## Wo werden die Punkte gespeichert?

Spieler und Spiele liegen als JSON-Datei im Branch [`data`](../../blob/data/data/db.json) dieses Repos.
Lesen kann sie jeder; zum **Schreiben** braucht der Browser einmalig einen Schlüssel (einen GitHub-Token mit
`Contents: Read and write`, nur für dieses Repo). Der Schlüssel steckt im **Einladungslink**
(Einstellungen → „Einladungslink kopieren“). Wer den Link einmal öffnet, speichert ab dann automatisch.

Ohne Schlüssel wird ein Spiel lokal im Browser gesichert und automatisch hochgeladen, sobald der Schlüssel da ist.

## Technik

- Reines HTML/CSS/JavaScript, gehostet über GitHub Pages – kein Server, kein Build.
- Street View über den Google-Maps-Embed (ohne API-Key) mit festen Panorama-IDs.
- Rate-Karte: [Leaflet](https://leafletjs.com/) mit Kacheln von © OpenStreetMap-Mitwirkende / © CARTO.
- Orte: ~26.000 Panoramen aus dem Datensatz von [WorldGuessr](https://github.com/codergautam/worldguessr)
  (PolyForm Noncommercial – hier rein privat genutzt). Deutschland, Österreich und Schweiz komplett, der Rest als Stichprobe.
- Punkteformel wie bei GeoGuessr: `5000 · e^(−10 · Entfernung / Kartengröße)`.

Nur für den privaten Gebrauch.
