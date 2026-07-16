# Changelog

All notable changes to the GrowManager ioBroker adapter are documented here.

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

### Qualitäts-Release — umfassender Bug-Fix-Zyklus, alle 24 Review-Findings behoben

Diese Version markiert das Ergebnis einer vollständigen Code-Revision nach dem 0.2.x-Entwicklungszyklus.
Ein mehrstufiges Review über alle Quelldateien ergab 24 Findings — alle wurden behoben.
255 Unit-Tests grün in 3 aufeinanderfolgenden Durchläufen.

---

### Behoben — Kritische Bugs

#### Korrektheit & Logik
- **Midnight-Flush lief nur einmal für alle Gruppen** (`DatabaseService`): `lastMidnightFlush` war ein einzelner String statt einer `Map<string, string>` — nach der ersten Gruppe wurden alle anderen Gruppen an dem Tag nicht mehr geflusht. Fix: pro-Gruppe-Tracking.
- **Priorität-Vertauschung bei kritischer Untertemperatur** (`ClimateController`): Priorität 2 (Kondensationsrisiko) kehrte vorzeitig zurück und verhinderte, dass Priorität 3 (kritische Untertemperatur) die Heizung aktivieren konnte. Fix: Untertemperatur kommt jetzt vor Kondensation.
- **VPD-Sensor nicht verfügbar → RH-Fallback** (`computeParticipantNeed`): Wenn VPD konfiguriert aber `gs.vpd === null`, fiel der Code auf den RH-Setpoint zurück. Fix: bei konfiguriertem VPD ohne Sensor-Wert wird der Aktor sicher gestoppt.
- **Outdoor-Guard fehlte für Teilnehmer-Stimmen** (`main.ts`): Der Außenluft-Guard wurde für den Eigentümer berechnet, aber nicht auf Teilnehmer-Stimmen angewendet. Teilnehmer-Gruppen prüfen jetzt ihren eigenen Outdoor-Sensor.
- **`trackActuatorOff` fehlte bei `ratedPowerW=0`** (`main.ts`): Bei Aktoren ohne Leistungsdaten wurde `trackActuatorOff` nicht aufgerufen, `lastOnTs` blieb gesetzt und verhinderte künftige Laufzeit-Erfassung. Fix: `trackActuatorOff` wird immer aufgerufen (mit 0 W).
- **Energie-Tracking im Legacy-`resolveAll()`-Pfad fehlte** (`main.ts`): Geteilte Aktoren ohne `sharedParticipants` wurden nicht in der Energiestatistik erfasst. Fix: Tracking auch im Legacy-Pfad.
- **Aktive Alarme gelöschter Gruppen** (`AlarmService`): Wenn eine Gruppe aus der Konfiguration entfernt wurde, blieben ihre aktiven Alarme für immer im Speicher. Fix: `cleanup()` akzeptiert jetzt bekannte Gruppen-IDs und löscht Alarme für nicht mehr existierende Gruppen.

#### Actuator-Service
- **`noFeedback`-Fehlalarm beim Adapter-Start** (`ActuatorService`): `timeSince` war riesig wenn `lastSwitchTs=0` (kein Befehl seit Start). Fix: Guard `state.lastSwitchTs > 0` vor dem Health-Check.
- **`firstSync` zählte als echter Schaltvorgang** (`ActuatorService`): Beim ersten Sync nach dem Start wurde `switchCount` und `lastHourSwitches` erhöht, auch wenn sich der Zustand nicht änderte. Fix: Zähler nur bei echtem Zustandswechsel (`wasOn !== isNowOn`).

#### Dashboard
- **XSS in Vote-Tooltip** (`dashboard.html`): `v.reason`, `v.groupName`, `v.groupId` wurden unescaped in `innerHTML` eingefügt. Fix: `esc()` für alle Felder.
- **XSS im onclick-Attribut** (`dashboard.html`): `a.name` wurde unescaped in `onclick="sendControl(..., '${a.name} ...')"` eingefügt. Fix: `esc(a.name)`.
- **Sperrzeit-Countdown war statisch** (`dashboard.html`): `blockSecondsLeft` wurde nur beim SSE-Update gesetzt und tickte nicht live. Fix: Backend sendet `blockUntil`-Timestamp; Frontend hat `setInterval` das `blk-cd`-Elemente sekündlich aktualisiert.
- **Kein Doppelklick-Schutz** (`dashboard.html`): `sendControl`/`sendMode` konnten doppelt ausgelöst werden. Fix: `_sendInFlight`-Flag verhindert parallele Requests.

#### Sonstiges
- **Verify-Timer bei numerischem Befehl nicht abgebrochen** (`main.ts`): Beim Wechsel von booleschem auf numerischen Befehl blieb der alte Verify-Timer aktiv und konnte einen Fehlalarm auslösen. Fix: Pending Verify wird bei numerischen Befehlen explizit abgebrochen.

---

## [0.2.0] - 2026-07-05

### Stabiles Release — 6 Audit-Runden, alle Bugs behoben

Diese Version markiert den ersten stabilen Release. Alle Kern-Features wurden implementiert und in 6
aufeinanderfolgenden Code-Audit-Runden auf Laufzeit-Korrektheit geprüft. 254 Unit-Tests grün.

---

### Neue Features seit v0.1.26

#### Geteilte Aktoren (Shared Actuators)
- Aktoren können mehreren Gruppen zugeordnet werden; Eigentümer-Gruppe schreibt, Teilnehmer stimmen ab
- Abstimmungsmodi: `any` (OR — EIN wenn irgendwer EIN will), `majority` (gewichtete Mehrheit),
  `primary` (Eigentümer entscheidet, hoher Einfluss ≥ 0.8 kann überstimmen)
- Hysterese-Timer für Zustandswechsel verhindert schnelles Hin- und Herschalten
- `influenceFactor` (0–100) als konfigurierbares Stimmgewicht pro Teilnehmer
- Feedback-Sichtbarkeit: Rückmeldung des Geräts erscheint in allen beteiligten Gruppen

#### Befehlsverifizierung mit Retry & Alarm
- Nach jedem Schreibbefehl startet ein 10-Sekunden-Timer
- Timer prüft ob das Gerät mit `ack:true` bestätigt hat
- Bei Abweichung: 1x automatischer Retry, dann `ACTUATOR_NO_FEEDBACK` Alarm/Warnung
- Korrekte Trennung von `ack:false` (eigener Schreibbefehl) und `ack:true` (Geräte-Bestätigung)
- Funktioniert für Aktoren mit und ohne separatem `feedbackStateId`

#### VPD-Regelungsmodus
- In VPD-Modus werden Lüfter, Befeuchter und Entfeuchter durch `decideVpd` geroutet
- `vpdMin`/`vpdMax` Sollband mit Mindestbreite 0.05 kPa
- Leaf-VPD-Berechnung über optionalen Blatttemperatur-Sensor

#### Luftstrommanagement (AirSystemService)
- `computeAirDemand`: berechnet Luftbedarf aus Abweichungen bei Temperatur, Feuchte und VPD
- `computeAirOutput`: setzt Lüfter-Ausgabe mit Hysterese und Kapazitätsgrenzen
- Koppelkurven (`ratioPoints`) für koordinierte Zu-/Abluft-Steuerung
- Außenluft-Guard: Lüfter werden gesperrt wenn Außenluft thermodynamisch ungünstiger ist

#### Bewässerungsservice (IrrigationService)
- Zonenbasierte Bewässerungssteuerung mit Delta-basierter Durchflussmessung (kein Drift)
- Tageslimit, feuchtebasierte Auslösung, Alarm bei Durchfluss-Überschreitung
- `ZoneState` mit `lastFlowTs` für korrekte Intervall-Berechnung

#### Kamera-Service (CameraService)
- Timelapse-Snapshots mit konfigurierbarem Intervall
- `captureOnlyWhenLightOn` für lichtbasierte Aufnahme-Steuerung
- Offline-Alarm nach konfigurierbarem Ausfall-Schwellwert (Intervall × 3, min. 1 min)
- Optionale lokale oder externe KI-Analyse mit Konfidenz-Filter und Health-Score

#### Diagnostik-Engine (DiagnosticsEngine)
- Effekt-Checks: prüft ob Aktorbefehle die Sensorwerte innerhalb eines Zeitfensters verändern
- Stündliche Historien-Puffer als Trend-Fallback wenn kein History-Adapter installiert
- Automatische Bereinigung abgelaufener Checks (`waitSeconds + windowSeconds × 3`)

#### Benachrichtigungsservice (NotificationService)
- Konfigurierbare Kanäle: Discord, E-Mail, Telegram
- Quiet-Hours, Severity-Filter, Cooldown pro Alarm-ID
- Formatierte Discord-Embeds mit Farb-Kodierung nach Schweregrad
- Cooldown wird erst nach erfolgreichem Versand gesetzt (Netzfehler → Retry möglich)

#### Shadow- und Wartungsmodus
- **Shadow-Mode** (monitorOnly): alle Aktoren blockiert, nur Licht-Aktoren schalten durch
- **Wartungsmodus**: Lüfter, Befeuchter etc. gesperrt — Licht-Aktoren bleiben aktiv
- Beide Modi blockieren nie Licht-Aktoren (Zeitplan-Steuerung bleibt immer aktiv)

---

### Bugfixes (Audit-Runden 1–6)

| # | Datei | Beschreibung |
|---|-------|--------------|
| 1 | SensorService | IQR-Filter synchronisierte Gewichte nicht mit Werten → falsche gewichtete Mittelwerte |
| 2 | ActuatorService | `canSwitch`: `!runTime.get()` invertiert → Schaltungen fälschlich blockiert |
| 3 | ActuatorService | `lastHourSwitches` nicht getrimmt → unbegrenztes Array-Wachstum |
| 4 | ActuatorService | `stuckOn` false-positive bei Neustart (`lastSwitchTs=0` → ~1.7M Sekunden Laufzeit) |
| 5 | ActuatorService | `manualLock` lief nie ab (fehlende `= false` Zuweisung in `tickOverrides`) |
| 6 | IrrigationService | Flow-Akkumulation mit Gesamt-Laufzeit statt Delta → starke Überschätzung |
| 7 | AirSystemService | `ratioPoints` null-Deref → Exception wenn keine Koppelkurve konfiguriert |
| 8 | AlarmService | Async Listener-Fehler nicht gefangen → unhandled promise rejection |
| 9 | ClimateController | Shadow-Mode blockierte Licht-Aktoren → Beleuchtung nie einschaltbar |
| 10 | ClimateController | `inferControlTarget` ohne `config.mode` → VPD-Routing komplett defekt |
| 11 | ClimateController | `vpdMin`/`vpdMax` null in `lerp` → NaN-Sollwerte downstream |
| 12 | SafetyService | Wartungsmodus blockierte Licht-Aktoren |
| 13 | main.ts | `cycleRunning`-Lock fehlte → parallele Regelzyklen überschrieben sich |
| 14 | main.ts | Eigene `ack:false` Schreibbefehle als Geräte-Feedback verarbeitet → falscher Dashboard-Status |
| 15 | main.ts | `computeParticipantNeed`: sp null-Deref wenn kein aktives Profil geladen |
| 16 | main.ts | VPD-Ziel NaN wenn `vpdMin`/`vpdMax` nicht im Profil definiert |
| 17 | main.ts | `setOverride`: kein Fehler-Callback wenn Aktor-ID nicht gefunden |
| 18 | main.ts | `getActiveSetpoint` 4× redundant pro Regelzyklus aufgerufen |
| 19 | main.ts | `lightChangeTimes ?? 0` im Dashboard → Übergangs-Fortschritt immer 100% nach Neustart |
| 20 | main.ts | History-Fallback-Kette brach beim ersten Adapter mit 0 Datenpunkten ab |
| 21 | calculations.ts | `dewPoint(t, 0)` → `Math.log(0) = -Infinity` → NaN in allen nachgelagerten Berechnungen |
| 22 | calculations.ts | `curveInterpolate`: Division durch 0 bei doppelten x-Stützpunkten |
| 23 | time.ts | `transitionProgress(ts, 0)` → Division durch 0 |
| 24 | SharedActorManager | `anyOn` prüfte alle Gruppen → Niedrig-Priorität konnte Hoch-Priorität OFF überstimmen |
| 25 | CameraService | `captureIntervalMinutes` konnte 0 sein → sofortiger Offline-Alarm ohne Wartezeit |
| 26 | ScheduleService | Übergangs-Erkennung lieferte falsches Ergebnis für `transitionMinutes > 60` |
| 27 | NotificationService | Cooldown vor Versand gesetzt → bei Netzfehler Alarm dauerhaft stumm für gesamte Cooldown-Dauer |
| 28 | WebDashboardService | `req.destroy()` ohne Error-Handler → `uncaughtException` → Adapter-Crash bei großem POST-Body |

---

## [0.1.26] - 2026-07-03

### Verbesserungen seit v0.1.0 — Gesamtübersicht

Diese Version fasst alle wesentlichen Neuerungen und Bugfixes seit dem Initial-Release zusammen.

---

### Kernfunktionen

- **Sensorverwaltung**: Primär-, Backup- und Monitor-Rollen mit konfigurierbarer Priorität.
  Backup-Sensoren aktivieren sich automatisch wenn alle Primärsensoren ausfallen.
- **Aggregation**: Median, Mittelwert, gewichteter Mittelwert, Min, Max; Ausreißerfilter ab 3+ Sensoren.
- **Glättung**: Keine / gleitender Mittelwert / Median / Exponential (EMA) je Sensor konfigurierbar.
- **Stabilitätszeit**: Sensor gilt nach Ausfall erst nach konfigurierbarer Stabilisierungszeit wieder als gültig.
- **Startwerte**: Beim Adapterstart werden alle konfigurierten Sensor-States sofort eingelesen.

### Klimaregelung

- **VPD / Temperatur / Feuchte / CO₂ / Bodenfeuchte**: Separat oder kombiniert regelbar.
  Wenn VPD als Regelgröße gewählt wird, berechnet der Adapter den notwendigen Feuchte-Sollwert
  dynamisch — Temperatur- und Feuchte-Sollwerte bleiben als Schutzgrenzen aktiv.
- **PID-Regler** pro Regelgröße mit konfigurierbaren Kp/Ki/Kd-Werten und Anti-Windup.
- **Tag/Nacht-Profile**: Jede Gruppe hat einen vollständigen Klimaprofil-Editor mit separaten
  Tag- und Nacht-Sollwerten für Temperatur, Feuchte, VPD, CO₂ und Bodenfeuchte.
- **Klimaprofil-Presets**: 7 vorkonfigurierte Pflanzenphasen im Admin-Editor auswählbar:
  Keimling, Wachstum, Blüte früh, Blüte spät, Trocknung, Gemüse/Tomate, Salat/Kräuter.
- **Per-Aktor Regelziel** (`controlTarget` / `controlDirection`): Jeder Aktor kann explizit
  konfigurieren welche Messgröße er regelt und ob er in positive/negative Richtung wirkt.
  Fehlende Werte werden automatisch aus dem Aktortyp abgeleitet (rückwärtskompatibel).

### Außenluft-Guard

- **Vergleichssensor pro Gruppe** (`outdoorSensor`): Optionale State-IDs für Außentemperatur
  und -feuchte. Abluft-/Zuluftlüfter mit aktiviertem Guard werden gesperrt wenn die Außenluft
  thermodynamisch ungünstiger als die Innenluft ist.
- Konfigurierbare Schwellwerte: Mindest-Temperaturdelta (Standard 2 °C) und
  Maximal-Feuchtedelta (Standard 10 %).

### Aktor- und Gruppenmanagement

- **SharedActorManager**: Verhindert gleichzeitige Schaltbefehle bei physisch gemeinsam
  genutzten Aktoren über Gruppen hinweg.
- **Gruppenkapazitäts-Service**: Berechnet die maximale Aktorlast pro Gruppe.
- **Wartungsmodus** und **Not-Aus**: Globale Sicherheitsabschaltung per ioBroker-State.
- **Manueller Modus pro Gruppe**: Dashboard-Toggle AUTO ↔ MANUELL mit PIN-Schutz.
  Im Manuell-Modus werden EIN/AUS-Buttons für alle Aktoren angezeigt.
- **Sensor-Abweichungsalarm**: Konfigurierbare Schwelle wenn mehrere Sensoren einer Gruppe
  stark voneinander abweichen.

### Stale-Erkennung (verbessert)

- **Alive-State überschreibt Timestamp**: Wenn `healthStateId` konfiguriert ist (z.B.
  `zigbee.0.device.available`) und Gerät meldet alive=true → kein Stale-Fehler egal wie
  alt der letzte Datenpunkt ist. Meldet es false → sofort "Gerät offline".
- **Geräte-Liveness-Sharing**: Temp- und Feuchtigkeitssensor am selben physischen Gerät
  (gleicher ID-Prefix, z.B. `zigbee.0.abc123`) teilen einen gemeinsamen Liveness-Timestamp.
  Wenn einer der Kanäle aktualisiert, gilt das gesamte Gerät als frisch.
- **Startup-Stale-Fix**: `onStateChange` nutzt `Math.max(state.ts, Date.now() - 5000)` —
  verhindert falschen Stale-Alarm beim Adapterstart wenn `state.ts` ein alter gespeicherter
  Wert ist.
- **Standard `staleAfterSeconds`**: 1200 s (20 Minuten).

### Alarm-System

- Mehrere konfigurierbare Alarmkanäle (Push, E-Mail, ioBroker-State).
- Alarm-Quittierung per ioBroker-State (`control.acknowledgeAll`).
- Alarm-Retention konfigurierbar (`eventRetentionDays`).

### Bewässerung

- Regelbasierte Bewässerungssteuerung mit konfigurierbaren Zeit- und Feuchtigkeitsbedingungen.
- Kopplung an Bodenfeuchte-Sensoren mit Ziel-/Toleranzwerten.

### Web-Dashboard (Port 8097)

- Live-Anzeige aller Gruppen: Temperatur, Feuchte, VPD, Sensorqualität, Aktorstatus.
- Sollwert-Balken mit farblicher Zielbereichsmarkierung für VPD, Temperatur und Feuchte.
- Aktive Geräte-Icon-Leiste mit Puls-Animation für laufende Aktoren.
- Monitor-Sensor-Tooltip mit Sensordetails.
- Modus-Toggle AUTO/MANUELL pro Gruppe mit PIN-Schutz.
- Manuelle Aktor-Steuerung (EIN/AUS) im Manuell-Modus.
- SSE-Stream (Server-Sent Events) für Echtzeit-Updates ohne Polling.

### Admin-UI (React)

- **Objektpicker**: Durchsuchbares Modal für alle ioBroker-States, 2-Ebenen-Baum
  (Adapter-Instanz → Unterordner, z.B. `0_userdata.0` → `Macros`).
  Zeigt freundliche Namen neben kryptischen IDs aus der ioBroker-Objektdatenbank.
- **Klimaprofil-Editor**: Vollständiger Tag/Nacht-Sollwert-Editor mit Preset-Auswahl.
- **Live-Dashboard im Admin**: Polling aller Gruppen-States mit Temperatur, Feuchte,
  VPD, Sensorqualität und Gesundheitsstatus. Neutraler Fallback-Status vor dem ersten Zyklus.
- **Diagnose-Ansicht**: Sensorqualität, Stale-Status, Gerätestatus pro Gruppe.
- **Gruppen-Editor**: Vollständige Konfiguration inkl. Außensensor, Sensor-Abweichungsschwelle,
  Stabilitätszeit, Aggregationsmethode.
- **Aktor-Editor**: Regelziel (`controlTarget`), Wirkrichtung (`controlDirection`),
  Außenluft-Guard-Checkbox für Abluft-/Zuluftlüfter.

### Build & Infrastruktur

- **Fester Bundle-Dateiname** (`assets/index.js`, kein Hash) — `admin/index.html` muss
  nach einem Rebuild nie mehr manuell aktualisiert werden.
- **IIFE-Bundle-Format** für Kompatibilität mit ioBroker Admin-iframe (kein `type="module"`).
- 116 automatisierte Unit-Tests (Jest), alle grün.

---

## [0.1.0] - 2026-06-30

### Added
- Initial release: core adapter, group management, climate control (VPD/PID), alarm system,
  schedule service, shared actor manager, web dashboard (port 8097), React admin UI, 116 tests
