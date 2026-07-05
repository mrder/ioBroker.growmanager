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
            const minutesSinceStart = 1440 - minutesUntil(now, lightOn.startHH, lightOn.startMM);
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
     * Berechnet aktive Sollwerte unter Berücksichtigung des Übergangs.
     */
    getActiveSetpoint(
        profile: ClimateProfile,
        dayNight: DayNight,
        lightChangeTs: number
    ): ClimateSetpoint {
        if (dayNight === 'day') return profile.day;
        if (dayNight === 'night') return profile.night;

        // Übergang: linear interpolieren
        const t = transitionProgress(lightChangeTs, profile.transitionMinutes * 60);
        const from = profile.day;
        const to = profile.night;

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
     */
    msUntilNextChange(now: Date, schedule: DaySchedule): number {
        const { lightOn } = schedule;
        const dayNight = this.getDayNight(now, schedule);
        if (dayNight === 'day') {
            return minutesUntil(now, lightOn.endHH, lightOn.endMM) * 60000;
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
