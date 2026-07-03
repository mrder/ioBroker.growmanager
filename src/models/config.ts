// ============================================================
// GrowManager – Konfigurationsmodell (vollständig typisiert)
// ============================================================

// ---- Sensor ------------------------------------------------

export type SensorType =
    | 'temperature'
    | 'humidity'
    | 'leafTemperature'
    | 'soilMoisture'
    | 'co2'
    | 'light'
    | 'tankLevel'
    | 'ph'
    | 'ec'
    | 'power'
    | 'door'
    | 'custom';

export type SensorRole =
    | 'primary'   // Hauptregelwert — wird zuerst verwendet
    | 'backup'    // Fallback wenn alle primary-Sensoren ausfallen
    | 'monitor';  // Nur Überwachung/Alarm, nie Regelgröße

export type AggregationMethod = 'median' | 'mean' | 'weightedMean' | 'min' | 'max';

export type SmoothingMethod = 'none' | 'movingAverage' | 'median' | 'exponential';

export type SensorErrorBehavior =
    | 'ignore'
    | 'switchToBackup'
    | 'lockControl'
    | 'activateSafeMode';

export interface SensorConfig {
    id: string;
    name: string;
    stateId: string;
    type: SensorType;
    role: SensorRole;
    unit: string;
    offset: number;
    multiplier: number;
    weight: number;
    validMin: number;
    validMax: number;
    staleAfterSeconds: number;
    unchangedAlarmSeconds: number;
    minUpdateRateSeconds: number;
    smoothing: SmoothingMethod;
    outlierFilter: boolean;
    errorBehavior: SensorErrorBehavior;
    useForControl: boolean;
    controlPriority: number;
    enabled: boolean;
    // Optional device-health companion state
    healthStateId?: string;
    healthCheckType?: 'boolean' | 'number';
    healthCheckMin?: number;
}

// ---- Aktor -------------------------------------------------

export type ActuatorType =
    | 'light'
    | 'circulationFan'
    | 'exhaustFan'
    | 'supplyFan'
    | 'heating'
    | 'cooling'
    | 'humidifier'
    | 'dehumidifier'
    | 'irrigation'
    | 'co2Valve'
    | 'damper'
    | 'custom';

export type ActuatorDataType = 'boolean' | 'number' | 'string';

export type ActuatorSafeState = 'off' | 'on' | 'keep' | 'minLevel';

export interface ActuatorConfig {
    id: string;
    name: string;
    type: ActuatorType;
    commandStateId: string;
    dataType: ActuatorDataType;
    onValue: boolean | number | string;
    offValue: boolean | number | string;
    // Optional percentage range (0-100)
    supportsPercent: boolean;
    feedbackStateId?: string;
    powerStateId?: string;
    speedStateId?: string;
    powerOnThreshold: number;
    speedOnThreshold: number;
    onDelaySeconds: number;
    offDelaySeconds: number;
    minimumOnSeconds: number;
    minimumOffSeconds: number;
    maximumOnSeconds: number;
    maxSwitchesPerHour: number;
    coastDownSeconds: number;
    safeState: ActuatorSafeState;
    feedbackMissingBehavior: 'warn' | 'alarm' | 'disable';
    manualOverride: boolean;
    overrideDurationMinutes: number;
    invertLogic: boolean;
    interlockIds: string[];
    shared: boolean;
    enabled: boolean;
    // Optional device-health companion state
    healthStateId?: string;
    healthCheckType?: 'boolean' | 'number';
    healthCheckMin?: number;
}

// ---- Zeitplan ----------------------------------------------

export interface TimeWindow {
    startHH: number;
    startMM: number;
    endHH: number;
    endMM: number;
}

export interface DaySchedule {
    lightOn: TimeWindow;
    transitionMinutes: number;
}

// ---- Profil ------------------------------------------------

export interface ClimateSetpoint {
    temperature: number;
    temperatureTolerance: number;
    humidity: number;
    humidityTolerance: number;
    vpdMin: number;
    vpdMax: number;
    temperatureMin: number;
    temperatureMax: number;
    temperatureCritical: number;
    humidityMin: number;
    humidityMax: number;
    humidityCritical: number;
    condensationRiskMaxHumidity: number;
}

export interface ClimateProfile {
    id: string;
    name: string;
    phase: PlantPhase;
    day: ClimateSetpoint;
    night: ClimateSetpoint;
    transitionMinutes: number;
}

// ---- Pflanzenphasen ----------------------------------------

export type PlantPhase =
    | 'seedling'
    | 'growth'
    | 'bloom'
    | 'drying'
    | 'custom';

// ---- Betriebsarten -----------------------------------------

export type GroupMode =
    | 'off'
    | 'manual'
    | 'schedule'
    | 'temperature'
    | 'humidity'
    | 'vpd'
    | 'combined'
    | 'monitorOnly'
    | 'maintenance';

// ---- Regler ------------------------------------------------

export type ControllerType =
    | 'off'
    | 'shadow'
    | 'twoPoint'
    | 'threePoint'
    | 'stepped'
    | 'timeProportional'
    | 'p'
    | 'pi'
    | 'pid'
    | 'custom';

export type SetpointSource =
    | 'fixed'
    | 'dayNightProfile'
    | 'schedule'
    | 'phase'
    | 'externalState';

export interface ControllerConfig {
    id: string;
    name: string;
    controlledVariable: 'temperature' | 'humidity' | 'vpd' | 'soilMoisture' | 'co2' | 'custom';
    controllerType: ControllerType;
    setpointSource: SetpointSource;
    fixedSetpoint?: number;
    externalSetpointStateId?: string;
    sampleTimeSeconds: number;
    minOutputChangeSeconds: number;
    deadband: number;
    hysteresis: number;
    outputMin: number;
    outputMax: number;
    maxOutputChangePerCycle: number;
    rampPerMinute: number;
    integratorMin: number;
    integratorMax: number;
    antiWindup: 'clamping' | 'backCalculation';
    // PID parameters
    kp: number;
    tiSeconds: number;
    tdSeconds: number;
    derivativeFilter: number;
    // Process model
    deadTimeSeconds: number;
    minimumResponseSeconds: number;
    expectedResponseSeconds: number;
    maximumResponseSeconds: number;
    settlingSeconds: number;
    minEffectThreshold: number;
    maxCounterEffect: number;
    failCountBeforeAlarm: number;
    successCountBeforeRestore: number;
    invalidInputBehavior: 'hold' | 'zero' | 'safeState';
}

// ---- Lüfterverbund -----------------------------------------

export type AirSystemMode =
    | 'exhaustOnly'
    | 'linked'
    | 'ratioCoupled'
    | 'curveCoupled'
    | 'independent';

export interface AirSystemConfig {
    id: string;
    mode: AirSystemMode;
    exhaustActuatorId: string;
    supplyActuatorId?: string;
    supplyToExhaustRatio: number;
    ratioPoints: Array<{ exhaust: number; supply: number }>;
    minimumExhaustPercentDay: number;
    minimumExhaustPercentNight: number;
    maximumExhaustPercent: number;
    startupBoostPercent: number;
    startupBoostSeconds: number;
    supplyLeadSeconds: number;
    exhaustCoastSeconds: number;
    supplyMinSpeed: number;
    exhaustMinSpeed: number;
}

// ---- Kamera ------------------------------------------------

export type CameraSourceType =
    | 'iobState'
    | 'snapshotUrl'
    | 'localPath'
    | 'manualUpload';

export type CameraAnalysisMode =
    | 'off'
    | 'timelapse'
    | 'localBasic'
    | 'localAI'
    | 'externalAI';

export interface CameraConfig {
    id: string;
    name: string;
    enabled: boolean;
    sourceType: CameraSourceType;
    sourceId: string;
    captureIntervalMinutes: number;
    captureOnlyWhenLightOn: boolean;
    delayAfterLightOnMinutes: number;
    retentionDays: number;
    maxStorageMB: number;
    analysisMode: CameraAnalysisMode;
    aiAnalysisIntervalHours: number;
    minimumConfidence: number;
    cpuLimitPercent: number;
}

// ---- Bewässerung -------------------------------------------

export interface IrrigationZoneConfig {
    id: string;
    name: string;
    enabled: boolean;
    moistureSensorIds: string[];
    startMoisture: number;
    targetMoisture: number;
    maxRunSeconds: number;
    minPauseMinutes: number;
    allowedWindow?: TimeWindow;
    pumpActuatorId: string;
    powerStateId?: string;
    flowStateId?: string;
    dryRunProtection: boolean;
    leakageAlarmSeconds: number;
}

// ---- Alarmkanal --------------------------------------------

export interface AlarmChannel {
    id: string;
    name: string;
    enabled: boolean;
    targetStateId?: string;
    sendToAdapter?: string;
    sendToInstance?: string;
    minSeverity: 'info' | 'warning' | 'fault' | 'critical';
    quietHours?: TimeWindow;
    retentionDays: number;
}

// ---- Gruppe ------------------------------------------------

export interface GroupConfig {
    id: string;
    name: string;
    description: string;
    color: string;
    enabled: boolean;
    phase: PlantPhase;
    mode: GroupMode;
    schedule: DaySchedule;
    sensors: SensorConfig[];
    actuators: ActuatorConfig[];
    airSystem?: AirSystemConfig;
    irrigationZones: IrrigationZoneConfig[];
    cameras: CameraConfig[];
    profileId: string;
    alarmProfileId: string;
    priority: number;
    location?: string;
    aggregationMethod: AggregationMethod;
    minValidSensors: number;
    fallbackChain: GroupMode[];
    stabilityTimeSeconds: number;
    sensorDisagreementThreshold: number;
}

// ---- Globale Konfiguration ---------------------------------

export type StartBehavior = 'lastState' | 'delayedStart' | 'safeTurnOff' | 'monitorOnly';

export interface GrowManagerConfig {
    language: 'de' | 'en';
    sampleInterval: number;
    controlCycleSeconds: number;
    maxConcurrentSwitches: number;
    maintenanceMode: boolean;
    startBehavior: StartBehavior;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    eventRetentionDays: number;
    webPort: number;
    webBindAddress: string;
    webAuth: boolean;
    groups: GroupConfig[];
    climateProfiles: ClimateProfile[];
    alarmChannels: AlarmChannel[];
}

// ---- Laufzeitzustände (nicht persistent) -------------------

export type DegradationLevel =
    | 'FULL'
    | 'LIMITED'
    | 'FALLBACK'
    | 'MONITOR_ONLY'
    | 'SAFE'
    | 'FAULT';

export type DayNight = 'day' | 'night' | 'transition';

export type EffectCheckResult =
    | 'confirmed'
    | 'weak'
    | 'notDetectable'
    | 'opposite'
    | 'disturbanceActive';

export interface SensorState {
    id: string;
    rawValue: number | boolean | string | null;
    processedValue: number | boolean | string | null;
    valid: boolean;
    quality: number;
    stale: boolean;
    unchanged: boolean;
    lastTs: number;
    lastLc: number;
    error?: string;
}

export interface ActuatorState {
    id: string;
    requested: boolean | number;
    feedback: boolean | number | null;
    power: number | null;
    effectiveState: boolean | number;
    blocked: boolean;
    blockedReason?: string;
    blockedUntil?: number;
    overrideActive: boolean;
    overrideUntil?: number;
    health: 'ok' | 'noFeedback' | 'noPower' | 'stuckOn' | 'stuckOff' | 'noEffect' | 'unknown';
    effectCheck?: EffectCheckResult;
    runTimeSeconds: number;
    switchCount: number;
    lastSwitchTs: number;
}

export interface GroupState {
    id: string;
    mode: GroupMode;
    degradation: DegradationLevel;
    degradationReason?: string;
    dayNight: DayNight;
    temperature: number | null;
    humidity: number | null;
    vpd: number | null;
    leafVpd: number | null;
    dewPoint: number | null;
    absoluteHumidity: number | null;
    condensationRisk: boolean;
    sensorQuality: number;
    activeProfile?: ClimateProfile;
    lastDecision?: ControlDecision;
    sensors: Map<string, SensorState>;
    actuators: Map<string, ActuatorState>;
    nextScheduleChange?: number;
    alarmActive: boolean;
    highestAlarmSeverity?: string;
}

export interface ControlAction {
    actuatorId: string;
    requested: boolean | number;
    reason: string;
    blocked: boolean;
    blockedReason?: string;
}

export interface ControlDecision {
    groupId: string;
    timestamp: number;
    mode: GroupMode;
    reason: string;
    dayNight: DayNight;
    temperature: number | null;
    humidity: number | null;
    vpd: number | null;
    actions: ControlAction[];
    degradation: DegradationLevel;
}

export interface AlarmRecord {
    id: string;
    code: string;
    groupId: string;
    source: string;
    severity: 'info' | 'warning' | 'fault' | 'critical';
    active: boolean;
    since: number;
    lastUpdate: number;
    message: string;
    acknowledged: boolean;
    repeatCount: number;
    clearedAt?: number;
}
