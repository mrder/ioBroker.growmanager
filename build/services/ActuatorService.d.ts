import type { ActuatorConfig, ActuatorState } from '../models/config';
import type { ILogger } from '../utils/logger';
export declare class ActuatorService {
    private readonly log;
    private readonly states;
    private readonly runTime;
    private readonly overrideUntil;
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
     * Setzt einen Aktor in seinen sicheren Zustand.
     */
    setSafeState(config: ActuatorConfig): boolean | number;
    /**
     * Verriegelt zwei sich gegenseitig ausschließende Aktoren.
     */
    applyInterlock(configA: ActuatorConfig, configB: ActuatorConfig): void;
    /**
     * Prüft abgelaufene Overrides.
     */
    tickOverrides(): void;
    getState(actuatorId: string): ActuatorState | undefined;
    getRunTimeSeconds(actuatorId: string): number;
    getSwitchCount(actuatorId: string): number;
    private isEffectivelyOn;
    private isRequestingOn;
    private computeEffectiveState;
    private computeHealth;
}
//# sourceMappingURL=ActuatorService.d.ts.map