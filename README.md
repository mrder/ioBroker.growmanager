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
- Außenluftunterd rückung bei Feuchtigkeitsumkehr

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
- Timelapse-Erstellung
- Optionale lokale oder externe KI-Bildanalyse

### Live Web Dashboard
Der Adapter startet einen integrierten HTTP-Server (Standard-Port **8097**).  
Das Dashboard ist erreichbar unter: `http://<iobroker-ip>:8097/`

Features:
- Live-Ansicht aller Gruppen mit Server-Sent Events (automatisches Update nach jedem Regelzyklus)
- Anzeige von Temperatur, Luftfeuchte, VPD, Bodenfeuchte
- Aktor-Status mit Prozentwert-Balken
- Alarm-Übersicht
- Verbindungsstatus mit automatischer Wiederverbindung

### Admin-Oberfläche (ioBroker Admin)
- Dashboard-Tab mit Gruppen-Live-Karten
- Gruppen-Editor mit Tabs:
  - **Grundeinstellungen**: Name, Phase, Modus, Zeitplan, Profil
  - **Sensoren**: Vollständiger Sensor-Editor (Typ, Rolle, State-ID, Offset, Glättung, …)
  - **Aktoren**: Aktor-Editor (Typ, State-IDs, Sperrzeiten, Feedback, …)
  - **Bewässerung**: Zonen-Editor mit Feuchte-Schwellen und Pumpenzuordnung
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
git clone https://github.com/iobroker-community/ioBroker.growmanager
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
│   ├── ActuatorService.ts          # Aktorsteuerung, Sperrzeiten, Feedback
│   ├── ScheduleService.ts          # Zeitplan, Tag/Nacht, Übergangsrampen
│   ├── AlarmService.ts             # Alarmzentrale mit Deduplizierung
│   ├── SafetyService.ts            # Sicherheitsregeln, Not-Aus, Wartung
│   ├── ConfigurationService.ts     # Validierung, Export/Import, Migration
│   ├── GroupCapabilityService.ts   # Capability-Bewertung, Fallback-Ketten
│   ├── AirSystemService.ts         # Abluft/Zuluft-Verbund, Umluft-Rotation
│   ├── IrrigationService.ts        # Bewässerungszonen, Schutzfunktionen
│   ├── CameraService.ts            # Snapshots, Timelapse, KI-Analyse
│   ├── SharedActorManager.ts       # Geteilte Aktoren, Konfliktauflösung
│   └── WebDashboardService.ts      # Interner HTTP-Server, SSE Live-Updates
├── control/
│   ├── ClimateController.ts        # 7-Stufen-Priorität, Shadow Mode
│   └── PidController.ts            # PID, Anti-Windup, Zweipunkt, Stepped
├── diagnostics/
│   └── DiagnosticsEngine.ts        # 4-Ebenen-Diagnose, Trend-Auswertung
└── utils/
    ├── calculations.ts             # VPD, Taupunkt, Aggregation, Trend
    ├── time.ts                     # Zeitfenster, Formatierung
    └── logger.ts                   # ILogger, PrefixedLogger
admin/
├── src/App.tsx                     # React Admin-UI
└── web/dashboard.html              # Standalone Live-Dashboard (Port 8097)
test/unit/                          # Jest Unit-Tests (116 Tests)
```

---

## Changelog

### 0.1.0 (2026-06-30)
- Erste vollständige Implementierung aller Phasen 1–11
- Vollständig optionale Sensorik und Aktorik
- Live-Dashboard auf Port 8097
- VPD-, Temperatur-, Feuchte- und Kombinationsregelung
- Bewässerungssteuerung mit optionalem Bodenfeuchte-Sensor
- Luftstrommanagement mit 4 Modi
- Kamera-Modul (optional)
- 4-Ebenen-Diagnose und Alarmzentrale
- Fähigkeitsbasierte Degradierung (FULL → FAULT)
- Geteilte Aktoren mit Prioritätsauflösung
- Sensor-Stabilitätszeit nach Wiederherstellung
- PID-Regler mit Anti-Windup und bumpless Transfer
- Admin-UI mit vollständigem Sensor/Aktor-Editor

---

## Lizenz

MIT © GrowManager Contributors
