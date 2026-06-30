import type { DaySchedule, DayNight, ClimateProfile, ClimateSetpoint } from '../models/config';
export declare class ScheduleService {
    /**
     * Ermittelt ob aktuell Tag, Nacht oder Übergang ist.
     */
    getDayNight(now: Date, schedule: DaySchedule): DayNight;
    /**
     * Berechnet aktive Sollwerte unter Berücksichtigung des Übergangs.
     */
    getActiveSetpoint(profile: ClimateProfile, dayNight: DayNight, lightChangeTs: number): ClimateSetpoint;
    /**
     * Liefert Millisekunden bis zum nächsten Zeitplanwechsel.
     */
    msUntilNextChange(now: Date, schedule: DaySchedule): number;
    /**
     * Liefert lesbaren Text über nächsten Wechsel.
     */
    nextChangeText(now: Date, schedule: DaySchedule): string;
}
//# sourceMappingURL=ScheduleService.d.ts.map