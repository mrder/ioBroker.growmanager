import type { ILogger } from '../utils/logger';
export interface DailySensorStat {
    date: string;
    sensors: Record<string, {
        name: string;
        min: number;
        max: number;
        avg: number;
        samples: number;
    }>;
}
export interface DailyEnergyStat {
    date: string;
    actuators: Record<string, {
        name: string;
        wh: number;
        runtimeMin: number;
    }>;
}
export interface IrrigationEvent {
    ts: number;
    zoneId: string;
    zoneName: string;
    durationSec: number;
    startMoisture: number | null;
    endMoisture: number | null;
    trigger: string;
    flowLiters: number;
}
type SetStateFn = (id: string, val: string) => Promise<void>;
type GetStateFn = (id: string) => Promise<string | null>;
export declare class DatabaseService {
    private readonly log;
    private readonly setState;
    private readonly getState;
    private readonly statsCache;
    private readonly energyCache;
    private readonly irrCache;
    private readonly sensorAcc;
    private readonly energyAcc;
    private readonly lastMidnightFlush;
    constructor(log: ILogger, setState: SetStateFn, getState: GetStateFn);
    loadGroup(groupId: string): Promise<void>;
    trackSensorValue(groupId: string, sensorId: string, value: number, name?: string): void;
    trackActuatorOn(groupId: string, actuatorId: string, name: string, ratedWatts?: number): void;
    trackActuatorOff(groupId: string, actuatorId: string, ratedWatts: number): void;
    /**
     * Wird bei jedem Live-W-Wert aufgerufen (energyStateUnit='W').
     * Akkumuliert Wh seit dem letzten Sample-Zeitpunkt.
     */
    updateActuatorPowerSample(groupId: string, actuatorId: string, watts: number): void;
    trackActuatorWh(groupId: string, actuatorId: string, name: string, deltaWh: number, durationMin: number): void;
    addIrrigationEvent(groupId: string, event: IrrigationEvent): Promise<void>;
    tickMidnight(groupId: string): Promise<void>;
    flushDay(groupId: string): Promise<void>;
    getStats(groupId: string): DailySensorStat[];
    getEnergy(groupId: string): DailyEnergyStat[];
    getIrrigation(groupId: string): IrrigationEvent[];
    private readJson;
    private flush;
    private todayStr;
}
export {};
//# sourceMappingURL=DatabaseService.d.ts.map