"use strict";
// ============================================================
// GrowManager – SafetyService
// Sicherheitsregeln, Not-Aus, Fail-safe-Zustände
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.SafetyService = void 0;
const AlarmService_1 = require("../services/AlarmService");
class SafetyService {
    constructor(alarmService, log) {
        this.alarmService = alarmService;
        this.log = log;
        this.emergencyStop = false;
        this.globalMaintenance = false;
        this.groupMaintenance = new Set();
    }
    setEmergencyStop(active) {
        this.emergencyStop = active;
        if (active) {
            this.alarmService.raise(AlarmService_1.ALARM_CODES.EMERGENCY_STOP, '__global__', 'safety', 'critical', 'Not-Aus aktiv – alle Aktoren werden in sicheren Zustand gebracht');
            this.log.error('NOT-AUS AKTIVIERT');
        }
        else {
            this.alarmService.clear(AlarmService_1.ALARM_CODES.EMERGENCY_STOP, '__global__', 'safety');
            this.log.info('Not-Aus deaktiviert');
        }
    }
    setGlobalMaintenance(active) {
        this.globalMaintenance = active;
    }
    setGroupMaintenance(groupId, active) {
        if (active) {
            this.groupMaintenance.add(groupId);
        }
        else {
            this.groupMaintenance.delete(groupId);
        }
    }
    isEmergencyStop() {
        return this.emergencyStop;
    }
    isGroupPaused(groupId) {
        return this.globalMaintenance || this.groupMaintenance.has(groupId);
    }
    /**
     * Wendet Sicherheitsregeln auf eine Kontrolle-Entscheidung an.
     * Blockiert Aktionen bei Not-Aus oder Wartung.
     */
    applySafetyRules(config, decision) {
        if (this.emergencyStop) {
            const safeActions = decision.actions.map(a => ({
                ...a,
                blocked: true,
                blockedReason: 'Not-Aus aktiv',
                // Sicherer Zustand: alle Aktoren ausschalten
                requested: false,
            }));
            return {
                ...decision,
                reason: 'NOT-AUS: Alle Aktoren gesperrt',
                actions: safeActions,
            };
        }
        if (this.isGroupPaused(config.id)) {
            const maintenanceActions = decision.actions.map(a => {
                const type = this.getActuatorType(config, a.actuatorId);
                if (type === 'light')
                    return a; // Licht immer nach Zeitplan, auch im Wartungsmodus
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
        if (!hasHeat && !hasCool && !hasHumid && !hasDehumid)
            return decision;
        if (hasHeat && hasCool)
            this.log.warn(`Gruppe ${config.id}: Heizung UND Kühlung angefordert – Kühlung gesperrt`);
        if (hasHumid && hasDehumid)
            this.log.warn(`Gruppe ${config.id}: Befeuchter UND Entfeuchter angefordert – Entfeuchter gesperrt`);
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
    computeDegradation(state, config) {
        if (this.emergencyStop)
            return 'FAULT';
        if (this.isGroupPaused(config.id))
            return 'MONITOR_ONLY';
        const hasTemp = state.temperature !== null;
        const hasHum = state.humidity !== null;
        if (state.sensorQuality === 0 && !hasTemp && !hasHum)
            return 'SAFE';
        if (!hasTemp && !hasHum)
            return 'FALLBACK';
        if (!hasTemp || !hasHum)
            return 'LIMITED';
        if (state.sensorQuality < 50)
            return 'LIMITED';
        return 'FULL';
    }
    getActuatorType(config, actuatorId) {
        return config.actuators.find(a => a.id === actuatorId)?.type ?? '';
    }
}
exports.SafetyService = SafetyService;
//# sourceMappingURL=SafetyService.js.map