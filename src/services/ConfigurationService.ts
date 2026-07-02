// ============================================================
// GrowManager – ConfigurationService
// Validierung, Import/Export und Migration
// ============================================================

import type { GrowManagerConfig, GroupConfig, ClimateProfile, SensorConfig, ActuatorConfig } from '../models/config';
import type { ILogger } from '../utils/logger';

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

export class ConfigurationService {
    constructor(private readonly log: ILogger) {}

    /**
     * Validiert die Gesamtkonfiguration.
     */
    validate(config: GrowManagerConfig): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!config.groups || !Array.isArray(config.groups)) {
            errors.push('groups fehlt oder ist kein Array');
        } else {
            const ids = new Set<string>();
            for (const g of config.groups) {
                if (!g.id) errors.push('Gruppe ohne ID gefunden');
                if (!g.name) errors.push(`Gruppe ${g.id}: Name fehlt`);
                if (ids.has(g.id)) errors.push(`Doppelte Gruppen-ID: ${g.id}`);
                ids.add(g.id);

                const gErrors = this.validateGroup(g, config.climateProfiles ?? []);
                errors.push(...gErrors.errors);
                warnings.push(...gErrors.warnings);
            }
        }

        if (config.controlCycleSeconds < 1) {
            errors.push('controlCycleSeconds muss ≥ 1 sein');
        }
        if (config.webPort < 1 || config.webPort > 65535) {
            errors.push(`Ungültiger Web-Port: ${config.webPort}`);
        }

        return { valid: errors.length === 0, errors, warnings };
    }

    private validateGroup(group: GroupConfig, profiles: ClimateProfile[]): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];
        const pfx = `Gruppe "${group.name}"`;

        if (group.profileId && !profiles.find(p => p.id === group.profileId)) {
            warnings.push(`${pfx}: Profil "${group.profileId}" nicht gefunden`);
        }

        const sensorIds = new Set<string>();
        for (const s of group.sensors ?? []) {
            if (!s.stateId) errors.push(`${pfx} Sensor ${s.id}: stateId fehlt`);
            if (sensorIds.has(s.id)) errors.push(`${pfx}: Doppelte Sensor-ID: ${s.id}`);
            sensorIds.add(s.id);
            errors.push(...this.validateSensor(s, pfx).errors);
        }

        const actuatorIds = new Set<string>();
        for (const a of group.actuators ?? []) {
            if (!a.commandStateId) errors.push(`${pfx} Aktor ${a.id}: commandStateId fehlt`);
            if (actuatorIds.has(a.id)) errors.push(`${pfx}: Doppelte Aktor-ID: ${a.id}`);
            actuatorIds.add(a.id);

            // Verriegelungs-IDs prüfen
            for (const lockId of a.interlockIds ?? []) {
                if (!actuatorIds.has(lockId) && !group.actuators.find(x => x.id === lockId)) {
                    warnings.push(`${pfx} Aktor "${a.name}": Verriegelungs-ID "${lockId}" nicht gefunden`);
                }
            }
        }

        // Lichtzeitplan plausibel?
        const s = group.schedule?.lightOn;
        if (s) {
            if (s.startHH === s.endHH && s.startMM === s.endMM) {
                warnings.push(`${pfx}: Licht-Ein und Licht-Aus zur gleichen Zeit`);
            }
        }

        return { valid: errors.length === 0, errors, warnings };
    }

    private validateSensor(sensor: SensorConfig, pfx: string): ValidationResult {
        const errors: string[] = [];
        if (sensor.validMin >= sensor.validMax) {
            errors.push(`${pfx} Sensor "${sensor.name}": validMin ≥ validMax`);
        }
        if (sensor.staleAfterSeconds < 30) {
            errors.push(`${pfx} Sensor "${sensor.name}": staleAfterSeconds sollte ≥ 30 sein`);
        }
        return { valid: errors.length === 0, errors, warnings: [] };
    }

    /**
     * Exportiert die Konfiguration als JSON-String.
     */
    exportConfig(config: GrowManagerConfig): string {
        return JSON.stringify(config, null, 2);
    }

    /**
     * Importiert und validiert eine Konfiguration.
     */
    importConfig(json: string): { config: GrowManagerConfig | null; result: ValidationResult } {
        let parsed: unknown;
        try {
            parsed = JSON.parse(json);
        } catch (e) {
            return {
                config: null,
                result: { valid: false, errors: [`JSON-Parsefehler: ${e}`], warnings: [] },
            };
        }

        if (!parsed || typeof parsed !== 'object') {
            return {
                config: null,
                result: { valid: false, errors: ['Kein gültiges Objekt in der JSON-Datei'], warnings: [] },
            };
        }

        const config = parsed as GrowManagerConfig;
        const result = this.validate(config);

        return { config: result.valid ? config : null, result };
    }

    /**
     * Migrationsfunktion für zukünftige Konfigurationsversionen.
     */
    migrate(raw: Partial<GrowManagerConfig>): GrowManagerConfig {
        // Fehlende Felder mit Defaults auffüllen
        return {
            language: 'de',
            sampleInterval: 10,
            controlCycleSeconds: 10,
            maxConcurrentSwitches: 5,
            maintenanceMode: false,
            startBehavior: 'lastState',
            logLevel: 'info',
            eventRetentionDays: 30,
            webPort: 8097,
            webBindAddress: '127.0.0.1',
            webAuth: false,
            groups: [],
            climateProfiles: [],
            alarmChannels: [],
            ...raw,
        };
    }

    /**
     * Erstellt eine Beispielkonfiguration für erste Inbetriebnahme.
     */
    createExampleConfig(): GrowManagerConfig {
        const profile: ClimateProfile = {
            id: 'bloom-standard',
            name: 'Blüte Standard',
            phase: 'bloom',
            day: {
                temperature: 25.5,
                temperatureTolerance: 1.0,
                humidity: 55,
                humidityTolerance: 4,
                vpdMin: 1.1,
                vpdMax: 1.35,
                temperatureMin: 22,
                temperatureMax: 30,
                temperatureCritical: 33,
                humidityMin: 45,
                humidityMax: 70,
                humidityCritical: 78,
                condensationRiskMaxHumidity: 75,
            },
            night: {
                temperature: 21.5,
                temperatureTolerance: 1.0,
                humidity: 58,
                humidityTolerance: 4,
                vpdMin: 0.9,
                vpdMax: 1.15,
                temperatureMin: 18,
                temperatureMax: 26,
                temperatureCritical: 33,
                humidityMin: 50,
                humidityMax: 72,
                humidityCritical: 78,
                condensationRiskMaxHumidity: 75,
            },
            transitionMinutes: 30,
        };

        const group: GroupConfig = {
            id: 'tent-1',
            name: 'Zelt 1 – Blüte',
            description: 'Mein erstes Growzelt',
            color: '#4caf50',
            enabled: true,
            phase: 'bloom',
            mode: 'monitorOnly',
            schedule: {
                lightOn: { startHH: 6, startMM: 0, endHH: 18, endMM: 0 },
                transitionMinutes: 30,
            },
            sensors: [
                {
                    id: 'temp-1',
                    name: 'Temperatur DHT22',
                    stateId: 'zigbee.0.sensor_1.temperature',
                    type: 'temperature',
                    role: 'primary',
                    unit: '°C',
                    offset: 0,
                    multiplier: 1,
                    weight: 1,
                    validMin: 5,
                    validMax: 50,
                    staleAfterSeconds: 900,
                    unchangedAlarmSeconds: 3600,
                    minUpdateRateSeconds: 300,
                    smoothing: 'median',
                    outlierFilter: true,
                    errorBehavior: 'lockControl',
                    useForControl: true,
                    enabled: true,
                },
                {
                    id: 'hum-1',
                    name: 'Luftfeuchtigkeit DHT22',
                    stateId: 'zigbee.0.sensor_1.humidity',
                    type: 'humidity',
                    role: 'primary',
                    unit: '%',
                    offset: 0,
                    multiplier: 1,
                    weight: 1,
                    validMin: 0,
                    validMax: 100,
                    staleAfterSeconds: 900,
                    unchangedAlarmSeconds: 3600,
                    minUpdateRateSeconds: 300,
                    smoothing: 'median',
                    outlierFilter: false,
                    errorBehavior: 'lockControl',
                    useForControl: true,
                    enabled: true,
                },
            ],
            actuators: [
                {
                    id: 'light-1',
                    name: 'LED Hauptlicht',
                    type: 'light',
                    commandStateId: 'tasmota.0.light.POWER',
                    dataType: 'boolean',
                    onValue: true,
                    offValue: false,
                    supportsPercent: false,
                    feedbackStateId: 'tasmota.0.light.POWER',
                    powerStateId: 'tasmota.0.light.ENERGY_Power',
                    powerOnThreshold: 50,
                    speedOnThreshold: 0,
                    onDelaySeconds: 0,
                    offDelaySeconds: 0,
                    minimumOnSeconds: 0,
                    minimumOffSeconds: 0,
                    maximumOnSeconds: 86400,
                    maxSwitchesPerHour: 0,
                    coastDownSeconds: 0,
                    safeState: 'off',
                    feedbackMissingBehavior: 'warn',
                    manualOverride: false,
                    overrideDurationMinutes: 60,
                    invertLogic: false,
                    interlockIds: [],
                    shared: false,
                    enabled: true,
                },
                {
                    id: 'exhaust-1',
                    name: 'Abluftlüfter',
                    type: 'exhaustFan',
                    commandStateId: 'tasmota.0.fan.POWER',
                    dataType: 'boolean',
                    onValue: true,
                    offValue: false,
                    supportsPercent: false,
                    feedbackStateId: 'tasmota.0.fan.POWER',
                    powerStateId: 'tasmota.0.fan.ENERGY_Power',
                    powerOnThreshold: 8,
                    speedOnThreshold: 0,
                    onDelaySeconds: 0,
                    offDelaySeconds: 0,
                    minimumOnSeconds: 180,
                    minimumOffSeconds: 120,
                    maximumOnSeconds: 86400,
                    maxSwitchesPerHour: 20,
                    coastDownSeconds: 0,
                    safeState: 'off',
                    feedbackMissingBehavior: 'alarm',
                    manualOverride: false,
                    overrideDurationMinutes: 60,
                    invertLogic: false,
                    interlockIds: [],
                    shared: false,
                    enabled: true,
                },
            ],
            irrigationZones: [],
            cameras: [],
            profileId: 'bloom-standard',
            alarmProfileId: '',
            priority: 1,
            aggregationMethod: 'median',
            minValidSensors: 1,
            fallbackChain: ['vpd', 'temperature', 'schedule', 'monitorOnly'],
            stabilityTimeSeconds: 120,
            sensorDisagreementThreshold: 5,
        };

        return {
            language: 'de',
            sampleInterval: 10,
            controlCycleSeconds: 10,
            maxConcurrentSwitches: 5,
            maintenanceMode: false,
            startBehavior: 'monitorOnly',
            logLevel: 'info',
            eventRetentionDays: 30,
            webPort: 8097,
            webBindAddress: '127.0.0.1',
            webAuth: false,
            groups: [group],
            climateProfiles: [profile],
            alarmChannels: [],
        };
    }
}
