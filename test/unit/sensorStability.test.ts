// ============================================================
// Tests für Sensor-Stabilitätszeit in SensorService
// ============================================================

import { SensorService } from '../../src/services/SensorService';
import type { SensorConfig } from '../../src/models/config';

const mockLog = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

function makeSensor(id: string): SensorConfig {
    return {
        id,
        name: id,
        stateId: `test.0.${id}`,
        type: 'temperature',
        role: 'primary',
        unit: '°C',
        offset: 0,
        multiplier: 1,
        weight: 1,
        validMin: 0,
        validMax: 50,
        staleAfterSeconds: 9999,
        unchangedAlarmSeconds: 9999,
        minUpdateRateSeconds: 0,
        smoothing: 'none',
        outlierFilter: false,
        errorBehavior: 'ignore',
        useForControl: true,
        controlPriority: 1,
        enabled: true,
    };
}

describe('SensorService – Stabilitätszeit', () => {
    let service: SensorService;
    const now = Date.now();

    beforeEach(() => {
        service = new SensorService(mockLog);
        jest.useFakeTimers();
        jest.setSystemTime(now);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('isStable gibt true wenn kein Recovery aktiv', () => {
        const s = makeSensor('s1');
        service.initState(s);
        expect(service.isStable('s1')).toBe(true);
    });

    it('isStable gibt false während Recovery', () => {
        service.startRecovery('s1', 120);
        expect(service.isStable('s1')).toBe(false);
    });

    it('isStable gibt true nach Ablauf der Stabilisierungszeit', () => {
        service.startRecovery('s1', 120);
        jest.advanceTimersByTime(121_000);
        expect(service.isStable('s1')).toBe(true);
    });

    it('aggregate ignoriert Sensoren im Recovery wenn stabilitySeconds gesetzt', () => {
        const s1 = makeSensor('s1');
        const s2 = makeSensor('s2');
        service.initState(s1);
        service.initState(s2);

        // s1 gültig machen
        service.processValue(s1, 25, now, now);
        // s2 gültig machen
        service.processValue(s2, 30, now, now);

        // s1 in Recovery setzen
        service.startRecovery('s1', 120);

        // Mit stabilitySeconds=120 wird s1 ignoriert
        const agg = service.aggregate([s1, s2], 'temperature', 'mean', 120);
        // Nur s2=30 geht ein
        expect(agg.value).toBe(30);
        expect(agg.validCount).toBe(1);
    });

    it('aggregate ohne stabilitySeconds nutzt alle gültigen Sensoren', () => {
        const s1 = makeSensor('s1');
        const s2 = makeSensor('s2');
        service.initState(s1);
        service.initState(s2);
        service.processValue(s1, 25, now, now);
        service.processValue(s2, 35, now, now);
        service.startRecovery('s1', 120);

        // Ohne stabilitySeconds → s1 wird mitgezählt
        const agg = service.aggregate([s1, s2], 'temperature', 'mean');
        expect(agg.validCount).toBe(2);
        expect(agg.value).toBe(30); // (25+35)/2
    });

    it('Recovery wird bei erneutem ungültigen Sensor gelöscht', () => {
        const s1 = makeSensor('s1');
        service.initState(s1);
        service.startRecovery('s1', 120);
        expect(service.isStable('s1')).toBe(false);

        // Sensor wird ungültig → Recovery löschen
        service.processValue(s1, null as unknown as number, now, now);
        expect(service.isStable('s1')).toBe(true);
    });
});
