import { PidController, createPidState, twoPointController, steppedController } from '../../src/control/PidController';
import type { PidParams } from '../../src/control/PidController';

function makeParams(overrides: Partial<PidParams> = {}): PidParams {
    return {
        kp: 2,
        tiSeconds: 0,
        tdSeconds: 0,
        derivativeFilter: 0.1,
        outputMin: 0,
        outputMax: 100,
        integratorMin: -100,
        integratorMax: 100,
        antiWindup: 'clamping',
        sampleTimeSeconds: 10,
        deadband: 0,
        outputRampPerCycle: 0,
        ...overrides,
    };
}

describe('PidController.compute', () => {
    test('gibt null bei null-Messwert zurück', () => {
        const ctrl = new PidController(makeParams());
        const state = createPidState();
        expect(ctrl.compute(20, null, state)).toBeNull();
    });

    test('P-only: Ausgang proportional zum Fehler', () => {
        const ctrl = new PidController(makeParams({ kp: 2, tiSeconds: 0 }));
        const state = createPidState();
        const result = ctrl.compute(25, 20, state);
        // Fehler = 5, P = 10
        expect(result).not.toBeNull();
        expect(result!.output).toBeCloseTo(10, 0);
        expect(result!.inDeadband).toBe(false);
    });

    test('Ausgangsbegrenzung clamping', () => {
        const ctrl = new PidController(makeParams({ kp: 100 }));
        const state = createPidState();
        const result = ctrl.compute(25, 0, state);
        expect(result!.output).toBeLessThanOrEqual(100);
        expect(result!.clamped).toBe(true);
    });

    test('Totband: Ausgang unveränder wenn Fehler < deadband', () => {
        const ctrl = new PidController(makeParams({ deadband: 2, kp: 5 }));
        const state = createPidState();
        state.lastOutput = 42;
        const result = ctrl.compute(21, 20, state); // Fehler = 1 < 2
        expect(result!.inDeadband).toBe(true);
        expect(result!.output).toBe(42);
    });

    test('bumplessTransfer setzt Integrator korrekt', () => {
        const ctrl = new PidController(makeParams({ kp: 2, tiSeconds: 60 }));
        const state = createPidState();
        // Bumpless: Ausgang soll bei 50 beginnen
        ctrl.bumplessTransfer(state, 50, 20, 25);
        // Nach bumpless: lastOutput = 50, Integrator entsprechend gesetzt
        expect(state.lastOutput).toBe(50);
        // Compute kurz danach – Ausgang bleibt grob im Bereich 0–100
        const result = ctrl.compute(25, 20, state);
        expect(result).not.toBeNull();
        expect(result!.output).toBeGreaterThanOrEqual(0);
        expect(result!.output).toBeLessThanOrEqual(100);
    });

    test('reset setzt alle Zustandsvariablen zurück', () => {
        const ctrl = new PidController(makeParams());
        const state = createPidState();
        ctrl.compute(25, 20, state);
        ctrl.reset(state);
        expect(state.integral).toBe(0);
        expect(state.lastOutput).toBe(0);
        expect(state.active).toBe(false);
    });

    test('timeProportional: 50% → halbe Einschaltzeit', () => {
        const result = PidController.timeProportional(50, 10);
        expect(result.onSeconds).toBe(5);
        expect(result.offSeconds).toBe(5);
    });

    test('timeProportional: 0% → alles aus', () => {
        const result = PidController.timeProportional(0, 10);
        expect(result.onSeconds).toBe(0);
    });

    test('timeProportional: 100% → alles ein', () => {
        const result = PidController.timeProportional(100, 10);
        expect(result.onSeconds).toBe(10);
    });
});

describe('twoPointController', () => {
    test('gibt false bei null-Messwert', () => {
        const r = twoPointController(null, 20, 2, false);
        expect(r.command).toBe(false);
    });

    test('schaltet EIN wenn Messwert unter Sollwert - Hysterese/2', () => {
        const r = twoPointController(17, 20, 2, false); // 17 < 19
        expect(r.command).toBe(true);
    });

    test('schaltet AUS wenn Messwert über Sollwert + Hysterese/2', () => {
        const r = twoPointController(23, 20, 2, true); // 23 > 21
        expect(r.command).toBe(false);
    });

    test('bleibt im Totband unverändert', () => {
        const rOn = twoPointController(20, 20, 2, true);
        const rOff = twoPointController(20, 20, 2, false);
        expect(rOn.command).toBe(true);
        expect(rOff.command).toBe(false);
    });
});

describe('steppedController', () => {
    test('gibt 0 bei null zurück', () => {
        expect(steppedController(null, 20, 3, 6)).toBe(0);
    });

    test('gibt maximale Stufe bei vollem Fehler', () => {
        expect(steppedController(26, 20, 3, 6)).toBe(3);
    });

    test('gibt mittlere Stufe bei halbem Fehler', () => {
        expect(steppedController(23, 20, 3, 6)).toBe(2);
    });

    test('gibt 0 bei Sollwert', () => {
        expect(steppedController(20, 20, 3, 6)).toBe(0);
    });
});
