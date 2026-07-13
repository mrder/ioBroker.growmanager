// ============================================================
// GrowManager – AlarmService
// Zentrale Alarmverwaltung mit Deduplizierung und Quittierung
// ============================================================

import type { AlarmRecord, AlarmChannel } from '../models/config';
import type { ILogger } from '../utils/logger';

export type AlarmSeverity = 'info' | 'warning' | 'fault' | 'critical';

export const ALARM_CODES = {
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
} as const;

export type AlarmCode = typeof ALARM_CODES[keyof typeof ALARM_CODES];

export interface AlarmRaisedEvent {
    alarm: AlarmRecord;
    isNew: boolean;
}

type AlarmListener = (event: AlarmRaisedEvent) => void | Promise<void>;

export class AlarmService {
    private readonly alarms = new Map<string, AlarmRecord>();
    private readonly listeners: AlarmListener[] = [];
    private retentionDays = 30;

    constructor(private readonly log: ILogger) {}

    setRetentionDays(days: number): void {
        this.retentionDays = days;
    }

    addListener(fn: AlarmListener): void {
        this.listeners.push(fn);
    }

    /**
     * Erzeugt oder aktualisiert einen Alarm.
     */
    raise(
        code: AlarmCode,
        groupId: string,
        source: string,
        severity: AlarmSeverity,
        message: string
    ): AlarmRecord {
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

        const alarm: AlarmRecord = {
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
    clear(code: AlarmCode, groupId: string, source: string): void {
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
    acknowledge(alarmId: string): void {
        const alarm = this.alarms.get(alarmId);
        if (alarm) {
            alarm.acknowledged = true;
            alarm.lastUpdate = Date.now();
        }
    }

    /**
     * Quittiert alle aktiven Alarme.
     */
    acknowledgeAll(): void {
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
    getActiveAlarms(): AlarmRecord[] {
        return Array.from(this.alarms.values()).filter(a => a.active);
    }

    /**
     * Gibt alle Alarme zurück (inkl. gelöschter).
     */
    getAllAlarms(): AlarmRecord[] {
        return Array.from(this.alarms.values());
    }

    /**
     * Höchster aktiver Schweregrad.
     */
    getHighestSeverity(groupId?: string): AlarmSeverity | null {
        const active = this.getActiveAlarms().filter(
            a => !groupId || a.groupId === groupId
        );
        if (active.length === 0) return null;
        const order: AlarmSeverity[] = ['critical', 'fault', 'warning', 'info'];
        for (const s of order) {
            if (active.some(a => a.severity === s)) return s;
        }
        return null;
    }

    /**
     * Bereinigt alte, gelöschte Alarme und aktive Alarme für nicht mehr existierende Gruppen.
     */
    cleanup(validGroupIds?: Set<string>): void {
        const cutoff = Date.now() - this.retentionDays * 86400000;
        for (const [key, alarm] of this.alarms.entries()) {
            if (!alarm.active && (alarm.clearedAt ?? 0) < cutoff) {
                this.alarms.delete(key);
            } else if (alarm.active && validGroupIds && !validGroupIds.has(alarm.groupId)) {
                this.alarms.delete(key);
            }
        }
    }

    /**
     * Sendet Alarm an konfigurierte Kanäle.
     */
    async dispatch(alarm: AlarmRecord, channels: AlarmChannel[]): Promise<void> {
        for (const ch of channels) {
            if (!ch.enabled) continue;
            const sevOrder: AlarmSeverity[] = ['info', 'warning', 'fault', 'critical'];
            if (sevOrder.indexOf(alarm.severity) < sevOrder.indexOf(ch.minSeverity)) continue;
            // Tatsächlicher Versand erfolgt über ioBroker-States/sendTo im Adapter
            this.log.info(`Alarm ${alarm.code} → Kanal ${ch.name}`);
        }
    }

    private notifyListeners(event: AlarmRaisedEvent): void {
        for (const fn of this.listeners) {
            try {
                const result = fn(event);
                // Async listener: unhandled rejection abfangen
                if (result && typeof (result as Promise<void>).catch === 'function') {
                    (result as Promise<void>).catch(() => { /* Fehler wird im Listener selbst geloggt */ });
                }
            } catch { /* ignore */ }
        }
    }
}

