// ============================================================
// GrowManager – DiagnosticsEngine
// Vier Ebenen der Funktionsüberwachung
// ============================================================

import type { GroupConfig, GroupState, ActuatorState, SensorState } from '../models/config';
import { linearTrend } from '../utils/calculations';
import type { AlarmService } from '../services/AlarmService';
import { ALARM_CODES } from '../services/AlarmService';
import type { ILogger } from '../utils/logger';

interface TrendPoint { ts: number; value: number }
type TrendBuffer = Map<string, TrendPoint[]>;

interface EffectCheckEntry {
    actuatorId: string;
    groupId: string;
    startTs: number;
    startValue: number;
    variable: 'temperature' | 'humidity';
    expectedDirection: 1 | -1;
    waitSeconds: number;
    windowSeconds: number;
    minChange: number;
    failCount: number;
}

interface HourlyAccum { sum: number; count: number; hourTs: number }

export class DiagnosticsEngine {
    private readonly trendBuffers: TrendBuffer = new Map();
    private readonly effectChecks: EffectCheckEntry[] = [];
    private readonly maxTrendPoints = 60;

    /** 1h-Durchschnitte für die letzten 48 Stunden pro Gruppe+Variable */
    private readonly hourlyHistory = new Map<string, TrendPoint[]>();
    private readonly hourlyAccum = new Map<string, HourlyAccum>();
    private readonly maxHourlyPoints = 48;

    constructor(
        private readonly alarmService: AlarmService,
        private readonly log: ILogger
    ) {}

    // ============================================================
    // Ebene 1: Datenpunkt-Erreichbarkeit → SensorService prüft dies
    // ============================================================

    // ============================================================
    // Ebene 2: Feedback-Prüfung nach Schaltbefehl
    // ============================================================
    checkActuatorFeedback(
        groupId: string,
        actuatorConfig: GroupConfig['actuators'][0],
        state: ActuatorState
    ): void {
        if (state.health === 'noFeedback') {
            this.alarmService.raise(
                ALARM_CODES.ACTUATOR_NO_FEEDBACK,
                groupId,
                actuatorConfig.id,
                'fault',
                `${actuatorConfig.name}: Keine Rückmeldung nach Einschaltbefehl`
            );
        } else {
            this.alarmService.clear(ALARM_CODES.ACTUATOR_NO_FEEDBACK, groupId, actuatorConfig.id);
        }

        if (state.health === 'noPower') {
            this.alarmService.raise(
                ALARM_CODES.ACTUATOR_NO_POWER,
                groupId,
                actuatorConfig.id,
                'fault',
                `${actuatorConfig.name}: Eingeschaltet, aber keine Leistungsaufnahme`
            );
        } else {
            this.alarmService.clear(ALARM_CODES.ACTUATOR_NO_POWER, groupId, actuatorConfig.id);
        }

        if (state.health === 'stuckOn') {
            this.alarmService.raise(
                ALARM_CODES.ACTUATOR_STUCK_ON,
                groupId,
                actuatorConfig.id,
                'fault',
                `${actuatorConfig.name}: Klebendes Relais – Leistung trotz Aus-Befehl`
            );
        } else {
            this.alarmService.clear(ALARM_CODES.ACTUATOR_STUCK_ON, groupId, actuatorConfig.id);
        }
    }

    // ============================================================
    // Ebene 3 & 4: Physische Aktivität und Prozesswirkung
    // ============================================================

    /**
     * Registriert den Start einer Wirkungsprüfung.
     */
    startEffectCheck(
        groupId: string,
        actuatorId: string,
        variable: 'temperature' | 'humidity',
        expectedDirection: 1 | -1,
        currentValue: number,
        waitSeconds: number,
        windowSeconds: number,
        minChange: number
    ): void {
        // Bestehende Prüfung für diesen Aktor entfernen
        const idx = this.effectChecks.findIndex(
            e => e.groupId === groupId && e.actuatorId === actuatorId
        );
        if (idx >= 0) this.effectChecks.splice(idx, 1);

        this.effectChecks.push({
            actuatorId,
            groupId,
            startTs: Date.now(),
            startValue: currentValue,
            variable,
            expectedDirection,
            waitSeconds,
            windowSeconds,
            minChange,
            failCount: 0,
        });
    }

    /**
     * Bewertet laufende Wirkungsprüfungen.
     */
    evaluateEffectChecks(groupStates: Map<string, GroupState>): void {
        const now = Date.now();

        for (const check of this.effectChecks) {
            const state = groupStates.get(check.groupId);
            if (!state) continue;

            const elapsed = (now - check.startTs) / 1000;
            if (elapsed < check.waitSeconds) continue; // Noch in Totzeit

            const currentValue =
                check.variable === 'temperature' ? state.temperature : state.humidity;
            if (currentValue === null) continue;

            // Trend aus Puffer berechnen
            const key = `${check.groupId}:${check.variable}`;
            const points = this.trendBuffers.get(key) ?? [];
            if (points.length < 3) continue;

            const recentPoints = points.filter(p => now - p.ts <= check.windowSeconds * 1000);
            const trend = linearTrend(recentPoints);

            if (trend === null) continue;

            // Wirkungsrichtung prüfen
            const expectedTrendPerMin = (check.minChange / check.windowSeconds) * 60;
            const trendOk = check.expectedDirection === 1
                ? trend >= expectedTrendPerMin
                : trend <= -expectedTrendPerMin;

            if (!trendOk) {
                check.failCount++;
                if (check.failCount >= 2) {
                    this.alarmService.raise(
                        ALARM_CODES.ACTUATOR_NO_EFFECT,
                        check.groupId,
                        check.actuatorId,
                        'warning',
                        `Aktor ${check.actuatorId}: Keine ausreichende Wirkung auf ${check.variable} ` +
                        `(Trend: ${(trend * 60).toFixed(2)}/h, erwartet: ${(expectedTrendPerMin * 60).toFixed(2)}/h)`
                    );
                }
            } else {
                check.failCount = 0;
                this.alarmService.clear(ALARM_CODES.ACTUATOR_NO_EFFECT, check.groupId, check.actuatorId);
            }
        }
    }

    /**
     * Fügt einen Messwert zum Trend-Puffer hinzu.
     */
    recordValue(groupId: string, variable: 'temperature' | 'humidity' | 'vpd', value: number): void {
        const key = `${groupId}:${variable}`;
        let points = this.trendBuffers.get(key);
        if (!points) {
            points = [];
            this.trendBuffers.set(key, points);
        }
        points.push({ ts: Date.now(), value });
        if (points.length > this.maxTrendPoints) points.splice(0, points.length - this.maxTrendPoints);

        // Stündlichen Durchschnitt akkumulieren
        const now = Date.now();
        const hourTs = Math.floor(now / 3_600_000) * 3_600_000;
        const accum = this.hourlyAccum.get(key) ?? { sum: 0, count: 0, hourTs };
        if (accum.hourTs !== hourTs) {
            // Neue Stunde begonnen → vorherigen Bucket abschließen
            if (accum.count > 0) {
                let history = this.hourlyHistory.get(key);
                if (!history) { history = []; this.hourlyHistory.set(key, history); }
                history.push({ ts: accum.hourTs, value: accum.sum / accum.count });
                if (history.length > this.maxHourlyPoints) history.splice(0, history.length - this.maxHourlyPoints);
            }
            this.hourlyAccum.set(key, { sum: value, count: 1, hourTs });
        } else {
            this.hourlyAccum.set(key, { sum: accum.sum + value, count: accum.count + 1, hourTs });
        }
    }

    /** Gibt die letzten 48 Stundenmittelwerte zurück (inklusive laufender Stunde). */
    getHourlyHistory(groupId: string, variable: 'temperature' | 'humidity' | 'vpd'): Array<{ ts: number; value: number }> {
        const key = `${groupId}:${variable}`;
        const history = this.hourlyHistory.get(key) ?? [];
        const accum = this.hourlyAccum.get(key);
        if (accum && accum.count > 0) {
            return [...history, { ts: accum.hourTs, value: accum.sum / accum.count }];
        }
        return [...history];
    }

    /**
     * Sensordifferenz-Prüfung: Warnung wenn mehrere Sensoren stark abweichen.
     */
    checkSensorDisagreement(
        groupId: string,
        sensorName: string,
        values: number[],
        maxDifference: number
    ): void {
        if (values.length < 2) return;
        const min = Math.min(...values);
        const max = Math.max(...values);
        if (max - min > maxDifference) {
            this.alarmService.raise(
                ALARM_CODES.SENSOR_DISAGREEMENT,
                groupId,
                sensorName,
                'warning',
                `${sensorName}: Sensoren weichen um ${(max - min).toFixed(1)} ab (Max. ${maxDifference})`
            );
        } else {
            this.alarmService.clear(ALARM_CODES.SENSOR_DISAGREEMENT, groupId, sensorName);
        }
    }

    /**
     * Prüft ob ein Sensor zu lange unverändert ist.
     */
    checkSensorFrozen(
        groupId: string,
        sensor: SensorState,
        sensorName: string
    ): void {
        if (sensor.unchanged) {
            this.alarmService.raise(
                ALARM_CODES.SENSOR_STALE,
                groupId,
                sensor.id,
                'warning',
                `${sensorName}: Wert seit langer Zeit unverändert (lc: ${new Date(sensor.lastLc).toLocaleTimeString()})`
            );
        } else {
            this.alarmService.clear(ALARM_CODES.SENSOR_STALE, groupId, sensor.id);
        }
    }

    /**
     * Erzeugt einen Klartextbericht über den Zustand eines Aktors.
     */
    buildActuatorDiagnosticText(
        actuatorConfig: GroupConfig['actuators'][0],
        state: ActuatorState
    ): string[] {
        const lines: string[] = [];
        lines.push(`${actuatorConfig.name}`);

        if (actuatorConfig.feedbackStateId) {
            if (state.feedback !== null) {
                lines.push(`✓ Rückmeldung: ${state.feedback}`);
            } else {
                lines.push(`✗ Rückmeldung: nicht erhalten`);
            }
        } else {
            lines.push(`○ Kein Rückmelde-State konfiguriert`);
        }

        if (actuatorConfig.powerStateId) {
            if (state.power !== null) {
                lines.push(`✓ Leistung: ${state.power} W`);
            } else {
                lines.push(`✗ Leistung: nicht verfügbar`);
            }
        }

        lines.push(`Status: ${state.health}`);

        if (state.effectCheck) {
            const symbols: Record<string, string> = {
                confirmed: '✓',
                weak: '!',
                notDetectable: '✗',
                opposite: '✗✗',
                disturbanceActive: '⚠',
            };
            lines.push(`${symbols[state.effectCheck] ?? '?'} Wirkung: ${state.effectCheck}`);
        }

        return lines;
    }
}
