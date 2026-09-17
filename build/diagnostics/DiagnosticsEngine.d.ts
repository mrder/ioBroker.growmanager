import type { GroupConfig, GroupState, ActuatorState, SensorState } from '../models/config';
import type { AlarmService } from '../services/AlarmService';
import type { ILogger } from '../utils/logger';
export declare class DiagnosticsEngine {
    private readonly alarmService;
    private readonly log;
    private readonly trendBuffers;
    private readonly effectChecks;
    private readonly maxTrendPoints;
    /** 1h-Durchschnitte für die letzten 48 Stunden pro Gruppe+Variable */
    private readonly hourlyHistory;
    private readonly hourlyAccum;
    private readonly maxHourlyPoints;
    constructor(alarmService: AlarmService, log: ILogger);
    checkActuatorFeedback(groupId: string, actuatorConfig: GroupConfig['actuators'][0], state: ActuatorState): void;
    /**
     * Registriert den Start einer Wirkungsprüfung.
     */
    startEffectCheck(groupId: string, actuatorId: string, variable: 'temperature' | 'humidity', expectedDirection: 1 | -1, currentValue: number, waitSeconds: number, windowSeconds: number, minChange: number): void;
    /**
     * Bewertet laufende Wirkungsprüfungen.
     */
    evaluateEffectChecks(groupStates: Map<string, GroupState>): void;
    /**
     * Fügt einen Messwert zum Trend-Puffer hinzu.
     */
    recordValue(groupId: string, variable: 'temperature' | 'humidity' | 'vpd' | 'co2', value: number): void;
    /** Gibt die letzten 48 Stundenmittelwerte zurück (inklusive laufender Stunde). */
    getHourlyHistory(groupId: string, variable: 'temperature' | 'humidity' | 'vpd'): Array<{
        ts: number;
        value: number;
    }>;
    /**
     * Sensordifferenz-Prüfung: Warnung wenn mehrere Sensoren stark abweichen.
     */
    checkSensorDisagreement(groupId: string, sensorName: string, values: number[], maxDifference: number): void;
    /**
     * Prüft ob ein Sensor zu lange unverändert ist.
     */
    checkSensorFrozen(groupId: string, sensor: SensorState, sensorName: string): void;
    /**
     * Erzeugt einen Klartextbericht über den Zustand eines Aktors.
     */
    buildActuatorDiagnosticText(actuatorConfig: GroupConfig['actuators'][0], state: ActuatorState): string[];
}
//# sourceMappingURL=DiagnosticsEngine.d.ts.map