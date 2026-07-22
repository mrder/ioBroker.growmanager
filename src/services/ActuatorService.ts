// ============================================================
// GrowManager – ActuatorService
// Verwaltet Aktorsteuerung, Sperrzeiten, Feedback und Diagnose
// ============================================================

import type { ActuatorConfig, ActuatorState } from '../models/config';
import { isStale, isInTimeWindow } from '../utils/time';
import type { ILogger } from '../utils/logger';

interface WindSimState {
    isOn: boolean;
    nextChangeAt: number; // Timestamp in ms
}

interface RunTimeEntry {
    startTs: number;
    totalSeconds: number;
    switchCount: number;
    lastHourSwitches: number[];
}

export class ActuatorService {
    private readonly states = new Map<string, ActuatorState>();
    private readonly runTime = new Map<string, RunTimeEntry>();
    private readonly overrideUntil = new Map<string, number>();
    private readonly windSimStates = new Map<string, WindSimState>();

    constructor(private readonly log: ILogger) {}

    initActuator(config: ActuatorConfig): void {
        this.states.set(config.id, {
            id: config.id,
            requested: config.offValue as boolean | number,
            feedback: null,
            power: null,
            effectiveState: config.offValue as boolean | number,
            blocked: false,
            overrideActive: false,
            manualLock: false,
            needsSync: true,
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
    canSwitch(config: ActuatorConfig, requested: boolean | number): {
        allowed: boolean;
        reason?: string;
        waitSeconds?: number;
    } {
        const state = this.states.get(config.id);
        if (!state) return { allowed: false, reason: 'Nicht initialisiert' };

        // Manueller Dashboard-Lock sperrt den Auto-Zyklus komplett
        if (state.manualLock) {
            return { allowed: false, reason: 'Manuell gesperrt' };
        }

        // Safe State / Notsperre hat immer Vorrang — auch über Override
        if (state.blocked) {
            return {
                allowed: false,
                reason: state.blockedReason,
                waitSeconds: state.blockedUntil
                    ? Math.max(0, Math.round((state.blockedUntil - Date.now()) / 1000))
                    : 0,
            };
        }

        // Override ignoriert Mindestzeiten und Schaltspielbegrenzung — aber nicht Safe State (oben)
        if (state.overrideActive) {
            return { allowed: true };
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
            if (!rt) return { allowed: true }; // nicht initialisiert → kein Limit
            const oneHourAgo = now - 3600000;
            const recentTs = rt.lastHourSwitches.filter(ts => ts > oneHourAgo);
            if (recentTs.length >= config.maxSwitchesPerHour) {
                // Warten bis das älteste Schaltereignis das 1h-Fenster verlässt
                const oldestTs = Math.min(...recentTs);
                const waitSeconds = Math.max(1, Math.round((oldestTs + 3600000 - now) / 1000));
                return {
                    allowed: false,
                    reason: `Max. Schaltspiele/h erreicht (${recentTs.length}/${config.maxSwitchesPerHour})`,
                    waitSeconds,
                };
            }
        }

        return { allowed: true };
    }

    /**
     * Registriert einen Schaltbefehl (nach Freigabe durch canSwitch).
     * @returns true wenn der Zustand sich tatsächlich ändert
     */
    recordCommand(config: ActuatorConfig, requested: boolean | number): boolean {
        const state = this.states.get(config.id);
        if (!state) return false;

        // Beim ersten Tick nach Neustart immer senden (Gerät könnte physisch anders stehen)
        const firstSync = state.needsSync;
        state.needsSync = false;

        // Vergleich basiert auf requested (nicht effectiveState), damit der Befehl
        // auch bei konfiguriertem Feedback-State korrekt gefeuert wird.
        const wasOn = this.isRequestingOn(config, state.requested);
        const prevRequested = state.requested;
        state.requested = requested;
        const isNowOn = this.isRequestingOn(config, state.requested);
        // Auch reine Prozentwertänderungen (z.B. 30%→80%) erkennen — nicht nur ON/OFF-Wechsel
        const changing = wasOn !== isNowOn || prevRequested !== requested || firstSync;

        // Effektiven Zustand sofort aus requested ableiten (wenn kein Feedback vorhanden)
        if (state.feedback === null && state.power === null) {
            state.effectiveState = requested;
        }

        if (changing) {
            const rt = this.runTime.get(config.id)!;
            // firstSync-only (kein echter Zustandswechsel): Zähler + lastSwitchTs nicht setzen
            if (wasOn !== isNowOn) {
                state.lastSwitchTs = Date.now();
                state.switchCount++;
                rt.switchCount++;
                rt.lastHourSwitches.push(Date.now());
                const oneHourAgo = Date.now() - 3600000;
                rt.lastHourSwitches = rt.lastHourSwitches.filter(ts => ts > oneHourAgo);
                if (!isNowOn && rt.startTs > 0) {
                    rt.totalSeconds += (Date.now() - rt.startTs) / 1000;
                    rt.startTs = 0;
                } else if (isNowOn) {
                    rt.startTs = Date.now();
                }
            }
        }

        return changing;
    }

    /**
     * Verarbeitet Feedback vom Gerät.
     */
    processFeedback(config: ActuatorConfig, feedbackValue: unknown, powerValue?: unknown): void {
        const state = this.states.get(config.id);
        if (!state) return;

        if (feedbackValue !== null && feedbackValue !== undefined) {
            state.feedback = feedbackValue as boolean | number;
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
    setOverride(config: ActuatorConfig, value: boolean | number, durationMinutes: number): void {
        const state = this.states.get(config.id);
        if (!state) return;
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
    lockForManual(actuatorId: string, command: boolean | number): void {
        const state = this.states.get(actuatorId);
        if (!state) return;
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
    setReachable(actuatorId: string, reachable: boolean): void {
        const state = this.states.get(actuatorId);
        if (!state) return;
        if (!reachable) {
            state.health = 'unreachable';
        } else if (state.health === 'unreachable') {
            state.health = 'unknown'; // computeHealth() übernimmt beim nächsten Zyklus
        }
    }

    /**
     * Hebt den manuellen Lock auf (→ AUTO).
     * Setzt lastSwitchTs=0 damit der nächste Auto-Zyklus die Mindestzeiten ignoriert
     * und durch den geänderten requested-Wert ein changed=true erzeugt.
     */
    unlockManual(actuatorId: string): void {
        const state = this.states.get(actuatorId);
        if (!state) return;
        state.manualLock = false;
        state.lastSwitchTs = 0;
    }

    /**
     * Setzt einen Aktor in seinen sicheren Zustand.
     */
    setSafeState(config: ActuatorConfig): boolean | number {
        const state = this.states.get(config.id);
        if (!state) return config.offValue as boolean | number;
        const safeValue = config.safeState === 'off' ? config.offValue : config.onValue;
        state.requested = safeValue as boolean | number;
        state.blocked = true;
        state.blockedReason = 'Sicherer Zustand aktiv';
        return safeValue as boolean | number;
    }

    /**
     * Verriegelt zwei sich gegenseitig ausschließende Aktoren.
     */
    applyInterlock(configA: ActuatorConfig, configB: ActuatorConfig): void {
        const stateA = this.states.get(configA.id);
        const stateB = this.states.get(configB.id);
        if (!stateA || !stateB) return;

        const aOn = this.isRequestingOn(configA, stateA.requested);
        const bOn = this.isRequestingOn(configB, stateB.requested);

        if (aOn && bOn) {
            // B verliert – A hat Priorität (erste Definition)
            stateB.requested = configB.offValue as boolean | number;
            this.log.warn(
                `Verriegelung: ${configB.name} abgeschaltet (Konflikt mit ${configA.name})`
            );
        }
    }

    /**
     * Wind-Simulator Tick für Umluft-Aktoren.
     * Gibt den aktuell gewünschten Zustand (true=EIN / false=AUS) zurück.
     * Kümmert sich intern um den Zustandswechsel-Timer.
     */
    tickWindSimulator(config: ActuatorConfig, now: Date): boolean {
        const cfg = config.windSimulator;
        if (!cfg) return true; // kein Konfig → immer EIN

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
            this.log.debug(
                `WindSim ${config.name}: → ${state.isOn ? 'EIN' : 'AUS'} für ${Math.round(dur / 1000)}s`
            );
        }

        return state.isOn;
    }

    /**
     * Prüft ob ein Umluft-Zeitfenster gerade aktiv ist.
     */
    isCirculationScheduleActive(config: ActuatorConfig, now: Date): boolean {
        const windows = config.circulationSchedule;
        if (!windows || windows.length === 0) return false;
        return windows.some(w => isInTimeWindow(now, w.startHH, w.startMM, w.endHH, w.endMM));
    }

    /**
     * Prüft abgelaufene Overrides.
     */
    tickOverrides(): void {
        const now = Date.now();
        for (const [id, until] of this.overrideUntil.entries()) {
            if (now >= until) {
                const state = this.states.get(id);
                if (state) {
                    state.overrideActive = false;
                    state.overrideUntil = undefined;
                    state.manualLock = false; // Dashboard-Lock läuft zusammen mit Override ab
                    state.lastSwitchTs = 0;   // Mindestzeiten nach Override-Ablauf ignorieren
                    this.log.info(`Override für ${id} abgelaufen`);
                }
                this.overrideUntil.delete(id);
            }
        }
    }

    getState(actuatorId: string): ActuatorState | undefined {
        return this.states.get(actuatorId);
    }

    getWindSimInfo(actuatorId: string): { isOn: boolean; nextChangeAt: number } | undefined {
        const s = this.windSimStates.get(actuatorId);
        if (!s) return undefined;
        return { isOn: s.isOn, nextChangeAt: s.nextChangeAt };
    }

    getRunTimeSeconds(actuatorId: string): number {
        const rt = this.runTime.get(actuatorId);
        if (!rt) return 0;
        const current = rt.startTs > 0 ? (Date.now() - rt.startTs) / 1000 : 0;
        return rt.totalSeconds + current;
    }

    getSwitchCount(actuatorId: string): number {
        return this.runTime.get(actuatorId)?.switchCount ?? 0;
    }

    private isEffectivelyOn(config: ActuatorConfig, state: ActuatorState): boolean {
        const eff = state.effectiveState;
        if (typeof eff === 'boolean') return eff;
        if (typeof eff === 'number') return eff > 0;
        return false;
    }

    isRequestingOn(config: ActuatorConfig, requested: boolean | number): boolean {
        if (typeof requested === 'boolean') return requested;
        if (typeof requested === 'number') return requested > 0;
        return false;
    }

    private computeEffectiveState(config: ActuatorConfig, state: ActuatorState): boolean | number {
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

    private computeHealth(
        config: ActuatorConfig,
        state: ActuatorState
    ): ActuatorState['health'] {
        const requestedOn = this.isRequestingOn(config, state.requested);
        const effectiveOn = this.isEffectivelyOn(config, state);
        const timeSince = (Date.now() - state.lastSwitchTs) / 1000;

        // Kleben prüfen (EIN obwohl AUS befohlen)
        // needsSync=true: Adapter-Start, firstSync noch nicht ausgeführt → kein stuckOn
        // Bei geteilten Aktoren überspringen: eine andere Gruppe kann den Aktor halten
        if (!config.shared && !requestedOn && effectiveOn && !state.needsSync && timeSince > config.offDelaySeconds + 30) {
            return 'stuckOn';
        }

        // Kein Feedback innerhalb der Frist (lastSwitchTs=0 = Adapter-Start, noch kein Befehl → überspringen)
        if (
            requestedOn &&
            state.feedback === null &&
            config.feedbackStateId &&
            state.lastSwitchTs > 0 &&
            timeSince > config.minimumOnSeconds
        ) {
            return 'noFeedback';
        }

        // Keine Leistung
        if (
            requestedOn &&
            state.power !== null &&
            config.powerOnThreshold > 0 &&
            state.power < config.powerOnThreshold &&
            timeSince > config.onDelaySeconds + 15
        ) {
            return 'noPower';
        }

        return 'ok';
    }

    private randBetween(minSec: number, maxSec: number): number {
        const lo = Math.max(1, minSec);
        const hi = Math.max(lo, maxSec);
        if (lo === hi) return lo;
        return Math.floor(Math.random() * (hi - lo + 1)) + lo;
    }
}
