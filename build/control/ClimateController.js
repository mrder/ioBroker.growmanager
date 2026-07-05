"use strict";
// ============================================================
// GrowManager – ClimateController
// Per-Aktor Regelziel: controlTarget bestimmt Regellogik.
// Fallback: Ableitung aus Aktor-Typ wenn controlTarget nicht gesetzt.
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClimateController = void 0;
const calculations_1 = require("../utils/calculations");
const AlarmService_1 = require("../services/AlarmService");
// Ableitung des Regelziels aus Aktor-Typ (wenn controlTarget nicht explizit gesetzt).
// Im VPD-Modus regeln Feuchte- und Temperatur-Aktoren über VPD statt absolut.
function inferControlTarget(act, groupMode) {
    if (act.controlTarget)
        return act.controlTarget;
    const isVpdMode = groupMode === 'vpd';
    switch (act.type) {
        case 'light': return 'light';
        case 'circulationFan': return 'timer';
        case 'exhaustFan':
        case 'supplyFan':
        case 'cooling': return isVpdMode ? 'vpd' : 'temperature';
        case 'heating': return isVpdMode ? 'vpd' : 'temperature';
        case 'humidifier': return isVpdMode ? 'vpd' : 'humidity';
        case 'dehumidifier': return isVpdMode ? 'vpd' : 'humidity';
        case 'co2Valve': return 'co2';
        case 'irrigation': return 'soilMoisture';
        default: return 'custom';
    }
}
function inferControlDirection(act) {
    if (act.controlDirection)
        return act.controlDirection;
    switch (act.type) {
        case 'heating': return 'up';
        case 'humidifier': return 'up';
        case 'cooling':
        case 'exhaustFan':
        case 'supplyFan':
        case 'dehumidifier': return 'down';
        default: return 'both';
    }
}
class ClimateController {
    constructor(alarmService, log) {
        this.alarmService = alarmService;
        this.log = log;
        this.hystStates = new Map();
        // Per-Aktor Hysterese-State (wenn actuatorHysteresis konfiguriert)
        this.actuatorHystStates = new Map();
    }
    /**
     * Hauptregel-Funktion. Erzeugt eine ControlDecision für eine Gruppe.
     * outdoorTemp / outdoorHumidity kommen vom konfigurierten Außensensor der Gruppe.
     */
    decide(config, state, setpoint, shadowMode, outdoorTemp = null, outdoorHumidity = null) {
        const actions = [];
        const hyst = this.getHystStates(config.id);
        const temp = state.temperature;
        const hum = state.humidity;
        const vpd = state.vpd;
        let primaryReason = 'Keine Regelung notwendig';
        // --------------------------------------------------------
        // Priorität 1: Übertemperatur-Notfall
        // --------------------------------------------------------
        if (temp !== null && temp > setpoint.temperatureCritical) {
            this.alarmService.raise(AlarmService_1.ALARM_CODES.TEMPERATURE_HIGH, config.id, 'climate', 'critical', `Kritische Übertemperatur: ${temp.toFixed(1)} °C > ${setpoint.temperatureCritical} °C`);
            primaryReason = `Übertemperatur ${temp.toFixed(1)} °C – Maximalabluft`;
            this.requestByTarget(config, 'temperature', 'down', actions, true, 100, primaryReason, null, null);
            this.requestByTarget(config, 'temperature', 'up', actions, false, 0, 'Verriegelung: Übertemperatur', null, null);
            return this.buildDecision(config, state, primaryReason, actions, shadowMode);
        }
        else if (temp !== null) {
            this.alarmService.clear(AlarmService_1.ALARM_CODES.TEMPERATURE_HIGH, config.id, 'climate');
        }
        // --------------------------------------------------------
        // Priorität 2: Kondensations- und Schimmelgefahr
        // --------------------------------------------------------
        if (temp !== null && hum !== null && (0, calculations_1.condensationRisk)(temp, hum)) {
            this.alarmService.raise(AlarmService_1.ALARM_CODES.CONDENSATION_RISK, config.id, 'climate', 'fault', `Kondensationsrisiko: T=${temp.toFixed(1)}°C RH=${hum.toFixed(0)}%`);
            primaryReason = 'Kondensationsrisiko – Entfeuchter / Abluft';
            this.requestByTarget(config, 'humidity', 'down', actions, true, 60, primaryReason, outdoorTemp, outdoorHumidity);
            this.requestByTarget(config, 'humidity', 'up', actions, false, 0, 'Gegenseitige Verriegelung', null, null);
            return this.buildDecision(config, state, primaryReason, actions, shadowMode);
        }
        else if (temp !== null && hum !== null) {
            this.alarmService.clear(AlarmService_1.ALARM_CODES.CONDENSATION_RISK, config.id, 'climate');
        }
        // --------------------------------------------------------
        // Priorität 3: Kritische Untertemperatur
        // --------------------------------------------------------
        if (temp !== null && temp < setpoint.temperatureMin - 3) {
            this.alarmService.raise(AlarmService_1.ALARM_CODES.TEMPERATURE_LOW, config.id, 'climate', 'fault', `Kritische Untertemperatur: ${temp.toFixed(1)} °C`);
            primaryReason = `Untertemperatur ${temp.toFixed(1)} °C – Heizung`;
            this.requestByTarget(config, 'temperature', 'up', actions, true, 0, primaryReason, null, null);
            return this.buildDecision(config, state, primaryReason, actions, shadowMode);
        }
        else if (temp !== null) {
            this.alarmService.clear(AlarmService_1.ALARM_CODES.TEMPERATURE_LOW, config.id, 'climate');
        }
        // --------------------------------------------------------
        // Per-Aktor Routing (Normalfall)
        // --------------------------------------------------------
        const reasons = [];
        for (const act of config.actuators) {
            if (!act.enabled)
                continue;
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
                    if (r)
                        reasons.push(r);
                    break;
                }
                case 'humidity': {
                    const r = this.decideHumidityAct(act, dir, hum, setpoint, hyst, actions, outdoorTemp, outdoorHumidity, config.outdoorSensor);
                    if (r)
                        reasons.push(r);
                    break;
                }
                case 'vpd': {
                    const r = this.decideVpdAct(act, dir, vpd, temp, hum, setpoint, hyst, actions, outdoorTemp, outdoorHumidity, config.outdoorSensor);
                    if (r)
                        reasons.push(r);
                    break;
                }
                case 'co2': {
                    const r = this.decideCo2Act(act, dir, setpoint, hyst, actions);
                    if (r)
                        reasons.push(r);
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
        return this.buildDecision(config, state, primaryReason, actions, shadowMode);
    }
    // ============================================================
    // Lichtsteuerung (Zeitplan)
    // ============================================================
    decideLight(act, state, actions) {
        const isDay = state.dayNight !== 'night';
        this.pushAction(actions, act, isDay, `Zeitplan: ${state.dayNight}`, false);
    }
    // ============================================================
    // Temperatur-Aktor
    // ============================================================
    decideTemperatureAct(act, dir, temp, sp, hyst, actions, outdoorTemp, outdoorHumidity, outdoorCfg) {
        if (temp === null)
            return null;
        let tState;
        if (act.actuatorHysteresis !== undefined && act.actuatorHysteresis > 0) {
            // Per-Aktor Schwelle: eigener State, unabhängig vom Gruppen-State
            const prevAct = this.actuatorHystStates.get(act.id) ?? 0;
            tState = (0, calculations_1.hysteresisCheck)(temp, sp.temperature, act.actuatorHysteresis * 2, prevAct);
            this.actuatorHystStates.set(act.id, tState);
        }
        else {
            tState = (0, calculations_1.hysteresisCheck)(temp, sp.temperature, sp.temperatureTolerance * 2, hyst.temperature);
            hyst.temperature = tState;
        }
        if (dir === 'up') {
            // Heizung
            if (tState === -1) {
                this.pushAction(actions, act, true, `T=${temp.toFixed(1)}°C < ${sp.temperature}°C`, false);
                return `Heizung EIN (${temp.toFixed(1)} °C zu kalt)`;
            }
            else {
                this.pushAction(actions, act, false, `T im Zielbereich`, false);
            }
        }
        else if (dir === 'down' || dir === 'both') {
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
            }
            else {
                this.pushAction(actions, act, false, `T im Zielbereich`, false);
            }
        }
        return null;
    }
    // ============================================================
    // Feuchte-Aktor
    // ============================================================
    decideHumidityAct(act, dir, hum, sp, hyst, actions, outdoorTemp, outdoorHumidity, outdoorCfg) {
        if (hum === null)
            return null;
        let hState;
        if (act.actuatorHysteresis !== undefined && act.actuatorHysteresis > 0) {
            const prevAct = this.actuatorHystStates.get(act.id) ?? 0;
            hState = (0, calculations_1.hysteresisCheck)(hum, sp.humidity, act.actuatorHysteresis * 2, prevAct);
            this.actuatorHystStates.set(act.id, hState);
        }
        else {
            hState = (0, calculations_1.hysteresisCheck)(hum, sp.humidity, sp.humidityTolerance * 2, hyst.humidity);
            hyst.humidity = hState;
        }
        if (dir === 'up') {
            // Befeuchter
            if (hState === -1) {
                this.pushAction(actions, act, true, `RH=${hum.toFixed(0)}% < ${sp.humidity}%`, false);
                return `Befeuchter EIN (${hum.toFixed(0)}% zu trocken)`;
            }
            else {
                this.pushAction(actions, act, false, `RH im Zielbereich`, false);
            }
        }
        else if (dir === 'down' || dir === 'both') {
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
            }
            else {
                this.pushAction(actions, act, false, `RH im Zielbereich`, false);
            }
        }
        return null;
    }
    // ============================================================
    // VPD-Aktor (koordiniert Temp + Feuchte)
    // ============================================================
    decideVpdAct(act, dir, vpd, temp, hum, sp, hyst, actions, outdoorTemp, outdoorHumidity, outdoorCfg) {
        if (vpd === null || temp === null || hum === null)
            return null;
        let vpdState;
        if (act.actuatorHysteresis !== undefined && act.actuatorHysteresis > 0) {
            const prevAct = this.actuatorHystStates.get(act.id) ?? 0;
            vpdState = (0, calculations_1.hysteresisCheck)(vpd, (sp.vpdMin + sp.vpdMax) / 2, act.actuatorHysteresis * 2, prevAct);
            this.actuatorHystStates.set(act.id, vpdState);
        }
        else {
            vpdState = (0, calculations_1.hysteresisCheck)(vpd, (sp.vpdMin + sp.vpdMax) / 2, sp.vpdMax - sp.vpdMin, hyst.vpd);
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
            }
            else if (dir === 'up') {
                // Heizung für VPD erhöhen
                this.pushAction(actions, act, true, `VPD ${vpd.toFixed(2)} zu niedrig – Heizung`, false);
                return `VPD zu niedrig → Heizung`;
            }
        }
        else if (vpdState === 1) {
            // VPD zu hoch → Feuchte erhöhen oder Temperatur senken
            if (dir === 'up') {
                // Befeuchter
                this.pushAction(actions, act, true, `VPD ${vpd.toFixed(2)} zu hoch – Befeuchten`, false);
                return `VPD ${vpd.toFixed(2)} kPa → zu hoch: Befeuchten`;
            }
            else if (dir === 'down' || dir === 'both') {
                // Kühlung / Abluft
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
        }
        else {
            this.pushAction(actions, act, false, `VPD im Zielbereich`, false);
        }
        return null;
    }
    // ============================================================
    // CO₂-Aktor
    // ============================================================
    decideCo2Act(act, dir, sp, hyst, actions) {
        if (!sp.co2Target)
            return null;
        // CO₂ wird über separate Sensor-States gelesen — hier Platzhalter
        // Die eigentliche CO₂-Regelung benötigt einen co2-Sensor in der Gruppe
        this.pushAction(actions, act, false, 'CO₂-Regelung: kein Sensor', false);
        return null;
    }
    // ============================================================
    // Hilfsfunktionen
    // ============================================================
    requestByTarget(config, target, dir, actions, on, percent, reason, outdoorTemp, outdoorHumidity) {
        for (const act of config.actuators) {
            if (!act.enabled)
                continue;
            if (inferControlTarget(act, config.mode) !== target)
                continue;
            if (dir !== 'both' && inferControlDirection(act) !== dir && inferControlDirection(act) !== 'both')
                continue;
            const val = on ? (act.supportsPercent && percent > 0 ? percent : true) : false;
            this.pushAction(actions, act, val, reason, false);
        }
    }
    pushAction(actions, act, requested, reason, blocked) {
        const existing = actions.find(a => a.actuatorId === act.id);
        if (existing) {
            if (typeof requested === 'boolean') {
                if (requested && !existing.requested) {
                    existing.requested = requested;
                    existing.reason = reason;
                }
            }
            else {
                if (requested > existing.requested) {
                    existing.requested = requested;
                    existing.reason = reason;
                }
            }
        }
        else {
            actions.push({ actuatorId: act.id, requested, reason, blocked });
        }
    }
    buildDecision(config, state, reason, actions, shadowMode) {
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
                    if (act?.type === 'light')
                        return a; // Licht immer nach Zeitplan, nie durch Shadow Mode blockieren
                    return { ...a, blocked: true, blockedReason: 'Shadow Mode' };
                })
                : actions,
            degradation: state.degradation,
        };
    }
    getHystStates(groupId) {
        let h = this.hystStates.get(groupId);
        if (!h) {
            h = { temperature: 0, humidity: 0, vpd: 0, co2: 0 };
            this.hystStates.set(groupId, h);
        }
        return h;
    }
}
exports.ClimateController = ClimateController;
//# sourceMappingURL=ClimateController.js.map