// ============================================================
// Unit-Tests: ActuatorService
// ============================================================

import { ActuatorService } from '../../src/services/ActuatorService';
import type { ActuatorConfig } from '../../src/models/config';
import type { ILogger } from '../../src/utils/logger';

const mockLogger: ILogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};

const makeActuator = (overrides: Partial<ActuatorConfig> = {}): ActuatorConfig => ({
    id: 'fan-1',
    name: 'Abluftlüfter',
    type: 'exhaustFan',
    commandStateId: 'tasmota.0.fan.POWER',
    dataType: 'boolean',
    onValue: true,
    offValue: false,
    supportsPercent: false,
    powerOnThreshold: 10,
    speedOnThreshold: 0,
    onDelaySeconds: 0,
    offDelaySeconds: 0,
    minimumOnSeconds: 180,
    minimumOffSeconds: 120,
    maximumOnSeconds: 7200,
    maxSwitchesPerHour: 0,
    coastDownSeconds: 0,
    safeState: 'off',
    feedbackMissingBehavior: 'warn',
    manualOverride: false,
    overrideDurationMinutes: 60,
    invertLogic: false,
    interlockIds: [],
    shared: false,
    enabled: true,
    ...overrides,
});

describe('ActuatorService', () => {
    let service: ActuatorService;

    beforeEach(() => {
        service = new ActuatorService(mockLogger);
    });

    test('Initialisierung', () => {
        const act = makeActuator();
        service.initActuator(act);
        const state = service.getState(act.id);
        expect(state).toBeDefined();
        expect(state?.health).toBe('unknown');
    });

    test('Erster Schaltbefehl immer erlaubt', () => {
        const act = makeActuator();
        service.initActuator(act);
        const result = service.canSwitch(act, true);
        expect(result.allowed).toBe(true);
    });

    test('Mindestlaufzeit blockiert Ausschalten', () => {
        const act = makeActuator({ minimumOnSeconds: 300 });
        service.initActuator(act);
        service.recordCommand(act, true); // einschalten
        const result = service.canSwitch(act, false);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('Mindestlaufzeit');
    });

    test('Mindestauszeit blockiert Einschalten', () => {
        const act = makeActuator({ minimumOffSeconds: 300 });
        service.initActuator(act);
        // Erst ein/aus um Schaltzeitpunkt zu setzen
        service.recordCommand(act, true);
        service.recordCommand(act, false);
        const result = service.canSwitch(act, true);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('Mindestauszeit');
    });

    test('Override ignoriert Mindestlaufzeiten', () => {
        const act = makeActuator({ minimumOnSeconds: 300 });
        service.initActuator(act);
        service.recordCommand(act, true);
        service.setOverride(act, false, 30);
        const result = service.canSwitch(act, false);
        expect(result.allowed).toBe(true);
    });

    test('Laufzeit wird kumuliert', () => {
        const act = makeActuator({ minimumOnSeconds: 0, minimumOffSeconds: 0 });
        service.initActuator(act);
        service.recordCommand(act, true);
        // Kleiner Delay simulieren
        const rt1 = service.getRunTimeSeconds(act.id);
        expect(rt1).toBeGreaterThanOrEqual(0);
    });

    test('Schaltspiele werden gezählt', () => {
        const act = makeActuator({ minimumOnSeconds: 0, minimumOffSeconds: 0 });
        service.initActuator(act);
        service.recordCommand(act, true);
        service.recordCommand(act, false);
        expect(service.getSwitchCount(act.id)).toBe(2);
    });

    test('Gleicher Zustand erzeugt keinen Schaltbefehl', () => {
        const act = makeActuator({ minimumOnSeconds: 0 });
        service.initActuator(act);
        service.recordCommand(act, true);
        const changed = service.recordCommand(act, true);
        expect(changed).toBe(false);
    });

    test('Sicherer Zustand setzt Blocked-Flag', () => {
        const act = makeActuator();
        service.initActuator(act);
        service.setSafeState(act);
        const state = service.getState(act.id);
        expect(state?.blocked).toBe(true);
    });

    test('Feedback verarbeiten', () => {
        const act = makeActuator({ powerOnThreshold: 10 });
        service.initActuator(act);
        service.processFeedback(act, true, 15);
        const state = service.getState(act.id);
        expect(state?.power).toBe(15);
        expect(state?.feedback).toBe(true);
    });
});
