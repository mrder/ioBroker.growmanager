// ============================================================
// Unit-Tests: ScheduleService
// ============================================================

import { ScheduleService } from '../../src/services/ScheduleService';
import type { DaySchedule, ClimateProfile } from '../../src/models/config';

const makeSchedule = (startH: number, startM: number, endH: number, endM: number): DaySchedule => ({
    lightOn: { startHH: startH, startMM: startM, endHH: endH, endMM: endM },
    transitionMinutes: 30,
});

describe('ScheduleService', () => {
    const service = new ScheduleService();

    const makeTime = (h: number, m: number): Date => {
        const d = new Date();
        d.setHours(h, m, 0, 0);
        return d;
    };

    test('Tag erkannt', () => {
        const schedule = makeSchedule(6, 0, 22, 0);
        expect(service.getDayNight(makeTime(12, 0), schedule)).toBe('day');
    });

    test('Nacht erkannt', () => {
        const schedule = makeSchedule(6, 0, 22, 0);
        expect(service.getDayNight(makeTime(3, 0), schedule)).toBe('night');
    });

    test('msUntilNextChange positiv', () => {
        const schedule = makeSchedule(6, 0, 22, 0);
        const now = makeTime(10, 0);
        const ms = service.msUntilNextChange(now, schedule);
        expect(ms).toBeGreaterThan(0);
    });

    test('Nächster Wechsel-Text enthält Uhrzeit', () => {
        const schedule = makeSchedule(6, 0, 22, 0);
        const text = service.nextChangeText(makeTime(12, 0), schedule);
        expect(text).toContain('22:00');
    });

    test('Setpoint Interpolation im Übergang', () => {
        const profile: ClimateProfile = {
            id: 'p1',
            name: 'Test',
            phase: 'bloom',
            day: {
                temperature: 26, temperatureTolerance: 1,
                humidity: 55, humidityTolerance: 4,
                vpdMin: 1.1, vpdMax: 1.3,
                temperatureMin: 23, temperatureMax: 30, temperatureCritical: 35,
                humidityMin: 45, humidityMax: 70, humidityCritical: 80,
                condensationRiskMaxHumidity: 75,
            },
            night: {
                temperature: 22, temperatureTolerance: 1,
                humidity: 60, humidityTolerance: 4,
                vpdMin: 0.9, vpdMax: 1.1,
                temperatureMin: 18, temperatureMax: 26, temperatureCritical: 35,
                humidityMin: 50, humidityMax: 75, humidityCritical: 80,
                condensationRiskMaxHumidity: 75,
            },
            transitionMinutes: 30,
        };

        // Mitten im Übergang: t = 0.5
        const midTransitionTs = Date.now() - 15 * 60 * 1000; // vor 15 Minuten
        const sp = service.getActiveSetpoint(profile, 'transition', midTransitionTs);
        // Temperatur sollte zwischen 22 und 26 sein
        expect(sp.temperature).toBeGreaterThan(22);
        expect(sp.temperature).toBeLessThan(26);
    });
});
