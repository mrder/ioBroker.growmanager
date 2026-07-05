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

// ---- Geteilte Aktoren: Teilnehmer-Konfiguration ------------

export interface SharedParticipant {
    groupId: string;           // ID der teilnehmenden Gruppe
    influenceFactor: number;   // 0-100: wie stark diese Gruppe betroffen ist (100 = voll, 30 = teilweise)
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

// Was ein Aktor primär regelt (pro Aktor konfigurierbar)
export type ControlTarget =
    | 'temperature'   // Heizung, Kühlung, Abluft für Temperatur
    | 'humidity'      // Befeuchter, Entfeuchter
    | 'vpd'           // VPD-koordinierte Regelung (Temp + Feuchte zusammen)
    | 'co2'           // CO₂-Ventil
    | 'soilMoisture'  // Bewässerungspumpe
    | 'light'         // Lichtsteuerung (Zeitplan)
    | 'timer'         // Immer EIN (Umluft etc.)
    | 'custom';       // Benutzerdefiniert

// Wirkrichtung: hebt an (up), senkt ab (down), oder beides
export type ControlDirection = 'up' | 'down' | 'both';

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
    sharedVotingMode?: 'any' | 'majority' | 'primary';
    sharedParticipants?: SharedParticipant[];
    sharedVoteHysteresisSeconds?: number; // Standard: 60
    enabled: boolean;
    // Optional device-health companion state
    healthStateId?: string;
    healthCheckType?: 'boolean' | 'number';
    healthCheckMin?: number;
    // Per-Aktor Regelziel (überschreibt die Typ-Ableitung)
    controlTarget?: ControlTarget;
    controlDirection?: ControlDirection;
    // Außenluft-Guard: Aktor nur schalten wenn Außenluft günstiger als Innenluft
    outdoorGuardEnabled?: boolean;
    // Per-Aktor Schaltschwelle: Mindestabweichung vom Sollwert vor EIN-/AUS-Schaltung
    // (°C für Temp-Aktoren, % für Feuchte-Aktoren, kPa für VPD-Aktoren; 0 = Profil-Toleranz)
    actuatorHysteresis?: number;
    // Stufenregelung: 1 = primär (Lüftung), 2 = Eskalation (Klimagerät/Heizung)
    // Stufe 2 schaltet erst wenn Stufe 1 seit escalationDelayMinutes läuft und Ziel noch nicht erreicht.
    escalationStage?: 1 | 2;
    escalationDelayMinutes?: number; // Standard: 10 min
    // Umluft-Betriebsart (nur für circulationFan)
    circulationMode?: 'windSimulator' | 'schedule' | 'alwaysOn';
    windSimulator?: WindSimulatorConfig;
    circulationSchedule?: CirculationScheduleWindow[];
}

// ---- Umluft-Windsimulator ----------------------------------

export interface WindSimulatorConfig {
    minOnSeconds: number;    // min. EIN-Dauer in Sekunden
    maxOnSeconds: number;    // max. EIN-Dauer in Sekunden
    minOffSeconds: number;   // min. AUS-Dauer in Sekunden
    maxOffSeconds: number;   // max. AUS-Dauer in Sekunden
}

export interface CirculationScheduleWindow {
    startHH: number;
    startMM: number;
    endHH: number;
    endMM: number;
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
    // Optionale Sollwerte für weitere Regelgrößen
    co2Target?: number;
    co2Tolerance?: number;
    soilMoistureTarget?: number;
    soilMoistureTolerance?: number;
}

// ---- Außenluft-Vergleichssensor ----------------------------

export interface OutdoorSensorConfig {
    enabled: boolean;
    tempStateId?: string;         // ioBroker State-ID für Außentemperatur
    humidityStateId?: string;     // ioBroker State-ID für Außenfeuchte
    // Mindest-Vorteil: Außenluft muss mindestens X °C kühler sein → sonst Lüfter sperren
    minTempDeltaCelsius: number;  // default 2
    // Außenfeuchte darf maximal X % höher sein als Innenfeuchte → sonst Feuchte-Lüftung sperren
    maxHumidityDeltaPercent: number; // default 10
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
    outdoorSensor?: OutdoorSensorConfig;
}

// ---- Push-Benachrichtigungen -------------------------------

export type NotificationChannelType = 'telegram' | 'whatsapp' | 'discord' | 'signal';

export interface NotificationChannel {
    id: string;
    type: NotificationChannelType;
    enabled: boolean;
    // Telegram (telegram adapter)
    telegramInstance?: string;    // z.B. "0" für telegram.0
    telegramChatId?: string;      // optional: bestimmter Chat/User; leer = Broadcast
    // WhatsApp (whatsapp-cmb adapter)
    whatsappInstance?: string;
    whatsappPhone?: string;       // E.164-Format, z.B. +491234567890
    // Discord (Webhook-URL)
    discordWebhookUrl?: string;
    // Signal (signal-cmb adapter)
    signalInstance?: string;
    signalPhone?: string;
    // Filter
    minSeverity: 'info' | 'warning' | 'fault' | 'critical';
    quietHoursEnabled: boolean;
    quietHoursStart: number;      // 0–23
    quietHoursEnd: number;        // 0–23
}

export interface NotificationConfig {
    enabled: boolean;
    channels: NotificationChannel[];
    cooldownMinutes: number;      // Gleicher Alarm wird frühestens nach N Minuten erneut gesendet
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
    dashboardPin: string;
    groups: GroupConfig[];
    climateProfiles: ClimateProfile[];
    alarmChannels: AlarmChannel[];
    notifications?: NotificationConfig;
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
    /** Manuell gesperrt durch Dashboard-Override — blockiert Auto-Zyklus */
    manualLock: boolean;
    health: 'ok' | 'noFeedback' | 'noPower' | 'stuckOn' | 'stuckOff' | 'noEffect' | 'unknown' | 'unreachable';
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
