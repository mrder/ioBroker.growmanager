"use strict";
// ============================================================
// GrowManager – ActuatorService
// Verwaltet Aktorsteuerung, Sperrzeiten, Feedback und Diagnose
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActuatorService = void 0;
const time_1 = require("../utils/time");
class ActuatorService {
    constructor(log) {
        this.log = log;
        this.states = new Map();
        this.runTime = new Map();
        this.overrideUntil = new Map();
        this.windSimStates = new Map();
    }
    initActuator(config) {
        this.states.set(config.id, {
            id: config.id,
            requested: config.offValue,
            feedback: null,
            power: null,
            effectiveState: config.offValue,
            blocked: false,
            overrideActive: false,
            manualLock: false,
            health: 'unknown',
            runTimeSeconds: 0,
            switchCount: 0,
            lastSwitchTs: 0,
        });
        this.runTime.set(config.id, {
            startTs: 0,
            totalSeconds: 0,
            switchCount: 0,
            lastHourSwitches: [],
        });
    }
    /**
     * Prüft ob der Aktor den angeforderten Zustand annehmen darf.
     * Berücksichtigt Mindestlauf- und Mindestauszeiten.
     */
    canSwitch(config, requested) {
        const state = this.states.get(config.id);
        if (!state)
            return { allowed: false, reason: 'Nicht initialisiert' };
        // Manueller Dashboard-Lock sperrt den Auto-Zyklus komplett
        if (state.manualLock) {
            return { allowed: false, reason: 'Manuell gesperrt' };
        }
        // Override ignoriert Sperrzeiten (außer kritische Sicherheit)
        if (state.overrideActive) {
            return { allowed: true };
        }
        if (state.blocked) {
            return {
                allowed: false,
                reason: state.blockedReason,
                waitSeconds: state.blockedUntil
                    ? Math.max(0, Math.round((state.blockedUntil - Date.now()) / 1000))
                    : 0,
            };
        }
        const now = Date.now();
        const timeSinceSwitch = (now - state.lastSwitchTs) / 1000;
        const isOn = this.isEffectivelyOn(config, state);
        const requestingOn = this.isRequestingOn(config, requested);
        if (!requestingOn && isOn) {
            // Ausschalten: Mindestlaufzeit prüfen
            if (timeSinceSwitch < config.minimumOnSeconds && state.lastSwitchTs > 0) {
                const wait = Math.round(config.minimumOnSeconds - timeSinceSwitch);
                return {
                    allowed: false,
                    reason: `Mindestlaufzeit: noch ${wait}s`,
                    waitSeconds: wait,
                };
            }
        }
        if (requestingOn && !isOn) {
            // Einschalten: Mindestauszeit prüfen
            if (timeSinceSwitch < config.minimumOffSeconds && state.lastSwitchTs > 0) {
                const wait = Math.round(config.minimumOffSeconds - timeSinceSwitch);
                return {
                    allowed: false,
                    reason: `Mindestauszeit: noch ${wait}s`,
                    waitSeconds: wait,
                };
            }
        }
        // Maximale Schaltspiele pro Stunde
        if (config.maxSwitchesPerHour > 0) {
            const rt = this.runTime.get(config.id);
            if (!rt)
                return { allowed: true }; // nicht initialisiert → kein Limit
            const oneHourAgo = now - 3600000;
            const recentSwitches = rt.lastHourSwitches.filter(ts => ts > oneHourAgo).length;
            if (recentSwitches >= config.maxSwitchesPerHour) {
                return {
                    allowed: false,
                    reason: `Max. Schaltspiele/h erreicht (${recentSwitches}/${config.maxSwitchesPerHour})`,
                    waitSeconds: 60,
                };
            }
        }
        return { allowed: true };
    }
    /**
     * Registriert einen Schaltbefehl (nach Freigabe durch canSwitch).
     * @returns true wenn der Zustand sich tatsächlich ändert
     */
    recordCommand(config, requested) {
        const state = this.states.get(config.id);
        if (!state)
            return false;
        // Vergleich basiert auf requested (nicht effectiveState), damit der Befehl
        // auch bei konfiguriertem Feedback-State korrekt gefeuert wird.
        const wasOn = this.isRequestingOn(config, state.requested);
        state.requested = requested;
        const isNowOn = this.isRequestingOn(config, state.requested);
        const changing = wasOn !== isNowOn;
        // Effektiven Zustand sofort aus requested ableiten (wenn kein Feedback vorhanden)
        if (state.feedback === null && state.power === null) {
            state.effectiveState = requested;
        }
        if (changing) {
            state.lastSwitchTs = Date.now();
            state.switchCount++;
            const rt = this.runTime.get(config.id);
            rt.switchCount++;
            rt.lastHourSwitches.push(Date.now());
            // Array trimmen: nur Timestamps der letzten Stunde behalten
            const oneHourAgo = Date.now() - 3600000;
            rt.lastHourSwitches = rt.lastHourSwitches.filter(ts => ts > oneHourAgo);
            if (!isNowOn && rt.startTs > 0) {
                rt.totalSeconds += (Date.now() - rt.startTs) / 1000;
                rt.startTs = 0;
            }
            else if (isNowOn) {
                rt.startTs = Date.now();
            }
        }
        return changing;
    }
    /**
     * Verarbeitet Feedback vom Gerät.
     */
    processFeedback(config, feedbackValue, powerValue) {
        const state = this.states.get(config.id);
        if (!state)
            return;
        if (feedbackValue !== null && feedbackValue !== undefined) {
            state.feedback = feedbackValue;
        }
        if (powerValue !== null && powerValue !== undefined) {
            state.power = typeof powerValue === 'number' ? powerValue : null;
        }
        state.effectiveState = this.computeEffectiveState(config, state);
        // Gerätestatus nicht überschreiben wenn explizit als unreachable markiert
        if (state.health !== 'unreachable') {
            state.health = this.computeHealth(config, state);
        }
    }
    /**
     * Setzt einen manuellen Override.
     */
    setOverride(config, value, durationMinutes) {
        const state = this.states.get(config.id);
        if (!state)
            return;
        state.overrideActive = true;
        state.overrideUntil = Date.now() + durationMinutes * 60000;
        this.overrideUntil.set(config.id, state.overrideUntil);
        state.requested = value;
        this.log.info(`Override für ${config.name}: ${value} für ${durationMinutes}min`);
    }
    /**
     * Sperrt einen Aktor manuell (Dashboard-Override).
     * Blockiert den Auto-Zyklus und setzt requested auf den manuellen Wert (→ korrekte LED-Anzeige).
     */
    lockForManual(actuatorId, command) {
        const state = this.states.get(actuatorId);
        if (!state)
            return;
        state.manualLock = true;
        state.requested = command;
        if (state.feedback === null && state.power === null) {
            state.effectiveState = command;
        }
    }
    /**
     * Setzt den Geräteerreichbarkeits-Status (aus healthStateId).
     * Überschreibt computeHealth wenn nicht erreichbar.
     */
    setReachable(actuatorId, reachable) {
        const state = this.states.get(actuatorId);
        if (!state)
            return;
        if (!reachable) {
            state.health = 'unreachable';
        }
        else if (state.health === 'unreachable') {
            state.health = 'unknown'; // computeHealth() übernimmt beim nächsten Zyklus
        }
    }
    /**
     * Hebt den manuellen Lock auf (→ AUTO).
     * Setzt lastSwitchTs=0 damit der nächste Auto-Zyklus die Mindestzeiten ignoriert
     * und durch den geänderten requested-Wert ein changed=true erzeugt.
     */
    unlockManual(actuatorId) {
        const state = this.states.get(actuatorId);
        if (!state)
            return;
        state.manualLock = false;
        state.lastSwitchTs = 0;
    }
    /**
     * Setzt einen Aktor in seinen sicheren Zustand.
     */
    setSafeState(config) {
        const state = this.states.get(config.id);
        if (!state)
            return config.offValue;
        const safeValue = config.safeState === 'off' ? config.offValue : config.onValue;
        state.requested = safeValue;
        state.blocked = true;
        state.blockedReason = 'Sicherer Zustand aktiv';
        return safeValue;
    }
    /**
     * Verriegelt zwei sich gegenseitig ausschließende Aktoren.
     */
    applyInterlock(configA, configB) {
        const stateA = this.states.get(configA.id);
        const stateB = this.states.get(configB.id);
        if (!stateA || !stateB)
            return;
        const aOn = this.isRequestingOn(configA, stateA.requested);
        const bOn = this.isRequestingOn(configB, stateB.requested);
        if (aOn && bOn) {
            // B verliert – A hat Priorität (erste Definition)
            stateB.requested = configB.offValue;
            this.log.warn(`Verriegelung: ${configB.name} abgeschaltet (Konflikt mit ${configA.name})`);
        }
    }
    /**
     * Wind-Simulator Tick für Umluft-Aktoren.
     * Gibt den aktuell gewünschten Zustand (true=EIN / false=AUS) zurück.
     * Kümmert sich intern um den Zustandswechsel-Timer.
     */
    tickWindSimulator(config, now) {
        const cfg = config.windSimulator;
        if (!cfg)
            return true; // kein Konfig → immer EIN
        let state = this.windSimStates.get(config.id);
        if (!state) {
            // Erststart: zufällige EIN-Phase beginnen
            const onDur = this.randBetween(cfg.minOnSeconds, cfg.maxOnSeconds) * 1000;
            state = { isOn: true, nextChangeAt: Date.now() + onDur };
            this.windSimStates.set(config.id, state);
        }
        if (Date.now() >= state.nextChangeAt) {
            state.isOn = !state.isOn;
            const dur = state.isOn
                ? this.randBetween(cfg.minOnSeconds, cfg.maxOnSeconds) * 1000
                : this.randBetween(cfg.minOffSeconds, cfg.maxOffSeconds) * 1000;
            state.nextChangeAt = Date.now() + dur;
            this.log.debug(`WindSim ${config.name}: → ${state.isOn ? 'EIN' : 'AUS'} für ${Math.round(dur / 1000)}s`);
        }
        return state.isOn;
    }
    /**
     * Prüft ob ein Umluft-Zeitfenster gerade aktiv ist.
     */
    isCirculationScheduleActive(config, now) {
        const windows = config.circulationSchedule;
        if (!windows || windows.length === 0)
            return false;
        return windows.some(w => (0, time_1.isInTimeWindow)(now, w.startHH, w.startMM, w.endHH, w.endMM));
    }
    /**
     * Prüft abgelaufene Overrides.
     */
    tickOverrides() {
        const now = Date.now();
        for (const [id, until] of this.overrideUntil.entries()) {
            if (now >= until) {
                const state = this.states.get(id);
                if (state) {
                    state.overrideActive = false;
                    state.overrideUntil = undefined;
                    state.manualLock = false; // Dashboard-Lock läuft zusammen mit Override ab
                    this.log.info(`Override für ${id} abgelaufen`);
                }
                this.overrideUntil.delete(id);
            }
        }
    }
    getState(actuatorId) {
        return this.states.get(actuatorId);
    }
    getWindSimInfo(actuatorId) {
        const s = this.windSimStates.get(actuatorId);
        if (!s)
            return undefined;
        return { isOn: s.isOn, nextChangeAt: s.nextChangeAt };
    }
    getRunTimeSeconds(actuatorId) {
        const rt = this.runTime.get(actuatorId);
        if (!rt)
            return 0;
        const current = rt.startTs > 0 ? (Date.now() - rt.startTs) / 1000 : 0;
        return rt.totalSeconds + current;
    }
    getSwitchCount(actuatorId) {
        return this.runTime.get(actuatorId)?.switchCount ?? 0;
    }
    isEffectivelyOn(config, state) {
        const eff = state.effectiveState;
        if (typeof eff === 'boolean')
            return eff;
        if (typeof eff === 'number')
            return eff > 0;
        return false;
    }
    isRequestingOn(config, requested) {
        if (typeof requested === 'boolean')
            return requested;
        if (typeof requested === 'number')
            return requested > 0;
        return false;
    }
    computeEffectiveState(config, state) {
        // Wenn Leistungsfeedback vorhanden: Schwellwert prüfen
        if (state.power !== null && config.powerOnThreshold > 0) {
            return state.power >= config.powerOnThreshold;
        }
        // Sonst Rückmeldung verwenden
        if (state.feedback !== null) {
            return state.feedback;
        }
        // Fallback: angeforderten Zustand zurückgeben
        return state.requested;
    }
    computeHealth(config, state) {
        const requestedOn = this.isRequestingOn(config, state.requested);
        const effectiveOn = this.isEffectivelyOn(config, state);
        const timeSince = (Date.now() - state.lastSwitchTs) / 1000;
        // Kleben prüfen (EIN obwohl AUS befohlen)
        // lastSwitchTs=0: Adapter-Start, noch kein Schaltbefehl ausgeführt → kein stuckOn
        // Bei geteilten Aktoren überspringen: eine andere Gruppe kann den Aktor halten
        if (!config.shared && !requestedOn && effectiveOn && state.lastSwitchTs > 0 && timeSince > config.offDelaySeconds + 30) {
            return 'stuckOn';
        }
        // Kein Feedback innerhalb der Frist
        if (requestedOn &&
            state.feedback === null &&
            config.feedbackStateId &&
            timeSince > config.minimumOnSeconds) {
            return 'noFeedback';
        }
        // Keine Leistung
        if (requestedOn &&
            state.power !== null &&
            config.powerOnThreshold > 0 &&
            state.power < config.powerOnThreshold &&
            timeSince > config.onDelaySeconds + 15) {
            return 'noPower';
        }
        return 'ok';
    }
    randBetween(minSec, maxSec) {
        const lo = Math.max(1, minSec);
        const hi = Math.max(lo + 1, maxSec);
        return Math.floor(Math.random() * (hi - lo + 1)) + lo;
    }
}
exports.ActuatorService = ActuatorService;
//# sourceMappingURL=ActuatorService.js.map