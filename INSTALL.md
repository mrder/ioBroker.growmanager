# Installation (Test via GitHub)

## Schritt 1 – Adapter in ioBroker installieren

Im ioBroker Admin:

1. **Admin → Adapter → Expertenansicht einschalten**
2. Oben rechts: **"Adapter von eigener URL"** (GitHub-Icon oder "+"-Button)
3. URL eingeben: `https://github.com/DEIN-USERNAME/ioBroker.growmanager`
4. Installieren klicken

Alternativ auf dem ioBroker-Server per SSH:
```bash
cd /opt/iobroker
npm install iobroker.growmanager@https://github.com/DEIN-USERNAME/ioBroker.growmanager
iobroker upload growmanager
iobroker restart growmanager
```

## Schritt 2 – Instanz anlegen & Grundkonfiguration

1. Admin → Adapter → GrowManager → **"+ Instanz hinzufügen"**
2. In der Konfiguration (Tab **Allgemein**):
   - Regelzyklus: 10 Sekunden (Standard)
   - Log-Level: Info
3. Tab **Live-Dashboard**: Port prüfen (Standard: 8097)
4. **Speichern & Schließen**

## Schritt 3 – Erste Gruppe konfigurieren (JSON-Editor)

Da der Gruppen-Editor noch kein eigenes UI hat, nutze den JSON-Editor:

1. In der Instanz-Konfiguration: oben rechts **"< >"** (JSON-Tab)
2. Im JSON-Objekt unter `"groups": []` eine Gruppe einfügen:

```json
{
  "groups": [
    {
      "id": "zelt1",
      "name": "Growzelt 1",
      "description": "Mein erstes Zelt",
      "color": "#4caf50",
      "enabled": true,
      "phase": "growth",
      "mode": "monitorOnly",
      "schedule": {
        "lightOn": { "startHH": 6, "startMM": 0, "endHH": 18, "endMM": 0 },
        "transitionMinutes": 30
      },
      "sensors": [
        {
          "id": "temp1",
          "name": "Temperatur Mitte",
          "stateId": "zigbee.0.DEIN_SENSOR.temperature",
          "type": "temperature",
          "role": "primary",
          "unit": "°C",
          "offset": 0,
          "multiplier": 1,
          "weight": 1,
          "validMin": 5,
          "validMax": 50,
          "staleAfterSeconds": 300,
          "unchangedAlarmSeconds": 3600,
          "minUpdateRateSeconds": 0,
          "smoothing": "none",
          "outlierFilter": false,
          "errorBehavior": "ignore",
          "useForControl": true,
          "enabled": true
        }
      ],
      "actuators": [],
      "irrigationZones": [],
      "cameras": [],
      "profileId": "",
      "alarmProfileId": "",
      "priority": 1,
      "aggregationMethod": "median",
      "minValidSensors": 1,
      "fallbackChain": ["temperature", "schedule", "monitorOnly"],
      "stabilityTimeSeconds": 120
    }
  ]
}
```

3. State-ID (`zigbee.0.DEIN_SENSOR.temperature`) durch echte State-ID ersetzen
4. Speichern → Adapter startet neu

## Schritt 4 – Live-Dashboard öffnen

```
http://<IP-deines-ioBrokers>:8097/
```

Das Dashboard aktualisiert sich automatisch nach jedem Regelzyklus.

## Schritt 5 – ioBroker-Objektbaum prüfen

Unter `growmanager.0.groups.zelt1.*` erscheinen:
- `climate.temperature`, `climate.humidity`, `climate.vpd`
- `schedule.dayNight` (day / night / transition)
- `control.degradation` (FULL / LIMITED / MONITOR_ONLY / …)

## Betriebsarten im Schnellüberblick

| mode | Benötigt | Was passiert |
|---|---|---|
| `monitorOnly` | – | Nur messen, nichts schalten |
| `schedule` | 1 Aktor | Licht/Abluft nach Zeitplan |
| `temperature` | Temp-Sensor + Aktor | Heizung/Abluft regeln |
| `humidity` | Feuchte-Sensor + Aktor | Befeuchter/Abluft regeln |
| `vpd` | Temp + Feuchte + Aktor | VPD-basierte Regelung |
| `combined` | Temp + Feuchte + Aktoren | VPD + Temperatur |

**Kein Sensor vorhanden?** → einfach `mode: "monitorOnly"` oder `"schedule"` wählen.  
**Sensor vorhanden, aber kein Aktor?** → Adapter läuft im `monitorOnly`-Fallback automatisch.
