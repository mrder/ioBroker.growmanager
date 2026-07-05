// ============================================================
// GrowManager – ClimateController
// Per-Aktor Regelziel: controlTarget bestimmt Regellogik.
// Fallback: Ableitung aus Aktor-Typ wenn controlTarget nicht gesetzt.
// ============================================================

import type {
    GroupConfig,
    GroupState,
    ClimateSetpoint,
    ControlDecision,
    ControlAction,
    ActuatorConfig,
    ControlTarget,
    ControlDirection,
    OutdoorSensorConfig,
    DayNight,
} from '../models/config';
import { calculateVPD, condensationRisk, hysteresisCheck } from '../utils/calculations';
import type { AlarmService } from '../services/AlarmService';
import { ALARM_CODES } from '../services/AlarmService';
import type { ILogger } from '../utils/logger';

type HystState = -1 | 0 | 1;

interface GroupHystStates {
    temperature: HystState;
    humidity: HystState;
    vpd: HystState;
    co2: HystState;
}

// Ableitung des Regelziels aus Aktor-Typ (wenn controlTarget nicht explizit gesetzt).
// Im VPD-Modus regeln Feuchte- und Temperatur-Aktoren über VPD statt absolut.
function inferControlTarget(act: ActuatorConfig, groupMode?: string): ControlTarget {
    if (act.controlTarget) return act.controlTarget;
    const isVpdMode = groupMode === 'vpd';
    switch (act.type) {
        case 'light':          return 'light';
        case 'circulationFan': return 'timer';
        case 'exhaustFan':
        case 'supplyFan':
        case 'cooling':        return isVpdMode ? 'vpd' : 'temperature';
        case 'heating':        return isVpdMode ? 'vpd' : 'temperature';
        case 'humidifier':     return isVpdMode ? 'vpd' : 'humidity';
        case 'dehumidifier':   return isVpdMode ? 'vpd' : 'humidity';
        case 'co2Valve':       return 'co2';
        case 'irrigation':     return 'soilMoisture';
        default:               return 'custom';
    }
}

function inferControlDirection(act: ActuatorConfig): ControlDirection {
    if (act.controlDirection) return act.controlDirection;
    switch (act.type) {
        case 'heating':      return 'up';
        case 'humidifier':   return 'up';
        case 'cooling':
        case 'exhaustFan':
        case 'supplyFan':
        case 'dehumidifier': return 'down';
        default:             return 'both';
    }
}

export class ClimateController {
    private readonly hystStates = new Map<string, GroupHystStates>();
    private readonly actuatorHystStates = new Map<string, HystState>();
    // Stufenregelung: merkt sich seit wann Stufe-1 für ein Ziel aktiv ist.
    // Key: `${groupId}:${controlTarget}:${direction}`
    private readonly stage1ActiveSince = new Map<string, number>();

    constructor(
        private readonly alarmService: AlarmService,
        private readonly log: ILogger
    ) {}

    /**
     * Hauptregel-Funktion. Erzeugt eine ControlDecision für eine Gruppe.
     * outdoorTemp / outdoorHumidity kommen vom konfigurierten Außensensor der Gruppe.
     */
    decide(
        config: GroupConfig,
        state: GroupState,
        setpoint: ClimateSetpoint,
        shadowMode: boolean,
        outdoorTemp: number | null = null,
        outdoorHumidity: number | null = null,
    ): ControlDecision {
        const actions: ControlAction[] = [];
        const hyst = this.getHystStates(config.id);

        const temp = state.temperature;
        const hum = state.humidity;
        const vpd = state.vpd;

        let primaryReason = 'Keine Regelung notwendig';

        // --------------------------------------------------------
        // Priorität 1: Übertemperatur-Notfall
        // --------------------------------------------------------
        if (temp !== null && temp > setpoint.temperatureCritical) {
            this.alarmService.raise(
                ALARM_CODES.TEMPERATURE_HIGH, config.id, 'climate', 'critical',
                `Kritische Übertemperatur: ${temp.toFixed(1)} °C > ${setpoint.temperatureCritical} °C`
            );
            primaryReason = `Übertemperatur ${temp.toFixed(1)} °C – Maximalabluft`;
            this.requestByTarget(config, 'temperature', 'down', actions, true, 100, primaryReason, null, null);
            this.requestByTarget(config, 'temperature', 'up', actions, false, 0, 'Verriegelung: Übertemperatur', null, null);
            return this.buildDecision(config, state, primaryReason, actions, shadowMode);
        } else if (temp !== null) {
            this.alarmService.clear(ALARM_CODES.TEMPERATURE_HIGH, config.id, 'climate');
        }

        // --------------------------------------------------------
        // Priorität 2: Kondensations- und Schimmelgefahr
        // --------------------------------------------------------
        if (temp !== null && hum !== null && condensationRisk(temp, hum)) {
            this.alarmService.raise(
                ALARM_CODES.CONDENSATION_RISK, config.id, 'climate', 'fault',
                `Kondensationsrisiko: T=${temp.toFixed(1)}°C RH=${hum.toFixed(0)}%`
            );
            primaryReason = 'Kondensationsrisiko – Entfeuchter / Abluft';
            this.requestByTarget(config, 'humidity', 'down', actions, true, 60, primaryReason, outdoorTemp, outdoorHumidity);
            this.requestByTarget(config, 'humidity', 'up', actions, false, 0, 'Gegenseitige Verriegelung', null, null);
            return this.buildDecision(config, state, primaryReason, actions, shadowMode);
        } else if (temp !== null && hum !== null) {
            this.alarmService.clear(ALARM_CODES.CONDENSATION_RISK, config.id, 'climate');
        }

        // --------------------------------------------------------
        // Priorität 3: Kritische Untertemperatur
        // --------------------------------------------------------
        if (temp !== null && temp < setpoint.temperatureMin - 3) {
            this.alarmService.raise(
                ALARM_CODES.TEMPERATURE_LOW, config.id, 'climate', 'fault',
                `Kritische Untertemperatur: ${temp.toFixed(1)} °C`
            );
            primaryReason = `Untertemperatur ${temp.toFixed(1)} °C – Heizung`;
            this.requestByTarget(config, 'temperature', 'up', actions, true, 0, primaryReason, null, null);
            return this.buildDecision(config, state, primaryReason, actions, shadowMode);
        } else if (temp !== null) {
            this.alarmService.clear(ALARM_CODES.TEMPERATURE_LOW, config.id, 'climate');
        }

        // --------------------------------------------------------
        // Per-Aktor Routing (Normalfall)
        // --------------------------------------------------------
        const reasons: string[] = [];

        for (const act of config.actuators) {
            if (!act.enabled) continue;
            const target = inferControlTarget(act, config.mode);
            const dir = inferControlDirection(act);

            switch (target) {
                case 'light':
                    this.decideLight(act, state, actions);
                    break;

                case 'timer':
                    if (!actions.find(a => a.actuatorId === act.id)) {
                        this.pushAction(actions, act, true, 'Dauerbetrieb', false);
                    }
                    break;

                case 'temperature': {
                    const r = this.decideTemperatureAct(act, dir, temp, setpoint, hyst, actions, outdoorTemp, outdoorHumidity, config.outdoorSensor);
                    if (r) reasons.push(r);
                    break;
                }

                case 'humidity': {
                    const r = this.decideHumidityAct(act, dir, hum, setpoint, hyst, actions, outdoorTemp, outdoorHumidity, config.outdoorSensor);
                    if (r) reasons.push(r);
                    break;
                }

                case 'vpd': {
                    const r = this.decideVpdAct(act, dir, vpd, temp, hum, setpoint, hyst, actions, outdoorTemp, outdoorHumidity, config.outdoorSensor);
                    if (r) reasons.push(r);
                    break;
                }

                case 'co2': {
                    const r = this.decideCo2Act(act, dir, setpoint, hyst, actions);
                    if (r) reasons.push(r);
                    break;
                }

                case 'soilMoisture':
                    // Wird von IrrigationService gesteuert — hier nichts tun
                    break;

                case 'custom':
                default:
                    // Kein automatisches Regelziel
                    break;
            }
        }

        primaryReason = reasons.length > 0 ? reasons.join('; ') : 'Alle Aktoren im Zielbereich';

        // Stufenregelung: Stufe-2-Aktoren sperren bis Stufe-1 lang genug aktiv ist
        this.applyEscalationBlocking(config, actions);

        return this.buildDecision(config, state, primaryReason, actions, shadowMode);
    }

    // ============================================================
    // Lichtsteuerung (Zeitplan)
    // ============================================================
    private decideLight(act: ActuatorConfig, state: GroupState, actions: ControlAction[]): void {
        const isDay = state.dayNight !== 'night';
        this.pushAction(actions, act, isDay, `Zeitplan: ${state.dayNight}`, false);
    }

    // ============================================================
    // Temperatur-Aktor
    // ============================================================
    private decideTemperatureAct(
        act: ActuatorConfig,
        dir: ControlDirection,
        temp: number | null,
        sp: ClimateSetpoint,
        hyst: GroupHystStates,
        actions: ControlAction[],
        outdoorTemp: number | null,
        outdoorHumidity: number | null,
        outdoorCfg: OutdoorSensorConfig | undefined,
    ): string | null {
        if (temp === null) return null;

        let tState: HystState;
        if (act.actuatorHysteresis !== undefined && act.actuatorHysteresis > 0) {
            // Per-Aktor Schwelle: eigener State, unabhängig vom Gruppen-State
            const prevAct = this.actuatorHystStates.get(act.id) ?? 0;
            tState = hysteresisCheck(temp, sp.temperature, act.actuatorHysteresis * 2, prevAct);
            this.actuatorHystStates.set(act.id, tState);
        } else {
            tState = hysteresisCheck(temp, sp.temperature, sp.temperatureTolerance * 2, hyst.temperature);
            hyst.temperature = tState;
        }

        if (dir === 'up') {
            // Heizung
            if (tState === -1) {
                this.pushAction(actions, act, true, `T=${temp.toFixed(1)}°C < ${sp.temperature}°C`, false);
                return `Heizung EIN (${temp.toFixed(1)} °C zu kalt)`;
            } else {
                this.pushAction(actions, act, false, `T im Zielbereich`, false);
            }
        } else if (dir === 'down' || dir === 'both') {
            // Kühlung / Abluft
            if (tState === 1) {
                // Außenluft-Guard: nur schalten wenn Außenluft günstiger
                if (act.outdoorGuardEnabled && outdoorTemp !== null) {
                    const minDelta = outdoorCfg?.minTempDeltaCelsius ?? 2;
                    const delta = temp - outdoorTemp;
                    if (delta < minDelta) {
                        this.pushAction(actions, act, false, `Außenluft zu warm (${outdoorTemp.toFixed(1)}°C, Δ${delta.toFixed(1)}K < ${minDelta}K)`, false);
                        return `Lüfter gesperrt: Außenluft nicht kühler genug (${outdoorTemp.toFixed(1)}°C)`;
                    }
                }
                const val = act.supportsPercent ? 60 : true;
                this.pushAction(actions, act, val, `T=${temp.toFixed(1)}°C > ${sp.temperature}°C`, false);
                return `Kühlung EIN (${temp.toFixed(1)} °C zu warm)`;
            } else {
                this.pushAction(actions, act, false, `T im Zielbereich`, false);
            }
        }
        return null;
    }

    // ============================================================
    // Feuchte-Aktor
    // ============================================================
    private decideHumidityAct(
        act: ActuatorConfig,
        dir: ControlDirection,
        hum: number | null,
        sp: ClimateSetpoint,
        hyst: GroupHystStates,
        actions: ControlAction[],
        outdoorTemp: number | null,
        outdoorHumidity: number | null,
        outdoorCfg: OutdoorSensorConfig | undefined,
    ): string | null {
        if (hum === null) return null;

        let hState: HystState;
        if (act.actuatorHysteresis !== undefined && act.actuatorHysteresis > 0) {
            const prevAct = this.actuatorHystStates.get(act.id) ?? 0;
            hState = hysteresisCheck(hum, sp.humidity, act.actuatorHysteresis * 2, prevAct);
            this.actuatorHystStates.set(act.id, hState);
        } else {
            hState = hysteresisCheck(hum, sp.humidity, sp.humidityTolerance * 2, hyst.humidity);
            hyst.humidity = hState;
        }

        if (dir === 'up') {
            // Befeuchter
            if (hState === -1) {
                this.pushAction(actions, act, true, `RH=${hum.toFixed(0)}% < ${sp.humidity}%`, false);
                return `Befeuchter EIN (${hum.toFixed(0)}% zu trocken)`;
            } else {
                this.pushAction(actions, act, false, `RH im Zielbereich`, false);
            }
        } else if (dir === 'down' || dir === 'both') {
            // Entfeuchter / Abluft
            if (hState === 1) {
                // Außenluft-Guard für Feuchte
                if (act.outdoorGuardEnabled && outdoorHumidity !== null) {
                    const maxHumDelta = outdoorCfg?.maxHumidityDeltaPercent ?? 10;
                    if (outdoorHumidity > hum + maxHumDelta) {
                        this.pushAction(actions, act, false, `Außenluft zu feucht (${outdoorHumidity.toFixed(0)}%)`, false);
                        return `Lüfter gesperrt: Außenluft zu feucht (${outdoorHumidity.toFixed(0)}%)`;
                    }
                }
                const val = act.supportsPercent ? 60 : true;
                this.pushAction(actions, act, val, `RH=${hum.toFixed(0)}% > ${sp.humidity}%`, false);
                return `Entfeuchter EIN (${hum.toFixed(0)}% zu feucht)`;
            } else {
                this.pushAction(actions, act, false, `RH im Zielbereich`, false);
            }
        }
        return null;
    }

    // ============================================================
    // VPD-Aktor (koordiniert Temp + Feuchte)
    // ============================================================
    private decideVpdAct(
        act: ActuatorConfig,
        dir: ControlDirection,
        vpd: number | null,
        temp: number | null,
        hum: number | null,
        sp: ClimateSetpoint,
        hyst: GroupHystStates,
        actions: ControlAction[],
        outdoorTemp: number | null,
        outdoorHumidity: number | null,
        outdoorCfg: OutdoorSensorConfig | undefined,
    ): string | null {
        if (vpd === null || temp === null || hum === null) return null;

        if (sp.vpdMin == null || sp.vpdMax == null) return null; // kein VPD-Sollwert konfiguriert
        const vpdMid = (sp.vpdMin + sp.vpdMax) / 2;
        let vpdState: HystState;
        if (act.actuatorHysteresis !== undefined && act.actuatorHysteresis > 0) {
            const prevAct = this.actuatorHystStates.get(act.id) ?? 0;
            vpdState = hysteresisCheck(vpd, vpdMid, act.actuatorHysteresis * 2, prevAct);
            this.actuatorHystStates.set(act.id, vpdState);
        } else {
            const band = Math.max(0.05, sp.vpdMax - sp.vpdMin); // Mindestband 0.05 kPa gegen Bang-Bang
            vpdState = hysteresisCheck(vpd, vpdMid, band, hyst.vpd);
            hyst.vpd = vpdState;
        }

        if (vpdState === -1) {
            // VPD zu niedrig → Feuchte senken oder Temperatur erhöhen
            if (dir === 'down' || dir === 'both') {
                // Entfeuchter / Abluft
                if (act.outdoorGuardEnabled && outdoorHumidity !== null) {
                    const maxHumDelta = outdoorCfg?.maxHumidityDeltaPercent ?? 10;
                    if (outdoorHumidity > hum + maxHumDelta) {
                        this.pushAction(actions, act, false, `Außenluft zu feucht`, false);
                        return null;
                    }
                }
                const val = act.supportsPercent ? 50 : true;
                this.pushAction(actions, act, val, `VPD ${vpd.toFixed(2)} zu niedrig – Entfeuchten`, false);
                return `VPD ${vpd.toFixed(2)} kPa (Ziel: ${sp.vpdMin}–${sp.vpdMax}) → zu niedrig: Entfeuchten`;
            } else if (dir === 'up') {
                // Heizung für VPD erhöhen
                this.pushAction(actions, act, true, `VPD ${vpd.toFixed(2)} zu niedrig – Heizung`, false);
                return `VPD zu niedrig → Heizung`;
            }
        } else if (vpdState === 1) {
            // VPD zu hoch → Feuchte erhöhen oder Temperatur senken
            if (dir === 'up') {
                // Befeuchter: mehr Feuchte → VPD sinkt ✓
                this.pushAction(actions, act, true, `VPD ${vpd.toFixed(2)} zu hoch – Befeuchten`, false);
                return `VPD ${vpd.toFixed(2)} kPa → zu hoch: Befeuchten`;
            } else if (dir === 'down' || dir === 'both') {
                // Entfeuchter senkt Feuchte → VPD würde steigen → darf bei VPD-zu-hoch NICHT laufen
                if (act.type === 'dehumidifier') {
                    this.pushAction(actions, act, false, `VPD zu hoch – Entfeuchter gesperrt`, false);
                    return null;
                }
                // Kühlung / Abluft: senkt Temperatur → VPD sinkt ✓
                if (act.outdoorGuardEnabled && outdoorTemp !== null) {
                    const minDelta = outdoorCfg?.minTempDeltaCelsius ?? 2;
                    const delta = temp - outdoorTemp;
                    if (delta < minDelta) {
                        this.pushAction(actions, act, false, `Außenluft zu warm für VPD`, false);
                        return null;
                    }
                }
                const val = act.supportsPercent ? 50 : true;
                this.pushAction(actions, act, val, `VPD ${vpd.toFixed(2)} zu hoch – Kühlen`, false);
                return `VPD zu hoch → Kühlung`;
            }
        } else {
            this.pushAction(actions, act, false, `VPD im Zielbereich`, false);
        }
        return null;
    }

    // ============================================================
    // CO₂-Aktor
    // ============================================================
    private decideCo2Act(
        act: ActuatorConfig,
        dir: ControlDirection,
        sp: ClimateSetpoint,
        hyst: GroupHystStates,
        actions: ControlAction[],
    ): string | null {
        if (!sp.co2Target) return null;
        // CO₂ wird über separate Sensor-States gelesen — hier Platzhalter
        // Die eigentliche CO₂-Regelung benötigt einen co2-Sensor in der Gruppe
        this.pushAction(actions, act, false, 'CO₂-Regelung: kein Sensor', false);
        return null;
    }

    // ============================================================
    // Hilfsfunktionen
    // ============================================================

    private requestByTarget(
        config: GroupConfig,
        target: ControlTarget,
        dir: ControlDirection,
        actions: ControlAction[],
        on: boolean,
        percent: number,
        reason: string,
        outdoorTemp: number | null,
        outdoorHumidity: number | null,
    ): void {
        for (const act of config.actuators) {
            if (!act.enabled) continue;
            if (inferControlTarget(act, config.mode) !== target) continue;
            if (dir !== 'both' && inferControlDirection(act) !== dir && inferControlDirection(act) !== 'both') continue;
            const val = on ? (act.supportsPercent && percent > 0 ? percent : true) : false;
            this.pushAction(actions, act, val, reason, false);
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
            actions: shadowMode
                ? actions.map(a => {
                    const act = config.actuators.find(x => x.id === a.actuatorId);
                    if (act?.type === 'light') return a; // Licht immer nach Zeitplan, nie durch Shadow Mode blockieren
                    return { ...a, blocked: true, blockedReason: 'Shadow Mode' };
                })
                : actions,
            degradation: state.degradation,
        };
    }

    /**
     * Stufenregelung: Stufe-2-Aktoren werden gesperrt bis Stufe-1 lange genug läuft.
     * Stufe 1 = Lüftung (primär), Stufe 2 = Klimagerät / Heizung (Eskalation).
     */
    private applyEscalationBlocking(config: GroupConfig, actions: ControlAction[]): void {
        const now = Date.now();

        // Stage-1-Tracking aktualisieren: für jede (target, dir)-Kombination prüfen ob Stufe-1 EIN
        const targets = new Set(
            config.actuators
                .filter(a => a.enabled && a.escalationStage === 1)
                .map(a => `${inferControlTarget(a, config.mode)}:${inferControlDirection(a)}`)
        );

        for (const key of targets) {
            const [target, dir] = key.split(':') as [ControlTarget, ControlDirection];
            const stage1Acts = config.actuators.filter(
                a => a.enabled && a.escalationStage === 1
                    && inferControlTarget(a, config.mode) === target
                    && inferControlDirection(a) === dir
            );
            const stage1IsOn = stage1Acts.some(a => {
                const action = actions.find(x => x.actuatorId === a.id);
                if (!action) return false;
                return typeof action.requested === 'boolean' ? action.requested : action.requested > 0;
            });

            const mapKey = `${config.id}:${target}:${dir}`;
            if (stage1IsOn) {
                if (!this.stage1ActiveSince.has(mapKey)) {
                    this.stage1ActiveSince.set(mapKey, now);
                }
            } else {
                this.stage1ActiveSince.delete(mapKey);
            }
        }

        // Stufe-2-Aktoren prüfen
        for (const act of config.actuators) {
            if (!act.enabled || act.escalationStage !== 2) continue;
            const action = actions.find(x => x.actuatorId === act.id);
            if (!action) continue;
            const wantsOn = typeof action.requested === 'boolean' ? action.requested : action.requested > 0;
            if (!wantsOn) continue; // will AUS → kein Blocking nötig

            const target = inferControlTarget(act, config.mode);
            const dir = inferControlDirection(act);
            const mapKey = `${config.id}:${target}:${dir}`;

            // Gibt es überhaupt Stufe-1-Aktoren für dieses Ziel?
            const hasStage1 = config.actuators.some(
                a => a.enabled && a.escalationStage === 1
                    && inferControlTarget(a, config.mode) === target
                    && inferControlDirection(a) === dir
            );
            if (!hasStage1) continue; // kein Stufe-1 konfiguriert → direkt freigeben

            const activeSince = this.stage1ActiveSince.get(mapKey);
            if (!activeSince) {
                // Stufe-1 läuft nicht → Stufe-2 sperren
                action.blocked = true;
                action.blockedReason = `Stufenregelung: Stufe 1 noch nicht aktiv`;
                continue;
            }

            const runningMinutes = (now - activeSince) / 60000;
            const delayMinutes = act.escalationDelayMinutes ?? 10;
            if (runningMinutes < delayMinutes) {
                const remaining = Math.ceil(delayMinutes - runningMinutes);
                action.blocked = true;
                action.blockedReason = `Stufenregelung: warte auf Stufe 1 (${Math.floor(runningMinutes)}/${delayMinutes} min, noch ${remaining} min)`;
                this.log.debug(
                    `${config.name}: ${act.name} (Stufe 2) gesperrt – Stufe 1 läuft seit ${Math.floor(runningMinutes)} min, braucht ${delayMinutes} min`
                );
            }
            // else: Stufe-1 läuft lang genug → Stufe-2 darf schalten
        }
    }

    private getHystStates(groupId: string): GroupHystStates {
        let h = this.hystStates.get(groupId);
        if (!h) {
            h = { temperature: 0, humidity: 0, vpd: 0, co2: 0 };
            this.hystStates.set(groupId, h);
        }
        return h;
    }
}
