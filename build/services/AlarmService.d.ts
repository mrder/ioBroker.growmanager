import type { AlarmRecord, AlarmChannel } from '../models/config';
import type { ILogger } from '../utils/logger';
export type AlarmSeverity = 'info' | 'warning' | 'fault' | 'critical';
export declare const ALARM_CODES: {
    readonly SENSOR_STALE: "SENSOR_STALE";
    readonly SENSOR_IMPLAUSIBLE: "SENSOR_IMPLAUSIBLE";
    readonly SENSOR_DISAGREEMENT: "SENSOR_DISAGREEMENT";
    readonly ACTUATOR_NO_FEEDBACK: "ACTUATOR_NO_FEEDBACK";
    readonly ACTUATOR_NO_POWER: "ACTUATOR_NO_POWER";
    readonly ACTUATOR_STUCK_ON: "ACTUATOR_STUCK_ON";
    readonly ACTUATOR_NO_EFFECT: "ACTUATOR_NO_EFFECT";
    readonly ACTUATOR_UNREACHABLE: "ACTUATOR_UNREACHABLE";
    readonly TEMPERATURE_HIGH: "TEMPERATURE_HIGH";
    readonly TEMPERATURE_LOW: "TEMPERATURE_LOW";
    readonly HUMIDITY_HIGH: "HUMIDITY_HIGH";
    readonly HUMIDITY_LOW: "HUMIDITY_LOW";
    readonly CONDENSATION_RISK: "CONDENSATION_RISK";
    readonly VPD_OUT_OF_RANGE: "VPD_OUT_OF_RANGE";
    readonly CONTROL_BLOCKED: "CONTROL_BLOCKED";
    readonly CONFIG_INVALID: "CONFIG_INVALID";
    readonly IRRIGATION_LEAK: "IRRIGATION_LEAK";
    readonly IRRIGATION_DRY_RUN: "IRRIGATION_DRY_RUN";
    readonly CAMERA_OFFLINE: "CAMERA_OFFLINE";
    readonly SENSOR_DEGRADED: "SENSOR_DEGRADED";
    readonly EMERGENCY_STOP: "EMERGENCY_STOP";
    readonly CUSTOM_ALERT: "CUSTOM_ALERT";
};
export type AlarmCode = typeof ALARM_CODES[keyof typeof ALARM_CODES];
export interface AlarmRaisedEvent {
    alarm: AlarmRecord;
    isNew: boolean;
}
type AlarmListener = (event: AlarmRaisedEvent) => void | Promise<void>;
export declare class AlarmService {
    private readonly log;
    private readonly alarms;
    private readonly listeners;
    private retentionDays;
    constructor(log: ILogger);
    setRetentionDays(days: number): void;
    addListener(fn: AlarmListener): void;
    /**
     * Erzeugt oder aktualisiert einen Alarm.
     */
    raise(code: AlarmCode, groupId: string, source: string, severity: AlarmSeverity, message: string): AlarmRecord;
    /**
     * Hebt einen Alarm auf (Entwarnung).
     */
    clear(code: AlarmCode, groupId: string, source: string): void;
    /**
     * Quittiert einen Alarm.
     */
    acknowledge(alarmId: string): void;
    /**
     * Quittiert alle aktiven Alarme.
     */
    acknowledgeAll(): void;
    /**
     * Gibt alle aktiven Alarme zurück.
     */
    getActiveAlarms(): AlarmRecord[];
    /**
     * Gibt alle Alarme zurück (inkl. gelöschter).
     */
    getAllAlarms(): AlarmRecord[];
    /**
     * Höchster aktiver Schweregrad.
     */
    getHighestSeverity(groupId?: string): AlarmSeverity | null;
    /**
     * Bereinigt alte, gelöschte Alarme.
     */
    cleanup(): void;
    /**
     * Sendet Alarm an konfigurierte Kanäle.
     */
    dispatch(alarm: AlarmRecord, channels: AlarmChannel[]): Promise<void>;
    private notifyListeners;
}
export {};
//# sourceMappingURL=AlarmService.d.ts.map