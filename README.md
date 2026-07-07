# ioBroker.growmanager

[![NPM version](https://img.shields.io/npm/v/iobroker.growmanager.svg)](https://www.npmjs.com/package/iobroker.growmanager)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Ein modularer ioBroker-Adapter zur Überwachung, Regelung und Diagnose mehrerer Grow-Bereiche, Zelte oder Räume.

---

## Funktionsumfang

### Kernfunktionen
- Mehrere unabhängige **Gruppen** (Growzelte, -räume, Growboxen)
- Temperatur- und Luftfeuchte-Sensoren mit konfigurierbarer **Aggregation** (Median, Mittelwert, gewichteter Mittelwert, Min, Max)
- Berechnung von **VPD**, Blatt-VPD, Taupunkt, absoluter Feuchte und Kondensationsrisiko
- **PID-Regler** (P, PI, PID) mit Anti-Windup (Clamping / Back-Calculation), bumpless Transfer, Derivative Filter
- **Hysterese-Zweipunktregelung** mit Mindestlauf- und Mindestauszeiten
- **7-stufige Prioritätslogik**: Notfall → VPD → Temperatur → Feuchte → Zeitplan → Überwachung → Aus

### Sensoren & Aktoren
- Alle Sensoren und Aktoren sind **vollständig optional** – fehlt ein Sensor oder Aktor, funktioniert der Rest weiterhin
- **Sensor-Rollen**: Primär, Backup, Plausibilität, Sicherheitslimit, Anzeige, Wirkungsprüfung
- Sensor-Glättung: Gleitender Mittelwert, Median, Exponentiell
- Sensor-Stabilitätszeit: Wiederhergestellte Sensoren werden erst nach konfigurierbarer Wartezeit für die Regelung verwendet
- Aktoren: Licht, Abluft, Zuluft, Umluft, Heizung, Kühlung, Befeuchter, Entfeuchter, Bewässerung, CO₂-Ventil, Klappe
- **Geteilte Aktoren**: Ein Aktor kann mehreren Gruppen dienen; Konflikte werden nach Priorität aufgelöst
- **Energie-Tracking**: Laufzeit- und Schaltstatistik für jeden Aktor (Stunden, Schaltvorgänge, Durchschnittsleistung)

### Regelungsarten
| Modus | Anforderungen |
|---|---|
| Nur Überwachung | Keine |
| Zeitplan | Mind. ein Aktor |
| Temperaturregelung | Temperatursensor + Heizung oder Abluft |
| Feuchteregelung | Feuchtsensor + Befeuchter oder Abluft |
| VPD-Regelung | Temperatur- und Feuchtsensor + Abluft |
| Kombiniert | Wie VPD |

### Luftstrommanagement
- **Abluft/Zuluft-Verbund**: Vier Modi (Only Exhaust, Linked, Ratio-Coupled, Curve-Coupled)
- **Umluft-Rotation**: Automatische Rotation alle 30 Minuten
- **Startup-Boost**: Kurzer Vollgas-Anlauf nach Wiedereinschaltung
- Außenluftunterdrückung bei Feuchtigkeitsumkehr

### Bewässerung
- Mehrere Bewässerungszonen pro Gruppe
- Feuchtebasierte Regelung (wenn Bodenfeuchte-Sensor vorhanden) oder **Timer-Betrieb** (ohne Sensor)
- Trockenläuferschutz (Flusssensor erforderlich)
- Leckage-Alarm (konfigurierbare Alarmschwelle)
- Manuelle Auslösung via `sendTo()`

### Diagnose & Alarme
- **4-Ebenen-Diagnose**: Erreichbarkeit → Feedback → Leistungsaufnahme → Prozesswirkung
- Trend-Auswertung (steigend, fallend, stabil, schwankend)
- Sensor-Plausibilitätsprüfung bei Mehrfachsensoren
- Interne **Alarmzentrale** mit Deduplizierung, Quittierung, Wiederholungszähler
- Alarm-Schweregrade: critical / fault / warning / info
- Alarm-Weiterleitung (Pushover, Email, Telegram, …) via sendTo-Adapter
- Ruhezeitenfilter für Alarmversand

### Fähigkeitsbasierte Degradierung
Der Adapter erkennt zur Laufzeit, welche Sensoren und Aktoren verfügbar sind, und wählt automatisch den bestmöglichen Betriebsmodus:

| Stufe | Bedeutung |
|---|---|
| FULL | Alle Sensoren, Aktoren und Feedback verfügbar |
| LIMITED | Regelung möglich, aber kein Feedback |
| FALLBACK | Gewünschter Modus nicht möglich; Fallback aktiv |
| MONITOR_ONLY | Keine Aktoren – nur Überwachung |
| SAFE | Sicherheitsmodus (z.B. Wartung, Not-Aus) |
| FAULT | Kritischer Fehler |

### Shadow Mode
Entscheidungen werden berechnet und protokolliert, aber **nicht** geschaltet. Nützlich für Einrichtung und Überprüfung.

### Kamera (optional)
- Snapshot-Aufnahme aus ioBroker-State, URL oder lokalem Pfad
- Kamera-Proxy: Bilder werden direkt über den Adapter-Port ausgeliefert (kein separater Zugriff nötig)
- Timelapse-Erstellung und -Anzeige
- **KI-Pflanzenanalyse** via Plant.id: automatische Erkennung von Krankheiten, Schädlingen und Mängeln
- Analyseergebnisse mit deutschen Übersetzungen, Konfidenz-Balken und Verlaufshistorie im Dashboard

### Sortenwiki
- Globale Sortendatenbank, erreichbar über den **📖 Sortenwiki**-Button im Dashboard-Header
- Sortenverwaltung: anlegen, bearbeiten, löschen
- Felder: Typ (Sativa/Indica/Hybrid), Züchter, Schwierigkeit, Wuchs-/Blütewochen, Ertrag, Wuchshöhe
- Klimaziele pro Sorte: Temperatur (Tag/Nacht), Luftfeuchte (Wachstum/Blüte), VPD-Bereich
- THC/CBD-Prozent, Aroma-Tags, Wirkungs-Tags, Notizfeld
- Vorbelegt mit: **Dante Inferno**, **Purple Punch**, **Seriousa**
- Daten werden in `strains.json` auf dem Adapter-Host gespeichert

### Live Web Dashboard
Der Adapter startet einen integrierten HTTP-Server (Standard-Port **8097**).  
Das Dashboard ist erreichbar unter: `http://<iobroker-ip>:8097/`  
Auf der ioBroker-Übersichtsseite erscheint GrowManager als Kachel mit direktem Link.

Features:
- Live-Ansicht aller Gruppen via Server-Sent Events (automatisches Update nach jedem Regelzyklus)
- Anzeige von Temperatur, Luftfeuchte, VPD, Bodenfeuchte, Kamera-Vorschau
- Aktor-Status mit Prozentwert-Balken und Energie-Statistiken
- Verlaufsgraphen (History-Adapter oder interner Stunden-Puffer)
- Alarm-Übersicht
- KI-Analyse-Auslösung, Ergebnisanzeige mit Zoom und Verlauf (mit Sternchen-Markierung)
- **📖 Sortenwiki** im Header: Sorten durchsuchen und verwalten
- Verbindungsstatus mit automatischer Wiederverbindung

### Admin-Oberfläche (ioBroker Admin)
- Dashboard-Tab mit Gruppen-Live-Karten
- Gruppen-Editor mit Tabs:
  - **Grundeinstellungen**: Name, Phase, Modus, Zeitplan, Profil
  - **Sensoren**: Vollständiger Sensor-Editor (Typ, Rolle, State-ID, Offset, Glättung, …)
  - **Aktoren**: Aktor-Editor (Typ, State-IDs, Sperrzeiten, Feedback, Energie-Tracking, …)
  - **Bewässerung**: Zonen-Editor mit Feuchte-Schwellen und Pumpenzuordnung
  - **Kamera**: Konfiguration von Snapshot-Quelle, KI-Analyse, Timelapse
- Alarm-Tab mit Quittierung
- Diagnose-Tab
- Einstellungen mit Konfigurations-Export/Import

---

## Installation

```bash
# Im ioBroker-Verzeichnis:
cd /opt/iobroker
npm install iobroker.growmanager

# Alternativ: aus dem Quellcode:
git clone https://github.com/mrder/ioBroker.growmanager
cd ioBroker.growmanager
npm install
npm run build
```

---

## Konfiguration

### Erste Schritte

1. Adapter in ioBroker installieren
2. Instanz anlegen (Admin → Adapter → GrowManager → + Instanz)
3. Im Einstellungs-Dialog: Web-Port prüfen (Standard 8097)
4. Im Tab **Gruppen**: Erste Gruppe anlegen
5. In der Gruppe:
   - **Sensoren**: ioBroker State-IDs für Temperatur/Feuchte eintragen
   - **Aktoren**: ioBroker State-IDs für Abluft/Licht/etc. eintragen
   - **Betriebsart**: Starten mit `Nur Überwachung`, dann schrittweise erweitern
6. Speichern und Adapter starten

### Globale Einstellungen

| Parameter | Standard | Beschreibung |
|---|---|---|
| `controlCycleSeconds` | 10 | Regelzyklusintervall in Sekunden |
| `webPort` | 8097 | Port für Live-Dashboard |
| `webBindAddress` | `0.0.0.0` | Bind-Adresse (oder `127.0.0.1` für lokalen Zugriff) |
| `startBehavior` | `lastState` | Verhalten beim Adapter-Start |
| `eventRetentionDays` | 30 | Aufbewahrung von Alarmereignissen |
| `logLevel` | `info` | Log-Detailgrad |

### Sensor-Konfiguration

| Feld | Beschreibung |
|---|---|
| `stateId` | ioBroker State-ID des Sensors (z.B. `zigbee.0.sensor1.temperature`) |
| `type` | Sensortyp: temperature, humidity, soilMoisture, co2, … |
| `role` | primary (Regelung), backup, plausibility, safetyLimit, … |
| `validMin/validMax` | Plausibilitätsbereich – Werte außerhalb werden verworfen |
| `offset/multiplier` | Kalibrierung: `Wert = (Rohwert + offset) × multiplier` |
| `smoothing` | Glättung: none, movingAverage, median, exponential |

### Aktor-Konfiguration

| Feld | Beschreibung |
|---|---|
| `commandStateId` | ioBroker State-ID zum Schalten (schreiben) |
| `feedbackStateId` | State-ID für Rückmeldung (optional, lesen) |
| `minimumOnSeconds` | Mindesteinschaltdauer (Schutz vor Taktbetrieb) |
| `minimumOffSeconds` | Mindestausschaltdauer |
| `safeState` | Verhalten bei Sicherheitsabschaltung: off / on / keep |
| `shared` | Aktor wird von mehreren Gruppen genutzt |

---

## ioBroker Objektbaum

```
growmanager.0
├── info
│   ├── connection         # Verbindungsstatus
│   ├── status             # Adapter-Status (starting / running / stopped)
│   ├── version            # Adapter-Version
│   ├── lastCycle          # Zeitstempel des letzten Zyklus
│   └── activeAlarms       # Anzahl aktiver Alarme
├── control
│   ├── enabled            # Adapter-Betrieb ein/aus
│   ├── maintenance        # Globaler Wartungsmodus
│   ├── emergencyStop      # Not-Aus (alle Aktoren in Sicherer Zustand)
│   └── acknowledgeAll     # Alle Alarme quittieren
├── groups
│   └── <groupId>
│       ├── climate
│       │   ├── temperature
│       │   ├── humidity
│       │   ├── vpd
│       │   ├── dewPoint
│       │   ├── absoluteHumidity
│       │   └── condensationRisk
│       ├── soil
│       │   ├── moisture
│       │   └── irrigationRequired
│       ├── schedule
│       │   ├── dayNight
│       │   └── nextChange
│       ├── control
│       │   ├── degradation
│       │   ├── mode
│       │   └── lastDecision
│       └── alarms
│           └── <alarmId>
│               ├── active
│               ├── severity
│               ├── code
│               ├── message
│               └── since
└── alarms
    └── <alarmId>.*        # Alle Alarme adapter-weit
```

---

## Sicherheitshinweis

Der GrowManager ist **keine sicherheitsgerichtete Steuerung**. Heizungen, Leuchten und elektrische Verbraucher benötigen weiterhin hardwareseitige Schutzmaßnahmen (Temperaturbegrenzer, Fehlerstromschutzschalter, Brandmeldetechnik).

---

## Entwicklung

```bash
npm run watch   # TypeScript-Watcher
npm test        # Unit-Tests (Jest)
npm run build   # Production-Build
```

### Projektstruktur

```
src/
├── main.ts                         # Adapter-Hauptklasse
├── models/config.ts                # Vollständiges Typmodell
├── services/
│   ├── SensorService.ts            # Sensorverarbeitung, Aggregation, Stabilitätszeit
│   ├── ActuatorService.ts          # Aktorsteuerung, Sperrzeiten, Feedback, Verifizierung
│   ├── ScheduleService.ts          # Zeitplan, Tag/Nacht, Übergangsrampen
│   ├── AlarmService.ts             # Alarmzentrale mit Deduplizierung
│   ├── SafetyService.ts            # Sicherheitsregeln, Not-Aus, Wartung
│   ├── ConfigurationService.ts     # Validierung, Export/Import, Migration
│   ├── GroupCapabilityService.ts   # Capability-Bewertung, Fallback-Ketten
│   ├── AirSystemService.ts         # Abluft/Zuluft-Verbund, Umluft-Rotation
│   ├── IrrigationService.ts        # Bewässerungszonen, Schutzfunktionen
│   ├── CameraService.ts            # Snapshots, Timelapse, KI-Analyse
│   ├── NotificationService.ts      # Discord, E-Mail, Telegram mit Cooldown
│   ├── SharedActorManager.ts       # Geteilte Aktoren, Abstimmung, Hysterese
│   └── WebDashboardService.ts      # Interner HTTP-Server, SSE, REST API (Strains)
├── control/
│   ├── ClimateController.ts        # 7-Stufen-Priorität, Shadow Mode, VPD-Routing
│   └── PidController.ts            # PID, Anti-Windup, Zweipunkt, Stepped
├── diagnostics/
│   └── DiagnosticsEngine.ts        # 4-Ebenen-Diagnose, Effekt-Checks, Trend
└── utils/
    ├── calculations.ts             # VPD, Taupunkt, Aggregation, Kennlinien
    ├── time.ts                     # Zeitfenster, Übergang, Formatierung
    └── logger.ts                   # ILogger, PrefixedLogger
admin/
├── src/App.tsx                     # React Admin-UI
└── web/dashboard.html              # Standalone Live-Dashboard (Port 8097)
test/unit/                          # Jest Unit-Tests (255 Tests, alle grün)
```

---

## Changelog

### 0.2.40 (2026-07-07)

- Sicherheit: XSS-Schutz in Sortenwiki — `esc()`-Helper für alle nutzergesteuerten `innerHTML`-Einfügungen
- Sicherheit: Inline-`onclick` in Listeneinträgen durch Event-Delegation mit `data-strain-id` ersetzt
- `wikiLoad` und `wikiDelete` prüfen HTTP-Status vor Weiterverarbeitung; Array-Guard für API-Antwort
- Null-Guards für numerische Felder in Sortendetailansicht
- `importConfig`: Callback wird jetzt **vor** `restart()` gesendet, damit die Antwort den Client erreicht
- REST API: PUT `/api/strains/:id` gibt 404 zurück wenn die Sorte nicht existiert (vorher: neue Sorte angelegt)
- `DEFAULT_STRAINS`-Timestamps werden konsistent beim ersten Seed gesetzt

### 0.2.39 (2026-07-07)

- **Sortenwiki**: Globale Sortendatenbank über 📖-Button im Dashboard-Header
- Vollständiger CRUD über REST API (`/api/strains`), Daten in `strains.json` auf dem Adapter-Host
- Vorbelegt mit: Dante Inferno, Purple Punch, Seriousa
- Suche, Typ-/Schwierigkeitsbadges, Detailansicht mit Klimazielen, Formular zum Anlegen/Bearbeiten

### 0.2.38 (2026-07-06)

- Fix: Zuluftaktor erhielt nach Adapter-Neustart keinen AUS-Befehl (Bedingung `supplyCommand !== false` entfernt)
- Fix: Geteilte Aktoren wurden doppelt befehligt (Air-System-Pfad + Voting) → `!a.shared`-Filter im Air-System
- Fix: Owner-Vote nutzte veralteten `state.requested` statt aktuellem Klimabedarf (`computeParticipantNeed`)

### 0.2.37 (2026-07-06)

- ioBroker-Übersichtsseite: GrowManager erscheint als Kachel mit direktem Dashboard-Link (`localLinks` in `io-package.json`)

### 0.2.35 – 0.2.36 (2026-07-05)

- Diverse Laufzeit-Bugfixes: `_plantPanelOpen` ReferenceError, `dbSwitchTab` Null-Guard, SSE-Reconnect Timer-Leak
- IrrigationService: Trockenläufer-Alarm nur bei konfiguriertem Flusssensor
- `importConfig` löst Adapter-Neustart aus; `detectAdapters` nutzt vollständige Instanz-ID
- Body-Limit sendet 413 vor `req.destroy()`; Fallback-Fetch überschreibt keine neueren SSE-Daten

### 0.2.34 (2026-07-05)

- Fix: Admin-UI zeigte veraltete Live-Daten nach Adapter-Neustart
- Fix: Aktor-Sync bei Adapter-Start: `needsSync`-Flag stellt Sollzustand nach Toleranzzeit wieder her

### 0.2.26 – 0.2.33 (2026-07-03 – 2026-07-04)

- Kamera-UX: Proxy-Auslieferung über Adapter-Port, flackerfreier Thumbnail-Cache via ObjectURL
- KI-Analyse: Zoom-Steuerung im Modal, persistente Verlaufshistorie mit Sternchen-Markierung
- Plant.id: Ergebnisdarstellung mit deutschen Übersetzungen und Konfidenz-Balken
- Kamera/Analyse-Bereich im Dashboard unterhalb der Aktoren positioniert

### 0.2.21 – 0.2.25 (2026-07-03)

- **Energie-Tracking**: Laufzeit- und Schaltstatistik für alle Aktoren
- Admin-UI: Encoding-Fixes für deutsche Sonderzeichen im IIFE-Bundle (zuverlässige `\uXXXX`-Escape-Methode)

### 0.2.0 (2026-07-02)

Erstes stabiles Release.

- Geteilte Aktoren: Abstimmungsmodi `any`, `majority`, `primary`
- Befehlsverifizierung: Retry nach 10 s, Alarm bei ausbleibendem Feedback
- Benachrichtigungsservice: Discord, E-Mail, Telegram mit Quiet-Hours und Cooldown
- History-Trends: `history.0`, `influxdb.0`, `sql.0` mit internem Fallback-Puffer
- Shadow- und Wartungsmodus: Licht-Aktoren laufen immer durch

### 0.1.0 – 0.1.26 (2026-06-30 – 2026-07-03)

Entwicklungsversionen. Vollständige Implementierung aller Kernfunktionen:

- Gruppen-basierte Klimaregelung (VPD / Temperatur / Feuchte / CO₂)
- PID-Regler mit Anti-Windup, bumpless Transfer, Derivative Filter
- Fähigkeitsbasierte Degradierung (FULL → FAULT)
- Bewässerungssteuerung, Luftstrommanagement, Kamera-Modul
- 4-Ebenen-Diagnose, Alarmzentrale, Geteilte Aktoren
- Live-Dashboard (Port 8097), React Admin-UI
- Sensor-Stabilitätszeit, Aggregationsoptionen, Sensor-Glättung
- Außenluft-Guard, Admin-UI Objektpicker, Klimaprofil-Presets

---

## Lizenz

MIT © GrowManager Contributors
