import type { GroupConfig, GroupMode, DegradationLevel } from '../models/config';
import type { SensorState } from '../models/config';
export interface GroupCapabilities {
    hasTemperature: boolean;
    hasHumidity: boolean;
    hasLeafTemperature: boolean;
    hasSoilMoisture: boolean;
    hasCO2: boolean;
    hasLight: boolean;
    canCalculateVPD: boolean;
    canCalculateLeafVPD: boolean;
    canCalculateDewPoint: boolean;
    hasLight_actuator: boolean;
    hasExhaustFan: boolean;
    hasSupplyFan: boolean;
    hasCirculationFan: boolean;
    hasHeating: boolean;
    hasCooling: boolean;
    hasHumidifier: boolean;
    hasDehumidifier: boolean;
    hasIrrigation: boolean;
    hasCamera: boolean;
    hasAnyFeedback: boolean;
    hasPowerFeedback: boolean;
    hasOutsideSensor: boolean;
    hasFlowSensor: boolean;
    hasMoistureSensor: boolean;
}
export interface CapabilityResult {
    capabilities: GroupCapabilities;
    availableModes: GroupMode[];
    recommendedMode: GroupMode;
    degradation: DegradationLevel;
    degradationReason: string;
    modeReasons: Partial<Record<GroupMode, string>>;
    fallbackChain: GroupMode[];
}
export declare class GroupCapabilityService {
    /**
     * Bewertet alle Fähigkeiten einer Gruppe zur Laufzeit.
     * Wird bei jedem Regelzyklus neu berechnet.
     */
    evaluate(config: GroupConfig, sensorStates: Map<string, SensorState>, temperature: number | null, humidity: number | null, leafTemperature: number | null, soilMoisture: number | null): CapabilityResult;
    private buildCapabilities;
    private determineAvailableModes;
    private buildModeReasons;
    private computeDegradation;
    private selectBestMode;
    private buildFallbackChain;
    private hasSensorType;
    /**
     * Erzeugt einen lesbaren Diagnosebericht über die Gruppe-Fähigkeiten.
     */
    buildCapabilityReport(result: CapabilityResult): string[];
}
//# sourceMappingURL=GroupCapabilityService.d.ts.map