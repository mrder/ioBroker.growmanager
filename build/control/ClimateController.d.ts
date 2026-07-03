import type { GroupConfig, GroupState, ClimateSetpoint, ControlDecision } from '../models/config';
import type { AlarmService } from '../services/AlarmService';
import type { ILogger } from '../utils/logger';
export declare class ClimateController {
    private readonly alarmService;
    private readonly log;
    private readonly hystStates;
    constructor(alarmService: AlarmService, log: ILogger);
    /**
     * Hauptregel-Funktion. Erzeugt eine ControlDecision für eine Gruppe.
     * outdoorTemp / outdoorHumidity kommen vom konfigurierten Außensensor der Gruppe.
     */
    decide(config: GroupConfig, state: GroupState, setpoint: ClimateSetpoint, shadowMode: boolean, outdoorTemp?: number | null, outdoorHumidity?: number | null): ControlDecision;
    private decideLight;
    private decideTemperatureAct;
    private decideHumidityAct;
    private decideVpdAct;
    private decideCo2Act;
    private getOutdoorConfig;
    private requestByTarget;
    private pushAction;
    private buildDecision;
    private getHystStates;
}
//# sourceMappingURL=ClimateController.d.ts.map