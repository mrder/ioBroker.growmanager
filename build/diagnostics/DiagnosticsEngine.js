"use strict";
// ============================================================
// GrowManager – DiagnosticsEngine
// Vier Ebenen der Funktionsüberwachung
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiagnosticsEngine = void 0;
const calculations_1 = require("../utils/calculations");
const AlarmService_1 = require("../services/AlarmService");
class DiagnosticsEngine {
    constructor(alarmService, log) {
        this.alarmService = alarmService;
        this.log = log;
        this.trendBuffers = new Map();
        this.effectChecks = [];
        this.maxTrendPoints = 60;
        /** 1h-Durchschnitte für die letzten 48 Stunden pro Gruppe+Variable */
        this.hourlyHistory = new Map();
        this.hourlyAccum = new Map();
        this.maxHourlyPoints = 48;
    }
    // ============================================================
    // Ebene 1: Datenpunkt-Erreichbarkeit → SensorService prüft dies
    // ============================================================
    // ============================================================
    // Ebene 2: Feedback-Prüfung nach Schaltbefehl
    // ============================================================
    checkActuatorFeedback(groupId, actuatorConfig, state) {
        if (state.health === 'noFeedback') {
            this.alarmService.raise(AlarmService_1.ALARM_CODES.ACTUATOR_NO_FEEDBACK, groupId, actuatorConfig.id, 'fault', `${actuatorConfig.name}: Keine Rückmeldung nach Einschaltbefehl`);
        }
        else {
            this.alarmService.clear(AlarmService_1.ALARM_CODES.ACTUATOR_NO_FEEDBACK, groupId, actuatorConfig.id);
        }
        if (state.health === 'noPower') {
            this.alarmService.raise(AlarmService_1.ALARM_CODES.ACTUATOR_NO_POWER, groupId, actuatorConfig.id, 'fault', `${actuatorConfig.name}: Eingeschaltet, aber keine Leistungsaufnahme`);
        }
        else {
            this.alarmService.clear(AlarmService_1.ALARM_CODES.ACTUATOR_NO_POWER, groupId, actuatorConfig.id);
        }
        if (state.health === 'stuckOn') {
            this.alarmService.raise(AlarmService_1.ALARM_CODES.ACTUATOR_STUCK_ON, groupId, actuatorConfig.id, 'fault', `${actuatorConfig.name}: Klebendes Relais – Leistung trotz Aus-Befehl`);
        }
        else {
            this.alarmService.clear(AlarmService_1.ALARM_CODES.ACTUATOR_STUCK_ON, groupId, actuatorConfig.id);
        }
    }
    // ============================================================
    // Ebene 3 & 4: Physische Aktivität und Prozesswirkung
    // ============================================================
    /**
     * Registriert den Start einer Wirkungsprüfung.
     */
    startEffectCheck(groupId, actuatorId, variable, expectedDirection, currentValue, waitSeconds, windowSeconds, minChange) {
        // Bestehende Prüfung für diesen Aktor entfernen
        const idx = this.effectChecks.findIndex(e => e.groupId === groupId && e.actuatorId === actuatorId);
        if (idx >= 0)
            this.effectChecks.splice(idx, 1);
        this.effectChecks.push({
            actuatorId,
            groupId,
            startTs: Date.now(),
            startValue: currentValue,
            variable,
            expectedDirection,
            waitSeconds,
            windowSeconds,
            minChange,
            failCount: 0,
        });
    }
    /**
     * Bewertet laufende Wirkungsprüfungen.
     */
    evaluateEffectChecks(groupStates) {
        const now = Date.now();
        for (const check of this.effectChecks) {
            const state = groupStates.get(check.groupId);
            if (!state)
                continue;
            const elapsed = (now - check.startTs) / 1000;
            if (elapsed < check.waitSeconds)
                continue; // Noch in Totzeit
            const currentValue = check.variable === 'temperature' ? state.temperature : state.humidity;
            if (currentValue === null)
                continue;
            // Trend aus Puffer berechnen
            const key = `${check.groupId}:${check.variable}`;
            const points = this.trendBuffers.get(key) ?? [];
            if (points.length < 3)
                continue;
            const recentPoints = points.filter(p => now - p.ts <= check.windowSeconds * 1000);
            const trend = (0, calculations_1.linearTrend)(recentPoints);
            if (trend === null)
                continue;
            // Wirkungsrichtung prüfen
            const expectedTrendPerMin = (check.minChange / check.windowSeconds) * 60;
            const trendOk = check.expectedDirection === 1
                ? trend >= expectedTrendPerMin
                : trend <= -expectedTrendPerMin;
            if (!trendOk) {
                check.failCount++;
                if (check.failCount >= 2) {
                    this.alarmService.raise(AlarmService_1.ALARM_CODES.ACTUATOR_NO_EFFECT, check.groupId, check.actuatorId, 'warning', `Aktor ${check.actuatorId}: Keine ausreichende Wirkung auf ${check.variable} ` +
                        `(Trend: ${(trend * 60).toFixed(2)}/h, erwartet: ${(expectedTrendPerMin * 60).toFixed(2)}/h)`);
                }
            }
            else {
                check.failCount = 0;
                this.alarmService.clear(AlarmService_1.ALARM_CODES.ACTUATOR_NO_EFFECT, check.groupId, check.actuatorId);
            }
        }
    }
    /**
     * Fügt einen Messwert zum Trend-Puffer hinzu.
     */
    recordValue(groupId, variable, value) {
        const key = `${groupId}:${variable}`;
        let points = this.trendBuffers.get(key);
        if (!points) {
            points = [];
            this.trendBuffers.set(key, points);
        }
        points.push({ ts: Date.now(), value });
        if (points.length > this.maxTrendPoints)
            points.splice(0, points.length - this.maxTrendPoints);
        // Stündlichen Durchschnitt akkumulieren
        const now = Date.now();
        const hourTs = Math.floor(now / 3600000) * 3600000;
        const accum = this.hourlyAccum.get(key) ?? { sum: 0, count: 0, hourTs };
        if (accum.hourTs !== hourTs) {
            // Neue Stunde begonnen → vorherigen Bucket abschließen
            if (accum.count > 0) {
                let history = this.hourlyHistory.get(key);
                if (!history) {
                    history = [];
                    this.hourlyHistory.set(key, history);
                }
                history.push({ ts: accum.hourTs, value: accum.sum / accum.count });
                if (history.length > this.maxHourlyPoints)
                    history.splice(0, history.length - this.maxHourlyPoints);
            }
            this.hourlyAccum.set(key, { sum: value, count: 1, hourTs });
        }
        else {
            this.hourlyAccum.set(key, { sum: accum.sum + value, count: accum.count + 1, hourTs });
        }
    }
    /** Gibt die letzten 48 Stundenmittelwerte zurück (inklusive laufender Stunde). */
    getHourlyHistory(groupId, variable) {
        const key = `${groupId}:${variable}`;
        const history = this.hourlyHistory.get(key) ?? [];
        const accum = this.hourlyAccum.get(key);
        if (accum && accum.count > 0) {
            return [...history, { ts: accum.hourTs, value: accum.sum / accum.count }];
        }
        return [...history];
    }
    /**
     * Sensordifferenz-Prüfung: Warnung wenn mehrere Sensoren stark abweichen.
     */
    checkSensorDisagreement(groupId, sensorName, values, maxDifference) {
        if (values.length < 2)
            return;
        const min = Math.min(...values);
        const max = Math.max(...values);
        if (max - min > maxDifference) {
            this.alarmService.raise(AlarmService_1.ALARM_CODES.SENSOR_DISAGREEMENT, groupId, sensorName, 'warning', `${sensorName}: Sensoren weichen um ${(max - min).toFixed(1)} ab (Max. ${maxDifference})`);
        }
        else {
            this.alarmService.clear(AlarmService_1.ALARM_CODES.SENSOR_DISAGREEMENT, groupId, sensorName);
        }
    }
    /**
     * Prüft ob ein Sensor zu lange unverändert ist.
     */
    checkSensorFrozen(groupId, sensor, sensorName) {
        if (sensor.unchanged) {
            this.alarmService.raise(AlarmService_1.ALARM_CODES.SENSOR_STALE, groupId, sensor.id, 'warning', `${sensorName}: Wert seit langer Zeit unverändert (lc: ${new Date(sensor.lastLc).toLocaleTimeString()})`);
        }
        else {
            this.alarmService.clear(AlarmService_1.ALARM_CODES.SENSOR_STALE, groupId, sensor.id);
        }
    }
    /**
     * Erzeugt einen Klartextbericht über den Zustand eines Aktors.
     */
    buildActuatorDiagnosticText(actuatorConfig, state) {
        const lines = [];
        lines.push(`${actuatorConfig.name}`);
        if (actuatorConfig.feedbackStateId) {
            if (state.feedback !== null) {
                lines.push(`✓ Rückmeldung: ${state.feedback}`);
            }
            else {
                lines.push(`✗ Rückmeldung: nicht erhalten`);
            }
        }
        else {
            lines.push(`○ Kein Rückmelde-State konfiguriert`);
        }
        if (actuatorConfig.powerStateId) {
            if (state.power !== null) {
                lines.push(`✓ Leistung: ${state.power} W`);
            }
            else {
                lines.push(`✗ Leistung: nicht verfügbar`);
            }
        }
        lines.push(`Status: ${state.health}`);
        if (state.effectCheck) {
            const symbols = {
                confirmed: '✓',
                weak: '!',
                notDetectable: '✗',
                opposite: '✗✗',
                disturbanceActive: '⚠',
            };
            lines.push(`${symbols[state.effectCheck] ?? '?'} Wirkung: ${state.effectCheck}`);
        }
        return lines;
    }
}
exports.DiagnosticsEngine = DiagnosticsEngine;
//# sourceMappingURL=DiagnosticsEngine.js.map