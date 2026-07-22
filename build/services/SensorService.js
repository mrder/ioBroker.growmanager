"use strict";
// ============================================================
// GrowManager – SensorService
// Liest, validiert und aggregiert Sensorwerte
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.SensorService = void 0;
const calculations_1 = require("../utils/calculations");
const time_1 = require("../utils/time");
/** Strip last dot-segment to get the physical device key (e.g. "zigbee.0.abc123.temp" → "zigbee.0.abc123"). */
function deviceKey(stateId) {
    const idx = stateId.lastIndexOf('.');
    return idx > 0 ? stateId.substring(0, idx) : stateId;
}
class SensorService {
    constructor(log) {
        this.log = log;
        this.states = new Map();
        this.emaValues = new Map();
        /** Device-health state registry: stateId → true(healthy)/false(unhealthy) — instance-scoped to avoid cross-test contamination */
        this.deviceHealthMap = new Map();
        /** Sensor-IDs die sich gerade in der Recovery-Phase befinden → Zeitstempel bis wann */
        this.recoveringUntil = new Map();
        /**
         * Maps device prefix → latest seen timestamp across ALL states of that device.
         * Allows multi-value sensors (temp + humidity on the same device) to share liveness:
         * if one channel updates, the other is also considered fresh.
         */
        this.deviceLastSeen = new Map();
    }
    setDeviceHealth(stateId, healthy) {
        this.deviceHealthMap.set(stateId, healthy);
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
        else if (config.type === 'door') {
            if (typeof rawValue !== 'boolean' && typeof rawValue !== 'string') {
                valid = false;
                error = `Door-Sensor: Unerwarteter Typ ${typeof rawValue}`;
            }
            else {
                processed = rawValue;
            }
        }
        else if (typeof rawValue !== 'number') {
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
        // Update device-level last-seen: share liveness across all channels of the same physical device.
        const dk = deviceKey(config.stateId);
        const prevDeviceTs = this.deviceLastSeen.get(dk) ?? 0;
        if (ts > prevDeviceTs)
            this.deviceLastSeen.set(dk, ts);
        // Effective timestamp for stale check: use the most recent activity of this physical device.
        const effectiveTs = Math.max(ts, this.deviceLastSeen.get(dk) ?? ts);
        // Stale determination:
        // - alive state configured + alive=true  → device itself signals presence → never stale
        // - alive state configured + alive=false → device offline → always stale
        // - no alive state configured            → fall back to timestamp check
        const aliveKnown = config.healthStateId !== undefined
            ? (this.deviceHealthMap.get(config.healthStateId) ?? true)
            : null; // null = no alive state, use timestamp
        const stale = aliveKnown === false ? true
            : aliveKnown === true ? false
                : (0, time_1.isStale)(effectiveTs, config.staleAfterSeconds);
        const unchanged = lc > 0 && (0, time_1.isStale)(lc, config.unchangedAlarmSeconds) && config.unchangedAlarmSeconds > 0;
        if (stale) {
            valid = false;
            error = aliveKnown === false
                ? 'Gerät offline (alive/link_quality)'
                : `Datenpunkt veraltet (ts: ${new Date(effectiveTs).toLocaleTimeString()})`;
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
        let pairs = validStates.map(s => {
            const cfg = relevant.find(c => c.id === s.id);
            return { value: s.processedValue, weight: cfg?.weight ?? 1 };
        });
        // Ausreißerfilter wenn mehr als 3 Werte — Gewichte synchron mit Werten filtern
        if (pairs.length > 3) {
            const vals = pairs.map(p => p.value);
            const sorted = [...vals].sort((a, b) => a - b);
            // (n-1)*0.75 statt n*0.75: verhindert dass Q3 bei n=4 immer das Maximum wird
            const q1 = sorted[Math.floor((sorted.length - 1) * 0.25)];
            const q3 = sorted[Math.floor((sorted.length - 1) * 0.75)];
            const iqr = q3 - q1;
            const low = q1 - 1.5 * iqr;
            const high = q3 + 1.5 * iqr;
            const filtered = pairs.filter(p => p.value >= low && p.value <= high);
            if (filtered.length > 0)
                pairs = filtered;
        }
        const value = (0, calculations_1.aggregateValues)(pairs.map(p => p.value), pairs.map(p => p.weight), method);
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
            const dk = deviceKey(cfg.stateId);
            const effectiveTs = Math.max(s.lastTs, this.deviceLastSeen.get(dk) ?? s.lastTs);
            const aliveKnown = cfg.healthStateId !== undefined
                ? (this.deviceHealthMap.get(cfg.healthStateId) ?? true)
                : null;
            if (aliveKnown === false)
                return false;
            if (aliveKnown === null && (0, time_1.isStale)(effectiveTs, cfg.staleAfterSeconds))
                return false;
            if (stabilitySeconds !== undefined && stabilitySeconds > 0) {
                const until = this.recoveringUntil.get(s.id);
                if (until !== undefined && Date.now() < until)
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
        const range = Math.abs(config.validMax - config.validMin); // abs: Fehlkonfiguration validMin>validMax absichern
        const maxJump = range * 0.25; // 25% Sprung als unplausibel
        return Math.abs(newValue - prev.processedValue) <= maxJump;
    }
}
exports.SensorService = SensorService;
//# sourceMappingURL=SensorService.js.map