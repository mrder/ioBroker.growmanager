# Changelog

All notable changes to the GrowManager ioBroker adapter are documented here.

> **Hinweis:** Nur Meilenstein-Versionen sind hier dokumentiert. Die vollständige Patch-History aller Zwischenversionen findet sich im [master-Branch](../../blob/master/CHANGELOG.md).

## [0.4.0] - 2026-09-17

Vollständige Zusammenfassung aller Neuerungen gegenüber **v0.3.0**. Umfasst 49 Patch-Versionen (v0.3.1–v0.3.49).

### Neue Features

#### CO₂-Regelung — v0.3.2
- Neue Aktor-Typen `co2Valve` und `exhaustFan` mit Zweipunkt-Hysterese-Regelung.
- Konfigurierbare Sollwerte: `co2Target`, `co2Tolerance`, `co2Max`, `co2Critical` im ClimateSetpoint.
- Alarme: `CO2_HIGH` und `CO2_LOW` mit Deduplizierung bei mehreren CO₂-Aktoren.

#### VPD-Hysterese richtungsbasiert (Laufen bis Mitte) — v0.3.7–0.3.8
- Aktoren laufen jetzt bis zur **Mitte des Sollbereichs** bevor sie abschalten — längere, stabilere EIN/AUS-Zyklen statt Bang-Bang.
- Gilt für Einzel- und geteilte Aktoren; im `majority`-Modus proportionale Abstimmung.

#### RH-Hysterese & VPD-Guard — v0.3.21–0.3.28
- Entfeuchter/Befeuchter regeln primär nach RH-Sollwert; VPD dient nur noch als harter Überbereich-Guard.
- Manueller Override läuft nicht ab solange die Gruppe im MANUELL-Modus bleibt.

#### Zeitgesteuerter Aktor-Typ (`timedActuator`) — v0.3.41–0.3.43
- Neuer Aktor-Typ „Zeitgesteuert" (timedActuator): pro Aktor können mehrere Wochenpläne konfiguriert werden (Wochentage + Zeitfenster). Der Adapter schaltet automatisch, unabhängig von der Klimaregelung.
- Geteilte timedActuator-Aktoren funktionieren korrekt: Eigentümer stimmt per Zeitplan, Teilnehmer enthalten sich.
- Admin-UI blendet bei Typ timedActuator klimaspezifische Felder (Regelziel, Wirkrichtung, Stufenregelung) aus und zeigt Zeitplan-Editor direkt am Aktor.
- Neuer Aktor-Typ „Zeitgesteuert" (timedActuator): pro Aktor können mehrere Wochenpläne konfiguriert werden (Wochentage + Zeitfenster). Der Adapter schaltet automatisch, unabhängig von der Klimaregelung.
- Geteilte timedActuator-Aktoren funktionieren korrekt: Eigentümer stimmt per Zeitplan, Teilnehmer enthalten sich.
- Admin-UI blendet bei Typ timedActuator klimaspezifische Felder (Regelziel, Wirkrichtung, Stufenregelung) aus und zeigt Zeitplan-Editor direkt am Aktor.

#### Blüte-Temperatur-Schutz (`bloomTempGuard`) — v0.3.44–0.3.46
- Heizung und Entfeuchter werden automatisch gesperrt, wenn eine Blüte-Gruppe die konfigurierte Maximaltemperatur überschreitet.
- 2 °C Hysterese: Guard bleibt aktiv bis 2 °C unter der Maximaltemperatur — verhindert Flatterbetrieb.
- Guard gilt auch für zeitgesteuerte Aktoren (`timedActuator`).

#### Leaf-VPD-Schätzung — v0.3.44
- Blatt-VPD wird jetzt auch ohne physischen Blatttemperatursensor berechnet — Schätzung über konfigurierbaren Offset (Standard: 2 °C kühler als Lufttemperatur).
- Anzeige im Dashboard unterhalb des Luft-VPD.

#### Trocknungsphase (`drying`) — v0.3.49
- Neue Pflanzenphase „Trocknung" neben Wuchs und Blüte.
- Dauerhafter Licht-Lockout: Licht-Aktoren werden in der Trocknungsphase automatisch gesperrt (optional deaktivierbar).
- Optionale proportionale Rampe: Soll-Temperatur und Soll-Feuchte werden linear über einen konfigurierbaren Zeitraum interpoliert (Startdatum, Dauer in Tagen, Start-/Endwerte).
- Dashboard zeigt Fortschritts-Badge (Tag X / Y) mit Fortschrittsbalken und aktuellen Sollwerten.
- Admin-UI mit eigenem Konfigurationspanel für Rampe und Licht-Lockout.

#### Alarm-Verbesserungen — v0.3.47–0.3.48
- **StuckOn-Retry**: Wenn ein Aktor als klebendes Relais erkannt wird, wird der AUS-Befehl einmal wiederholt. Alarm erst nach weiteren 90 Sekunden.
- **Grace-Period für Verbindungsverlust**: `ACTUATOR_UNREACHABLE`-Alarm erst nach 60 s kontinuierlichem Ausfall — kurze WLAN-Aussetzer lösen keinen Alarm mehr aus.
- **Alarmverlauf im Dashboard**: Klick auf den „Alarme"-Chip öffnet ein Modal mit allen Alarmen (aktiv + gelöscht), sortiert nach Zeitstempel.

#### Energie-Tracking & Dashboard-Karten — v0.3.4–0.3.6
- Energie-Tracking für dauerlaufende Aktoren (kein abgeschlossener EIN→AUS-Zyklus): `ratedWatts` als Fallback für Wh-Berechnung.
- Korrektur: Aktoren ohne `ratedPowerW` wurden nicht korrekt als AUS getracked → Laufzeit lief durch.
- Energie-Verlaufstabelle und Tages-Statistiken auf Card-Layout pro Aktor/Sensor umgestellt.
- Wochen-Navigation (◀/▶) für Statistik und Energieverlauf (7 Tage/Seite, 30 Tage gespeichert).

### Leistungsüberwachung (Power Monitoring) — v0.3.33–0.3.40
- Automatisch erlernter Peak-Watt-Wert (auto-learned) als Vergleichsbasis.
- Live-Leistungsbadge pro Aktor-Zeile (nur bei eingeschaltetem Aktor sichtbar).
- Energie-Tracking für W-Sensor-Aktoren korrigiert: korrekter Wh-Wert auch wenn ioBroker keine State-Change-Events für unveränderte Leistungswerte sendet.
- `energyStateUnit`-Default-Handling korrigiert (fehlende explizite Einheit führte zu 0 Wh).
- Energie-Tracking für Umluft-, Luft- und Bewässerungs-Aktoren ergänzt.
- Energie-Verlaufstabelle auf Card-Layout pro Aktor umgestellt.

### Klima-Regelung — v0.3.7–0.3.28
- **VPD-Hysterese richtungsbasiert** (v0.3.7): Aktoren laufen bis zur Mitte des Sollbereichs statt sofort abzuschalten — längere, stabilere EIN/AUS-Zyklen.
- **Geteilte Aktoren** (v0.3.8): Gleiches Laufen-bis-Mitte-Prinzip für shared actors; proportionale Abstimmung im majority-Modus.
- **RH-Hysterese** (v0.3.21–0.3.28): Entfeuchter/Befeuchter regeln primär nach RH-Sollwert; VPD fungiert als harter Überbereich-Guard.
- CO₂-Regelung (v0.3.2): co2Valve/exhaustFan mit Zweipunkt-Hysterese, CO₂_HIGH- und CO₂_LOW-Alarme.
- Blatt-VPD, Taupunkt und Kondensationsrisiko durchgehend verfügbar.

### Dashboard & UI — v0.3.6–v0.3.49
- Tages-Statistiken als Sensor-Cards (v0.3.6).
- Wochen-Navigation für Statistik und Energie (7 Tage/Seite, ◀/▶, 30 Tage gespeichert) (v0.3.7).
- Aktor-Alert-Regeln im Admin konfigurierbar (v0.3.33+).
- Live-Admin-Vorschau-Fix (v0.3.30).
- Push-Benachrichtigungen verbessert (v0.3.31–0.3.32).
- Trocknungsphase-Badge, Alarmverlauf-Modal (v0.3.48–0.3.49).

### Stabilitätskorrekturen (v0.3.1–v0.3.49, Rundenpässe)
- Über 25 dedizierte Bug-Fix-Pässe mit Korrekturen in: ClimateController, IrrigationService, AirSystemService, ActuatorService, SensorService, ScheduleService, DatabaseService, WebDashboardService, NotificationService, DiagnosticsEngine, main.ts und dashboard.html.
- Schwerpunkte: XSS-Fixes im Dashboard (14+ Stellen), Energie-Tracking-Korrekturen, SSRF-Guards, Hysterese-Fehler bei geteilten Aktoren, Kondensationsverriegelung, Pumpen-Sofortstopp, Race-Conditions, Async-Exception-Handling, NaN-Guards in ScheduleService.

---

## [0.3.9] - 2026-07-20

Siehe Commit-Message `v0.3.9` — 7-Runden Bug-Fix-Pass (Energie-Tracking, SafeState, Dashboard, ConfigImport, VPD-Hysterese, Datum-Off-by-One, Promise-Rejection-Handling).

---

## [0.3.8] - 2026-07-20

### Klima — VPD + Temperatur Hysterese für geteilte Aktoren (shared actors)

- **`computeParticipantNeed()` überarbeitet** (`main.ts`): Geteilte Aktoren liefen bisher nur minimal über die Sollbereichsgrenze (bang-bang ohne Totband). Jetzt gilt das gleiche Laufen-bis-Mitte-Prinzip wie bei `decideVpdAct()` im ClimateController:
  - **Entfeuchter**: EIN wenn VPD < vpdMin, AUS erst wenn VPD > vpdMid — proportionale Dringlichkeit
  - **Befeuchter**: EIN wenn VPD > vpdMax, AUS erst wenn VPD < vpdMid — proportionale Dringlichkeit
  - **Kühlung/Abluft/Zuluft**: EIN wenn T > target+hyst, AUS erst wenn T < target — proportionale Dringlichkeit
  - **Heizung**: EIN wenn T < target-hyst, AUS erst wenn T > target — proportionale Dringlichkeit
- **VPD-Überschreitung im Abstimmungs-Modus** (`SharedActorManager.ts`):
  - **`any`/`primary`**: hartes Veto — jede AUS-Stimme mit `urgency > 0` (= Sollbereich verletzt) von Nicht-Eigentümer blockiert den Aktor sofort
  - **`majority`**: proportionale Abwägung — kleiner Überschuss kann von großem Restbedarf überstimmt werden; effektives Gewicht = `weight × (1 + urgency)`
- **`votingResults`-Map** (`main.ts`): liefert `currentlyOn` für jeden Aktor an `computeParticipantNeed()` damit die Hysterese zyklus-übergreifend korrekt funktioniert

---

## [0.3.7] - 2026-07-16

### Dashboard — Wochen-Navigation für Statistik und Energie

- **Wochen-Navigation** (`dashboard.html`): Stats- und Energie-Verlauf zeigt jetzt nur 7 Tage auf einmal. Über ◀/▶-Buttons kann Woche für Woche zurückgeblättert werden. 30 Tage werden weiterhin gespeichert. Bewässerungs-Tab unverändert (ereignisbasiert, keine Tages-Aggregation). Navigation zeigt Datums-Range der angezeigten Woche.

### Klima — VPD-Hysterese richtungsbasiert (Laufen bis Sollbereichsmitte)

- **`decideVpdAct()` geändert** (`ClimateController.ts`): VPD-Aktoren laufen jetzt bis zur **Mitte des Sollbereichs** (vpdMid), nicht nur bis zur unteren/oberen Sollbereichsgrenze.
  - **Entfeuchter/Abluft (`dir='down'`)**: EIN wenn VPD < vpdMin, AUS erst wenn VPD > vpdMid
  - **Befeuchter (`dir='up'`)**: EIN wenn VPD > vpdMax, AUS erst wenn VPD < vpdMid
  - Per-Aktor-Hysterese-State (`actuatorHystStates`) wird immer verwendet, kein geteilter Gruppen-State mehr — verhindert den Startup-Bug bei dem `prevState=0` im Totband sofort AUS triggerte
  - Aktoren mit explizit gesetztem `actuatorHysteresis` behalten ihr bisheriges Verhalten

---

## [0.3.6] - 2026-07-16

### UI — Tages-Statistiken als Sensor-Cards

- **`renderStatsTable()` neu gestaltet** (`dashboard.html`): Ersetzt die extrem breite Tabelle (pro Sensor 3 Spalten: Min/Avg/Max × n Sensoren) durch das gleiche Card-Layout wie die Energie-Ansicht. Jeder Sensor bekommt eine eigene Card mit kompakter Tabelle: Datum | Min (blau) | Avg (fett) | Max (rot). Cards fließen per Flexbox nebeneinander. CO₂ in der Sensor-Label-Map ergänzt.

---

## [0.3.5] - 2026-07-16

### Patch — Energie-Tracking: Laufzeit + Wh-Berechnung + Darstellung

- **`trackActuatorOff()` wurde für Aktoren ohne `ratedPowerW` nie aufgerufen** (`main.ts`): Im SharedAktor-Pfad stand `else if (actuatorConfig.ratedPowerW)` und im windSimulator-Pfad `else if (act.ratedPowerW)` — bei `ratedPowerW = 0` oder nicht konfiguriert wurde der OFF-Event nicht getracked. Folge: `lastOnTs` blieb auf dem Mitternachts-Reset stehen → angezeigte Laufzeit = aktuelle Uhrzeit statt tatsächliche Betriebszeit. Fix: `else` ohne Guard — `trackActuatorOff(…, 0)` setzt `lastOnTs = 0` und addiert `runtimeMin` korrekt, auch ohne Wh-Berechnung.
- **0 Wh bei W-Sensor mit konstantem Wert** (`main.ts`): ioBroker sendet State-Events für `energyStateId` nur bei Wertänderungen. Bleibt der Sensor konstant (z.B. Lüfter immer 50 W), kommt kein Event → `updateActuatorPowerSample()` wird nie aufgerufen → `runtimeMin = 0`, `wh = 0`. Fix: beim Adapterstart den aktuellen W-Wert per `getForeignStateAsync()` lesen und als `ratedWatts`-Fallback in `trackActuatorOn()` übergeben, wenn keine `ratedPowerW` konfiguriert ist.
- **Energietabelle katastrophale Darstellung** (`dashboard.html`): Pro Aktor 2 Spalten (Wh + Laufzeit) ergab eine extrem breite Tabelle die nicht scrollt. Neu: ein Card-Rahmen pro Aktor mit eigener kompakter Tabelle (Datum | Energie | Laufzeit | Ø W). Cards fließen per Flexbox nebeneinander.

---

## [0.3.4] - 2026-07-15

### Patch — Fix Energie-Tracking: 0 Wh bei dauerlaufenden Aktoren

- **0 Wh in Verlaufsdaten trotz konfigurierter IST-Leistung** (`DatabaseService`): `getEnergy()` berechnete den Ø-Watt aus abgeschlossenen EIN→AUS-Perioden (`acc.runtimeMin > 0 ? acc.wh / acc.runtimeMin * 60 : 0`). Für Aktoren die seit Adapterstart durchgehend laufen (keine AUS-Schaltung), ist `runtimeMin = 0` und `wh = 0` → `avgW = 0` → angezeigte Wh = 0. Root-Cause: `ratedPowerW` war im Akkumulator nicht gespeichert und stand für den Fallback nicht zur Verfügung.
- **Fix**: `ratedWatts`-Feld zum Energie-Akkumulator-Eintrag hinzugefügt. `trackActuatorOn()` nimmt jetzt optional `ratedWatts` entgegen und speichert es im Eintrag. `getEnergy()` (Live-Display) und `flushDay()` (Mitternachts-Flush) nutzen `acc.ratedWatts` als Fallback wenn `acc.runtimeMin === 0` (kein abgeschlossener Zyklus). Alle 5 `trackActuatorOn()`-Callsites in `main.ts` übergeben jetzt `actuatorConfig.ratedPowerW ?? 0`.

---

## [0.3.3] - 2026-07-14

### Patch — 4 Nachbesserungen an CO₂-Regelung + stuckOn-Fix

- **CO₂_LOW-Alarm blieb im Dead-Zone-Bereich stecken** (`ClimateController`): `else if (co2 >= target - tolerance)` ließ den Alarm zwischen `target - 3×tol` und `target - tol` weder erhöhen noch löschen. Fix: `else` — Alarm wird immer gelöscht sobald kein Raise-Kriterium mehr zutrifft.
- **Doppelte Alarm-Notifications bei mehreren co2Valve-Aktoren** (`ClimateController`): `decideCo2Act()` wurde pro Aktor aufgerufen; jede Invocation rief `alarmService.raise()` mit demselben Key auf → zweiter Aufruf inkrementierte `repeatCount` und feuerte Listener erneut (Push-Duplikate). Fix: Alarm-Logik in neue Methode `raiseCo2Alarms()` ausgelagert, die einmalig pro Gruppe vor dem Aktor-Loop aufgerufen wird.
- **stuckOn-Erkennung blind für dauerhaft-AUS-befohle Aktoren** (`ActuatorService`): Guard `state.lastSwitchTs > 0` blockierte stuckOn-Alarm für Aktoren die seit Adapterstart nur OFF befohlen wurden (z.B. Licht in Nachtphase). Da `lastSwitchTs` nach v0.3.1 nur bei echten Zustandswechseln gesetzt wird, blieb es bei 0 → kein Alarm. Fix: Guard geändert auf `!state.needsSync` — nach dem ersten Sync-Befehl (firstSync=false) ist die Startup-Grace abgelaufen.
- **Dashboard CO₂ nutzte dritte unabhängige Aggregation** (`main.ts`): CO₂ wurde für Controller (mit Stabilität), Dashboard und ioBroker-State-Schreibung dreimal unabhängig aggregiert → unterschiedliche Werte möglich. Fix: Dashboard liest `state?.co2` aus dem GroupState (bereits mit Stabilität aus dem Watchdog-Zyklus).

---

## [0.3.2] - 2026-07-14

### Feature — CO₂-Regelung + Admin-Logo

- **CO₂-Zweipunkt-Regelung** (`ClimateController`): `decideCo2Act()` war bisher ein leerer Platzhalter. Jetzt echte Regelung: CO₂-Ventil oder -Generator (Aktor `co2Valve`, `controlDirection: up`) schaltet EIN wenn CO₂ < Ziel − Toleranz, AUS wenn Zielbereich erreicht. Abluft-Aktor (`controlDirection: down`) für CO₂-Abbau analog. Zweipunkt-Hysterese via `hysteresisCheck()`.
- **CO₂ im GroupState** (`config.ts`, `main.ts`): Feld `co2: number | null` in `GroupState` ergänzt. Wird im Watchdog-Zyklus via `sensorService.aggregate()` befüllt und an `ClimateController.decide()` übergeben. CO₂-Trend wird in `DiagnosticsEngine.recordValue()` aufgezeichnet.
- **CO₂-Alarme** (`AlarmService`): Neue Alarm-Codes `CO2_HIGH` (warning ab `co2Max`, critical ab `co2Critical`) und `CO2_LOW` (warning wenn CO₂ < Ziel − 3 × Toleranz). Schwellen konfigurierbar im `ClimateSetpoint`, sinnvolle Defaults wenn nicht gesetzt.
- **Neue ClimateSetpoint-Felder**: `co2Max` (Warnschwelle ppm, Default: Ziel + Toleranz × 4) und `co2Critical` (Kritisch-Schwelle ppm, Default: max(5000, Ziel + Toleranz × 8)).
- **CO₂-Anzeige im Dashboard**: War bereits implementiert — zeigt ppm mit Farbkodierung und Trend-Klick (keine Dashboard-Änderung nötig).
- **Admin-Logo `admin/growmanager.png`**: 256 × 256 px PNG mit Pflanzensymbol auf dunkelgrünem Hintergrund. Pflichtfeld für ioBroker-Repository-Veröffentlichung.

---

## [0.3.1] - 2026-07-14

### Patch — 3 Nachbesserungen aus Code-Review nach v0.3.0

- **`lastSwitchTs` wurde bei firstSync gesetzt** (`ActuatorService`): Beim ersten Sync nach dem Start wurde `state.lastSwitchTs = Date.now()` gesetzt, auch wenn sich der Zustand nicht änderte. Folge: `minimumOffSeconds`/`minimumOnSeconds` blockierten Befehle direkt nach dem Neustart, und der stuckOn-Startup-Grace (`lastSwitchTs=0`) funktionierte nicht. Fix: `lastSwitchTs` nur noch innerhalb des `if (wasOn !== isNowOn)`-Blocks setzen.
- **`lastMidnightFlush` nicht vorgemerkt in `loadGroup()`** (`DatabaseService`): Die Map für den Midnight-Flush wurde bei Adapterstart nicht initialisiert. Der erste Watchdog-Tick (~60s nach Start) sah `undefined !== today` und rief `flushDay()` auf — mit noch fast leeren Akkumulatoren. Fix: `loadGroup()` setzt den heutigen Tag in die Map, sodass der erste echte Flush erst um Mitternacht stattfindet.
- **Teilnehmer-Outdoor-Guard ohne Feuchte-Zuluft-Ausnahme** (`main.ts`): Der Outdoor-Guard für Teilnehmer-Stimmen blockierte Lüfter auch dann, wenn VPD zu hoch war und Außenluft feuchter als Innenluft — also genau den Fall, in dem die Zuluft sinnvoll wäre. Fix: gleiche Feuchte-Zuluft-Ausnahme wie beim Eigentümer-Guard ergänzt.

---

## [0.3.0] - 2026-07-13
>>>>>>> master

---

## [0.3.0] - 2026-07-13 — Qualitäts-Release

Vollständiger Bug-Fix-Zyklus nach umfassendem Code-Review aller Quelldateien.
255 Unit-Tests grün in 3 aufeinanderfolgenden Durchläufen.

### Klimaregelung
- Prioritätsreihenfolge korrigiert: kritische Untertemperatur wird vor Kondensationsrisiko behandelt (Frost-Schutz geht vor Schimmel-Schutz)
- VPD-Modus sicherer: wenn VPD konfiguriert aber Sensor ausfällt, stoppt der Aktor statt auf RH-Setpoint zurückzufallen
- Außenluft-Guard jetzt auch für Teilnehmer-Stimmen bei geteilten Zu-/Abluft-Aktoren wirksam

### Energieerfassung
- Tagesabschluss (Midnight-Flush) läuft jetzt korrekt pro Gruppe statt nur einmal global
- Energie-Tracking für alle Pfade vollständig: direkte Aktoren, Voting-Loop und Legacy-Shared-Pfad
- Laufzeiterfassung auch für Aktoren ohne konfigurierte Leistungsdaten (`ratedPowerW = 0`)

### Aktor-Service
- Keine Fehlalarme mehr beim Adapter-Start (`noFeedback`, `stuckOn` erst nach echtem Schaltbefehl aktiv)
- Erstsynchronisation beim Start zählt nicht mehr als echter Schaltvorgang in der Statistik

### Dashboard
- XSS-Schutz: alle nutzergesteuerten Felder in Vote-Tooltip und Steuerschaltflächen korrekt escaped
- Sperrzeit-Countdown läuft jetzt live im Browser (sekündliches Update via `data-until`-Timestamp)
- Doppelklick-Schutz für alle Steuer- und Modusschaltflächen

### Alarmverwaltung
- Aktive Alarme für gelöschte Gruppen werden beim regelmäßigen Watchdog-Takt automatisch bereinigt

---

## [0.2.0] - 2026-07-05 — Stabiles Release

Erstes stabiles Release nach vollständiger Implementierung aller Kernfunktionen
und 6 aufeinanderfolgenden Code-Audit-Runden. 254 Unit-Tests grün.

### Geteilte Aktoren (Shared Actuators)
- Ein Aktor kann von mehreren Gruppen gemeinsam genutzt werden
- Drei Abstimmungsmodi: `any` (EIN wenn irgendwer EIN will), `majority` (gewichtete Mehrheit mit optionalem Dringlichkeits-Bonus), `primary` (Eigentümer entscheidet, Teilnehmer können überstimmen)
- Konfigurierbares Stimmgewicht (`influenceFactor` 0–100) und Hysterese-Timer gegen Flackern

### VPD-Regelung
- Vollständiger VPD-Modus: Lüfter, Befeuchter und Entfeuchter werden durch VPD-Sollband gesteuert
- VPD-Priorität: wenn VPD konfiguriert, überstimmt er den RH-Setpoint für Ent-/Befeuchter
- VPD-Schutzzone (oberes/unteres Drittel) blockiert gegensteuernde Aktoren
- Außenluft-Guard mit Feuchte-Ausnahme: Zuluft erlaubt wenn VPD zu hoch und Außenluft feuchter

### Befehlsverifizierung
- Jeder Schreibbefehl wird nach 10 s auf Gerätebestätigung geprüft
- Automatischer Retry bei ausbleibendem Feedback, danach `ACTUATOR_NO_FEEDBACK` Alarm

### Energiestatistik
- Laufzeit- und Verbrauchserfassung für alle Aktoren (Watt-Sensor oder `ratedPowerW`-Fallback)
- Tages-Statistiken persistent im ioBroker-Objektbaum (bis 30 Tage History)

### Luftstrommanagement
- Koordinierte Zu-/Abluft-Steuerung mit Koppelkurven und Kapazitätsgrenzen
- Präventive Lüftung bei Überschreitung des Sollwerts (vor Hysterese-Auslösung)
- Außenluft-Guard auf Basis von Temperaturdelta

### Bewässerung & Kamera
- Zonenbasierte Bewässerungssteuerung mit Delta-basierter Durchflussmessung
- Timelapse-Kamera mit optionaler KI-Analyse (Plant.id) und Verlaufshistorie

### Diagnose & Alarm
- 4-Ebenen-Diagnose: Effekt-Checks prüfen ob Aktorbefehle messbare Sensorveränderungen bewirken
- Alarmzentrale mit Deduplizierung, Schweregraden und Benachrichtigungskanälen (Discord, E-Mail, Telegram)
- Tagesbasierte Sensor-Statistiken (Min/Max/Avg/Samples)

### Dashboard & Admin-UI
- Live-Dashboard auf Port 8097 (SSE, dark theme, Trend-Charts, Sortenwiki)
- React Admin-UI für vollständige Konfiguration aller Gruppen, Sensoren und Aktoren
