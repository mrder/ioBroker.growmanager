import type { ActuatorConfig, ActuatorState } from '../models/config';
import type { ILogger } from '../utils/logger';
export declare class ActuatorService {
    private readonly log;
    private readonly states;
    private readonly runTime;
    private readonly overrideUntil;
    private readonly windSimStates;
    constructor(log: ILogger);
    initActuator(config: ActuatorConfig): void;
    /**
     * Prüft ob der Aktor den angeforderten Zustand annehmen darf.
     * Berücksichtigt Mindestlauf- und Mindestauszeiten.
     */
    canSwitch(config: ActuatorConfig, requested: boolean | number): {
        allowed: boolean;
        reason?: string;
        waitSeconds?: number;
    };
    /**
     * Registriert einen Schaltbefehl (nach Freigabe durch canSwitch).
     * @returns true wenn der Zustand sich tatsächlich ändert
     */
    recordCommand(config: ActuatorConfig, requested: boolean | number): boolean;
    /**
     * Verarbeitet Feedback vom Gerät.
     */
    processFeedback(config: ActuatorConfig, feedbackValue: unknown, powerValue?: unknown): void;
    /**
     * Setzt einen manuellen Override.
     */
    setOverride(config: ActuatorConfig, value: boolean | number, durationMinutes: number): void;
    /**
     * Sperrt einen Aktor manuell (Dashboard-Override).
     * Blockiert den Auto-Zyklus und setzt requested auf den manuellen Wert (→ korrekte LED-Anzeige).
     */
    lockForManual(actuatorId: string, command: boolean | number): void;
    /**
     * Setzt den Geräteerreichbarkeits-Status (aus healthStateId).
     * Überschreibt computeHealth wenn nicht erreichbar.
     */
    setReachable(actuatorId: string, reachable: boolean): void;
    /**
     * Hebt den manuellen Lock auf (→ AUTO).
     * Setzt lastSwitchTs=0 damit der nächste Auto-Zyklus die Mindestzeiten ignoriert
     * und durch den geänderten requested-Wert ein changed=true erzeugt.
     */
    unlockManual(actuatorId: string): void;
    /**
     * Setzt einen Aktor in seinen sicheren Zustand.
     */
    setSafeState(config: ActuatorConfig): boolean | number;
    /**
     * Verriegelt zwei sich gegenseitig ausschließende Aktoren.
     */
    applyInterlock(configA: ActuatorConfig, configB: ActuatorConfig): void;
    /**
     * Wind-Simulator Tick für Umluft-Aktoren.
     * Gibt den aktuell gewünschten Zustand (true=EIN / false=AUS) zurück.
     * Kümmert sich intern um den Zustandswechsel-Timer.
     */
    tickWindSimulator(config: ActuatorConfig, now: Date): boolean;
    /**
     * Prüft ob ein Umluft-Zeitfenster gerade aktiv ist.
     */
    isCirculationScheduleActive(config: ActuatorConfig, now: Date): boolean;
    /**
     * Prüft abgelaufene Overrides.
     */
    tickOverrides(): void;
    getState(actuatorId: string): ActuatorState | undefined;
    getRunTimeSeconds(actuatorId: string): number;
    getSwitchCount(actuatorId: string): number;
    private isEffectivelyOn;
    isRequestingOn(config: ActuatorConfig, requested: boolean | number): boolean;
    private computeEffectiveState;
    private computeHealth;
    private randBetween;
}
//# sourceMappingURL=ActuatorService.d.ts.map