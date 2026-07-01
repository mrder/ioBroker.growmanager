// ============================================================
// Unit-Tests: AlarmService
// ============================================================

import { AlarmService, ALARM_CODES } from '../../src/services/AlarmService';
import type { ILogger } from '../../src/utils/logger';

const mockLogger: ILogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};

describe('AlarmService', () => {
    let service: AlarmService;

    beforeEach(() => {
        service = new AlarmService(mockLogger);
    });

    test('Alarm erzeugen', () => {
        const alarm = service.raise(ALARM_CODES.TEMPERATURE_HIGH, 'g1', 'src', 'warning', 'Test');
        expect(alarm.code).toBe(ALARM_CODES.TEMPERATURE_HIGH);
        expect(alarm.active).toBe(true);
        expect(alarm.repeatCount).toBe(1);
    });

    test('Gleicher Alarm wird nicht dupliziert', () => {
        service.raise(ALARM_CODES.TEMPERATURE_HIGH, 'g1', 'src', 'warning', 'Test');
        service.raise(ALARM_CODES.TEMPERATURE_HIGH, 'g1', 'src', 'warning', 'Test2');
        const actives = service.getActiveAlarms();
        expect(actives.filter(a => a.code === ALARM_CODES.TEMPERATURE_HIGH).length).toBe(1);
        expect(actives[0].repeatCount).toBe(2);
    });

    test('Alarm löschen', () => {
        service.raise(ALARM_CODES.TEMPERATURE_HIGH, 'g1', 'src', 'warning', 'Test');
        service.clear(ALARM_CODES.TEMPERATURE_HIGH, 'g1', 'src');
        expect(service.getActiveAlarms().length).toBe(0);
    });

    test('Alarm quittieren', () => {
        const alarm = service.raise(ALARM_CODES.TEMPERATURE_HIGH, 'g1', 'src', 'warning', 'Test');
        service.acknowledge(alarm.id);
        expect(service.getAllAlarms().find(a => a.id === alarm.id)?.acknowledged).toBe(true);
    });

    test('Alle quittieren', () => {
        service.raise(ALARM_CODES.TEMPERATURE_HIGH, 'g1', 'src', 'warning', 'T1');
        service.raise(ALARM_CODES.HUMIDITY_HIGH, 'g1', 'src2', 'fault', 'T2');
        service.acknowledgeAll();
        expect(service.getActiveAlarms().every(a => a.acknowledged)).toBe(true);
    });

    test('Höchster Schweregrad', () => {
        service.raise(ALARM_CODES.SENSOR_STALE, 'g1', 'src', 'info', 'I');
        service.raise(ALARM_CODES.TEMPERATURE_HIGH, 'g1', 'src2', 'critical', 'C');
        expect(service.getHighestSeverity('g1')).toBe('critical');
    });

    test('Kein aktiver Alarm → null', () => {
        expect(service.getHighestSeverity('g1')).toBeNull();
    });

    test('Verschiedene Gruppen trennen', () => {
        service.raise(ALARM_CODES.TEMPERATURE_HIGH, 'g1', 'src', 'critical', 'G1');
        service.raise(ALARM_CODES.HUMIDITY_HIGH, 'g2', 'src', 'info', 'G2');
        expect(service.getHighestSeverity('g1')).toBe('critical');
        expect(service.getHighestSeverity('g2')).toBe('info');
    });

    test('Listener wird bei neuem Alarm benachrichtigt', () => {
        const listener = jest.fn();
        service.addListener(listener);
        service.raise(ALARM_CODES.SENSOR_STALE, 'g1', 'src', 'warning', 'Msg');
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({ isNew: true }));
    });

    test('Listener bei Update (nicht neu)', () => {
        const listener = jest.fn();
        service.addListener(listener);
        service.raise(ALARM_CODES.SENSOR_STALE, 'g1', 'src', 'warning', 'Msg');
        service.raise(ALARM_CODES.SENSOR_STALE, 'g1', 'src', 'warning', 'Msg2');
        expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ isNew: false }));
    });
});
