"use strict";
// ============================================================
// GrowManager – SensorService
// Liest, validiert und aggregiert Sensorwerte
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.SensorService = exports.setDeviceHealth = void 0;
const calculations_1 = require("../utils/calculations");
const time_1 = require("../utils/time");
// Device-health state registry: stateId → true(healthy)/false(unhealthy)
const deviceHealthMap = new Map();
function setDeviceHealth(stateId, healthy) {
    deviceHealthMap.set(stateId, healthy);
}
exports.setDeviceHealth = setDeviceHealth;
class SensorService {
    constructor(log) {
        this.log = log;
        this.states = new Map();
        this.emaValues = new Map();
        /** Sensor-IDs die sich gerade in der Recovery-Phase befinden → Zeitstempel bis wann */
        this.recoveringUntil = new Map();
    }
    /**
     * Verarbeitet einen neuen Rohwert für einen Sensor.
     */
    processValue(config, rawValue, ts, lc, stabilitySeconds) {
        const prev = this.states.get(config.id);
        let processed = null;
        let valid = true;
        let error;
        if (rawValue === null || rawValue === undefined) {
            valid = false;
            error = 'Kein Wert vorhanden';
        }
        else if (config.type !== 'door' && typeof rawValue !== 'number' && typeof rawValue !== 'string') {
            valid = false;
            error = `Unerwarteter Datentyp: ${typeof rawValue}`;
        }
        else if (typeof rawValue === 'number') {
            if (!isFinite(rawValue)) {
                valid = false;
                error = 'Wert ist nicht endlich';
            }
            else {
                const adjusted = rawValue * config.multiplier + config.offset;
                if (adjusted < config.validMin || adjusted > config.validMax) {
                    valid = false;
                    error = `Wert ${adjusted.toFixed(2)} außerhalb Plausibilitätsbereich [${config.validMin}, ${config.validMax}]`;
                }
                else {
                    processed = this.applySmoothing(config, adjusted, prev?.processedValue);
                }
            }
        }
        else {
            processed = rawValue;
        }
        const stale = (0, time_1.isStale)(ts, config.staleAfterSeconds);
        const unchanged = lc > 0 && (0, time_1.isStale)(lc, config.unchangedAlarmSeconds) && config.unchangedAlarmSeconds > 0;
        if (stale) {
            valid = false;
            error = `Datenpunkt veraltet (ts: ${new Date(ts).toLocaleTimeString()})`;
        }
        const quality = this.computeQuality(valid, stale, unchanged);
        // Übergang ungültig → gültig: Recovery-Timer setzen
        if (valid && prev && !prev.valid && stabilitySeconds && stabilitySeconds > 0) {
            this.recoveringUntil.set(config.id, Date.now() + stabilitySeconds * 1000);
            this.log.debug(`Sensor ${config.name}: Recovery startet, ${stabilitySeconds}s Stabilisierungszeit`);
        }
        // Wenn Sensor wieder ungültig wird → Recovery löschen
        if (!valid) {
            this.recoveringUntil.delete(config.id);
        }
        const state = {
            id: config.id,
            rawValue: (typeof rawValue === 'number' || typeof rawValue === 'string' || typeof rawValue === 'boolean')
                ? rawValue : null,
            processedValue: valid ? processed : (prev?.processedValue ?? null),
            valid,
            quality,
            stale,
            unchanged,
            lastTs: ts,
            lastLc: lc,
            error,
        };
        this.states.set(config.id, state);
        return state;
    }
    /**
     * Gibt zurück ob ein Sensor stabil (nicht in Recovery) ist.
     */
    isStable(sensorId) {
        const until = this.recoveringUntil.get(sensorId);
        if (until === undefined)
            return true;
        return Date.now() >= until;
    }
    /**
     * Startet den Recovery-Timer explizit mit einer Dauer.
     * Wird vom Adapter aufgerufen wenn stabilityTimeSeconds bekannt ist.
     */
    startRecovery(sensorId, stabilitySeconds) {
        this.recoveringUntil.set(sensorId, Date.now() + stabilitySeconds * 1000);
    }
    /**
     * Aggregiert mehrere Sensorwerte einer Messgröße für eine Gruppe.
     * Logik: zuerst primary-Sensoren (nach controlPriority sortiert),
     * falls keine gültigen vorhanden → Fallback auf backup-Sensoren.
     * monitor-Sensoren werden nie für Regelung verwendet.
     */
    aggregate(configs, type, method, stabilitySeconds) {
        // Alle aktivierten Sensoren des gewünschten Typs, die keine reinen Monitor-Sensoren sind
        const relevant = configs.filter(c => c.type === type && c.enabled && c.useForControl && (c.role ?? 'primary') !== 'monitor');
        const total = relevant.length;
        if (total === 0) {
            return { value: null, quality: 0, validCount: 0, totalCount: 0, usingBackup: false };
        }
        // Primary-Sensoren nach Priorität (niedrigste Zahl = höchste Priorität)
        const primaries = relevant
            .filter(c => (c.role ?? 'primary') === 'primary')
            .sort((a, b) => (a.controlPriority ?? 1) - (b.controlPriority ?? 1));
        let validStates = this.filterValidStates(primaries, stabilitySeconds);
        let usingBackup = false;
        // Kein gültiger primary → Fallback auf backup-Sensoren
        if (validStates.length === 0) {
            const backups = relevant
                .filter(c => c.role === 'backup')
                .sort((a, b) => (a.controlPriority ?? 1) - (b.controlPriority ?? 1));
            validStates = this.filterValidStates(backups, stabilitySeconds);
            if (validStates.length > 0)
                usingBackup = true;
        }
        if (validStates.length === 0) {
            return { value: null, quality: 0, validCount: 0, totalCount: total, usingBackup: false };
        }
        let values = validStates.map(s => s.processedValue);
        const weights = validStates.map(s => {
            const cfg = relevant.find(c => c.id === s.id);
            return cfg?.weight ?? 1;
        });
        // Ausreißerfilter wenn mehr als 3 Werte
        if (values.length > 3) {
            const filtered = (0, calculations_1.removeOutliers)(values);
            if (filtered.length > 0)
                values = filtered;
        }
        const value = (0, calculations_1.aggregateValues)(values, weights, method);
        const quality = (0, calculations_1.sensorQuality)(validStates.length, total);
        return { value, quality, validCount: validStates.length, totalCount: total, usingBackup };
    }
    /** Filtert SensorConfigs auf gültige, nicht-stale, nicht-recovering, gesunde States. */
    filterValidStates(configs, stabilitySeconds) {
        return configs
            .map(c => ({ cfg: c, state: this.states.get(c.id) }))
            .filter(({ cfg, state: s }) => {
            if (!s || !s.valid || typeof s.processedValue !== 'number')
                return false;
            if ((0, time_1.isStale)(s.lastTs, cfg.staleAfterSeconds))
                return false;
            if (stabilitySeconds !== undefined && stabilitySeconds > 0) {
                const until = this.recoveringUntil.get(s.id);
                if (until !== undefined && Date.now() < until)
                    return false;
            }
            if (cfg.healthStateId && deviceHealthMap.has(cfg.healthStateId)) {
                if (!deviceHealthMap.get(cfg.healthStateId))
                    return false;
            }
            return true;
        })
            .map(({ state }) => state);
    }
    /**
     * Gibt den aktuellen State eines Sensors zurück.
     */
    getState(sensorId) {
        return this.states.get(sensorId);
    }
    /**
     * Initialisiert einen Sensor-State (bei Adapterstart).
     */
    initState(config) {
        this.states.set(config.id, {
            id: config.id,
            rawValue: null,
            processedValue: null,
            valid: false,
            quality: 0,
            stale: true,
            unchanged: false,
            lastTs: 0,
            lastLc: 0,
            error: 'Noch kein Wert empfangen',
        });
    }
    applySmoothing(config, value, prev) {
        switch (config.smoothing) {
            case 'exponential': {
                const alpha = 0.3;
                const prevVal = prev ?? value;
                const ema = (0, calculations_1.exponentialSmoothing)(prevVal, value, alpha);
                this.emaValues.set(config.id, ema);
                return ema;
            }
            case 'movingAverage': {
                // Einfacher EMA mit alpha 0.5
                const prevEma = this.emaValues.get(config.id) ?? value;
                const ema = (0, calculations_1.exponentialSmoothing)(prevEma, value, 0.5);
                this.emaValues.set(config.id, ema);
                return ema;
            }
            default:
                return value;
        }
    }
    computeQuality(valid, stale, unchanged) {
        if (!valid || stale)
            return 0;
        if (unchanged)
            return 50;
        return 100;
    }
    /**
     * Erkennt sprunghafte Änderungen (Ausreißer im Zeitverlauf).
     * @returns true wenn Wert plausibel ist
     */
    checkPlausibility(config, newValue) {
        const prev = this.states.get(config.id);
        if (!prev || typeof prev.processedValue !== 'number')
            return true;
        const range = config.validMax - config.validMin;
        const maxJump = range * 0.25; // 25% Sprung als unplausibel
        return Math.abs(newValue - prev.processedValue) <= maxJump;
    }
}
exports.SensorService = SensorService;
//# sourceMappingURL=SensorService.js.map