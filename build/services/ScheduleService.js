"use strict";
// ============================================================
// GrowManager – ScheduleService
// Licht-Zeitplan und Tag/Nacht-Erkennung
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScheduleService = void 0;
const time_1 = require("../utils/time");
const calculations_1 = require("../utils/calculations");
class ScheduleService {
    /**
     * Ermittelt ob aktuell Tag, Nacht oder Übergang ist.
     */
    getDayNight(now, schedule) {
        const { lightOn, transitionMinutes } = schedule;
        if ((0, time_1.isInTimeWindow)(now, lightOn.startHH, lightOn.startMM, lightOn.endHH, lightOn.endMM)) {
            // Prüfen ob wir noch im Übergang sind (nach Licht-AN)
            // minutesUntil gibt Minuten BIS ZUM nächsten Start → 1440 minus das = tatsächliche Minuten seit Start
            // % 1440: wenn minutesUntil=0 (exakt auf Startzeit) → 1440-0=1440, Modulo → 0 (korrekt)
            const minutesSinceStart = (1440 - (0, time_1.minutesUntil)(now, lightOn.startHH, lightOn.startMM)) % 1440;
            if (minutesSinceStart < transitionMinutes) {
                return 'transition';
            }
            return 'day';
        }
        else {
            // Nacht – Übergang prüfen (kurz nach Licht-AUS)
            const minutesToEnd = (0, time_1.minutesUntil)(now, lightOn.endHH, lightOn.endMM);
            if (1440 - minutesToEnd < transitionMinutes) {
                return 'transition';
            }
            return 'night';
        }
    }
    /**
     * Berechnet aktive Sollwerte unter Berücksichtigung des Übergangs.
     */
    getActiveSetpoint(profile, dayNight, lightChangeTs) {
        if (dayNight === 'day')
            return profile.day;
        if (dayNight === 'night')
            return profile.night;
        // Übergang: linear interpolieren
        const t = (0, time_1.transitionProgress)(lightChangeTs, profile.transitionMinutes * 60);
        const from = profile.day;
        const to = profile.night;
        return {
            temperature: (0, calculations_1.lerp)(from.temperature, to.temperature, t),
            temperatureTolerance: (0, calculations_1.lerp)(from.temperatureTolerance, to.temperatureTolerance, t),
            humidity: (0, calculations_1.lerp)(from.humidity, to.humidity, t),
            humidityTolerance: (0, calculations_1.lerp)(from.humidityTolerance, to.humidityTolerance, t),
            vpdMin: (0, calculations_1.lerp)(from.vpdMin, to.vpdMin, t),
            vpdMax: (0, calculations_1.lerp)(from.vpdMax, to.vpdMax, t),
            temperatureMin: (0, calculations_1.lerp)(from.temperatureMin, to.temperatureMin, t),
            temperatureMax: (0, calculations_1.lerp)(from.temperatureMax, to.temperatureMax, t),
            temperatureCritical: from.temperatureCritical,
            humidityMin: (0, calculations_1.lerp)(from.humidityMin, to.humidityMin, t),
            humidityMax: (0, calculations_1.lerp)(from.humidityMax, to.humidityMax, t),
            humidityCritical: from.humidityCritical,
            condensationRiskMaxHumidity: from.condensationRiskMaxHumidity,
        };
    }
    /**
     * Liefert Millisekunden bis zum nächsten Zeitplanwechsel.
     */
    msUntilNextChange(now, schedule) {
        const { lightOn } = schedule;
        const dayNight = this.getDayNight(now, schedule);
        if (dayNight === 'day') {
            return (0, time_1.minutesUntil)(now, lightOn.endHH, lightOn.endMM) * 60000;
        }
        else {
            return (0, time_1.minutesUntil)(now, lightOn.startHH, lightOn.startMM) * 60000;
        }
    }
    /**
     * Liefert lesbaren Text über nächsten Wechsel.
     */
    nextChangeText(now, schedule) {
        const dayNight = this.getDayNight(now, schedule);
        const { lightOn } = schedule;
        if (dayNight === 'day') {
            return `Nacht ${String(lightOn.endHH).padStart(2, '0')}:${String(lightOn.endMM).padStart(2, '0')}`;
        }
        else {
            return `Tag ${String(lightOn.startHH).padStart(2, '0')}:${String(lightOn.startMM).padStart(2, '0')}`;
        }
    }
}
exports.ScheduleService = ScheduleService;
//# sourceMappingURL=ScheduleService.js.map