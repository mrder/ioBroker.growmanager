// GrowManager config types – local copy for admin build
// (avoids importing outside admin/src/ which react-scripts blocks)

export type SensorType =
    | 'temperature' | 'humidity' | 'leafTemperature' | 'soilMoisture'
    | 'co2' | 'light' | 'tankLevel' | 'ph' | 'ec' | 'power' | 'door' | 'custom';

export type SensorRole = 'primary' | 'backup' | 'monitor';
export type AggregationMethod = 'median' | 'mean' | 'weightedMean' | 'min' | 'max';
export type SmoothingMethod = 'none' | 'movingAverage' | 'median' | 'exponential';
export type SensorErrorBehavior = 'ignore' | 'switchToBackup' | 'lockControl' | 'activateSafeMode';

export interface SensorConfig {
    id: string; name: string; stateId: string; type: SensorType; role: SensorRole;
    unit: string; offset: number; multiplier: number; weight: number;
    validMin: number; validMax: number; staleAfterSeconds: number;
    unchangedAlarmSeconds: number; minUpdateRateSeconds: number;
    smoothing: SmoothingMethod; outlierFilter: boolean;
    errorBehavior: SensorErrorBehavior; useForControl: boolean; controlPriority: number; enabled: boolean;
    healthStateId?: string; healthCheckType?: 'boolean' | 'number'; healthCheckMin?: number;
}

export type ActuatorType =
    | 'light' | 'circulationFan' | 'exhaustFan' | 'supplyFan' | 'heating'
    | 'cooling' | 'humidifier' | 'dehumidifier' | 'irrigation' | 'co2Valve' | 'damper' | 'custom';

export type ActuatorDataType = 'boolean' | 'number' | 'string';
export type ActuatorSafeState = 'off' | 'on' | 'keep' | 'minLevel';
export type ControlTarget = 'temperature' | 'humidity' | 'vpd' | 'co2' | 'soilMoisture' | 'light' | 'timer' | 'custom';
export type ControlDirection = 'up' | 'down' | 'both';

export interface SharedParticipant {
    groupId: string;
    influenceFactor: number; // 0-100
}

export interface ActuatorConfig {
    id: string; name: string; type: ActuatorType; commandStateId: string;
    dataType: ActuatorDataType; onValue: boolean | number | string;
    offValue: boolean | number | string; supportsPercent: boolean;
    feedbackStateId?: string; powerStateId?: string; speedStateId?: string;
    powerOnThreshold: number; speedOnThreshold: number;
    onDelaySeconds: number; offDelaySeconds: number;
    minimumOnSeconds: number; minimumOffSeconds: number; maximumOnSeconds: number;
    maxSwitchesPerHour: number; coastDownSeconds: number;
    safeState: ActuatorSafeState; feedbackMissingBehavior: 'warn' | 'alarm' | 'disable';
    manualOverride: boolean; overrideDurationMinutes: number;
    invertLogic: boolean; interlockIds: string[]; shared: boolean;
    sharedVotingMode?: 'any' | 'majority' | 'primary';
    sharedParticipants?: SharedParticipant[];
    sharedVoteHysteresisSeconds?: number;
    enabled: boolean;
    healthStateId?: string; healthCheckType?: 'boolean' | 'number'; healthCheckMin?: number;
    controlTarget?: ControlTarget;
    controlDirection?: ControlDirection;
    outdoorGuardEnabled?: boolean;
    actuatorHysteresis?: number;
}

export interface OutdoorSensorConfig {
    enabled: boolean;
    tempStateId?: string;
    humidityStateId?: string;
    minTempDeltaCelsius: number;
    maxHumidityDeltaPercent: number;
}

export interface TimeWindow { startHH: number; startMM: number; endHH: number; endMM: number; }
export interface DaySchedule { lightOn: TimeWindow; transitionMinutes: number; }

export interface ClimateSetpoint {
    temperature: number; temperatureTolerance: number; humidity: number; humidityTolerance: number;
    vpdMin: number; vpdMax: number; temperatureMin: number; temperatureMax: number;
    temperatureCritical: number; humidityMin: number; humidityMax: number; humidityCritical: number;
    condensationRiskMaxHumidity: number;
    co2Target?: number; co2Tolerance?: number;
    soilMoistureTarget?: number; soilMoistureTolerance?: number;
}

export type PlantPhase = 'seedling' | 'growth' | 'bloom' | 'drying' | 'custom';

export interface ClimateProfile {
    id: string; name: string; phase: PlantPhase;
    day: ClimateSetpoint; night: ClimateSetpoint; transitionMinutes: number;
}

export type GroupMode =
    | 'off' | 'manual' | 'schedule' | 'temperature' | 'humidity'
    | 'vpd' | 'combined' | 'monitorOnly' | 'maintenance';

export interface IrrigationZoneConfig {
    id: string; name: string; enabled: boolean;
    moistureSensorIds: string[]; startMoisture: number; targetMoisture: number;
    maxRunSeconds: number; minPauseMinutes: number; allowedWindow?: TimeWindow;
    pumpActuatorId: string; powerStateId?: string; flowStateId?: string;
    dryRunProtection: boolean; leakageAlarmSeconds: number;
}

export interface AlarmChannel {
    id: string; name: string; enabled: boolean;
    targetStateId?: string; sendToAdapter?: string; sendToInstance?: string;
    minSeverity: 'info' | 'warning' | 'fault' | 'critical';
    quietHours?: TimeWindow; retentionDays: number;
}

export type CameraSourceType = 'iobState' | 'snapshotUrl' | 'localPath' | 'manualUpload';
export type CameraAnalysisMode = 'off' | 'timelapse' | 'localBasic' | 'localAI' | 'externalAI';

export interface CameraConfig {
    id: string; name: string; enabled: boolean;
    sourceType: CameraSourceType; sourceId: string;
    captureIntervalMinutes: number; captureOnlyWhenLightOn: boolean;
    delayAfterLightOnMinutes: number; retentionDays: number;
    maxStorageMB: number; analysisMode: CameraAnalysisMode;
    aiAnalysisIntervalHours: number; minimumConfidence: number;
    cpuLimitPercent: number;
}

export interface GroupConfig {
    id: string; name: string; description: string; color: string; enabled: boolean;
    phase: PlantPhase; mode: GroupMode; schedule: DaySchedule;
    sensors: SensorConfig[]; actuators: ActuatorConfig[];
    irrigationZones: IrrigationZoneConfig[]; cameras: CameraConfig[];
    profileId: string; alarmProfileId: string; priority: number;
    aggregationMethod: AggregationMethod; minValidSensors: number;
    fallbackChain: GroupMode[]; stabilityTimeSeconds: number;
    sensorDisagreementThreshold: number;
    outdoorSensor?: OutdoorSensorConfig;
}

export type NotificationChannelType = 'telegram' | 'whatsapp' | 'discord' | 'signal';

export interface NotificationChannel {
    id: string;
    type: NotificationChannelType;
    enabled: boolean;
    telegramInstance?: string;
    telegramChatId?: string;
    whatsappInstance?: string;
    whatsappPhone?: string;
    discordWebhookUrl?: string;
    signalInstance?: string;
    signalPhone?: string;
    minSeverity: 'info' | 'warning' | 'fault' | 'critical';
    quietHoursEnabled: boolean;
    quietHoursStart: number;
    quietHoursEnd: number;
}

export interface NotificationConfig {
    enabled: boolean;
    channels: NotificationChannel[];
    cooldownMinutes: number;
}

export type StartBehavior = 'lastState' | 'delayedStart' | 'safeTurnOff' | 'monitorOnly';

export interface GrowManagerConfig {
    language: 'de' | 'en'; sampleInterval: number; controlCycleSeconds: number;
    maxConcurrentSwitches: number; maintenanceMode: boolean; startBehavior: StartBehavior;
    logLevel: 'debug' | 'info' | 'warn' | 'error'; eventRetentionDays: number;
    webPort: number; webBindAddress: string; webAuth: boolean; dashboardPin: string;
    groups: GroupConfig[]; climateProfiles: ClimateProfile[]; alarmChannels: AlarmChannel[];
    notifications?: NotificationConfig;
}
