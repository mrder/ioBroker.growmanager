"use strict";
// ============================================================
// GrowManager – IrrigationService
// Bewässerungsautomatik pro Zone, vollständig optional:
//  - Sensor fehlt → Zeitsteuerung oder manuell
//  - Pumpe fehlt  → Zone wird übersprungen
//  - Flow fehlt   → kein Leckage-Schutz
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.IrrigationService = void 0;
const AlarmService_1 = require("./AlarmService");
const time_1 = require("../utils/time");
class IrrigationService {
    constructor(alarmService, log) {
        this.alarmService = alarmService;
        this.log = log;
        this.zoneStates = new Map();
        this.zoneConfigs = new Map();
    }
    setOnStop(cb) {
        this.onStopCallback = cb;
    }
    initZone(zone) {
        this.zoneConfigs.set(zone.id, zone);
        if (this.zoneStates.has(zone.id))
            return;
        this.zoneStates.set(zone.id, {
            zoneId: zone.id,
            running: false,
            startTs: 0,
            lastEndTs: 0,
            pauseUntil: 0,
            currentMoisture: null,
            startMoisture: null,
            flowRate: null,
            lastFlowTs: 0,
            totalFlowLiters: 0,
            cycleCount: 0,
            faultCount: 0,
            blocked: false,
            health: 'unknown',
        });
    }
    /**
     * Haupt-Entscheidungslogik für eine Zone.
     * Wird im Regelzyklus für jede aktivierte Zone aufgerufen.
     */
    decide(zone, groupId, sensorStates, now) {
        this.initZone(zone);
        const state = this.zoneStates.get(zone.id);
        // Zone deaktiviert
        if (!zone.enabled) {
            return { zoneId: zone.id, command: false, reason: 'Zone deaktiviert', blocked: false };
        }
        // Fehlersperre
        if (state.blocked) {
            return { zoneId: zone.id, command: false, reason: state.blockedReason ?? 'Gesperrt', blocked: true };
        }
        // Erlaubtes Zeitfenster prüfen (optional)
        if (zone.allowedWindow && !(0, time_1.isInTimeWindow)(now, zone.allowedWindow.startHH, zone.allowedWindow.startMM, zone.allowedWindow.endHH, zone.allowedWindow.endMM)) {
            if (state.running) {
                this.log.info(`Zone ${zone.name}: Zeitfenster endet → Pumpe AUS`);
                this.stopZone(zone, state, 'Außerhalb Zeitfenster', groupId, state.startMoisture);
                return { zoneId: zone.id, command: false, reason: 'Außerhalb Zeitfenster', blocked: false };
            }
            return { zoneId: zone.id, command: false, reason: 'Außerhalb erlaubtem Zeitfenster', blocked: false };
        }
        // Mindestpause prüfen
        if (!state.running && Date.now() < state.pauseUntil) {
            const waitMin = Math.ceil((state.pauseUntil - Date.now()) / 60000);
            return { zoneId: zone.id, command: false, reason: `Mindestpause: noch ${waitMin} min`, blocked: false };
        }
        // Bodenfeuchte auslesen (optional)
        const moisture = this.aggregateMoisture(zone, sensorStates);
        state.currentMoisture = moisture;
        // Laufender Zyklus
        if (state.running) {
            return this.handleRunning(zone, state, groupId);
        }
        // Startentscheidung
        return this.handleStopped(zone, state, moisture);
    }
    handleRunning(zone, state, groupId) {
        const elapsed = (Date.now() - state.startTs) / 1000;
        const maxRun = state.maxRunSeconds ?? zone.maxRunSeconds;
        // Maximale Laufzeit
        if (elapsed > maxRun) {
            const isDryRun = zone.dryRunProtection && zone.flowStateId && (state.flowRate === null || state.flowRate < 0.1);
            const stopReason = isDryRun ? 'Trockenläufer-Schutz' : 'Maximale Laufzeit erreicht';
            this.stopZone(zone, state, stopReason, groupId, state.startMoisture);
            if (isDryRun) {
                this.alarmService.raise(AlarmService_1.ALARM_CODES.IRRIGATION_DRY_RUN, groupId, `zone:${zone.id}`, 'fault', `Zone ${zone.name}: Kein Durchfluss erkannt (Trockenläuferschutz)`);
                state.blocked = true;
                state.blockedReason = 'Trockenläufer-Schutz aktiv';
                state.health = 'dryRun';
                return { zoneId: zone.id, command: false, reason: 'Trockenläufer-Schutz', blocked: true };
            }
            return { zoneId: zone.id, command: false, reason: 'Timeout', blocked: false };
        }
        // Sollfeuchte erreicht (wenn Sensor vorhanden)
        if (state.currentMoisture !== null && state.currentMoisture >= zone.targetMoisture) {
            this.stopZone(zone, state, `Zielfeuchte erreicht (${state.currentMoisture.toFixed(0)}%)`, groupId, state.startMoisture);
            return { zoneId: zone.id, command: false, reason: `Zielfeuchte ${zone.targetMoisture}% erreicht`, blocked: false };
        }
        // Leckage prüfen (wenn Flow-Sensor vorhanden UND Pumpe schon lange läuft)
        if (zone.leakageAlarmSeconds > 0 && elapsed > zone.leakageAlarmSeconds) {
            if (state.flowRate !== null && state.flowRate > 5.0) {
                this.alarmService.raise(AlarmService_1.ALARM_CODES.IRRIGATION_LEAK, groupId, `zone:${zone.id}`, 'critical', `Zone ${zone.name}: Verdacht auf Leckage (${state.flowRate.toFixed(1)} L/min nach ${elapsed.toFixed(0)}s)`);
                this.stopZone(zone, state, 'Leckage-Schutz', groupId, state.startMoisture);
                state.blocked = true;
                state.blockedReason = 'Leckage erkannt – manuelle Prüfung erforderlich';
                state.health = 'leak';
                return { zoneId: zone.id, command: false, reason: 'Leckageschutz', blocked: true };
            }
        }
        return { zoneId: zone.id, command: true, reason: `Bewässerung läuft (${elapsed.toFixed(0)}s)`, blocked: false };
    }
    handleStopped(zone, state, moisture) {
        // Mit Feuchtesensor: Startschwelle prüfen
        if (moisture !== null) {
            if (moisture <= zone.startMoisture) {
                this.startZone(zone, state);
                return { zoneId: zone.id, command: true, reason: `Bodenfeuchte ${moisture.toFixed(0)}% ≤ ${zone.startMoisture}%`, blocked: false };
            }
            return { zoneId: zone.id, command: false, reason: `Bodenfeuchte OK (${moisture.toFixed(0)}%)`, blocked: false };
        }
        // Ohne Sensor: Bewässerung nur wenn explizit angefordert (z.B. Zeitplan)
        // Der externe Aufruf muss dann triggerManual() aufrufen
        return { zoneId: zone.id, command: false, reason: 'Kein Feuchtesensor – Zeitsteuerung via triggerManual()', blocked: false };
    }
    /**
     * Manuelle/Zeitplan-gesteuerte Bewässerung auslösen.
     */
    triggerManual(zone, durationSeconds) {
        this.initZone(zone);
        const state = this.zoneStates.get(zone.id);
        if (state.running || state.blocked)
            return false;
        if (Date.now() < state.pauseUntil)
            return false;
        const runSecs = durationSeconds ?? zone.maxRunSeconds;
        this.startZone({ ...zone, maxRunSeconds: runSecs }, state);
        return true;
    }
    /**
     * Flow-Wert aus ioBroker aktualisieren (Volumenstrom in L/min).
     */
    updateFlow(zoneId, flowLpm) {
        const state = this.zoneStates.get(zoneId);
        if (!state)
            return;
        const now = Date.now();
        if (flowLpm !== null && state.running && state.startTs > 0 && state.lastFlowTs > 0) {
            const dt = (now - state.lastFlowTs) / 60000; // Delta seit letztem Update in Minuten
            state.totalFlowLiters += flowLpm * dt; // L/min × min = Liter
        }
        state.lastFlowTs = now;
        state.flowRate = flowLpm;
    }
    /**
     * Pumpe sofort stoppen (Notfall / manuell).
     */
    stopNow(zoneId, reason, groupId) {
        const state = this.zoneStates.get(zoneId);
        const zone = this.zoneConfigs.get(zoneId);
        if (state && zone)
            this.stopZone(zone, state, reason, groupId, state.startMoisture);
        else if (state)
            this.stopZone({ minPauseMinutes: 0 }, state, reason, groupId, state.startMoisture);
    }
    /**
     * Sperre aufheben (nach manuellem Eingriff).
     */
    clearFault(zoneId) {
        const state = this.zoneStates.get(zoneId);
        if (state) {
            state.blocked = false;
            state.blockedReason = undefined;
            state.health = 'unknown';
            state.faultCount = 0;
        }
    }
    getState(zoneId) {
        return this.zoneStates.get(zoneId);
    }
    /**
     * Berechnet für eine Gruppe, ob gerade irgendeine Zone bewässert.
     */
    isAnyZoneRunning(group) {
        return group.irrigationZones.some(z => this.zoneStates.get(z.id)?.running ?? false);
    }
    startZone(zone, state) {
        state.running = true;
        state.startTs = Date.now();
        state.totalFlowLiters = 0; // Zähler für aktuellen Zyklus zurücksetzen
        state.lastFlowTs = 0; // Phantom-Pause zwischen Zyklen verhindern
        state.startMoisture = state.currentMoisture; // Feuchte zum Startpunkt merken
        state.maxRunSeconds = zone.maxRunSeconds; // Laufzeit-Override aus triggerManual()
        state.health = 'ok';
        state.cycleCount++;
        this.log.info(`Zone ${zone.id}: Bewässerung gestartet (Zyklus ${state.cycleCount})`);
    }
    stopZone(zone, state, reason, groupId, startMoisture) {
        const durationSec = state.startTs > 0 ? Math.round((Date.now() - state.startTs) / 1000) : 0;
        state.running = false;
        state.lastEndTs = Date.now();
        state.startTs = 0;
        state.maxRunSeconds = undefined;
        state.pauseUntil = Date.now() + zone.minPauseMinutes * 60000;
        this.log.info(`Zone ${state.zoneId}: Bewässerung gestoppt (${reason})`);
        if (this.onStopCallback && groupId) {
            this.onStopCallback({
                groupId,
                zoneId: state.zoneId,
                zoneName: zone.name ?? state.zoneId,
                startTs: state.lastEndTs - durationSec * 1000,
                durationSec,
                startMoisture: startMoisture ?? null,
                endMoisture: state.currentMoisture,
                trigger: reason,
                flowLiters: state.totalFlowLiters,
            });
        }
    }
    aggregateMoisture(zone, sensorStates) {
        if (zone.moistureSensorIds.length === 0)
            return null;
        const values = [];
        for (const id of zone.moistureSensorIds) {
            const st = sensorStates.get(id);
            if (st?.valid && typeof st.processedValue === 'number') {
                values.push(st.processedValue);
            }
        }
        if (values.length === 0)
            return null;
        return values.reduce((a, b) => a + b, 0) / values.length;
    }
}
exports.IrrigationService = IrrigationService;
//# sourceMappingURL=IrrigationService.js.map