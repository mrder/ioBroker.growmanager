import { GroupCapabilityService } from '../../src/services/GroupCapabilityService';
import type { GroupConfig, SensorState } from '../../src/models/config';

function makeGroup(overrides: Partial<GroupConfig> = {}): GroupConfig {
    return {
        id: 'g1',
        name: 'Test',
        description: '',
        color: '#fff',
        enabled: true,
        phase: 'growth',
        mode: 'vpd',
        schedule: { lightOn: { startHH: 6, startMM: 0, endHH: 18, endMM: 0 }, transitionMinutes: 30 },
        sensors: [],
        actuators: [],
        irrigationZones: [],
        cameras: [],
        profileId: 'p1',
        alarmProfileId: 'ap1',
        priority: 1,
        aggregationMethod: 'median',
        minValidSensors: 1,
        fallbackChain: ['combined', 'temperature', 'monitorOnly'],
        stabilityTimeSeconds: 60,
        sensorDisagreementThreshold: 5,
        ...overrides,
    };
}

function makeActuator(type: string, id = type) {
    return {
        id,
        name: id,
        type,
        commandStateId: `state.${id}`,
        dataType: 'boolean',
        onValue: true,
        offValue: false,
        supportsPercent: false,
        powerOnThreshold: 0,
        speedOnThreshold: 0,
        onDelaySeconds: 0,
        offDelaySeconds: 0,
        minimumOnSeconds: 0,
        minimumOffSeconds: 0,
        maximumOnSeconds: 0,
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
    } as GroupConfig['actuators'][0];
}

describe('GroupCapabilityService', () => {
    const svc = new GroupCapabilityService();
    const noSensors = new Map<string, SensorState>();

    test('FAULT wenn keine Sensoren und keine Aktoren', () => {
        const result = svc.evaluate(makeGroup({ mode: 'vpd' }), noSensors, null, null, null, null);
        expect(result.degradation).toBe('FAULT');
    });

    test('monitorOnly immer in availableModes', () => {
        const result = svc.evaluate(makeGroup(), noSensors, null, null, null, null);
        expect(result.availableModes).toContain('monitorOnly');
    });

    test('temperature-Modus verfügbar wenn Temp + Heizung', () => {
        const group = makeGroup({ actuators: [makeActuator('heating')] });
        const result = svc.evaluate(group, noSensors, 24, null, null, null);
        expect(result.availableModes).toContain('temperature');
    });

    test('vpd-Modus nur wenn Temp + Feuchte', () => {
        const group = makeGroup({ actuators: [makeActuator('exhaustFan')] });
        const withBoth = svc.evaluate(group, noSensors, 24, 65, null, null);
        const tempOnly = svc.evaluate(group, noSensors, 24, null, null, null);
        expect(withBoth.availableModes).toContain('vpd');
        expect(tempOnly.availableModes).not.toContain('vpd');
    });

    test('FALLBACK wenn vpd gewünscht aber kein Feuchtsensor', () => {
        const group = makeGroup({ mode: 'vpd', actuators: [makeActuator('exhaustFan')] });
        const result = svc.evaluate(group, noSensors, 24, null, null, null);
        expect(result.degradation).toBe('FALLBACK');
    });

    test('FULL wenn alles vorhanden inkl. Feedback', () => {
        const exhaustWithFeedback = { ...makeActuator('exhaustFan'), feedbackStateId: 'state.exhaustFeedback' };
        const group = makeGroup({
            mode: 'vpd',
            actuators: [exhaustWithFeedback, makeActuator('humidifier')],
        });
        const result = svc.evaluate(group, noSensors, 24, 60, null, null);
        expect(result.degradation).toBe('FULL');
    });

    test('schedule-Modus wenn Aktoren vorhanden', () => {
        const group = makeGroup({ actuators: [makeActuator('light')] });
        const result = svc.evaluate(group, noSensors, null, null, null, null);
        expect(result.availableModes).toContain('schedule');
    });

    test('Fallback-Kette ist sinnvoll geordnet', () => {
        const group = makeGroup({
            actuators: [makeActuator('exhaustFan'), makeActuator('heating')],
        });
        const result = svc.evaluate(group, noSensors, 24, 60, null, null);
        const chain = result.fallbackChain;
        // vpd sollte vor temperature kommen
        expect(chain.indexOf('vpd')).toBeLessThan(chain.indexOf('temperature'));
    });

    test('buildCapabilityReport gibt Array zurück', () => {
        const group = makeGroup({ actuators: [makeActuator('exhaustFan')] });
        const result = svc.evaluate(group, noSensors, 24, 60, null, null);
        const report = svc.buildCapabilityReport(result);
        expect(Array.isArray(report)).toBe(true);
        expect(report.length).toBeGreaterThan(5);
    });
});
