// ============================================================
// GrowManager – ClimateController
// Prioritätsbasierte Klima- und VPD-Regelung mit Hysterese
// ============================================================

import type {
    GroupConfig,
    GroupState,
    ClimateSetpoint,
    ControlDecision,
    ControlAction,
    ActuatorConfig,
    DayNight,
} from '../models/config';
import { calculateVPD, condensationRisk, hysteresisCheck } from '../utils/calculations';
import type { AlarmService } from '../services/AlarmService';
import { ALARM_CODES } from '../services/AlarmService';
import type { ILogger } from '../utils/logger';

// Interne Hysterese-Zustände pro Gruppe/Variable
type HystState = -1 | 0 | 1;

interface GroupHystStates {
    temperature: HystState;
    humidity: HystState;
    vpd: HystState;
}

export class ClimateController {
    private readonly hystStates = new Map<string, GroupHystStates>();

    constructor(
        private readonly alarmService: AlarmService,
        private readonly log: ILogger
    ) {}

    /**
     * Hauptregel-Funktion. Erzeugt eine ControlDecision für eine Gruppe.
     */
    decide(
        config: GroupConfig,
        state: GroupState,
        setpoint: ClimateSetpoint,
        shadowMode: boolean
    ): ControlDecision {
        const actions: ControlAction[] = [];
        const hyst = this.getHystStates(config.id);

        const temp = state.temperature;
        const hum = state.humidity;
        const vpd = state.vpd;
        const dayNight = state.dayNight;

        let primaryReason = 'Keine Regelung notwendig';

        // --------------------------------------------------------
        // Priorität 1: Übertemperatur-Notfall
        // --------------------------------------------------------
        if (temp !== null && temp > setpoint.temperatureCritical) {
            this.alarmService.raise(
                ALARM_CODES.TEMPERATURE_HIGH,
                config.id,
                'climate',
                'critical',
                `Kritische Übertemperatur: ${temp.toFixed(1)} °C > ${setpoint.temperatureCritical} °C`
            );
            primaryReason = `Übertemperatur ${temp.toFixed(1)} °C – Maximalabluft`;
            this.requestCoolingActuators(config, actions, 100, primaryReason);
            this.blockHeating(config, actions, 'Übertemperatur');
            return this.buildDecision(config, state, primaryReason, actions, shadowMode);
        } else if (temp !== null) {
            this.alarmService.clear(ALARM_CODES.TEMPERATURE_HIGH, config.id, 'climate');
        }

        // --------------------------------------------------------
        // Priorität 2: Kondensations- und Schimmelgefahr
        // --------------------------------------------------------
        if (temp !== null && hum !== null && condensationRisk(temp, hum)) {
            this.alarmService.raise(
                ALARM_CODES.CONDENSATION_RISK,
                config.id,
                'climate',
                'fault',
                `Kondensationsrisiko: T=${temp.toFixed(1)}°C RH=${hum.toFixed(0)}%`
            );
            primaryReason = 'Kondensationsrisiko – Entfeuchter / Abluft';
            this.requestDehumidification(config, actions, primaryReason);
            return this.buildDecision(config, state, primaryReason, actions, shadowMode);
        } else if (temp !== null && hum !== null) {
            this.alarmService.clear(ALARM_CODES.CONDENSATION_RISK, config.id, 'climate');
        }

        // --------------------------------------------------------
        // Priorität 3: Kritische Untertemperatur
        // --------------------------------------------------------
        if (temp !== null && temp < setpoint.temperatureMin - 3) {
            this.alarmService.raise(
                ALARM_CODES.TEMPERATURE_LOW,
                config.id,
                'climate',
                'fault',
                `Kritische Untertemperatur: ${temp.toFixed(1)} °C`
            );
            primaryReason = `Untertemperatur ${temp.toFixed(1)} °C – Heizung`;
            this.requestHeating(config, actions, primaryReason);
            return this.buildDecision(config, state, primaryReason, actions, shadowMode);
        } else if (temp !== null) {
            this.alarmService.clear(ALARM_CODES.TEMPERATURE_LOW, config.id, 'climate');
        }

        // --------------------------------------------------------
        // Betriebsart-Routing
        // --------------------------------------------------------
        switch (config.mode) {
            case 'vpd':
                primaryReason = this.decideVPD(config, state, setpoint, hyst, actions);
                break;
            case 'combined':
                primaryReason = this.decideCombined(config, state, setpoint, hyst, actions);
                break;
            case 'temperature':
                primaryReason = this.decideTemperature(config, state, setpoint, hyst, actions);
                break;
            case 'humidity':
                primaryReason = this.decideHumidity(config, state, setpoint, hyst, actions);
                break;
            case 'schedule':
                primaryReason = this.decideSchedule(config, state, dayNight, actions);
                break;
            case 'monitorOnly':
            case 'off':
                primaryReason = 'Modus: nur Überwachung / Aus';
                break;
            default:
                break;
        }

        return this.buildDecision(config, state, primaryReason, actions, shadowMode);
    }

    // ============================================================
    // VPD-Regelung
    // ============================================================
    private decideVPD(
        config: GroupConfig,
        state: GroupState,
        sp: ClimateSetpoint,
        hyst: GroupHystStates,
        actions: ControlAction[]
    ): string {
        const vpd = state.vpd;
        const temp = state.temperature;
        const hum = state.humidity;

        if (vpd === null || temp === null || hum === null) {
            return 'VPD: Sensor fehlt – Fallback auf Temperatur/Feuchte';
        }

        const vpdState = hysteresisCheck(vpd, (sp.vpdMin + sp.vpdMax) / 2, sp.vpdMax - sp.vpdMin, hyst.vpd);
        hyst.vpd = vpdState;

        let reason = `VPD: ${vpd.toFixed(2)} kPa (Ziel: ${sp.vpdMin}–${sp.vpdMax})`;

        if (vpdState === -1) {
            // VPD zu niedrig → Feuchte senken oder Temperatur erhöhen
            reason += ' → zu niedrig: Entfeuchter / Heizung';
            if (hum > sp.humidityMax) {
                this.requestDehumidification(config, actions, 'VPD zu niedrig + RH zu hoch');
            } else if (temp < sp.temperature) {
                this.requestHeating(config, actions, 'VPD zu niedrig + Temp zu niedrig');
            }
        } else if (vpdState === 1) {
            // VPD zu hoch → Feuchte erhöhen oder Temperatur senken
            reason += ' → zu hoch: Befeuchter / Kühlung';
            if (hum < sp.humidityMin) {
                this.requestHumidification(config, actions, 'VPD zu hoch + RH zu niedrig');
            } else if (temp > sp.temperature) {
                this.requestCoolingActuators(config, actions, 60, 'VPD zu hoch + Temp zu hoch');
            }
        }

        // Licht und Umluft nach Zeitplan
        this.handleLightAndCirculation(config, state, actions);

        return reason;
    }

    // ============================================================
    // Kombinierte Klima-Regelung
    // ============================================================
    private decideCombined(
        config: GroupConfig,
        state: GroupState,
        sp: ClimateSetpoint,
        hyst: GroupHystStates,
        actions: ControlAction[]
    ): string {
        const reasons: string[] = [];
        reasons.push(this.decideTemperature(config, state, sp, hyst, actions));
        reasons.push(this.decideHumidity(config, state, sp, hyst, actions));
        this.handleLightAndCirculation(config, state, actions);
        return reasons.join('; ');
    }

    // ============================================================
    // Temperatur-Regelung
    // ============================================================
    private decideTemperature(
        config: GroupConfig,
        state: GroupState,
        sp: ClimateSetpoint,
        hyst: GroupHystStates,
        actions: ControlAction[]
    ): string {
        const temp = state.temperature;
        if (temp === null) return 'Temp: Sensor fehlt';

        const tState = hysteresisCheck(temp, sp.temperature, sp.temperatureTolerance * 2, hyst.temperature);
        hyst.temperature = tState;

        if (tState === 1) {
            this.requestCoolingActuators(config, actions, 60, `T=${temp.toFixed(1)}°C > ${sp.temperature}°C`);
            this.blockHeating(config, actions, 'Übertemperatur im Normalbetrieb');
            return `Temp zu hoch (${temp.toFixed(1)} °C) – Kühlung / Abluft`;
        } else if (tState === -1) {
            this.requestHeating(config, actions, `T=${temp.toFixed(1)}°C < ${sp.temperature}°C`);
            return `Temp zu niedrig (${temp.toFixed(1)} °C) – Heizung`;
        }
        return `Temp: ${temp.toFixed(1)} °C im Zielbereich`;
    }

    // ============================================================
    // Feuchte-Regelung
    // ============================================================
    private decideHumidity(
        config: GroupConfig,
        state: GroupState,
        sp: ClimateSetpoint,
        hyst: GroupHystStates,
        actions: ControlAction[]
    ): string {
        const hum = state.humidity;
        if (hum === null) return 'RH: Sensor fehlt';

        const hState = hysteresisCheck(hum, sp.humidity, sp.humidityTolerance * 2, hyst.humidity);
        hyst.humidity = hState;

        if (hState === 1) {
            this.requestDehumidification(config, actions, `RH=${hum.toFixed(0)}% > ${sp.humidity}%`);
            return `RH zu hoch (${hum.toFixed(0)} %) – Entfeuchter`;
        } else if (hState === -1) {
            this.requestHumidification(config, actions, `RH=${hum.toFixed(0)}% < ${sp.humidity}%`);
            return `RH zu niedrig (${hum.toFixed(0)} %) – Befeuchter`;
        }
        return `RH: ${hum.toFixed(0)} % im Zielbereich`;
    }

    // ============================================================
    // Zeitplan-Modus (nur Licht/Umluft)
    // ============================================================
    private decideSchedule(
        config: GroupConfig,
        state: GroupState,
        dayNight: DayNight,
        actions: ControlAction[]
    ): string {
        this.handleLightAndCirculation(config, state, actions);
        return `Zeitplan: ${dayNight}`;
    }

    // ============================================================
    // Hilfsfunktionen Aktoranforderungen
    // ============================================================

    private requestHeating(config: GroupConfig, actions: ControlAction[], reason: string): void {
        for (const act of config.actuators) {
            if (act.type === 'heating' && act.enabled) {
                this.pushAction(actions, act, true, reason, false);
            }
            // Kühlung ausschalten (Verriegelung)
            if (act.type === 'cooling' && act.enabled) {
                this.pushAction(actions, act, false, 'Verriegelung: Heizung aktiv', false);
            }
        }
    }

    private requestCoolingActuators(
        config: GroupConfig,
        actions: ControlAction[],
        exhaustPercent: number,
        reason: string
    ): void {
        for (const act of config.actuators) {
            if (act.type === 'exhaustFan' && act.enabled) {
                const val = act.supportsPercent ? exhaustPercent : true;
                this.pushAction(actions, act, val, reason, false);
            }
            if (act.type === 'cooling' && act.enabled) {
                this.pushAction(actions, act, true, reason, false);
            }
            // Heizung ausschalten (Verriegelung)
            if (act.type === 'heating' && act.enabled) {
                this.pushAction(actions, act, false, 'Verriegelung: Kühlung aktiv', false);
            }
        }
    }

    private requestDehumidification(config: GroupConfig, actions: ControlAction[], reason: string): void {
        for (const act of config.actuators) {
            if (act.type === 'dehumidifier' && act.enabled) {
                this.pushAction(actions, act, true, reason, false);
            }
            if (act.type === 'exhaustFan' && act.enabled) {
                const val = act.supportsPercent ? 60 : true;
                this.pushAction(actions, act, val, reason, false);
            }
            // Befeuchter ausschalten (Verriegelung)
            if (act.type === 'humidifier' && act.enabled) {
                this.pushAction(actions, act, false, 'Gegenseitige Verriegelung', false);
            }
        }
    }

    private requestHumidification(config: GroupConfig, actions: ControlAction[], reason: string): void {
        for (const act of config.actuators) {
            if (act.type === 'humidifier' && act.enabled) {
                this.pushAction(actions, act, true, reason, false);
            }
            // Entfeuchter ausschalten (Verriegelung)
            if (act.type === 'dehumidifier' && act.enabled) {
                this.pushAction(actions, act, false, 'Gegenseitige Verriegelung', false);
            }
        }
    }

    private blockHeating(config: GroupConfig, actions: ControlAction[], reason: string): void {
        for (const act of config.actuators) {
            if (act.type === 'heating' && act.enabled) {
                this.pushAction(actions, act, false, reason, false);
            }
        }
    }

    private handleLightAndCirculation(
        config: GroupConfig,
        state: GroupState,
        actions: ControlAction[]
    ): void {
        const isDay = state.dayNight !== 'night';
        for (const act of config.actuators) {
            if (act.type === 'light' && act.enabled) {
                this.pushAction(actions, act, isDay, `Zeitplan: ${state.dayNight}`, false);
            }
            if (act.type === 'circulationFan' && act.enabled) {
                // Umluft immer EIN (minimaler Betrieb; Detailsteuerung in AirSystem)
                if (!actions.find(a => a.actuatorId === act.id)) {
                    this.pushAction(actions, act, true, 'Mindest-Umluft', false);
                }
            }
        }
    }

    private pushAction(
        actions: ControlAction[],
        act: ActuatorConfig,
        requested: boolean | number,
        reason: string,
        blocked: boolean
    ): void {
        const existing = actions.find(a => a.actuatorId === act.id);
        if (existing) {
            // Kritischere Anforderung gewinnt (true > false, höhere Zahl gewinnt)
            if (typeof requested === 'boolean') {
                if (requested && !existing.requested) {
                    existing.requested = requested;
                    existing.reason = reason;
                }
            } else {
                if (requested > (existing.requested as number)) {
                    existing.requested = requested;
                    existing.reason = reason;
                }
            }
        } else {
            actions.push({ actuatorId: act.id, requested, reason, blocked });
        }
    }

    private buildDecision(
        config: GroupConfig,
        state: GroupState,
        reason: string,
        actions: ControlAction[],
        shadowMode: boolean
    ): ControlDecision {
        return {
            groupId: config.id,
            timestamp: Date.now(),
            mode: config.mode,
            reason,
            dayNight: state.dayNight,
            temperature: state.temperature,
            humidity: state.humidity,
            vpd: state.vpd,
            actions: shadowMode ? actions.map(a => ({ ...a, blocked: true, blockedReason: 'Shadow Mode' })) : actions,
            degradation: state.degradation,
        };
    }

    private getHystStates(groupId: string): GroupHystStates {
        let h = this.hystStates.get(groupId);
        if (!h) {
            h = { temperature: 0, humidity: 0, vpd: 0 };
            this.hystStates.set(groupId, h);
        }
        return h;
    }
}
