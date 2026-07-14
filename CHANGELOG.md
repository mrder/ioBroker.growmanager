# Changelog

All notable changes to the GrowManager ioBroker adapter are documented here.

> **Hinweis:** Nur Meilenstein-Versionen sind hier dokumentiert. Die vollständige Patch-History aller Zwischenversionen findet sich im [master-Branch](../../blob/master/CHANGELOG.md).

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
