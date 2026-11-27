---
name: rezepte-weinzuordnung
description: Ordnet Rezepten der Rezepte-App passende Weine aus Gians Weinkeller zu (Rot, Weiss), inkl. Recherche in Gastro- und Weinquellen, Entfernungsempfehlungen und Sortierung. Bei 'Weine zuordnen', 'Rotweine ergänzen', 'Weinempfehlung Rezepte'.
---

# Rezepte ↔ Weinkeller: Weinzuordnung mit Recherche

Sprache: Deutsch. Direkt und sachlich, keine Schmeicheleien.

## Daten
- Supabase-Projekt "Gourmet-Adlemsried" (Project-ID vzsmjneerahucqwisouv), Tabellen `rezepte`, `rezept_weine`, `wines`, `kategorien`.
- Seit 26.11.2026 (App 3.0): `rezept_weine` = eine Zeile pro Rezept und Wein **ohne Jahrgang**: `rezept_id` (FK auf `rezepte`, ON DELETE CASCADE), `wein_name`, `weingut` (= `wines.name` / `wines.weingut`), `begruendung` (text), unique (rezept_id, wein_name, weingut). `id` ist eine Identity-Spalte (GENERATED ALWAYS), beim Insert nicht angeben. Die Jahrgänge löst die App beim Anzeigen aus `wines` auf (Status Aktiv/Bestellt). Benennt Gian einen Wein im Keller um, zieht ein Trigger auf `wines` die Empfehlungen nach, sobald kein Jahrgang mehr den alten Namen trägt.
- Veraltet, nicht mehr schreiben: `rezepte.wein_empfehlung_ids` (text[] mit Jahrgangs-IDs) und `rezepte.wein_begruendung` (eine Begründung pro Rezept). Sie bleiben bis zur Freigabe durch Gian als Sicherung stehen, die App liest sie nicht mehr.
- `wines`: typ ('Rotwein','Weisswein','Schaumwein','Süsswein','Alkoholfrei'), name, weingut, jahr, sorte, koerper, saeure, tannin, eignung, ausbau, status, anzahl, trinkreife_ab, trinkreife.
- Projektordner lokal: LLM_Projekte/projekte/Rezepte (KONTEXT.md, ENTSCHEIDE.md, SESSION_LOG.md).

## Regeln (von Gian vorgegeben)
1. Ergänzen: Wenn der gewünschte Weintyp (z. B. Rotwein) bei einem Rezept noch fehlt ("sofern es noch keine gibt"), passende Weine hinzufügen.
2. Entfernen nur auf Empfehlung: Bestehende Zuordnungen prüfen. Passt ein bestehender Wein nicht (Gericht, Struktur, Trinkreife überschritten), wird er NICHT automatisch gelöscht, sondern in einer Liste "Entfernung empfohlen" mit kurzer Begründung aufgeführt. Gelöscht wird erst nach Freigabe durch Gian.
3. Verknüpft wird der Wein (Name + Weingut), nicht der Jahrgang. Alle Jahrgänge im Keller gehören automatisch dazu, der Jahrgang wird nicht hervorgehoben.
4. Welche Weine: nur Weine, von denen mindestens ein Jahrgang status in ('Aktiv','Bestellt') und anzahl > 0 hat. Bei Weinen mit Status 'Bestellt' im Bericht kennzeichnen.
5. Sortierung: macht die App selbst (1. Weinfarbe/typ in der Reihenfolge Rotwein, Weisswein, Schaumwein, Süsswein, Alkoholfrei; 2. Name). Im Bericht dieselbe Reihenfolge verwenden.
6. Wichtig: Die Weine müssen passen. Lieber kein Wein als ein schlechter. Rezepte, bei denen der Weintyp nicht passt, bewusst auslassen und im Bericht begründen. Typische Ausschlüsse für Rot: Süssspeisen/Schmarrn/Kuchen/Milchreis, Eingemachtes/Pickles, Butter/Würzbutter, Getränke, Salate, reine Technikseiten, Zitrus-dominierte Gerichte (Zitronenpasta, Guacamole mit Zitrone/Koriander).
7. Kategorien nach Auftrag (z. B. Hauptgerichte, Reisgerichte, Teigwaren, Suppen, Gemüse, Fisch, Sauce). Kategorien in `kategorien` prüfen, sie sind dynamisch.

## Vorgehen
1. Ist-Stand: Rezepte der Kategorien listen und je Rezept die bestehenden Weine aus `rezept_weine` nach typ gruppieren (Join über `wines` auf name + weingut). Volltext (zutaten, zubereitung, notizen) der Kandidaten lesen. Notizen können einen Wein-Tipp enthalten.
2. Weinkeller laden: alle Weine mit status Aktiv/Bestellt, anzahl > 0, mit Körper, Säure, Tannin, Eignung, Ausbau, Trinkreife.
3. Geschwister als Referenz: Ähnliche Rezepte (z. B. andere Hummus, Quiches, Ravioli) und deren Zuordnung ansehen, damit die Logik konsistent bleibt.
4. Recherche (Suchaufträge, parallel mit WebSearch standard, dann WebFetch auf die besten Treffer):
   - "<Gericht/Hauptzutat> Weinempfehlung Rotwein" und "<dish> wine pairing red wine low tannin"
   - Zubereitungsart/Sauce: "Rahmsauce Weinempfehlung", "Tomatensauce Rotwein Barbera Sangiovese", "Pesto Wein Pairing"
   - Aromen: "<Zutat> Wein Begleitung" (Kürbis, Randen, Pilze, Feigen, Chili/Erdnuss, Hummus, Sauerkraut, Lauch/Quiche)
   - Rebsortenseiten: "best food matches for Grenache / Merlot / Barbera / Syrah"
   - Gute Quellen: Wine Folly, Decanter, Matching Food & Wine (Fiona Beckett), Michelin Guide, Falstaff, Meininger, Bilanz.ch, Gastro-Rezeptseiten mit Weintipp. Paywall-Seiten nur als sichtbar belegt zitieren. Nichts erfinden, was die Quelle nicht hergibt.
5. Abgleich mit den Weindaten: Struktur schlägt Regel. Mit koerper/saeure/tannin/eignung argumentieren:
   - Süsse, cremige, mehlige Gerichte: weiche Weine (Merlot-Cuvées, niedrig–mittel Tannin).
   - Säure/Fett (Sauerkraut, Sahne, Tomate): säurebetont, tanninarm (Barbera, Lirac, Sangiovese).
   - Chili, Bitterstoffe (Rucola, Chicorée), Zitrus: nur tanninarm, fruchtig.
   - Raucharomen/Umami (Miso, geräucherter Tofu): Syrah/Grenache.
   - Kräftige Schmorgerichte, Pilze, Auberginen, Linsen: kräftige, tanninreichere Weine (Solus, Cigalus, Reserva Marti).
   - Pro Rezept i. d. R. 2–3 Weine.
6. Prüfen bestehender Zuordnungen mit denselben Kriterien (Regel 2) und Liste "Entfernung empfohlen" anlegen. Auch Weine, deren Trinkreife deutlich überschritten ist, markieren.
7. Schreiben (nach Freigabe bei Entfernungen):
   - Neu: `insert into rezept_weine (rezept_id, wein_name, weingut, begruendung) select v.rid, w.name, w.weingut, v.txt from (values …) v(rid, name, txt) join (select distinct name, weingut from wines where status in ('Aktiv','Bestellt') and anzahl > 0) w on w.name = v.name on conflict (rezept_id, wein_name, weingut) do update set begruendung = excluded.begruendung`. Vorher prüfen, dass jeder Weinname genau einen Treffer (Name + Weingut) hat.
   - Entfernen (nur freigegebene): `delete from rezept_weine where rezept_id = … and wein_name = …`.
   - Mit `returning` kontrollieren, dass alle Zeilen geschrieben wurden.
   - Nie die ganze Tabelle neu aufbauen (kein truncate, kein delete ohne rezept_id/wein_name), sonst gehen Zuordnungen anderer Läufe verloren.
8. Kontrolle: Rezepte ohne gewünschten Weintyp neu zählen, Stichproben auf Reihenfolge und Konsistenz.
9. Dokumentation: SESSION_LOG.md im Projektordner ergänzen (Datum, Umfang, ausgelassene Rezepte, Entfernungsempfehlungen, Quellen), bei neuen Regeln ENTSCHEIDE.md.

## Bericht an Gian
- Tabelle: Rezept | Wein (Sortierung Farbe, Name) | Begründung pro Wein (so wie sie geschrieben wird).
- Liste "Entfernung empfohlen": Rezept | Wein | Grund. Löschen erst nach Freigabe.
- Liste der bewusst nicht zugeordneten Rezepte mit Grund, gruppiert.
- Hinweis auf schwache Passungen, Weine mit Status 'Bestellt' und dünne Quellenlage.
- Sources-Liste mit Links.
- Bei Weinempfehlungen zu Gerichten immer auch einen Rotweinvorschlag machen (stehende Vorgabe von Gian).

## Begründung pflegen (pro Wein, seit 26.11.2026)
Jede neue Zeile in `rezept_weine` bekommt eine eigene `begruendung`: 1–2 Sätze (ca. 15–35 Wörter) nur zu diesem Wein, ohne Jahrgang. Inhalt: welche Komponente des Gerichts der Wein trägt und warum (Körper, Säure, Tannin, Ausbau, Eignung laut Weindaten oder Quelle). Wenn die Weindaten das Gericht oder die Zutat ausdrücklich nennen, das erwähnen («Die Weindaten nennen …»). Schwache Passungen offen benennen («schwache Passung», «eher schwächer, wenn …»). Nichts erfinden, was Weindaten oder Quelle nicht hergeben. Kontrolle: `select count(*) from rezept_weine where begruendung is null` vor und nach dem Lauf melden.
