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
            const minutesToEnd = minutesUntil(now, lightOn.endHH, lightOn.endMM);
            if (1440 - minutesToEnd < transitionMinutes) {
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

        return {
            temperature: lerp(from.temperature, to.temperature, t),
            temperatureTolerance: lerp(from.temperatureTolerance, to.temperatureTolerance, t),
            humidity: lerp(from.humidity, to.humidity, t),
            humidityTolerance: lerp(from.humidityTolerance, to.humidityTolerance, t),
            vpdMin: lerp(from.vpdMin, to.vpdMin, t),
            vpdMax: lerp(from.vpdMax, to.vpdMax, t),
            temperatureMin: lerp(from.temperatureMin, to.temperatureMin, t),
            temperatureMax: lerp(from.temperatureMax, to.temperatureMax, t),
            temperatureCritical: from.temperatureCritical,
            humidityMin: lerp(from.humidityMin, to.humidityMin, t),
            humidityMax: lerp(from.humidityMax, to.humidityMax, t),
            humidityCritical: from.humidityCritical,
            condensationRiskMaxHumidity: from.condensationRiskMaxHumidity,
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
