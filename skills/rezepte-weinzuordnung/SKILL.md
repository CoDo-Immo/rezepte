---
name: rezepte-weinzuordnung
description: Ordnet Rezepten der Rezepte-App passende Weine aus Gians Weinkeller zu (Rot, Weiss), inkl. Recherche in Gastro- und Weinquellen, Entfernungsempfehlungen und Sortierung. Bei 'Weine zuordnen', 'Rotweine ergänzen', 'Weinempfehlung Rezepte'.
---

# Rezepte ↔ Weinkeller: Weinzuordnung mit Recherche

Sprache: Deutsch. Direkt und sachlich, keine Schmeicheleien.

## Daten
- Supabase-Projekt "Gourmet-Adlemsried" (Project-ID vzsmjneerahucqwisouv), Tabellen `rezepte`, `wines`, `kategorien`.
- `rezepte.wein_empfehlung_ids` = text[] mit `wines.id` (kein FK). Es sind einzelne Jahrgänge (je Jahrgang eine ID).
- `wines`: typ ('Rotwein','Weisswein','Schaumwein','Süsswein','Alkoholfrei'), name, jahr, sorte, koerper, saeure, tannin, eignung, ausbau, status, anzahl, trinkreife_ab, trinkreife.
- Projektordner lokal: LLM_Projekte/projekte/Rezepte (KONTEXT.md, ENTSCHEIDE.md, SESSION_LOG.md).

## Regeln (von Gian vorgegeben)
1. Ergänzen: Wenn der gewünschte Weintyp (z. B. Rotwein) bei einem Rezept noch fehlt ("sofern es noch keine gibt"), passende Weine hinzufügen.
2. Entfernen nur auf Empfehlung: Bestehende Zuordnungen prüfen. Passt ein bestehender Wein nicht (Gericht, Struktur, Trinkreife überschritten), wird er NICHT automatisch gelöscht, sondern in einer Liste "Entfernung empfohlen" mit kurzer Begründung aufgeführt. Gelöscht wird erst nach Freigabe durch Gian.
3. Pro Wein alle Jahrgänge verknüpfen (nicht nur einen), der Jahrgang wird nicht hervorgehoben.
4. Welche Weine: status in ('Aktiv','Bestellt') und anzahl > 0. Nicht verknüpfen: andere Status, anzahl 0. Bei Weinen mit Status 'Bestellt' im Bericht kennzeichnen.
5. Sortierung von `wein_empfehlung_ids` (bei jedem Schreiben, auch bei unveränderten Beständen des betroffenen Rezepts): 1. Weinfarbe/typ in der Reihenfolge Rotwein, Weisswein, Schaumwein, Süsswein, Alkoholfrei; 2. Name (alphabetisch); 3. Jahrgang aufsteigend.
6. Wichtig: Die Weine müssen passen. Lieber kein Wein als ein schlechter. Rezepte, bei denen der Weintyp nicht passt, bewusst auslassen und im Bericht begründen. Typische Ausschlüsse für Rot: Süssspeisen/Schmarrn/Kuchen/Milchreis, Eingemachtes/Pickles, Butter/Würzbutter, Getränke, Salate, reine Technikseiten, Zitrus-dominierte Gerichte (Zitronenpasta, Guacamole mit Zitrone/Koriander).
7. Kategorien nach Auftrag (z. B. Hauptgerichte, Reisgerichte, Teigwaren, Suppen, Gemüse, Fisch, Sauce). Kategorien in `kategorien` prüfen, sie sind dynamisch.

## Vorgehen
1. Ist-Stand: Rezepte der Kategorien listen und je Rezept die bestehenden Weine nach typ gruppieren (Join über `wines`). Volltext (zutaten, zubereitung, notizen) der Kandidaten lesen. Notizen können einen Wein-Tipp enthalten.
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
   - Pro Rezept i. d. R. 2–3 Weine (Namen), je alle Jahrgänge.
6. Prüfen bestehender Zuordnungen mit denselben Kriterien (Regel 2) und Liste "Entfernung empfohlen" anlegen. Auch Weine, deren Trinkreife deutlich überschritten ist, markieren.
7. Schreiben (nach Freigabe bei Entfernungen): ein UPDATE mit VALUES (rezept_id, weinname), Join auf `wines` (status in Aktiv/Bestellt, anzahl > 0). Neue IDs mit den bestehenden vereinigen, freigegebene Entfernungen abziehen und das Ergebnis sortieren (Regel 5): `array_agg(id order by case typ when 'Rotwein' then 1 when 'Weisswein' then 2 when 'Schaumwein' then 3 when 'Süsswein' then 4 else 5 end, name, jahr)`. `updated_at = now()`. Nur ausführen, wenn für alle genannten Weinnamen Treffer gefunden wurden.
8. Kontrolle: Rezepte ohne gewünschten Weintyp neu zählen, Stichproben auf Reihenfolge und Konsistenz.
9. Dokumentation: SESSION_LOG.md im Projektordner ergänzen (Datum, Umfang, ausgelassene Rezepte, Entfernungsempfehlungen, Quellen), bei neuen Regeln ENTSCHEIDE.md.

## Bericht an Gian
- Tabelle: Rezept | Weine (in der Sortierung Farbe, Name, Jahrgang) | Begründung (kurz).
- Liste "Entfernung empfohlen": Rezept | Wein | Grund. Löschen erst nach Freigabe.
- Liste der bewusst nicht zugeordneten Rezepte mit Grund, gruppiert.
- Hinweis auf schwache Passungen, Weine mit Status 'Bestellt' und dünne Quellenlage.
- Sources-Liste mit Links.
- Bei Weinempfehlungen zu Gerichten immer auch einen Rotweinvorschlag machen (stehende Vorgabe von Gian).
