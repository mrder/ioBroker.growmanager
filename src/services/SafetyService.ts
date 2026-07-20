// ============================================================
// GrowManager – SafetyService
// Sicherheitsregeln, Not-Aus, Fail-safe-Zustände
// ============================================================

import type { GroupConfig, GroupState, ControlDecision, ControlAction } from '../models/config';
import type { AlarmService } from '../services/AlarmService';
import { ALARM_CODES } from '../services/AlarmService';
import type { ILogger } from '../utils/logger';

export class SafetyService {
    private emergencyStop = false;
    private globalMaintenance = false;
    private readonly groupMaintenance = new Set<string>();

    constructor(
        private readonly alarmService: AlarmService,
        private readonly log: ILogger
    ) {}

    setEmergencyStop(active: boolean): void {
        this.emergencyStop = active;
        if (active) {
            this.alarmService.raise(
                ALARM_CODES.EMERGENCY_STOP,
                '__global__',
                'safety',
                'critical',
                'Not-Aus aktiv – alle Aktoren werden in sicheren Zustand gebracht'
            );
            this.log.error('NOT-AUS AKTIVIERT');
        } else {
            this.alarmService.clear(ALARM_CODES.EMERGENCY_STOP, '__global__', 'safety');
            this.log.info('Not-Aus deaktiviert');
        }
    }

    setGlobalMaintenance(active: boolean): void {
        this.globalMaintenance = active;
    }

    setGroupMaintenance(groupId: string, active: boolean): void {
        if (active) {
            this.groupMaintenance.add(groupId);
        } else {
            this.groupMaintenance.delete(groupId);
        }
    }

    isEmergencyStop(): boolean {
        return this.emergencyStop;
    }

    isGroupPaused(groupId: string): boolean {
        return this.globalMaintenance || this.groupMaintenance.has(groupId);
    }

    /**
     * Wendet Sicherheitsregeln auf eine Kontrolle-Entscheidung an.
     * Blockiert Aktionen bei Not-Aus oder Wartung.
     */
    applySafetyRules(
        config: GroupConfig,
        decision: ControlDecision
    ): ControlDecision {
        if (this.emergencyStop) {
            const safeActions: ControlAction[] = decision.actions.map(a => {
                // Numerische Aktoren (Dimmer, Lüfter) brauchen offValue statt boolean false
                const act = config.actuators.find(c => c.id === a.actuatorId);
                const rawOff = act?.offValue;
                const offVal: boolean | number = (typeof rawOff === 'number' || typeof rawOff === 'boolean') ? rawOff : false;
                return {
                    ...a,
                    blocked: true,
                    blockedReason: 'Not-Aus aktiv',
                    requested: offVal,
                };
            });
            return {
                ...decision,
                reason: 'NOT-AUS: Alle Aktoren gesperrt',
                actions: safeActions,
            };
        }

        if (this.isGroupPaused(config.id)) {
            const maintenanceActions = decision.actions.map(a => {
                const type = this.getActuatorType(config, a.actuatorId);
                if (type === 'light') return a; // Licht immer nach Zeitplan, auch im Wartungsmodus
                return { ...a, blocked: true, blockedReason: 'Wartungsmodus' };
            });
            return {
                ...decision,
                reason: `Wartungsmodus: ${decision.reason}`,
                actions: maintenanceActions,
            };
        }

        // Heizung + Kühlung sowie Befeuchter + Entfeuchter gleichzeitig verhindern.
        // Beide Checks in einem Pass — kein Early-Return, damit beide Konflikte erkannt werden.
        const hasHeat = decision.actions.some(a => a.requested && this.getActuatorType(config, a.actuatorId) === 'heating');
        const hasCool = decision.actions.some(a => a.requested && this.getActuatorType(config, a.actuatorId) === 'cooling');
        const hasHumid = decision.actions.some(a => a.requested && this.getActuatorType(config, a.actuatorId) === 'humidifier');
        const hasDehumid = decision.actions.some(a => a.requested && this.getActuatorType(config, a.actuatorId) === 'dehumidifier');

        if (!hasHeat && !hasCool && !hasHumid && !hasDehumid) return decision;

        if (hasHeat && hasCool) this.log.warn(`Gruppe ${config.id}: Heizung UND Kühlung angefordert – Kühlung gesperrt`);
        if (hasHumid && hasDehumid) this.log.warn(`Gruppe ${config.id}: Befeuchter UND Entfeuchter angefordert – Entfeuchter gesperrt`);

        return {
            ...decision,
            actions: decision.actions.map(a => {
                const type = this.getActuatorType(config, a.actuatorId);
                if (hasHeat && hasCool && type === 'cooling' && a.requested) {
                    return { ...a, blocked: true, blockedReason: 'Verriegelung Heizung/Kühlung' };
                }
                if (hasHumid && hasDehumid && type === 'dehumidifier' && a.requested) {
                    return { ...a, blocked: true, blockedReason: 'Verriegelung Befeuchter/Entfeuchter' };
                }
                return a;
            }),
        };
    }

    /**
     * Berechnet Degradationsstufe basierend auf Sensorqualität und Sensorverfügbarkeit.
     */
    computeDegradation(state: GroupState, config: GroupConfig): GroupState['degradation'] {
        if (this.emergencyStop) return 'FAULT';
        if (this.isGroupPaused(config.id)) return 'MONITOR_ONLY';

        const hasTemp = state.temperature !== null;
        const hasHum = state.humidity !== null;

        if (state.sensorQuality === 0 && !hasTemp && !hasHum) return 'SAFE';
        if (!hasTemp && !hasHum) return 'FALLBACK';
        if (!hasTemp || !hasHum) return 'LIMITED';
        if (state.sensorQuality < 50) return 'LIMITED';
        return 'FULL';
    }

    private getActuatorType(config: GroupConfig, actuatorId: string): string {
        return config.actuators.find(a => a.id === actuatorId)?.type ?? '';
    }
}
