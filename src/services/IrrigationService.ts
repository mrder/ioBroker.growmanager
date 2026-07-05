// ============================================================
// GrowManager – IrrigationService
// Bewässerungsautomatik pro Zone, vollständig optional:
//  - Sensor fehlt → Zeitsteuerung oder manuell
//  - Pumpe fehlt  → Zone wird übersprungen
//  - Flow fehlt   → kein Leckage-Schutz
// ============================================================

import type { IrrigationZoneConfig, GroupConfig, TimeWindow } from '../models/config';
import type { SensorState } from '../models/config';
import type { AlarmService } from './AlarmService';
import { ALARM_CODES } from './AlarmService';
import type { ILogger } from '../utils/logger';
import { isInTimeWindow } from '../utils/time';

// Betriebszustand einer Zone
export interface ZoneState {
    zoneId: string;
    running: boolean;
    startTs: number;           // 0 wenn nicht aktiv
    lastEndTs: number;         // letzte Bewässerung beendet
    pauseUntil: number;        // nicht vor diesem Zeitstempel starten
    currentMoisture: number | null;
    flowRate: number | null;   // L/min (optional)
    lastFlowTs: number;        // Timestamp des letzten updateFlow()-Aufrufs
    totalFlowLiters: number;   // Lauf-gesamt
    cycleCount: number;
    faultCount: number;
    blocked: boolean;
    blockedReason?: string;
    health: 'ok' | 'noFlow' | 'leak' | 'dryRun' | 'timeout' | 'fault' | 'unknown';
}

// Ergebnis der Entscheidung pro Zone
export interface IrrigationDecision {
    zoneId: string;
    command: boolean;    // true = Pumpe EIN
    reason: string;
    blocked: boolean;
}

export class IrrigationService {
    private readonly zoneStates = new Map<string, ZoneState>();
    private readonly zoneConfigs = new Map<string, IrrigationZoneConfig>();

    constructor(
        private readonly alarmService: AlarmService,
        private readonly log: ILogger
    ) {}

    initZone(zone: IrrigationZoneConfig): void {
        this.zoneConfigs.set(zone.id, zone);
        if (this.zoneStates.has(zone.id)) return;
        this.zoneStates.set(zone.id, {
            zoneId: zone.id,
            running: false,
            startTs: 0,
            lastEndTs: 0,
            pauseUntil: 0,
            currentMoisture: null,
            flowRate: null,
            lastFlowTs: 0,
            totalFlowLiters: 0,
            cycleCount: 0,
            faultCount: 0,
            blocked: false,
            health: 'unknown',
        });
    }

    /**
     * Haupt-Entscheidungslogik für eine Zone.
     * Wird im Regelzyklus für jede aktivierte Zone aufgerufen.
     */
    decide(
        zone: IrrigationZoneConfig,
        groupId: string,
        sensorStates: Map<string, SensorState>,
        now: Date
    ): IrrigationDecision {
        this.initZone(zone);
        const state = this.zoneStates.get(zone.id)!;

        // Zone deaktiviert
        if (!zone.enabled) {
            return { zoneId: zone.id, command: false, reason: 'Zone deaktiviert', blocked: false };
        }

        // Fehlersperre
        if (state.blocked) {
            return { zoneId: zone.id, command: false, reason: state.blockedReason ?? 'Gesperrt', blocked: true };
        }

        // Erlaubtes Zeitfenster prüfen (optional)
        if (zone.allowedWindow && !isInTimeWindow(now, zone.allowedWindow.startHH, zone.allowedWindow.startMM, zone.allowedWindow.endHH, zone.allowedWindow.endMM)) {
            if (state.running) {
                this.log.info(`Zone ${zone.name}: Zeitfenster endet → Pumpe AUS`);
                return { zoneId: zone.id, command: false, reason: 'Außerhalb Zeitfenster', blocked: false };
            }
            return { zoneId: zone.id, command: false, reason: 'Außerhalb erlaubtem Zeitfenster', blocked: false };
        }

        // Mindestpause prüfen
        if (!state.running && Date.now() < state.pauseUntil) {
            const waitMin = Math.ceil((state.pauseUntil - Date.now()) / 60000);
            return { zoneId: zone.id, command: false, reason: `Mindestpause: noch ${waitMin} min`, blocked: false };
        }

        // Bodenfeuchte auslesen (optional)
        const moisture = this.aggregateMoisture(zone, sensorStates);
        state.currentMoisture = moisture;

        // Laufender Zyklus
        if (state.running) {
            return this.handleRunning(zone, state, groupId);
        }

        // Startentscheidung
        return this.handleStopped(zone, state, moisture);
    }

    private handleRunning(
        zone: IrrigationZoneConfig,
        state: ZoneState,
        groupId: string
    ): IrrigationDecision {
        const elapsed = (Date.now() - state.startTs) / 1000;

        // Maximale Laufzeit
        if (elapsed > zone.maxRunSeconds) {
            this.stopZone(zone, state, 'Maximale Laufzeit erreicht');
            if (zone.dryRunProtection && (state.flowRate === null || state.flowRate < 0.1)) {
                this.alarmService.raise(
                    ALARM_CODES.IRRIGATION_DRY_RUN,
                    groupId,
                    `zone:${zone.id}`,
                    'fault',
                    `Zone ${zone.name}: Kein Durchfluss erkannt (Trockenläuferschutz)`
                );
                state.blocked = true;
                state.blockedReason = 'Trockenläufer-Schutz aktiv';
                state.health = 'dryRun';
            }
            return { zoneId: zone.id, command: false, reason: 'Timeout', blocked: false };
        }

        // Sollfeuchte erreicht (wenn Sensor vorhanden)
        if (state.currentMoisture !== null && state.currentMoisture >= zone.targetMoisture) {
            this.stopZone(zone, state, `Zielfeuchte erreicht (${state.currentMoisture.toFixed(0)}%)`);
            return { zoneId: zone.id, command: false, reason: `Zielfeuchte ${zone.targetMoisture}% erreicht`, blocked: false };
        }

        // Leckage prüfen (wenn Flow-Sensor vorhanden UND Pumpe schon lange läuft)
        if (zone.leakageAlarmSeconds > 0 && elapsed > zone.leakageAlarmSeconds) {
            if (state.flowRate !== null && state.flowRate > 5.0) {
                this.alarmService.raise(
                    ALARM_CODES.IRRIGATION_LEAK,
                    groupId,
                    `zone:${zone.id}`,
                    'critical',
                    `Zone ${zone.name}: Verdacht auf Leckage (${state.flowRate.toFixed(1)} L/min nach ${elapsed.toFixed(0)}s)`
                );
                this.stopZone(zone, state, 'Leckage-Schutz');
                state.blocked = true;
                state.blockedReason = 'Leckage erkannt – manuelle Prüfung erforderlich';
                state.health = 'leak';
                return { zoneId: zone.id, command: false, reason: 'Leckageschutz', blocked: true };
            }
        }

        return { zoneId: zone.id, command: true, reason: `Bewässerung läuft (${elapsed.toFixed(0)}s)`, blocked: false };
    }

    private handleStopped(
        zone: IrrigationZoneConfig,
        state: ZoneState,
        moisture: number | null
    ): IrrigationDecision {
        // Mit Feuchtesensor: Startschwelle prüfen
        if (moisture !== null) {
            if (moisture <= zone.startMoisture) {
                this.startZone(zone, state);
                return { zoneId: zone.id, command: true, reason: `Bodenfeuchte ${moisture.toFixed(0)}% ≤ ${zone.startMoisture}%`, blocked: false };
            }
            return { zoneId: zone.id, command: false, reason: `Bodenfeuchte OK (${moisture.toFixed(0)}%)`, blocked: false };
        }

        // Ohne Sensor: Bewässerung nur wenn explizit angefordert (z.B. Zeitplan)
        // Der externe Aufruf muss dann triggerManual() aufrufen
        return { zoneId: zone.id, command: false, reason: 'Kein Feuchtesensor – Zeitsteuerung via triggerManual()', blocked: false };
    }

    /**
     * Manuelle/Zeitplan-gesteuerte Bewässerung auslösen.
     */
    triggerManual(zone: IrrigationZoneConfig, durationSeconds?: number): boolean {
        this.initZone(zone);
        const state = this.zoneStates.get(zone.id)!;
        if (state.running || state.blocked) return false;
        if (Date.now() < state.pauseUntil) return false;
        const runSecs = durationSeconds ?? zone.maxRunSeconds;
        this.startZone({ ...zone, maxRunSeconds: runSecs }, state);
        return true;
    }

    /**
     * Flow-Wert aus ioBroker aktualisieren (Volumenstrom in L/min).
     */
    updateFlow(zoneId: string, flowLpm: number | null): void {
        const state = this.zoneStates.get(zoneId);
        if (!state) return;
        const now = Date.now();
        if (flowLpm !== null && state.running && state.startTs > 0 && state.lastFlowTs > 0) {
            const dt = (now - state.lastFlowTs) / 3600000; // Delta seit letztem Update in Stunden
            state.totalFlowLiters += flowLpm * dt;
        }
        state.lastFlowTs = now;
        state.flowRate = flowLpm;
    }

    /**
     * Pumpe sofort stoppen (Notfall / manuell).
     */
    stopNow(zoneId: string, reason: string): void {
        const state = this.zoneStates.get(zoneId);
        const zone = this.zoneConfigs.get(zoneId);
        if (state && zone) this.stopZone(zone, state, reason);
        else if (state) this.stopZone({ minPauseMinutes: 0 } as IrrigationZoneConfig, state, reason);
    }

    /**
     * Sperre aufheben (nach manuellem Eingriff).
     */
    clearFault(zoneId: string): void {
        const state = this.zoneStates.get(zoneId);
        if (state) {
            state.blocked = false;
            state.blockedReason = undefined;
            state.health = 'unknown';
            state.faultCount = 0;
        }
    }

    getState(zoneId: string): ZoneState | undefined {
        return this.zoneStates.get(zoneId);
    }

    /**
     * Berechnet für eine Gruppe, ob gerade irgendeine Zone bewässert.
     */
    isAnyZoneRunning(group: GroupConfig): boolean {
        return group.irrigationZones.some(z => this.zoneStates.get(z.id)?.running ?? false);
    }

    private startZone(zone: IrrigationZoneConfig, state: ZoneState): void {
        state.running = true;
        state.startTs = Date.now();
        state.health = 'ok';
        state.cycleCount++;
        this.log.info(`Zone ${zone.id}: Bewässerung gestartet (Zyklus ${state.cycleCount})`);
    }

    private stopZone(zone: Pick<IrrigationZoneConfig, 'minPauseMinutes'>, state: ZoneState, reason: string): void {
        state.running = false;
        state.lastEndTs = Date.now();
        state.startTs = 0;
        state.pauseUntil = Date.now() + zone.minPauseMinutes * 60000;
        this.log.info(`Zone ${state.zoneId}: Bewässerung gestoppt (${reason})`);
    }

    private aggregateMoisture(
        zone: IrrigationZoneConfig,
        sensorStates: Map<string, SensorState>
    ): number | null {
        if (zone.moistureSensorIds.length === 0) return null;

        const values: number[] = [];
        for (const id of zone.moistureSensorIds) {
            const st = sensorStates.get(id);
            if (st?.valid && typeof st.processedValue === 'number') {
                values.push(st.processedValue);
            }
        }

        if (values.length === 0) return null;
        return values.reduce((a, b) => a + b, 0) / values.length;
    }
}
