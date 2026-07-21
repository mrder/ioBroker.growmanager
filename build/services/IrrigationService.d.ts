import type { IrrigationZoneConfig, GroupConfig } from '../models/config';
import type { SensorState } from '../models/config';
import type { AlarmService } from './AlarmService';
import type { ILogger } from '../utils/logger';
export interface ZoneState {
    zoneId: string;
    running: boolean;
    startTs: number;
    lastEndTs: number;
    pauseUntil: number;
    currentMoisture: number | null;
    startMoisture: number | null;
    flowRate: number | null;
    lastFlowTs: number;
    totalFlowLiters: number;
    maxRunSeconds?: number;
    cycleCount: number;
    faultCount: number;
    blocked: boolean;
    blockedReason?: string;
    health: 'ok' | 'noFlow' | 'leak' | 'dryRun' | 'timeout' | 'fault' | 'unknown';
}
export interface IrrigationDecision {
    zoneId: string;
    command: boolean;
    reason: string;
    blocked: boolean;
}
export interface IrrigationStopEvent {
    groupId: string;
    zoneId: string;
    zoneName: string;
    startTs: number;
    durationSec: number;
    startMoisture: number | null;
    endMoisture: number | null;
    trigger: string;
    flowLiters: number;
}
export declare class IrrigationService {
    private readonly alarmService;
    private readonly log;
    private readonly zoneStates;
    private readonly zoneConfigs;
    private onStopCallback?;
    constructor(alarmService: AlarmService, log: ILogger);
    setOnStop(cb: (e: IrrigationStopEvent) => void): void;
    initZone(zone: IrrigationZoneConfig): void;
    /**
     * Haupt-Entscheidungslogik für eine Zone.
     * Wird im Regelzyklus für jede aktivierte Zone aufgerufen.
     */
    decide(zone: IrrigationZoneConfig, groupId: string, sensorStates: Map<string, SensorState>, now: Date): IrrigationDecision;
    private handleRunning;
    private handleStopped;
    /**
     * Manuelle/Zeitplan-gesteuerte Bewässerung auslösen.
     */
    triggerManual(zone: IrrigationZoneConfig, durationSeconds?: number): boolean;
    /**
     * Flow-Wert aus ioBroker aktualisieren (Volumenstrom in L/min).
     */
    updateFlow(zoneId: string, flowLpm: number | null): void;
    /**
     * Pumpe sofort stoppen (Notfall / manuell).
     */
    stopNow(zoneId: string, reason: string, groupId?: string): void;
    /**
     * Sperre aufheben (nach manuellem Eingriff).
     */
    clearFault(zoneId: string): void;
    getState(zoneId: string): ZoneState | undefined;
    /**
     * Berechnet für eine Gruppe, ob gerade irgendeine Zone bewässert.
     */
    isAnyZoneRunning(group: GroupConfig): boolean;
    private startZone;
    private stopZone;
    private aggregateMoisture;
}
//# sourceMappingURL=IrrigationService.d.ts.map