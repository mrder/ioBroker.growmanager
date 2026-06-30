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
     */
    decide(config: GroupConfig, state: GroupState, setpoint: ClimateSetpoint, shadowMode: boolean): ControlDecision;
    private decideVPD;
    private decideCombined;
    private decideTemperature;
    private decideHumidity;
    private decideSchedule;
    private requestHeating;
    private requestCoolingActuators;
    private requestDehumidification;
    private requestHumidification;
    private blockHeating;
    private handleLightAndCirculation;
    private pushAction;
    private buildDecision;
    private getHystStates;
}
//# sourceMappingURL=ClimateController.d.ts.map