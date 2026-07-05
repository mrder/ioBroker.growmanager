// ============================================================
// GrowManager – AirSystemService
// Zu-/Abluft-Verbund, Umluft-Gruppen, Luftstromdiagnose.
// Alle Aktoren optional – der Service arbeitet mit dem,
// was konfiguriert und verfügbar ist.
// ============================================================

import type { GroupConfig, AirSystemConfig, ActuatorConfig, OutdoorSensorConfig } from '../models/config';
import { curveInterpolate } from '../utils/calculations';
import type { AlarmService } from './AlarmService';
import { ALARM_CODES } from './AlarmService';
import type { ILogger } from '../utils/logger';

export interface AirDemand {
    temperatureDemandPercent: number;   // Bedarf aus Temperatur
    humidityDemandPercent: number;      // Bedarf aus Feuchte
    vpdDemandPercent: number;           // Bedarf aus VPD
    minimumPercent: number;             // Mindestlüftung (ggf. 0 wenn kein Aktor)
    finalDemandPercent: number;         // Maximum aller Bedarfe
    reason: string;
}

export interface AirSystemOutput {
    exhaustPercent: number;   // 0–100 % oder boolean (true/false)
    supplyPercent: number;    // 0–100 % oder boolean
    exhaustCommand: boolean | number;
    supplyCommand: boolean | number;
    reason: string;
    available: boolean;       // false wenn keine Aktoren vorhanden
}

// Rotation für Umluft-Ventilatoren
interface CirculationState {
    currentIndex: number;
    lastRotationTs: number;
}

export class AirSystemService {
    private readonly circulationStates = new Map<string, CirculationState>();
    private readonly startupBoostUntil = new Map<string, number>();

    constructor(
        private readonly alarmService: AlarmService,
        private readonly log: ILogger
    ) {}

    /**
     * Berechnet Abluftbedarf aus Klimawerten.
     * Gibt 0 zurück wenn keine relevanten Sensoren vorhanden.
     */
    computeAirDemand(
        config: GroupConfig,
        airSystem: AirSystemConfig | undefined,
        temperature: number | null,
        tempSetpoint: number | null,
        humidity: number | null,
        humSetpoint: number | null,
        vpd: number | null,
        vpdMin: number | null,
        vpdMax: number | null,
        isDay: boolean
    ): AirDemand {
        // Ohne Abluftaktor: Minimalbedarf
        const hasExhaust = config.actuators.some(a => a.type === 'exhaustFan' && a.enabled);
        if (!hasExhaust) {
            return {
                temperatureDemandPercent: 0,
                humidityDemandPercent: 0,
                vpdDemandPercent: 0,
                minimumPercent: 0,
                finalDemandPercent: 0,
                reason: 'Kein Abluftaktor vorhanden',
            };
        }

        const minPercent = isDay
            ? (airSystem?.minimumExhaustPercentDay ?? 15)
            : (airSystem?.minimumExhaustPercentNight ?? 10);

        let tempDemand = 0;
        let humDemand = 0;
        let vpdDemand = 0;
        const reasons: string[] = [];

        // Temperaturbedarf (optional)
        if (temperature !== null && tempSetpoint !== null) {
            const delta = temperature - tempSetpoint;
            if (delta > 0) {
                tempDemand = Math.min(100, minPercent + delta * 15);
                reasons.push(`T+${delta.toFixed(1)}K→${tempDemand.toFixed(0)}%`);
            }
        }

        // Feuchtebedarf (optional)
        if (humidity !== null && humSetpoint !== null) {
            const delta = humidity - humSetpoint;
            if (delta > 5) {
                humDemand = Math.min(100, minPercent + (delta - 5) * 5);
                reasons.push(`RH+${delta.toFixed(0)}%→${humDemand.toFixed(0)}%`);
            }
        }

        // VPD-Bedarf (optional)
        if (vpd !== null && vpdMin !== null && vpdMax !== null) {
            if (vpd > vpdMax) {
                vpdDemand = Math.min(80, (vpd - vpdMax) * 100);
                reasons.push(`VPD↑→${vpdDemand.toFixed(0)}%`);
            }
        }

        const final = Math.max(minPercent, tempDemand, humDemand, vpdDemand);
        const maxPercent = airSystem?.maximumExhaustPercent ?? 100;

        return {
            temperatureDemandPercent: tempDemand,
            humidityDemandPercent: humDemand,
            vpdDemandPercent: vpdDemand,
            minimumPercent: minPercent,
            finalDemandPercent: Math.min(final, maxPercent),
            reason: reasons.length > 0 ? reasons.join(', ') : `Mindestlüftung ${minPercent}%`,
        };
    }

    /**
     * Berechnet Abluft- und Zuluftbefehle.
     * Gibt available=false wenn keine Aktoren vorhanden.
     */
    computeAirOutput(
        groupId: string,
        config: GroupConfig,
        airSystem: AirSystemConfig | undefined,
        demand: AirDemand
    ): AirSystemOutput {
        const exhaustAct = config.actuators.find(a => a.type === 'exhaustFan' && a.enabled);
        const supplyAct = config.actuators.find(a => a.type === 'supplyFan' && a.enabled);

        // Kein Abluftaktor → nichts zu tun
        if (!exhaustAct) {
            return {
                exhaustPercent: 0,
                supplyPercent: 0,
                exhaustCommand: false,
                supplyCommand: false,
                reason: 'Kein Abluftaktor',
                available: false,
            };
        }

        const exhaustPercent = demand.finalDemandPercent;

        // Anlauf-Boost
        const boost = this.startupBoostUntil.get(groupId);
        const boostActive = boost && Date.now() < boost;

        const effectiveExhaust = boostActive
            ? Math.max(exhaustPercent, airSystem?.startupBoostPercent ?? 100)
            : exhaustPercent;

        // Abluftkkommando (Boolean-Aktor: Ein/Aus; Prozent-Aktor: 0–100)
        const exhaustCommand: boolean | number = exhaustAct.supportsPercent
            ? effectiveExhaust
            : effectiveExhaust > 0;

        // Zuluft berechnen (optional)
        let supplyPercent = 0;
        let supplyCommand: boolean | number = false;

        if (supplyAct && airSystem) {
            switch (airSystem.mode) {
                case 'linked':
                    supplyPercent = effectiveExhaust;
                    break;
                case 'ratioCoupled':
                    supplyPercent = effectiveExhaust * airSystem.supplyToExhaustRatio;
                    break;
                case 'curveCoupled':
                    supplyPercent = airSystem.ratioPoints?.length
                        ? curveInterpolate(effectiveExhaust, airSystem.ratioPoints.map(p => ({ x: p.exhaust, y: p.supply })))
                        : effectiveExhaust; // Fallback: 1:1 wenn keine Kurve konfiguriert
                    break;
                case 'exhaustOnly':
                default:
                    supplyPercent = 0;
            }
            supplyPercent = Math.max(airSystem.supplyMinSpeed ?? 0, Math.min(100, supplyPercent));
            supplyCommand = supplyAct.supportsPercent ? supplyPercent : supplyPercent > 0;
        }

        this.diagnoseLowflow(groupId, config, exhaustAct, effectiveExhaust);

        return {
            exhaustPercent: effectiveExhaust,
            supplyPercent,
            exhaustCommand,
            supplyCommand,
            reason: demand.reason,
            available: true,
        };
    }

    /**
     * Steuert Umluftventilatoren (Rotation, Intervall, Dauerbetrieb).
     * Gibt Map von actuatorId → boolean zurück.
     */
    computeCirculationCommands(
        groupId: string,
        config: GroupConfig,
        isDay: boolean,
        afterIrrigation: boolean
    ): Map<string, boolean> {
        const commands = new Map<string, boolean>();
        const circulationFans = config.actuators.filter(a => a.type === 'circulationFan' && a.enabled);

        if (circulationFans.length === 0) return commands;

        // Alle EIN wenn kein AirSystem oder Dauerbetrieb gewünscht
        if (!config.airSystem) {
            circulationFans.forEach(a => commands.set(a.id, true));
            return commands;
        }

        // Rotationsmodus: wechselnde Ventilatoren
        if (circulationFans.length > 1) {
            let state = this.circulationStates.get(groupId);
            if (!state) {
                state = { currentIndex: 0, lastRotationTs: Date.now() };
                this.circulationStates.set(groupId, state);
            }

            // Rotation alle 30 Minuten
            const rotationIntervalMs = 30 * 60 * 1000;
            if (Date.now() - state.lastRotationTs > rotationIntervalMs) {
                state.currentIndex = (state.currentIndex + 1) % circulationFans.length;
                state.lastRotationTs = Date.now();
                this.log.info(`Gruppe ${groupId}: Umluft-Rotation → Ventilator ${state.currentIndex}`);
            }

            circulationFans.forEach((a, idx) => {
                // Primär-Ventilator immer EIN, Sekundär-Ventilator wechselnd
                const isPrimary = idx === 0;
                const isActive = isPrimary || idx === state!.currentIndex;
                commands.set(a.id, isActive);
            });
        } else {
            // Nur ein Ventilator: immer EIN, ausser Nacht-Absenkung
            const fan = circulationFans[0];
            const runNight = true; // Konfigurierbar – hier immer EIN
            commands.set(fan.id, isDay || runNight);
        }

        // Nachlauf nach Bewässerung: alle EIN
        if (afterIrrigation) {
            circulationFans.forEach(a => commands.set(a.id, true));
        }

        return commands;
    }

    /**
     * Startet Anlaufboost (z.B. nach langer Pause).
     */
    triggerStartupBoost(groupId: string, durationSeconds: number): void {
        this.startupBoostUntil.set(groupId, Date.now() + durationSeconds * 1000);
    }

    private diagnoseLowflow(
        groupId: string,
        config: GroupConfig,
        exhaustAct: ActuatorConfig,
        demandPercent: number
    ): void {
        // Nur wenn Leistungsfeedback vorhanden
        if (!exhaustAct.powerStateId) return;

        // Diagnose erfolgt extern über DiagnosticsEngine
        // Hier nur Alarm wenn Leistung zu hoch bei niedrigem Soll (Filterverschmutzung)
    }

    /**
     * Prüft ob Zuluft feuchter als Abluft-Bedarf erlaubt.
     */
    shouldSuppressHumidityVentilation(
        insideHumidity: number | null,
        outsideHumidity: number | null
    ): boolean {
        if (insideHumidity === null || outsideHumidity === null) return false;
        return outsideHumidity >= insideHumidity;
    }

    /**
     * Außenluft-Guard: Prüft ob Außenluft günstiger als Innenluft.
     * Gibt blockiert=true zurück wenn Lüfter NICHT schalten sollten.
     *
     * Temp-Guard: Außentemp muss mindestens minTempDeltaCelsius kühler sein.
     * Feuchte-Guard: Außenfeuchte darf maximal maxHumidityDeltaPercent höher sein.
     */
    checkOutdoorGuard(
        outdoorCfg: OutdoorSensorConfig | undefined,
        insideTemp: number | null,
        insideHumidity: number | null,
        outdoorTemp: number | null,
        outdoorHumidity: number | null,
        demandReason: 'temperature' | 'humidity' | 'both'
    ): { blocked: boolean; reason: string } {
        if (!outdoorCfg?.enabled) {
            return { blocked: false, reason: 'Außensensor nicht konfiguriert' };
        }

        const minDelta = outdoorCfg.minTempDeltaCelsius ?? 2;
        const maxHumDelta = outdoorCfg.maxHumidityDeltaPercent ?? 10;

        if (demandReason === 'temperature' || demandReason === 'both') {
            if (insideTemp !== null && outdoorTemp !== null) {
                const delta = insideTemp - outdoorTemp;
                if (delta < minDelta) {
                    return {
                        blocked: true,
                        reason: `Außenluft nicht kühler genug: ${outdoorTemp.toFixed(1)}°C innen ${insideTemp.toFixed(1)}°C (Δ${delta.toFixed(1)}K < ${minDelta}K)`,
                    };
                }
            }
        }

        if (demandReason === 'humidity' || demandReason === 'both') {
            if (insideHumidity !== null && outdoorHumidity !== null) {
                const humDelta = outdoorHumidity - insideHumidity;
                if (humDelta > maxHumDelta) {
                    return {
                        blocked: true,
                        reason: `Außenluft zu feucht: ${outdoorHumidity.toFixed(0)}% > Innen ${insideHumidity.toFixed(0)}% + ${maxHumDelta}%`,
                    };
                }
            }
        }

        return { blocked: false, reason: 'Außenluft günstig' };
    }
}
