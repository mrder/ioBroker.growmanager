"use strict";
// ============================================================
// GrowManager – AlarmService
// Zentrale Alarmverwaltung mit Deduplizierung und Quittierung
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.AlarmService = exports.ALARM_CODES = void 0;
exports.ALARM_CODES = {
    SENSOR_STALE: 'SENSOR_STALE',
    SENSOR_IMPLAUSIBLE: 'SENSOR_IMPLAUSIBLE',
    SENSOR_DISAGREEMENT: 'SENSOR_DISAGREEMENT',
    ACTUATOR_NO_FEEDBACK: 'ACTUATOR_NO_FEEDBACK',
    ACTUATOR_NO_POWER: 'ACTUATOR_NO_POWER',
    ACTUATOR_STUCK_ON: 'ACTUATOR_STUCK_ON',
    ACTUATOR_NO_EFFECT: 'ACTUATOR_NO_EFFECT',
    ACTUATOR_UNREACHABLE: 'ACTUATOR_UNREACHABLE',
    TEMPERATURE_HIGH: 'TEMPERATURE_HIGH',
    TEMPERATURE_LOW: 'TEMPERATURE_LOW',
    HUMIDITY_HIGH: 'HUMIDITY_HIGH',
    HUMIDITY_LOW: 'HUMIDITY_LOW',
    CONDENSATION_RISK: 'CONDENSATION_RISK',
    VPD_OUT_OF_RANGE: 'VPD_OUT_OF_RANGE',
    CONTROL_BLOCKED: 'CONTROL_BLOCKED',
    CONFIG_INVALID: 'CONFIG_INVALID',
    IRRIGATION_LEAK: 'IRRIGATION_LEAK',
    IRRIGATION_DRY_RUN: 'IRRIGATION_DRY_RUN',
    CAMERA_OFFLINE: 'CAMERA_OFFLINE',
    SENSOR_DEGRADED: 'SENSOR_DEGRADED',
    EMERGENCY_STOP: 'EMERGENCY_STOP',
    CUSTOM_ALERT: 'CUSTOM_ALERT',
};
class AlarmService {
    constructor(log) {
        this.log = log;
        this.alarms = new Map();
        this.listeners = [];
        this.retentionDays = 30;
    }
    setRetentionDays(days) {
        this.retentionDays = days;
    }
    addListener(fn) {
        this.listeners.push(fn);
    }
    /**
     * Erzeugt oder aktualisiert einen Alarm.
     */
    raise(code, groupId, source, severity, message) {
        const key = `${groupId}:${code}:${source}`;
        const existing = this.alarms.get(key);
        if (existing && existing.active) {
            // Aktualisieren
            existing.lastUpdate = Date.now();
            existing.message = message;
            existing.repeatCount++;
            this.notifyListeners({ alarm: existing, isNew: false });
            return existing;
        }
        const alarm = {
            id: key,
            code,
            groupId,
            source,
            severity,
            active: true,
            since: Date.now(),
            lastUpdate: Date.now(),
            message,
            acknowledged: false,
            repeatCount: 1,
        };
        this.alarms.set(key, alarm);
        this.log.warn(`Alarm [${severity}] ${code} (${groupId}/${source}): ${message}`);
        this.notifyListeners({ alarm, isNew: true });
        return alarm;
    }
    /**
     * Hebt einen Alarm auf (Entwarnung).
     */
    clear(code, groupId, source) {
        const key = `${groupId}:${code}:${source}`;
        const alarm = this.alarms.get(key);
        if (alarm && alarm.active) {
            alarm.active = false;
            alarm.clearedAt = Date.now();
            alarm.lastUpdate = Date.now();
            this.log.info(`Alarm gelöscht: ${code} (${groupId}/${source})`);
        }
    }
    /**
     * Quittiert einen Alarm.
     */
    acknowledge(alarmId) {
        const alarm = this.alarms.get(alarmId);
        if (alarm) {
            alarm.acknowledged = true;
            alarm.lastUpdate = Date.now();
        }
    }
    /**
     * Quittiert alle aktiven Alarme.
     */
    acknowledgeAll() {
        for (const alarm of this.alarms.values()) {
            if (alarm.active) {
                alarm.acknowledged = true;
                alarm.lastUpdate = Date.now();
            }
        }
    }
    /**
     * Gibt alle aktiven Alarme zurück.
     */
    getActiveAlarms() {
        return Array.from(this.alarms.values()).filter(a => a.active);
    }
    /**
     * Gibt alle Alarme zurück (inkl. gelöschter).
     */
    getAllAlarms() {
        return Array.from(this.alarms.values());
    }
    /**
     * Höchster aktiver Schweregrad.
     */
    getHighestSeverity(groupId) {
        const active = this.getActiveAlarms().filter(a => !groupId || a.groupId === groupId);
        if (active.length === 0)
            return null;
        const order = ['critical', 'fault', 'warning', 'info'];
        for (const s of order) {
            if (active.some(a => a.severity === s))
                return s;
        }
        return null;
    }
    /**
     * Bereinigt alte, gelöschte Alarme und aktive Alarme für nicht mehr existierende Gruppen.
     */
    cleanup(validGroupIds) {
        const cutoff = Date.now() - this.retentionDays * 86400000;
        for (const [key, alarm] of this.alarms.entries()) {
            if (!alarm.active && (alarm.clearedAt ?? 0) < cutoff) {
                this.alarms.delete(key);
            }
            else if (alarm.active && validGroupIds && !validGroupIds.has(alarm.groupId)) {
                this.alarms.delete(key);
            }
        }
    }
    /**
     * Sendet Alarm an konfigurierte Kanäle.
     */
    async dispatch(alarm, channels) {
        for (const ch of channels) {
            if (!ch.enabled)
                continue;
            const sevOrder = ['info', 'warning', 'fault', 'critical'];
            if (sevOrder.indexOf(alarm.severity) < sevOrder.indexOf(ch.minSeverity))
                continue;
            // Tatsächlicher Versand erfolgt über ioBroker-States/sendTo im Adapter
            this.log.info(`Alarm ${alarm.code} → Kanal ${ch.name}`);
        }
    }
    notifyListeners(event) {
        for (const fn of this.listeners) {
            try {
                const result = fn(event);
                // Async listener: unhandled rejection abfangen
                if (result && typeof result.catch === 'function') {
                    result.catch(() => { });
                }
            }
            catch { /* ignore */ }
        }
    }
}
exports.AlarmService = AlarmService;
//# sourceMappingURL=AlarmService.js.map