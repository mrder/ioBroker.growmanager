import type { SensorConfig, SensorState, SensorType } from '../models/config';
import type { ILogger } from '../utils/logger';
export declare function setDeviceHealth(stateId: string, healthy: boolean): void;
export declare class SensorService {
    private readonly log;
    private readonly states;
    private readonly emaValues;
    /** Sensor-IDs die sich gerade in der Recovery-Phase befinden → Zeitstempel bis wann */
    private readonly recoveringUntil;
    /**
     * Maps device prefix → latest seen timestamp across ALL states of that device.
     * Allows multi-value sensors (temp + humidity on the same device) to share liveness:
     * if one channel updates, the other is also considered fresh.
     */
    private readonly deviceLastSeen;
    constructor(log: ILogger);
    /**
     * Verarbeitet einen neuen Rohwert für einen Sensor.
     */
    processValue(config: SensorConfig, rawValue: unknown, ts: number, lc: number, stabilitySeconds?: number): SensorState;
    /**
     * Gibt zurück ob ein Sensor stabil (nicht in Recovery) ist.
     */
    isStable(sensorId: string): boolean;
    /**
     * Startet den Recovery-Timer explizit mit einer Dauer.
     * Wird vom Adapter aufgerufen wenn stabilityTimeSeconds bekannt ist.
     */
    startRecovery(sensorId: string, stabilitySeconds: number): void;
    /**
     * Aggregiert mehrere Sensorwerte einer Messgröße für eine Gruppe.
     * Logik: zuerst primary-Sensoren (nach controlPriority sortiert),
     * falls keine gültigen vorhanden → Fallback auf backup-Sensoren.
     * monitor-Sensoren werden nie für Regelung verwendet.
     */
    aggregate(configs: SensorConfig[], type: SensorType, method: 'median' | 'mean' | 'weightedMean' | 'min' | 'max', stabilitySeconds?: number): {
        value: number | null;
        quality: number;
        validCount: number;
        totalCount: number;
        usingBackup: boolean;
    };
    /** Filtert SensorConfigs auf gültige, nicht-stale, nicht-recovering, gesunde States. */
    private filterValidStates;
    /**
     * Gibt den aktuellen State eines Sensors zurück.
     */
    getState(sensorId: string): SensorState | undefined;
    /**
     * Initialisiert einen Sensor-State (bei Adapterstart).
     */
    initState(config: SensorConfig): void;
    private applySmoothing;
    private computeQuality;
    /**
     * Erkennt sprunghafte Änderungen (Ausreißer im Zeitverlauf).
     * @returns true wenn Wert plausibel ist
     */
    checkPlausibility(config: SensorConfig, newValue: number): boolean;
}
//# sourceMappingURL=SensorService.d.ts.map