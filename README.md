# Rezepte

Private Rezeptarchiv-App, gespeist aus der Supabase-Tabelle `rezepte` (Projekt
„Gourmet-Adlemsried“, dieselbe Datenbank wie die Weinkeller-App). Läuft als
reine Client-Anwendung ohne Build-Schritt (HTML/CSS/Vanilla-JS), lässt sich
also direkt über GitHub Pages oder jeden anderen statischen Hoster ausliefern.

## Funktionen

- Startseite mit Kategorie-Kacheln (Anzahl Rezepte pro Kategorie)
- Volltextsuche über Titel, Zutaten und Zubereitung
- Detailansicht mit Zutaten, Zubereitung, Notizen, Quelle
- Weinempfehlung-Box in der Detailansicht, falls ein Rezept mit
  `wein_empfehlung_ids` auf die `wines`-Tabelle verweist; im Formular per
  Such-Auswahl (Autocomplete + entfernbare Chips) aus dem Weinkeller wählbar
  — erfordert Login, da die `wines`-Tabelle nur für angemeldete Nutzer lesbar
  ist (gleiche Privatsphäre-Regel wie in der Weinkeller-App)
- Bildupload pro Rezept (JPEG/PNG/WebP, max. 3 MB) über Supabase Storage
  (Bucket `rezeptbilder`), mit Vorschau, Ersetzen und Entfernen im Formular;
  Bild erscheint in der Detailansicht und als Thumbnail in der Listenkarte
- Bearbeiten- und Löschen-Icons in der Detailansicht, „Neues Rezept“-Button
  in der Listenansicht — beide nur sichtbar mit Schreibrechten
- Login-Pflicht für die ganze App (Supabase Auth), exakt wie bei der
  Weinkeller-App: ohne Anmeldung ist nichts sichtbar, auch kein Lesen. Ein
  Konto mit Rolle `viewer` darf nur lesen, alle anderen angemeldeten Konten
  dürfen zusätzlich anlegen/ändern/löschen. Es sind dieselben Konten wie im
  Weinkeller nutzbar, da Supabase Auth projektweit gilt (kein separates
  Konto pro App nötig).

## Lokal starten

Kein Build nötig, einfach über einen beliebigen statischen Webserver
ausliefern (direktes Öffnen der `index.html` per `file://` funktioniert wegen
ES-Modulen in den meisten Browsern nicht zuverlässig):

```bash
python3 -m http.server 8000
# dann im Browser: http://localhost:8000
```

## Auf GitHub veröffentlichen

```bash
git init
git add .
git commit -m "Initial commit: Rezepte-App"
git branch -M main
git remote add origin <URL deines GitHub-Repos>
git push -u origin main
```

## Hosting über GitHub Pages

1. Repo auf GitHub anlegen und den obigen Push durchführen.
2. In den Repo-Einstellungen unter „Pages“ als Quelle den Branch `main` und
   den Ordner `/ (root)` wählen.
3. Nach kurzer Zeit ist die App unter
   `https://<dein-github-name>.github.io/<repo-name>/` erreichbar.

## Supabase-Zugang

Die Zugangsdaten in `js/config.js` (Projekt-URL + `anon`-Key) sind bewusst
öffentlich sichtbar — das ist bei Supabase so vorgesehen. Der eigentliche
Schutz erfolgt über Row-Level-Security-Regeln in der Datenbank: Lesen
(`SELECT`) ist nur für angemeldete Nutzer erlaubt (`auth.role() =
'authenticated'`, wie bei `wines`), Schreiben (Anlegen/Ändern/Löschen) ist
zusätzlich für die Rolle `viewer` gesperrt. Bilder im Storage-Bucket
`rezeptbilder` bleiben bewusst öffentlich lesbar (wie `weinbilder`), da
`<img>`-Tags keine Auth-Header mitschicken können.

Beim Aufsetzen dieser App wurde zusätzlich festgestellt und behoben, dass der
Tabelle `rezepte` (im Gegensatz zu `wines`) die grundlegenden Postgres-Grants
für die Rollen `anon`/`authenticated` fehlten — ohne die schlagen alle
Zugriffe unabhängig von den RLS-Regeln mit „permission denied“ fehl. Das
wurde direkt in Supabase nachgezogen (`GRANT SELECT` für `anon`,
`GRANT SELECT, INSERT, UPDATE, DELETE` für `authenticated`).

## Datenmodell

Tabelle `rezepte` (Auszug):

| Feld | Typ | Bemerkung |
|---|---|---|
| `titel` | text | |
| `kategorie` | text | Fremdschlüssel auf `kategorien.name` (dynamisch erweiterbar) |
| `portionen`, `zubereitungszeit_min`, `wartezeit_min` | integer | optional |
| `schwierigkeit` | text | `einfach` / `mittel` / `anspruchsvoll` |
| `bewertung` | integer | 1–4 Sterne |
| `zutaten` | text | freier Text, eine Zutat pro Zeile |
| `zubereitung` | text | freier Text, ein Absatz/Schritt pro Zeile |
| `notizen`, `quelle` | text | optional |
| `wein_empfehlung_ids` | text[] | Referenzen auf `wines.id` (kein FK) |

## Kategorien (dynamisch)

Tabelle `kategorien` (`name`, `icon` = SVG-Pfade 24×24, `sortierung`, `aktiv`).
Die Kacheln der Startseite und das Kategorie-Dropdown im Formular werden bei
jedem Laden daraus aufgebaut. Neue Kategorie = neue Zeile in der Tabelle
(Supabase Table Editor); leeres `icon` ergibt ein Standard-Icon, `aktiv = false`
blendet sie aus. Umbenennen wirkt per `ON UPDATE CASCADE` auf alle Rezepte;
Löschen ist nur ohne zugeordnete Rezepte möglich.

## Fusszeile

Zeigt Anzahl Rezepte und App-Version (`APP_VERSION` in `js/config.js`).

## Bilder (Supabase Storage)

Bucket `rezeptbilder` (öffentlich lesbar, Schreiben nur für angemeldete
Nutzer ausser Rolle `viewer` — analog zu `weinbilder` bei der
Weinkeller-App). Beim Speichern eines Rezepts wird ein neues Bild
hochgeladen und ein zuvor gesetztes Bild automatisch aus dem Storage
entfernt, wenn es ersetzt oder gelöscht wird.

## Offene Punkte / mögliche nächste Schritte

- Vollimport der restlichen OneNote-Rezepte (siehe Projekt-Dokumentation).
