import type { SensorConfig, SensorState, SensorType } from '../models/config';
import type { ILogger } from '../utils/logger';
export declare class SensorService {
    private readonly log;
    private readonly states;
    private readonly emaValues;
    /** Sensor-IDs die sich gerade in der Recovery-Phase befinden → Zeitstempel bis wann */
    private readonly recoveringUntil;
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
     * stabilitySeconds: wenn gesetzt, werden Sensoren in Recovery ignoriert.
     */
    aggregate(configs: SensorConfig[], type: SensorType, method: 'median' | 'mean' | 'weightedMean' | 'min' | 'max', stabilitySeconds?: number): {
        value: number | null;
        quality: number;
        validCount: number;
        totalCount: number;
    };
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