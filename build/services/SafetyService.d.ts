import type { GroupConfig, GroupState, ControlDecision } from '../models/config';
import type { AlarmService } from '../services/AlarmService';
import type { ILogger } from '../utils/logger';
export declare class SafetyService {
    private readonly alarmService;
    private readonly log;
    private emergencyStop;
    private globalMaintenance;
    private readonly groupMaintenance;
    constructor(alarmService: AlarmService, log: ILogger);
    setEmergencyStop(active: boolean): void;
    setGlobalMaintenance(active: boolean): void;
    setGroupMaintenance(groupId: string, active: boolean): void;
    isEmergencyStop(): boolean;
    isGroupPaused(groupId: string): boolean;
    /**
     * Wendet Sicherheitsregeln auf eine Kontrolle-Entscheidung an.
     * Blockiert Aktionen bei Not-Aus oder Wartung.
     */
    applySafetyRules(config: GroupConfig, decision: ControlDecision): ControlDecision;
    /**
     * Berechnet Degradationsstufe basierend auf Sensorqualität und Sensorverfügbarkeit.
     */
    computeDegradation(state: GroupState, config: GroupConfig): GroupState['degradation'];
    private getActuatorType;
}
//# sourceMappingURL=SafetyService.d.ts.map