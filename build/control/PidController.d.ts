export interface PidParams {
    kp: number;
    tiSeconds: number;
    tdSeconds: number;
    derivativeFilter: number;
    outputMin: number;
    outputMax: number;
    integratorMin: number;
    integratorMax: number;
    antiWindup: 'clamping' | 'backCalculation';
    sampleTimeSeconds: number;
    deadband: number;
    outputRampPerCycle: number;
}
export interface PidState {
    lastError: number;
    integral: number;
    lastDerivative: number;
    lastOutput: number;
    lastSetpoint: number;
    lastTs: number;
    active: boolean;
}
export interface PidResult {
    output: number;
    p: number;
    i: number;
    d: number;
    error: number;
    clamped: boolean;
    inDeadband: boolean;
}
export declare function createPidState(): PidState;
export declare class PidController {
    private readonly params;
    constructor(params: PidParams);
    /**
     * Berechnet den nächsten Reglerausgang.
     * @param setpoint Sollwert
     * @param measured Istwert (null = ungültig)
     * @param state Mutabler Reglerzustand
     * @returns PidResult oder null bei ungültigem Istwert
     */
    compute(setpoint: number, measured: number | null, state: PidState): PidResult | null;
    /**
     * Stoßfreie Umschaltung Hand → Automatik.
     * Integrator wird so initialisiert, dass der Ausgang beim aktuellen Wert beginnt.
     */
    bumplessTransfer(state: PidState, currentOutput: number, measured: number, setpoint: number): void;
    /**
     * Regler zurücksetzen.
     */
    reset(state: PidState): void;
    /**
     * Zeitproportionaler Ausgang für Relais:
     * Wandelt 0–100 % in Ein-Zeit innerhalb eines Fensters um.
     */
    static timeProportional(outputPercent: number, windowSeconds: number): {
        onSeconds: number;
        offSeconds: number;
    };
}
/**
 * Zweipunktregler mit Hysterese (einfach, robust, für Ein/Aus-Aktoren).
 * Gibt true (Ein) oder false (Aus) zurück.
 */
export declare function twoPointController(measured: number | null, setpoint: number, hysteresis: number, currentOn: boolean): {
    command: boolean;
    reason: string;
};
/**
 * Stufenregler: gibt Stufe 0..n zurück basierend auf Abstand vom Sollwert.
 */
export declare function steppedController(measured: number | null, setpoint: number, steps: number, maxDeviation: number): number;
//# sourceMappingURL=PidController.d.ts.map