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
        const co2 = state.co2 ?? null;

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
            this.requestByTarget(config, 'temperature', 'down', actions, true, 100, primaryReason, null, null, false, true);
            this.requestByTarget(config, 'temperature', 'up', actions, false, 0, 'Verriegelung: Übertemperatur', null, null, true, true);
            return this.buildDecision(config, state, primaryReason, actions, shadowMode);
        } else if (temp !== null) {
            this.alarmService.clear(ALARM_CODES.TEMPERATURE_HIGH, config.id, 'climate');
        }

        // --------------------------------------------------------
        // Priorität 2: Kritische Untertemperatur (vor Kondensation, da Frost-Schutz wichtiger)
        // --------------------------------------------------------
        if (temp !== null && temp < setpoint.temperatureMin - 3) {
            this.alarmService.raise(
                ALARM_CODES.TEMPERATURE_LOW, config.id, 'climate', 'fault',
                `Kritische Untertemperatur: ${temp.toFixed(1)} °C`
            );
            primaryReason = `Untertemperatur ${temp.toFixed(1)} °C – Heizung`;
            this.requestByTarget(config, 'temperature', 'up', actions, true, 0, primaryReason, null, null, false, true);
            return this.buildDecision(config, state, primaryReason, actions, shadowMode);
        } else if (temp !== null && temp >= setpoint.temperatureMin - 1) {
            this.alarmService.clear(ALARM_CODES.TEMPERATURE_LOW, config.id, 'climate');
        }

        // --------------------------------------------------------
        // Priorität 3: Kondensations- und Schimmelgefahr
        // --------------------------------------------------------
        if (temp !== null && hum !== null && condensationRisk(temp, hum)) {
            this.alarmService.raise(
                ALARM_CODES.CONDENSATION_RISK, config.id, 'climate', 'fault',
                `Kondensationsrisiko: T=${temp.toFixed(1)}°C RH=${hum.toFixed(0)}%`
            );
            primaryReason = 'Kondensationsrisiko – Entfeuchter / Abluft';
            this.requestByTarget(config, 'humidity', 'down', actions, true, 60, primaryReason, outdoorTemp, outdoorHumidity, false, true);
            this.requestByTarget(config, 'humidity', 'up', actions, false, 0, 'Gegenseitige Verriegelung', null, null, true, true);
            return this.buildDecision(config, state, primaryReason, actions, shadowMode);
        } else if (temp !== null && hum !== null) {
            this.alarmService.clear(ALARM_CODES.CONDENSATION_RISK, config.id, 'climate');
        }

        // --------------------------------------------------------
        // CO₂-Alarme (einmalig pro Gruppe, unabhängig von Aktor-Anzahl)
        // --------------------------------------------------------
        if (co2 !== null && setpoint.co2Target) {
            this.raiseCo2Alarms(co2, config.id, setpoint);
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
                    const r = this.decideHumidityAct(act, dir, hum, vpd, setpoint, hyst, actions, outdoorTemp, outdoorHumidity, config.outdoorSensor);
                    if (r) reasons.push(r);
                    break;
                }

                case 'vpd': {
                    const r = this.decideVpdAct(act, dir, vpd, temp, hum, setpoint, hyst, actions, outdoorTemp, outdoorHumidity, config.outdoorSensor);
                    if (r) reasons.push(r);
                    break;
                }

                case 'co2': {
                    const r = this.decideCo2Act(act, dir, co2, config.id, setpoint, hyst, actions);
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
        vpd: number | null,
        sp: ClimateSetpoint,
        hyst: GroupHystStates,
        actions: ControlAction[],
        outdoorTemp: number | null,
        outdoorHumidity: number | null,
        outdoorCfg: OutdoorSensorConfig | undefined,
    ): string | null {
        if (hum === null) return null;

        const vpdMin = sp.vpdMin ?? null;
        const vpdMax = sp.vpdMax ?? null;

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
            // Befeuchter: VPD-Schutz – unteres Drittel des Sollbereichs blockiert Befeuchter
            if (hState === -1) {
                if (act.type === 'humidifier' && vpd !== null && vpdMin !== null) {
                    const humGuard = vpdMax !== null ? vpdMin + (vpdMax - vpdMin) * 0.33 : vpdMin + 0.1;
                    if (vpd < humGuard) {
                        this.pushAction(actions, act, false, `VPD ${vpd.toFixed(2)} im Schutzbereich – Befeuchter gesperrt`, false);
                        return null;
                    }
                }
                this.pushAction(actions, act, true, `RH=${hum.toFixed(0)}% < ${sp.humidity}%`, false);
                return `Befeuchter EIN (${hum.toFixed(0)}% zu trocken)`;
            } else {
                this.pushAction(actions, act, false, `RH im Zielbereich`, false);
            }
        } else if (dir === 'down' || dir === 'both') {
            // Entfeuchter: VPD-Schutz – oberes Drittel des Sollbereichs blockiert Entfeuchter
            if (hState === 1) {
                if (act.type === 'dehumidifier' && vpd !== null && vpdMax !== null) {
                    const dehumGuard = vpdMin !== null ? vpdMax - (vpdMax - vpdMin) * 0.33 : vpdMax - 0.1;
                    if (vpd > dehumGuard) {
                        this.pushAction(actions, act, false, `VPD ${vpd.toFixed(2)} im Schutzbereich – Entfeuchter gesperrt`, false);
                        return null;
                    }
                }
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
        const prevAct = this.actuatorHystStates.get(act.id) ?? 0;
        if (act.actuatorHysteresis !== undefined && act.actuatorHysteresis > 0) {
            // Richtungsbasiert: Setpoint liegt je nach dir direkt an vpdMin (Entfeuchter) oder
            // vpdMax (Befeuchter), Band = actuatorHysteresis × 2.
            // → Entfeuchter: ON wenn vpd < vpdMin, OFF wenn vpd > vpdMin + 2×hyst
            // → Befeuchter:  ON wenn vpd > vpdMax, OFF wenn vpd < vpdMax - 2×hyst
            if (dir === 'up') {
                vpdState = hysteresisCheck(vpd, sp.vpdMax - act.actuatorHysteresis, act.actuatorHysteresis * 2, prevAct);
            } else {
                vpdState = hysteresisCheck(vpd, sp.vpdMin + act.actuatorHysteresis, act.actuatorHysteresis * 2, prevAct);
            }
        } else {
            // Richtungsbasierte Hysterese: Aktoren laufen bis zur Mitte des Sollbereichs (vpdMid),
            // nicht nur bis zur Sollbereichsgrenze. Das schafft längere EIN/AUS-Zyklen.
            // Entfeuchter/Abluft (dir='down'): EIN wenn VPD < vpdMin, AUS erst wenn VPD > vpdMid
            // Befeuchter (dir='up'):           EIN wenn VPD > vpdMax, AUS erst wenn VPD < vpdMid
            const halfRange = (sp.vpdMax - sp.vpdMin) / 2;
            const band = Math.max(0.05, halfRange);
            if (dir === 'up') {
                vpdState = hysteresisCheck(vpd, sp.vpdMax - band / 2, band, prevAct);
            } else {
                vpdState = hysteresisCheck(vpd, sp.vpdMin + band / 2, band, prevAct);
            }
        }
        this.actuatorHystStates.set(act.id, vpdState);

        if (vpdState === -1) {
            // VPD zu niedrig → Feuchte senken oder Temperatur erhöhen
            if (dir === 'down' || dir === 'both') {
                // Entfeuchter darf nur laufen wenn Temperatur ≤ Solltemperatur.
                // Bei Übertemperatur ist Abluft/Kühlung das richtige Mittel — Entfeuchten
                // würde VPD zwar auch erhöhen, aber die Temperatur nicht lösen.
                if (act.type === 'dehumidifier' && temp !== null && sp.temperature !== undefined) {
                    const tempOvershoot = temp - (sp.temperature + (sp.temperatureTolerance ?? 1));
                    if (tempOvershoot > 0) {
                        this.pushAction(actions, act, false, `VPD zu niedrig, Temp zu hoch – Entfeuchter gesperrt (Abluft bevorzugt)`, false);
                        return null;
                    }
                }
                // Außenluft-Guard
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
                // dir='up' = Befeuchter ODER Heizung: unterschiedliche Reaktion auf VPD-zu-niedrig
                if (act.type === 'heating') {
                    this.pushAction(actions, act, true, `VPD ${vpd.toFixed(2)} zu niedrig – Heizung`, false);
                    return `VPD zu niedrig → Heizung`;
                } else {
                    // Befeuchter: VPD bereits zu niedrig → AUSschalten, sonst sinkt VPD weiter
                    this.pushAction(actions, act, false, `VPD ${vpd.toFixed(2)} zu niedrig – Befeuchter aus`, false);
                    return `VPD zu niedrig → Befeuchter aus`;
                }
            }
        } else if (vpdState === 1) {
            // VPD zu hoch → Feuchte erhöhen oder Temperatur senken
            if (dir === 'up') {
                if (act.type === 'heating') {
                    // Heizung: VPD zu hoch → AUSschalten (Heizung würde VPD weiter erhöhen)
                    this.pushAction(actions, act, false, `VPD ${vpd.toFixed(2)} zu hoch – Heizung aus`, false);
                } else {
                    // Befeuchter: mehr Feuchte → VPD sinkt ✓
                    this.pushAction(actions, act, true, `VPD ${vpd.toFixed(2)} zu hoch – Befeuchten`, false);
                    return `VPD ${vpd.toFixed(2)} kPa → zu hoch: Befeuchten`;
                }
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
    // CO₂-Aktor (Zweipunkt mit Hysterese)
    // ============================================================
    private decideCo2Act(
        act: ActuatorConfig,
        dir: ControlDirection,
        co2: number | null,
        groupId: string,
        sp: ClimateSetpoint,
        hyst: GroupHystStates,
        actions: ControlAction[],
    ): string | null {
        if (!sp.co2Target) return null;

        if (co2 === null) {
            this.pushAction(actions, act, false, 'CO₂-Regelung: kein Sensor', false);
            return null;
        }

        const target = sp.co2Target;
        const tolerance = sp.co2Tolerance ?? 50;

        // Zweipunkt-Regelung mit Hysterese
        hyst.co2 = hysteresisCheck(co2, target, tolerance * 2, hyst.co2);

        if (dir === 'up') {
            // CO₂-Ventil / Generator: EIN wenn CO₂ zu niedrig
            if (hyst.co2 === -1) {
                this.pushAction(actions, act, true, `CO₂ ${co2.toFixed(0)} ppm < Ziel ${target.toFixed(0)} ppm`, false);
                return `CO₂-Ventil EIN (${co2.toFixed(0)} ppm zu niedrig)`;
            } else {
                this.pushAction(actions, act, false, `CO₂ im Zielbereich (${co2.toFixed(0)} ppm)`, false);
            }
        } else if (dir === 'down') {
            // Abluft für CO₂-Abbau: EIN wenn CO₂ zu hoch
            if (hyst.co2 === 1) {
                const val = act.supportsPercent ? 60 : true;
                this.pushAction(actions, act, val, `CO₂ ${co2.toFixed(0)} ppm > Ziel ${target.toFixed(0)} ppm – Abluft`, false);
                return `Abluft CO₂-Abbau EIN (${co2.toFixed(0)} ppm)`;
            } else {
                this.pushAction(actions, act, false, `CO₂ im Zielbereich (${co2.toFixed(0)} ppm)`, false);
            }
        }
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
        force = false,
        safetyOverride = false,  // true: ignoriert group-mode beim Target-Matching (für Not-Checks)
    ): void {
        for (const act of config.actuators) {
            if (!act.enabled) continue;
            // Sicherheitsübersteuerungen: Aktor nach Typ matchen, nicht nach Modus
            const effectiveTarget = inferControlTarget(act, safetyOverride ? undefined : config.mode);
            if (effectiveTarget !== target) continue;
            if (dir !== 'both' && inferControlDirection(act) !== dir && inferControlDirection(act) !== 'both') continue;
            const val = on ? (act.supportsPercent && percent > 0 ? percent : true) : false;
            this.pushAction(actions, act, val, reason, false, force);
        }
    }

    private pushAction(
        actions: ControlAction[],
        act: ActuatorConfig,
        requested: boolean | number,
        reason: string,
        blocked: boolean,
        force = false
    ): void {
        const existing = actions.find(a => a.actuatorId === act.id);
        if (existing) {
            if (typeof requested === 'boolean') {
                // force=true: false can override true (safety locks, condensation protection)
                if (force || (requested && !existing.requested)) {
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
                if (!action || action.blocked) return false; // geblockte Aktoren sind effektiv AUS
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

    private raiseCo2Alarms(co2: number, groupId: string, sp: ClimateSetpoint): void {
        const target = sp.co2Target!;
        const tolerance = sp.co2Tolerance ?? 50;
        const co2Max = sp.co2Max ?? target + tolerance * 4;
        // co2Critical muss immer über co2Max liegen – sonst überspringt die Warning-Stufe
        const co2Critical = Math.max(
            sp.co2Critical ?? Math.max(5000, target + tolerance * 8),
            co2Max + tolerance
        );

        if (co2 > co2Critical) {
            this.alarmService.raise(
                ALARM_CODES.CO2_HIGH, groupId, 'climate', 'critical',
                `Kritischer CO₂-Wert: ${co2.toFixed(0)} ppm (Schwelle: ${co2Critical.toFixed(0)} ppm)`
            );
        } else if (co2 > co2Max) {
            this.alarmService.raise(
                ALARM_CODES.CO2_HIGH, groupId, 'climate', 'warning',
                `CO₂ erhöht: ${co2.toFixed(0)} ppm (Max: ${co2Max.toFixed(0)} ppm)`
            );
        } else {
            this.alarmService.clear(ALARM_CODES.CO2_HIGH, groupId, 'climate');
        }

        if (co2 < target - tolerance * 3) {
            this.alarmService.raise(
                ALARM_CODES.CO2_LOW, groupId, 'climate', 'warning',
                `CO₂ zu niedrig: ${co2.toFixed(0)} ppm (Ziel: ${target.toFixed(0)} ppm)`
            );
        } else {
            this.alarmService.clear(ALARM_CODES.CO2_LOW, groupId, 'climate');
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
