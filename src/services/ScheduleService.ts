// ============================================================
// GrowManager – ScheduleService
// Licht-Zeitplan und Tag/Nacht-Erkennung
// ============================================================

import type { DaySchedule, DayNight, ClimateProfile, ClimateSetpoint } from '../models/config';
import { isInTimeWindow, minutesUntil, transitionProgress } from '../utils/time';
import { lerp } from '../utils/calculations';

export class ScheduleService {
    /**
     * Ermittelt ob aktuell Tag, Nacht oder Übergang ist.
     */
    getDayNight(now: Date, schedule: DaySchedule): DayNight {
        const { lightOn, transitionMinutes } = schedule;

        if (isInTimeWindow(now, lightOn.startHH, lightOn.startMM, lightOn.endHH, lightOn.endMM)) {
            // Prüfen ob wir noch im Übergang sind (nach Licht-AN)
            // minutesUntil gibt Minuten BIS ZUM nächsten Start → 1440 minus das = tatsächliche Minuten seit Start
            // % 1440: wenn minutesUntil=0 (exakt auf Startzeit) → 1440-0=1440, Modulo → 0 (korrekt)
            const minutesSinceStart = (1440 - minutesUntil(now, lightOn.startHH, lightOn.startMM)) % 1440;
            if (minutesSinceStart < transitionMinutes) {
                return 'transition';
            }
            return 'day';
        } else {
            // Nacht – Übergang prüfen (kurz nach Licht-AUS)
            // minutesToEnd=0 bedeutet exakt die AUS-Minute → Transition beginnt jetzt
            const minutesToEnd = minutesUntil(now, lightOn.endHH, lightOn.endMM);
            if ((transitionMinutes > 0 && minutesToEnd === 0) || 1440 - minutesToEnd < transitionMinutes) {
                return 'transition';
            }
            return 'night';
        }
    }

    /**
     * Prüft ob jetzt das Lichtfenster aktiv ist (unabhängig von Transition-Status).
     */
    isInLightWindow(now: Date, schedule: DaySchedule): boolean {
        const { lightOn } = schedule;
        return isInTimeWindow(now, lightOn.startHH, lightOn.startMM, lightOn.endHH, lightOn.endMM);
    }

    /**
     * Berechnet aktive Sollwerte unter Berücksichtigung des Übergangs.
     * @param transitionFromNight true = Morgen-Übergang (Nacht→Tag), false = Abend-Übergang (Tag→Nacht)
     */
    getActiveSetpoint(
        profile: ClimateProfile,
        dayNight: DayNight,
        lightChangeTs: number,
        transitionFromNight = false
    ): ClimateSetpoint {
        if (dayNight === 'day') return profile.day;
        if (dayNight === 'night') return profile.night;

        // Übergang: Richtung bestimmt from/to
        // Morgen (Nacht→Tag): t=0 = Nacht-Werte, t=1 = Tag-Werte
        // Abend  (Tag→Nacht): t=0 = Tag-Werte,   t=1 = Nacht-Werte
        const t = transitionProgress(lightChangeTs, profile.transitionMinutes * 60);
        const from = transitionFromNight ? profile.night : profile.day;
        const to   = transitionFromNight ? profile.day   : profile.night;

        // isNaN catches both NaN and undefined-cast-to-number at runtime.
        // safeMin: returns Infinity when both undefined (no limit → alarm never fires).
        // safeLerp: falls back to whichever side is defined.
        const safeMin = (a: number, b: number): number => {
            if (isNaN(a) && isNaN(b)) return Infinity;
            if (isNaN(a)) return b;
            if (isNaN(b)) return a;
            return Math.min(a, b);
        };
        const safeLerp = (a: number, b: number, p: number): number => {
            if (isNaN(a) && isNaN(b)) return 0;
            if (isNaN(a)) return b;
            if (isNaN(b)) return a;
            return lerp(a, b, p);
        };

        return {
            temperature: safeLerp(from.temperature, to.temperature, t),
            temperatureTolerance: safeLerp(from.temperatureTolerance, to.temperatureTolerance, t),
            humidity: safeLerp(from.humidity, to.humidity, t),
            humidityTolerance: safeLerp(from.humidityTolerance, to.humidityTolerance, t),
            vpdMin: safeLerp(from.vpdMin, to.vpdMin, t),
            vpdMax: safeLerp(from.vpdMax, to.vpdMax, t),
            temperatureMin: safeLerp(from.temperatureMin, to.temperatureMin, t),
            temperatureMax: safeLerp(from.temperatureMax, to.temperatureMax, t),
            temperatureCritical: safeMin(from.temperatureCritical, to.temperatureCritical),
            humidityMin: safeLerp(from.humidityMin, to.humidityMin, t),
            humidityMax: safeLerp(from.humidityMax, to.humidityMax, t),
            humidityCritical: safeMin(from.humidityCritical, to.humidityCritical),
            condensationRiskMaxHumidity: safeMin(from.condensationRiskMaxHumidity, to.condensationRiskMaxHumidity),
        };
    }

    /**
     * Liefert Millisekunden bis zum nächsten Zeitplanwechsel.
     * Während Transition: 60s (sekündliche Re-Evaluierung für glatte Interpolation).
     */
    msUntilNextChange(now: Date, schedule: DaySchedule): number {
        const { lightOn } = schedule;
        const dayNight = this.getDayNight(now, schedule);
        if (dayNight === 'day') {
            return minutesUntil(now, lightOn.endHH, lightOn.endMM) * 60000;
        } else if (dayNight === 'transition') {
            return 60 * 1000;
        } else {
            return minutesUntil(now, lightOn.startHH, lightOn.startMM) * 60000;
        }
    }

    /**
     * Liefert lesbaren Text über nächsten Wechsel.
     */
    nextChangeText(now: Date, schedule: DaySchedule): string {
        const dayNight = this.getDayNight(now, schedule);
        const { lightOn } = schedule;
        if (dayNight === 'day') {
            return `Nacht ${String(lightOn.endHH).padStart(2, '0')}:${String(lightOn.endMM).padStart(2, '0')}`;
        } else {
            return `Tag ${String(lightOn.startHH).padStart(2, '0')}:${String(lightOn.startMM).padStart(2, '0')}`;
        }
    }
}
