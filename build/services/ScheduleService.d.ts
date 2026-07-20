import type { DaySchedule, DayNight, ClimateProfile, ClimateSetpoint } from '../models/config';
export declare class ScheduleService {
    /**
     * Ermittelt ob aktuell Tag, Nacht oder Übergang ist.
     */
    getDayNight(now: Date, schedule: DaySchedule): DayNight;
    /**
     * Prüft ob jetzt das Lichtfenster aktiv ist (unabhängig von Transition-Status).
     */
    isInLightWindow(now: Date, schedule: DaySchedule): boolean;
    /**
     * Berechnet aktive Sollwerte unter Berücksichtigung des Übergangs.
     * @param transitionFromNight true = Morgen-Übergang (Nacht→Tag), false = Abend-Übergang (Tag→Nacht)
     */
    getActiveSetpoint(profile: ClimateProfile, dayNight: DayNight, lightChangeTs: number, transitionFromNight?: boolean): ClimateSetpoint;
    /**
     * Liefert Millisekunden bis zum nächsten Zeitplanwechsel.
     * Während Transition: 60s (sekündliche Re-Evaluierung für glatte Interpolation).
     */
    msUntilNextChange(now: Date, schedule: DaySchedule): number;
    /**
     * Liefert lesbaren Text über nächsten Wechsel.
     */
    nextChangeText(now: Date, schedule: DaySchedule): string;
}
//# sourceMappingURL=ScheduleService.d.ts.map