import type { GroupConfig, AirSystemConfig, OutdoorSensorConfig } from '../models/config';
import type { AlarmService } from './AlarmService';
import type { ILogger } from '../utils/logger';
export interface AirDemand {
    temperatureDemandPercent: number;
    humidityDemandPercent: number;
    vpdDemandPercent: number;
    minimumPercent: number;
    finalDemandPercent: number;
    reason: string;
}
export interface AirSystemOutput {
    exhaustPercent: number;
    supplyPercent: number;
    exhaustCommand: boolean | number;
    supplyCommand: boolean | number;
    reason: string;
    available: boolean;
}
export declare class AirSystemService {
    private readonly alarmService;
    private readonly log;
    private readonly circulationStates;
    private readonly startupBoostUntil;
    constructor(alarmService: AlarmService, log: ILogger);
    /**
     * Berechnet Abluftbedarf aus Klimawerten.
     * Gibt 0 zurück wenn keine relevanten Sensoren vorhanden.
     */
    computeAirDemand(config: GroupConfig, airSystem: AirSystemConfig | undefined, temperature: number | null, tempSetpoint: number | null, humidity: number | null, humSetpoint: number | null, vpd: number | null, vpdMin: number | null, vpdMax: number | null, isDay: boolean): AirDemand;
    /**
     * Berechnet Abluft- und Zuluftbefehle.
     * Gibt available=false wenn keine Aktoren vorhanden.
     */
    computeAirOutput(groupId: string, config: GroupConfig, airSystem: AirSystemConfig | undefined, demand: AirDemand): AirSystemOutput;
    /**
     * Steuert Umluftventilatoren (Rotation, Intervall, Dauerbetrieb).
     * Gibt Map von actuatorId → boolean zurück.
     */
    computeCirculationCommands(groupId: string, config: GroupConfig, isDay: boolean, afterIrrigation: boolean): Map<string, boolean>;
    /**
     * Startet Anlaufboost (z.B. nach langer Pause).
     */
    triggerStartupBoost(groupId: string, durationSeconds: number): void;
    private diagnoseLowflow;
    /**
     * Prüft ob Zuluft feuchter als Abluft-Bedarf erlaubt.
     */
    shouldSuppressHumidityVentilation(insideHumidity: number | null, outsideHumidity: number | null): boolean;
    /**
     * Außenluft-Guard: Prüft ob Außenluft günstiger als Innenluft.
     * Gibt blockiert=true zurück wenn Lüfter NICHT schalten sollten.
     *
     * Temp-Guard: Außentemp muss mindestens minTempDeltaCelsius kühler sein.
     * Feuchte-Guard: Außenfeuchte darf maximal maxHumidityDeltaPercent höher sein.
     */
    checkOutdoorGuard(outdoorCfg: OutdoorSensorConfig | undefined, insideTemp: number | null, insideHumidity: number | null, outdoorTemp: number | null, outdoorHumidity: number | null, demandReason: 'temperature' | 'humidity' | 'both'): {
        blocked: boolean;
        reason: string;
    };
}
//# sourceMappingURL=AirSystemService.d.ts.map