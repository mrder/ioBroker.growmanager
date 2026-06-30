// ============================================================
// GrowManager – PID-Regler
// Für analoge Aktoren (0–100 %-Ausgabe).
// Nicht für Ein/Aus-Relais gedacht.
// ============================================================

export interface PidParams {
    kp: number;
    tiSeconds: number;   // 0 = kein I-Anteil
    tdSeconds: number;   // 0 = kein D-Anteil
    derivativeFilter: number; // 0..1, typisch 0.1
    outputMin: number;
    outputMax: number;
    integratorMin: number;
    integratorMax: number;
    antiWindup: 'clamping' | 'backCalculation';
    sampleTimeSeconds: number;
    deadband: number;
    outputRampPerCycle: number; // Max. Ausgangsänderung pro Zyklus (0 = unbegrenzt)
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
    output: number;       // 0..100
    p: number;
    i: number;
    d: number;
    error: number;
    clamped: boolean;
    inDeadband: boolean;
}

export function createPidState(): PidState {
    return {
        lastError: 0,
        integral: 0,
        lastDerivative: 0,
        lastOutput: 0,
        lastSetpoint: 0,
        lastTs: 0,
        active: false,
    };
}

export class PidController {
    constructor(private readonly params: PidParams) {}

    /**
     * Berechnet den nächsten Reglerausgang.
     * @param setpoint Sollwert
     * @param measured Istwert (null = ungültig)
     * @param state Mutabler Reglerzustand
     * @returns PidResult oder null bei ungültigem Istwert
     */
    compute(
        setpoint: number,
        measured: number | null,
        state: PidState
    ): PidResult | null {
        if (measured === null) return null;

        const now = Date.now();
        const dt = state.lastTs > 0
            ? Math.min((now - state.lastTs) / 1000, this.params.sampleTimeSeconds * 3)
            : this.params.sampleTimeSeconds;
        state.lastTs = now;

        // Fehler (Regelabweichung)
        const error = setpoint - measured;

        // Totband: sehr kleine Fehler ignorieren
        if (Math.abs(error) < this.params.deadband) {
            return {
                output: state.lastOutput,
                p: 0, i: 0, d: 0,
                error,
                clamped: false,
                inDeadband: true,
            };
        }

        // P-Anteil
        const p = this.params.kp * error;

        // I-Anteil (nur wenn Ti > 0)
        let i = 0;
        if (this.params.tiSeconds > 0) {
            state.integral += error * dt;
            // Integratorbegrenzung (Clamping Anti-Windup)
            state.integral = Math.max(this.params.integratorMin, Math.min(this.params.integratorMax, state.integral));
            i = (this.params.kp / this.params.tiSeconds) * state.integral;
        }

        // D-Anteil (nur wenn Td > 0, gefilterter Derivative)
        let d = 0;
        if (this.params.tdSeconds > 0 && dt > 0) {
            const rawD = this.params.kp * this.params.tdSeconds * (error - state.lastError) / dt;
            const alpha = this.params.derivativeFilter;
            d = alpha * rawD + (1 - alpha) * state.lastDerivative;
            state.lastDerivative = d;
        }

        state.lastError = error;

        // Rohausgang
        let output = p + i + d;

        // Ausgangsrampe: begrenzt wie schnell sich der Ausgang ändert
        if (this.params.outputRampPerCycle > 0) {
            const delta = output - state.lastOutput;
            if (Math.abs(delta) > this.params.outputRampPerCycle) {
                output = state.lastOutput + Math.sign(delta) * this.params.outputRampPerCycle;
            }
        }

        // Ausgangsbegrenzung
        const clamped = output < this.params.outputMin || output > this.params.outputMax;
        const clampedOutput = Math.max(this.params.outputMin, Math.min(this.params.outputMax, output));

        // Anti-Windup Back-Calculation: Integrator um Sättigungsfehler zurückrechnen
        if (this.params.antiWindup === 'backCalculation' && this.params.tiSeconds > 0) {
            const satError = clampedOutput - output;
            state.integral += satError * dt * (this.params.tiSeconds / this.params.kp);
        }

        state.lastOutput = clampedOutput;
        state.lastSetpoint = setpoint;

        return {
            output: Math.round(clampedOutput * 10) / 10,
            p,
            i,
            d,
            error,
            clamped,
            inDeadband: false,
        };
    }

    /**
     * Stoßfreie Umschaltung Hand → Automatik.
     * Integrator wird so initialisiert, dass der Ausgang beim aktuellen Wert beginnt.
     */
    bumplessTransfer(state: PidState, currentOutput: number, measured: number, setpoint: number): void {
        const error = setpoint - measured;
        const p = this.params.kp * error;
        if (this.params.tiSeconds > 0) {
            state.integral = (currentOutput - p) / (this.params.kp / this.params.tiSeconds);
            state.integral = Math.max(this.params.integratorMin, Math.min(this.params.integratorMax, state.integral));
        }
        state.lastOutput = currentOutput;
        state.lastError = error;
        state.lastDerivative = 0;
        state.lastTs = Date.now();
        state.active = true;
    }

    /**
     * Regler zurücksetzen.
     */
    reset(state: PidState): void {
        state.integral = 0;
        state.lastError = 0;
        state.lastDerivative = 0;
        state.lastOutput = 0;
        state.lastTs = 0;
        state.active = false;
    }

    /**
     * Zeitproportionaler Ausgang für Relais:
     * Wandelt 0–100 % in Ein-Zeit innerhalb eines Fensters um.
     */
    static timeProportional(
        outputPercent: number,
        windowSeconds: number
    ): { onSeconds: number; offSeconds: number } {
        const t = Math.max(0, Math.min(100, outputPercent)) / 100;
        const onSeconds = Math.round(windowSeconds * t);
        return {
            onSeconds,
            offSeconds: windowSeconds - onSeconds,
        };
    }
}

/**
 * Zweipunktregler mit Hysterese (einfach, robust, für Ein/Aus-Aktoren).
 * Gibt true (Ein) oder false (Aus) zurück.
 */
export function twoPointController(
    measured: number | null,
    setpoint: number,
    hysteresis: number,
    currentOn: boolean
): { command: boolean; reason: string } {
    if (measured === null) {
        return { command: false, reason: 'Kein Messwert – Aktor gesperrt' };
    }
    const half = hysteresis / 2;
    if (!currentOn && measured < setpoint - half) {
        return { command: true, reason: `${measured.toFixed(1)} < ${(setpoint - half).toFixed(1)}` };
    }
    if (currentOn && measured > setpoint + half) {
        return { command: false, reason: `${measured.toFixed(1)} > ${(setpoint + half).toFixed(1)}` };
    }
    return { command: currentOn, reason: 'Im Totband' };
}

/**
 * Stufenregler: gibt Stufe 0..n zurück basierend auf Abstand vom Sollwert.
 */
export function steppedController(
    measured: number | null,
    setpoint: number,
    steps: number,
    maxDeviation: number
): number {
    if (measured === null) return 0;
    const deviation = measured - setpoint;
    const normalised = Math.abs(deviation) / maxDeviation;
    return Math.min(steps, Math.round(normalised * steps));
}
