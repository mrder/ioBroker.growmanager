// ============================================================
// GrowManager – GroupCapabilityService
// Bestimmt zur Laufzeit, welche Regelarten für eine Gruppe
// möglich sind. Fehlende Sensoren/Aktoren führen zu
// kontrollierten Fallbacks, niemals zum Totalausfall.
// ============================================================

import type { GroupConfig, GroupMode, DegradationLevel } from '../models/config';
import type { SensorState } from '../models/config';

// Welche Fähigkeiten eine Gruppe aktuell besitzt
export interface GroupCapabilities {
    // Sensorik
    hasTemperature: boolean;
    hasHumidity: boolean;
    hasLeafTemperature: boolean;
    hasSoilMoisture: boolean;
    hasCO2: boolean;
    hasLight: boolean;
    // Abgeleitete Größen (erfordern Kombination)
    canCalculateVPD: boolean;
    canCalculateLeafVPD: boolean;
    canCalculateDewPoint: boolean;
    // Aktoren
    hasLight_actuator: boolean;
    hasExhaustFan: boolean;
    hasSupplyFan: boolean;
    hasCirculationFan: boolean;
    hasHeating: boolean;
    hasCooling: boolean;
    hasHumidifier: boolean;
    hasDehumidifier: boolean;
    hasIrrigation: boolean;
    hasCamera: boolean;
    // Feedback
    hasAnyFeedback: boolean;
    hasPowerFeedback: boolean;
    // Außen-/Zuluft
    hasOutsideSensor: boolean;
    // Bewässerungs-Feedback
    hasFlowSensor: boolean;
    hasMoistureSensor: boolean;
}

// Welche Betriebsmodi durch die aktuellen Fähigkeiten möglich sind
export interface CapabilityResult {
    capabilities: GroupCapabilities;
    availableModes: GroupMode[];
    recommendedMode: GroupMode;
    degradation: DegradationLevel;
    degradationReason: string;
    // Für jede Regelart: warum sie (nicht) verfügbar ist
    modeReasons: Partial<Record<GroupMode, string>>;
    // Fallback-Kette: von bevorzugt nach sicher
    fallbackChain: GroupMode[];
}

export class GroupCapabilityService {
    /**
     * Bewertet alle Fähigkeiten einer Gruppe zur Laufzeit.
     * Wird bei jedem Regelzyklus neu berechnet.
     */
    evaluate(
        config: GroupConfig,
        sensorStates: Map<string, SensorState>,
        temperature: number | null,
        humidity: number | null,
        leafTemperature: number | null,
        soilMoisture: number | null
    ): CapabilityResult {
        const caps = this.buildCapabilities(config, sensorStates, temperature, humidity, leafTemperature, soilMoisture);
        const availableModes = this.determineAvailableModes(caps, config);
        const modeReasons = this.buildModeReasons(caps, config);
        const { degradation, degradationReason } = this.computeDegradation(caps, config, temperature, humidity);
        const recommendedMode = this.selectBestMode(config, availableModes);
        const fallbackChain = this.buildFallbackChain(config, availableModes);

        return {
            capabilities: caps,
            availableModes,
            recommendedMode,
            degradation,
            degradationReason,
            modeReasons,
            fallbackChain,
        };
    }

    private buildCapabilities(
        config: GroupConfig,
        sensorStates: Map<string, SensorState>,
        temperature: number | null,
        humidity: number | null,
        leafTemperature: number | null,
        soilMoisture: number | null
    ): GroupCapabilities {
        // Sensorfähigkeiten anhand gültiger aggregierter Werte
        const hasTemperature = temperature !== null;
        const hasHumidity = humidity !== null;
        const hasLeafTemperature = leafTemperature !== null;
        const hasSoilMoisture = soilMoisture !== null;

        // CO2 / Licht aus Sensor-States
        const hasCO2 = this.hasSensorType(config, sensorStates, 'co2');
        const hasLight = this.hasSensorType(config, sensorStates, 'light');

        // Aktoren
        const actuatorTypes = config.actuators.filter(a => a.enabled).map(a => a.type);
        const hasAny = (t: string) => actuatorTypes.includes(t as typeof config.actuators[0]['type']);

        // Feedback
        const hasAnyFeedback = config.actuators.some(a => a.enabled && (a.feedbackStateId || a.powerStateId));
        const hasPowerFeedback = config.actuators.some(a => a.enabled && !!a.powerStateId);

        // Bewässerungs-Sensoren
        const hasFlowSensor = config.irrigationZones.some(z => z.enabled && !!z.flowStateId);
        const hasMoistureSensor = config.irrigationZones.some(z => z.enabled && z.moistureSensorIds.length > 0);

        return {
            hasTemperature,
            hasHumidity,
            hasLeafTemperature,
            hasSoilMoisture,
            hasCO2,
            hasLight,
            canCalculateVPD: hasTemperature && hasHumidity,
            canCalculateLeafVPD: hasTemperature && hasHumidity && hasLeafTemperature,
            canCalculateDewPoint: hasTemperature && hasHumidity,
            hasLight_actuator: hasAny('light'),
            hasExhaustFan: hasAny('exhaustFan'),
            hasSupplyFan: hasAny('supplyFan'),
            hasCirculationFan: hasAny('circulationFan'),
            hasHeating: hasAny('heating'),
            hasCooling: hasAny('cooling'),
            hasHumidifier: hasAny('humidifier'),
            hasDehumidifier: hasAny('dehumidifier'),
            hasIrrigation: hasAny('irrigation') || config.irrigationZones.some(z => z.enabled),
            hasCamera: config.cameras.some(c => c.enabled),
            hasAnyFeedback,
            hasPowerFeedback,
            hasOutsideSensor: false, // zukünftig: Außensensor-Zuordnung
            hasFlowSensor,
            hasMoistureSensor,
        };
    }

    private determineAvailableModes(caps: GroupCapabilities, config: GroupConfig): GroupMode[] {
        const modes: GroupMode[] = ['off', 'manual', 'monitorOnly'];

        // Zeitplan: braucht keinen Sensor, nur Aktoren
        if (config.actuators.some(a => a.enabled)) {
            modes.push('schedule');
        }

        // Wartung: immer
        modes.push('maintenance');

        // Temperaturregelung
        if (caps.hasTemperature && (caps.hasHeating || caps.hasCooling || caps.hasExhaustFan)) {
            modes.push('temperature');
        }

        // Feuchteregelung
        if (caps.hasHumidity && (caps.hasHumidifier || caps.hasDehumidifier || caps.hasExhaustFan)) {
            modes.push('humidity');
        }

        // VPD-Regelung
        if (caps.canCalculateVPD && (caps.hasHeating || caps.hasCooling || caps.hasHumidifier || caps.hasDehumidifier || caps.hasExhaustFan)) {
            modes.push('vpd');
        }

        // Kombiniert: braucht beides
        if (modes.includes('temperature') && modes.includes('humidity')) {
            modes.push('combined');
        }

        return modes;
    }

    private buildModeReasons(caps: GroupCapabilities, config: GroupConfig): Partial<Record<GroupMode, string>> {
        const reasons: Partial<Record<GroupMode, string>> = {};

        reasons['temperature'] = caps.hasTemperature
            ? (caps.hasHeating || caps.hasCooling || caps.hasExhaustFan)
                ? '✓ Temperatursensor + Regelaktor vorhanden'
                : '✗ Kein Heizungs-/Kühlungs-/Abluftaktor konfiguriert'
            : '✗ Kein gültiger Temperatursensor';

        reasons['humidity'] = caps.hasHumidity
            ? (caps.hasHumidifier || caps.hasDehumidifier || caps.hasExhaustFan)
                ? '✓ Feuchtesensor + Regelaktor vorhanden'
                : '✗ Kein Befeuchter-/Entfeuchter-/Abluftaktor konfiguriert'
            : '✗ Kein gültiger Feuchtesensor';

        reasons['vpd'] = caps.canCalculateVPD
            ? '✓ Temperatur + Feuchte vorhanden → VPD berechenbar'
            : !caps.hasTemperature
                ? '✗ Temperatursensor fehlt'
                : '✗ Feuchtesensor fehlt';

        reasons['schedule'] = config.actuators.some(a => a.enabled)
            ? '✓ Mindestens ein Aktor konfiguriert'
            : '✗ Keine Aktoren konfiguriert';

        reasons['monitorOnly'] = '✓ Immer verfügbar (keine Aktoren werden geschaltet)';

        return reasons;
    }

    private computeDegradation(
        caps: GroupCapabilities,
        config: GroupConfig,
        temperature: number | null,
        humidity: number | null
    ): { degradation: DegradationLevel; degradationReason: string } {
        // Keine Sensoren und keine Aktoren
        if (!caps.hasTemperature && !caps.hasHumidity && !config.actuators.some(a => a.enabled)) {
            return { degradation: 'FAULT', degradationReason: 'Keine Sensoren und Aktoren konfiguriert' };
        }

        // VPD gewünscht aber nicht möglich
        if (config.mode === 'vpd' && !caps.canCalculateVPD) {
            if (!caps.hasTemperature && !caps.hasHumidity) {
                return { degradation: 'FALLBACK', degradationReason: 'VPD nicht möglich: Temperatur- und Feuchtesensor fehlen' };
            }
            if (!caps.hasTemperature) {
                return { degradation: 'FALLBACK', degradationReason: 'VPD nicht möglich: Temperatursensor fehlt → Feuchteregelung' };
            }
            return { degradation: 'FALLBACK', degradationReason: 'VPD nicht möglich: Feuchtesensor fehlt → Temperaturregelung' };
        }

        // Teilweise Sensoren
        if ((config.mode === 'combined' || config.mode === 'vpd') && (!caps.hasTemperature || !caps.hasHumidity)) {
            return { degradation: 'LIMITED', degradationReason: 'Nur teilweise Sensorik verfügbar' };
        }

        // Kein Feedback verfügbar
        if (!caps.hasAnyFeedback && config.actuators.some(a => a.enabled)) {
            return { degradation: 'LIMITED', degradationReason: 'Kein Aktor-Feedback konfiguriert – Wirkungsprüfung eingeschränkt' };
        }

        return { degradation: 'FULL', degradationReason: '' };
    }

    private selectBestMode(config: GroupConfig, available: GroupMode[]): GroupMode {
        // Gewünschten Modus nutzen, wenn verfügbar
        if (available.includes(config.mode)) return config.mode;

        // Fallback-Kette aus Konfiguration
        for (const fb of config.fallbackChain) {
            if (available.includes(fb)) return fb;
        }

        // Letzter Ausweg
        return 'monitorOnly';
    }

    private buildFallbackChain(config: GroupConfig, available: GroupMode[]): GroupMode[] {
        const preferenceOrder: GroupMode[] = ['vpd', 'combined', 'temperature', 'humidity', 'schedule', 'monitorOnly'];
        return preferenceOrder.filter(m => available.includes(m));
    }

    private hasSensorType(
        config: GroupConfig,
        states: Map<string, SensorState>,
        type: string
    ): boolean {
        return config.sensors.some(s => {
            if (s.type !== type || !s.enabled) return false;
            const st = states.get(s.id);
            return st?.valid ?? false;
        });
    }

    /**
     * Erzeugt einen lesbaren Diagnosebericht über die Gruppe-Fähigkeiten.
     */
    buildCapabilityReport(result: CapabilityResult): string[] {
        const lines: string[] = [];
        const caps = result.capabilities;

        lines.push('── Sensorik ──────────────────────');
        lines.push(`${caps.hasTemperature ? '✓' : '○'} Temperatur`);
        lines.push(`${caps.hasHumidity ? '✓' : '○'} Luftfeuchtigkeit`);
        lines.push(`${caps.canCalculateVPD ? '✓' : '○'} VPD berechenbar`);
        lines.push(`${caps.hasLeafTemperature ? '✓' : '○'} Blatt-Temperatur`);
        lines.push(`${caps.canCalculateLeafVPD ? '✓' : '○'} Leaf-VPD berechenbar`);
        lines.push(`${caps.hasSoilMoisture ? '✓' : '○'} Bodenfeuchte`);
        lines.push(`${caps.hasCO2 ? '✓' : '○'} CO₂`);

        lines.push('── Aktoren ───────────────────────');
        lines.push(`${caps.hasLight_actuator ? '✓' : '○'} Licht`);
        lines.push(`${caps.hasExhaustFan ? '✓' : '○'} Abluft`);
        lines.push(`${caps.hasSupplyFan ? '✓' : '○'} Zuluft`);
        lines.push(`${caps.hasCirculationFan ? '✓' : '○'} Umluft`);
        lines.push(`${caps.hasHeating ? '✓' : '○'} Heizung`);
        lines.push(`${caps.hasCooling ? '✓' : '○'} Kühlung`);
        lines.push(`${caps.hasHumidifier ? '✓' : '○'} Befeuchter`);
        lines.push(`${caps.hasDehumidifier ? '✓' : '○'} Entfeuchter`);
        lines.push(`${caps.hasIrrigation ? '✓' : '○'} Bewässerung`);

        lines.push('── Feedback ──────────────────────');
        lines.push(`${caps.hasAnyFeedback ? '✓' : '○'} Rückmeldung (mindestens ein Aktor)`);
        lines.push(`${caps.hasPowerFeedback ? '✓' : '○'} Leistungsfeedback`);

        lines.push('── Verfügbare Modi ───────────────');
        lines.push(result.availableModes.join(', '));

        if (result.degradationReason) {
            lines.push('── Einschränkungen ───────────────');
            lines.push(`${result.degradation}: ${result.degradationReason}`);
        }

        return lines;
    }
}
