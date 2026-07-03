# Changelog

All notable changes to the GrowManager ioBroker adapter are documented here.

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
