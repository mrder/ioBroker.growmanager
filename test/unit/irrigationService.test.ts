import { IrrigationService } from '../../src/services/IrrigationService';
import { AlarmService } from '../../src/services/AlarmService';
import type { IrrigationZoneConfig } from '../../src/models/config';

const noopLog = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};

function makeZone(overrides: Partial<IrrigationZoneConfig> = {}): IrrigationZoneConfig {
    return {
        id: 'z1',
        name: 'Zone 1',
        enabled: true,
        moistureSensorIds: [],
        startMoisture: 40,
        targetMoisture: 70,
        maxRunSeconds: 120,
        minPauseMinutes: 5,
        pumpActuatorId: 'pump1',
        dryRunProtection: false,
        leakageAlarmSeconds: 0,
        ...overrides,
    };
}

describe('IrrigationService', () => {
    let svc: IrrigationService;
    let alarmSvc: AlarmService;

    beforeEach(() => {
        alarmSvc = new AlarmService(noopLog);
        svc = new IrrigationService(alarmSvc, noopLog);
    });

    test('deaktivierte Zone: command=false', () => {
        const zone = makeZone({ enabled: false });
        const result = svc.decide(zone, 'g1', new Map(), new Date());
        expect(result.command).toBe(false);
    });

    test('ohne Feuchtsensor: kein Start', () => {
        const zone = makeZone({ moistureSensorIds: [] });
        const result = svc.decide(zone, 'g1', new Map(), new Date());
        expect(result.command).toBe(false);
    });

    test('mit Sensor unter Schwelle: Start', () => {
        const zone = makeZone({ moistureSensorIds: ['s1'], startMoisture: 40 });
        const sensors = new Map([
            ['s1', { id: 's1', rawValue: 30, processedValue: 30, valid: true, quality: 100, stale: false, unchanged: false, lastTs: Date.now(), lastLc: Date.now() }],
        ]);
        const result = svc.decide(zone, 'g1', sensors, new Date());
        expect(result.command).toBe(true);
    });

    test('mit Sensor über Ziel: kein Start', () => {
        const zone = makeZone({ moistureSensorIds: ['s1'], startMoisture: 40, targetMoisture: 70 });
        const sensors = new Map([
            ['s1', { id: 's1', rawValue: 75, processedValue: 75, valid: true, quality: 100, stale: false, unchanged: false, lastTs: Date.now(), lastLc: Date.now() }],
        ]);
        const result = svc.decide(zone, 'g1', sensors, new Date());
        expect(result.command).toBe(false);
    });

    test('triggerManual startet Pumpe manuell', () => {
        const zone = makeZone();
        const started = svc.triggerManual(zone, 60);
        expect(started).toBe(true);
        const state = svc.getState('z1');
        expect(state?.running).toBe(true);
    });

    test('stopNow stoppt laufende Zone', () => {
        const zone = makeZone();
        svc.triggerManual(zone, 60);
        svc.stopNow('z1', 'Test');
        const state = svc.getState('z1');
        expect(state?.running).toBe(false);
    });

    test('clearFault hebt Sperre auf', () => {
        const zone = makeZone();
        svc.initZone(zone);
        const state = svc.getState('z1')!;
        state.blocked = true;
        svc.clearFault('z1');
        expect(svc.getState('z1')?.blocked).toBe(false);
    });

    test('Mindestpause verhindert sofortigen Neustart', () => {
        const zone = makeZone({ moistureSensorIds: ['s1'], startMoisture: 40, minPauseMinutes: 10 });
        svc.initZone(zone);
        const sensors = new Map([
            ['s1', { id: 's1', rawValue: 30, processedValue: 30, valid: true, quality: 100, stale: false, unchanged: false, lastTs: Date.now(), lastLc: Date.now() }],
        ]);
        svc.decide(zone, 'g1', sensors, new Date()); // Start
        svc.stopNow('z1', 'Test');
        const result2 = svc.decide(zone, 'g1', sensors, new Date());
        // Noch in Mindestpause (10 min)
        expect(result2.command).toBe(false);
        expect(result2.reason).toContain('Mindestpause');
    });
});
