# Changelog

All notable changes to the GrowManager ioBroker adapter are documented here.

## [0.1.23] - 2026-07-03

### Added
- **Per-Aktor Regelziel** (`controlTarget`/`controlDirection`): Jeder Aktor kann jetzt explizit
  konfigurieren, welche Messgröße er regelt (Temperatur, Feuchte, VPD, CO₂, Bodenfeuchte,
  Licht, Timer, Benutzerdefiniert) und in welche Richtung er wirkt (up/down/both).
  Rückwärtskompatibel: fehlende Werte werden automatisch aus dem Aktortyp abgeleitet.
- **Außenluft-Vergleichssensor pro Gruppe** (`outdoorSensor`): Optionale State-IDs für
  Außentemperatur und -feuchte. Lüfter mit aktiviertem `outdoorGuardEnabled` werden gesperrt,
  wenn die Außenluft nicht günstiger als die Innenluft ist.
  Konfigurierbare Schwellwerte: Min-Temperaturdelta (Standard 2 °C) und Max-Feuchtedelta (Standard 10 %).
- **Vollständiger Klimaprofil-Editor**: Sollwerte jetzt mit Sektionen (Temperatur, Feuchte, VPD, CO₂, Bodenfeuchte)
  und optionalen Feldern für CO₂-Ziel/-Toleranz und Bodenfeuchte-Ziel/-Toleranz.
- Admin-UI: Aktor-Editor zeigt Regelziel- und Wirkrichtungs-Dropdowns; Außenluft-Guard-Checkbox
  für Abluft-/Zuluftlüfter; Gruppen-Editor mit vollständiger Außensensor-Konfiguration.

### Fixed
- `requestByTarget()` Richtungsfilter: Aktoren mit `controlDirection='both'` wurden fälschlicherweise
  übersprungen, wenn eine spezifische Richtung (z.B. 'down') angefordert wurde.
- Außenluft-Guard nutzt jetzt die konfigurierten Schwellwerte aus `group.outdoorSensor` statt
  fest codierten Standardwerten.

---

## [0.1.22] - 2026-07-03

### Added
- **Dashboard AUTO/MANUELL-Umschalter pro Gruppe**: Jede Gruppe hat jetzt einen Modus-Toggle
  im Gruppen-Header. Im MANUELL-Modus werden EIN/AUS-Buttons für alle Aktoren der Gruppe angezeigt.
- **PIN-Schutz für Moduswechsel**: Der Wechsel in den MANUELL-Modus erfordert denselben PIN
  wie manuelle Aktuator-Steuerung.
- Neuer SSE-Feldname `runtimeMode` im `DashboardGroupState` für die Modusweitergabe an das Dashboard.
- Neue REST-Route `POST /api/mode` im `WebDashboardService` für Modus-Callbacks.

---

## [0.1.21] - 2026-07-02

### Added
- Dashboard: modusabhängige Sollwert-Balken für VPD, Temperatur und Feuchte mit farblicher
  Zielbereichsmarkierung.
- Aktive Geräte-Icon-Leiste mit Puls-Animation für laufende Aktoren.
- Verbesserte visuelle Hierarchie im Dashboard (Sektions-Trennlinien, Farbkodierung).

---

## [0.1.20] - 2026-07-02

### Added
- Dashboard: manuelle Aktorsteuerung per EIN/AUS-Buttons mit PIN-Schutz.
- Sollwertanzeige und Kamerabild-Kachel im Gruppen-Card.
- Monitor-Sensor-Tooltip mit Sensordetails.

### Fixed
- Doppelter Modus-Tag-Bug im Dashboard behoben.

---

## [0.1.19] - 2026-07-02

### Added
- Sensor-Rollen: `primary`, `backup`, `monitor` mit Prioritätsreihenfolge.
- Backup-Sensoren aktivieren sich automatisch, wenn alle primären Sensoren ausfallen.

---

## [0.1.18] - 2026-07-02

### Fixed
- Leere Admin-UI: Vite-Build von ES-Modul auf IIFE-Format umgestellt für Kompatibilität
  mit ioBroker Admin-iframe (kein `type="module"` auf `<script>`-Tag).

---

## [0.1.17] - 2026-07-02

### Added
- Konfigurierbarer Sensor-Abweichungsalarm pro Gruppe (`sensorDisagreementThreshold`, Standard 5).

### Fixed
- Fehler in einer Gruppe können den Adapter nicht mehr zum Absturz bringen (Fehler werden
  pro Gruppe isoliert abgefangen).

---

## [0.1.16] - 2026-07-02

### Fixed
- Fehlender Script-Tag in `admin/index.html` nach Build ergänzt.

---

## [0.1.15] - 2026-07-02

### Fixed
- Admin-UI-Render-Fehler: Vite-Build von IIFE auf ES-Modul-Format umgestellt.

---

## [0.1.14] - 2026-07-02

### Added
- Dynamischer Stale-Check je Zyklus; `staleAfterSeconds` Standard 900 s.
- Erstlesen verwendet `Date.now()` als Timestamp.
- Gerätestatus-State (`available`/`link_quality`/`alive`) für Sensoren und Aktoren.

---

## [0.1.13] - 2026-07-02

### Fixed
- Sensorqualität 0 %: `staleAfterSeconds`-Standard von 300 auf 3600 erhöht.
- `lc`/`q`-Parameter-Bug beim Start behoben.

### Added
- Live-Polling im Admin-Dashboard.
- Aufklappbare Adapter-Kategorien im Objektpicker.

---

## [0.1.12] - 2026-07-02

### Fixed
- Wiederkehrender Build-Bug: fester Bundle-Dateiname (`assets/index.js`), sodass
  `admin/index.html` nie mehr manuell aktualisiert werden muss.

---

## [0.1.11] - 2026-07-02

### Added
- Sensor-Startwerte werden beim Adapterstart eingelesen.
- Objektpicker komplett überarbeitet: Tabelle mit Typ-Tabs und Raum/Funktion-Spalten.

---

## [0.1.10] - 2026-07-02

### Fixed
- Crash when opening the group editor: `climateProfiles` was missing from older saved configs
  and arrived as `undefined` instead of `[]`, causing `.map()` to throw. Config is now merged
  with array defaults on load so missing keys never reach the UI as `undefined`.
- Added `climateProfiles: []` to the `io-package.json` native defaults so new installations
  always have a well-formed initial config.

---

## [0.1.9] - 2026-07-02

### Fixed
- **Critical build fix**: `admin/index.html` was pointing to the previously compiled bundle
  instead of the TypeScript source entry (`./src/index.tsx`). Every build since v0.1.5 had
  been repackaging the same old bundle — no TypeScript changes were ever compiled into the
  shipped files. Resetting the entry point caused Vite to transform 30 modules (previously 3)
  and produce a correct bundle for the first time since v0.1.4.

---

## [0.1.8] - 2026-07-02

### Fixed
- Socket bridge now works reliably: `window.io` is checked immediately at startup before
  loading `socket.io.js` (handles the case where admin already loaded it).
- Added polling fallback (every 250 ms, up to 10 s) so the bridge connects even if Firefox
  does not fire `onload` for a cached/duplicate script URL.
- Extracted `doConnect()` helper shared by all connection paths (direct, onload, poll).

*Note: due to the build bug fixed in 0.1.9, the changes above only took effect from 0.1.9 onwards.*

---

## [0.1.5 – 0.1.7] - 2026-07-02

*Note: these versions were shipped with the build bug described in 0.1.9 — the TypeScript
source was never compiled, so their fixes had no effect at runtime.*

### Intended fixes (now active via 0.1.9)
- **0.1.7** Socket bridge cleanup: consistent use of `io.connect()` across all paths.
- **0.1.6** Bridge checks `window.io` before attempting to load `socket.io.js` again.
- **0.1.5** Use ioBroker WebSockets v3 API correctly: `window.io` is an object
  `{ connect: fn }`, not a callable function. Previous code called `window.io()` →
  TypeError → fell through to non-functional fetch fallback → config never loaded or saved.

---

## [0.1.4] - 2026-07-02

### Added
- Socket bridge with multiple fallback paths (`window.socket`, `parent.socket`, `socket.io.js`)
- Save feedback indicator in header (● Verbunden / ○ Verbinde…)
- Auto-save when GroupEditor closes

---

## [0.1.3] - 2026-07-02

### Added
- **Object tree picker**: "🔍 Wählen" button on all sensor/actuator state-ID fields opens a
  searchable modal showing all ioBroker states (ID, name, type, role)
- **Climate profile editor**: full day/night setpoint editor for temperature, humidity and VPD
  with phase selection (seedling / growth / bloom / drying)
- **Save feedback**: header shows "✓ Gespeichert" on success or "✗ Fehler beim Speichern"
  on failure

### Fixed
- Socket bridge tries `window.socket` (injected by ioBroker admin v6+) first

---

## [0.1.2] - 2026-07-02

### Fixed
- Added `"adminUI": { "config": "html" }` to `io-package.json` so ioBroker admin loads the
  React UI instead of looking for `jsonConfig.json`

---

## [0.1.1] - 2026-07-01

### Fixed
- `admin/` directory was missing after `npm install` from GitHub (npm v7+ skips subdirs with
  their own `package.json`). Removed build config files from git tracking, added `.npmignore`.

---

## [0.1.0] - 2026-06-30

### Added
- Initial release: core adapter, group management, climate control (VPD/PID), alarm system,
  schedule service, shared actor manager, web dashboard (port 8097), React admin UI, 116 tests
