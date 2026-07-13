export interface DashboardActuatorState {
    id: string;
    name: string;
    type: string;
    command: boolean | number | null;
    effectiveState: boolean | number | string | null;
    feedback: boolean | number | string | null;
    health: string;
    sharedVotingMode?: string;
    sharedParticipants?: Array<{
        groupId: string;
        influenceFactor: number;
    }>;
    votes?: Array<{
        groupId: string;
        groupName?: string;
        wantsOn: boolean;
        weight: number;
        urgency: number;
        reason: string;
    }>;
    sharedFromGroupId?: string;
    sharedFromGroupName?: string;
    influenceFactor?: number;
    manualLock?: boolean;
    blocked?: boolean;
    blockReason?: string;
    blockSecondsLeft?: number;
    blockUntil?: number;
    windSimIsOn?: boolean;
    windSimNextChangeAt?: number;
    power?: number | null;
    ratedPowerW?: number;
}
export interface DashboardAlarm {
    id: string;
    code: string;
    severity: string;
    message: string;
    since: number;
}
export interface DashboardGroupState {
    id: string;
    name: string;
    color: string;
    phase: string;
    mode: string;
    health: string;
    temperature: number | null;
    humidity: number | null;
    vpd: number | null;
    soilMoisture: number | null;
    soilSensors: Array<{
        id: string;
        name: string;
        value: number | null;
    }>;
    co2: number | null;
    leafTemperature: number | null;
    leafSensors: Array<{
        id: string;
        name: string;
        value: number | null;
    }>;
    sensorDetails: Array<{
        id: string;
        name: string;
        type: string;
        quality: number;
        valid: boolean;
        stale: boolean;
        error?: string;
    }>;
    isDay: boolean;
    dayNight: string;
    sensorQuality: number;
    actuators: DashboardActuatorState[];
    alarms: DashboardAlarm[];
    lastDecision: string;
    irrigationRunning: boolean;
    setpointTemp: number | null;
    setpointHumidity: number | null;
    setpointVpdMin: number | null;
    setpointVpdMax: number | null;
    setpointSoilMoistureTarget: number | null;
    setpointSoilMoistureTolerance: number | null;
    setpointCo2Target: number | null;
    setpointCo2Tolerance: number | null;
    monitorSensors: string[];
    cameraUrl: string | null;
    manualOverrides: Record<string, {
        command: boolean | number;
        until: number;
    }>;
    runtimeMode: string;
    outdoorTemp: number | null;
    outdoorHumidity: number | null;
}
export interface DashboardState {
    ts: number;
    adapterVersion: string;
    health: string;
    activeAlarms: number;
    groups: DashboardGroupState[];
}
export type ControlCommand = {
    groupId: string;
    actuatorId: string;
    command: boolean | number;
    durationMinutes: number;
};
export type ModeCommand = {
    groupId: string;
    mode: string;
};
export interface StrainEntry {
    id: string;
    name: string;
    type: 'sativa' | 'indica' | 'hybrid';
    sativaPercent: number;
    growWeeks: number;
    bloomWeeks: number;
    yieldGramsPerM2?: number;
    height: 'klein' | 'mittel' | 'groß' | 'sehr groß';
    tempDayMin: number;
    tempDayMax: number;
    tempNightMin: number;
    tempNightMax: number;
    humidityVeg: number;
    humidityBloom: number;
    vpdMin: number;
    vpdMax: number;
    aroma: string[];
    effect: string[];
    thcPercent?: number;
    cbdPercent?: number;
    difficulty: 'einfach' | 'mittel' | 'schwer';
    breeder?: string;
    notes?: string;
    createdAt: number;
    updatedAt: number;
}
export interface AnalysisEntry {
    id: number;
    groupId: string;
    groupName: string;
    ts: number;
    data: unknown;
    starred: boolean;
}
export declare class WebDashboardService {
    private readonly log;
    private readonly adapterDir;
    private server;
    private readonly sseClients;
    private state;
    private dashboardHtml;
    private pin;
    private controlCallback;
    private modeCallback;
    private trendsCallback;
    private databaseCallback;
    private lifestyleGetCallback;
    private lifestyleSetCallback;
    private strainsGetCallback;
    private strainsSetCallback;
    private analysesGetCallback;
    private analysesSetCallback;
    private plantIdApiKey;
    private strainsFilePath;
    constructor(log: {
        info: (m: string) => void;
        warn: (m: string) => void;
        error: (m: string) => void;
    }, adapterDir: string);
    setPin(pin: string): void;
    setPlantIdApiKey(key: string): void;
    setControlCallback(cb: (cmd: ControlCommand) => Promise<void>): void;
    setModeCallback(cb: (cmd: ModeCommand) => Promise<void>): void;
    setTrendsCallback(cb: (groupId: string, variable: string) => Promise<{
        points: Array<{
            ts: number;
            value: number;
        }>;
        hint?: string;
    }>): void;
    setDatabaseCallback(cb: (groupId: string, type: 'stats' | 'energy' | 'irrigation') => unknown): void;
    setLifestyleCallbacks(get: (groupId: string) => Promise<unknown>, set: (groupId: string, data: unknown) => Promise<void>): void;
    setStrainsCallbacks(get: () => Promise<StrainEntry[]>, set: (s: StrainEntry[]) => Promise<void>): void;
    setAnalysesCallbacks(get: (groupId: string) => Promise<AnalysisEntry[]>, set: (groupId: string, analyses: AnalysisEntry[]) => Promise<void>): void;
    start(port: number, bindAddress: string): void;
    private loadStrains;
    private saveStrains;
    private handleStrains;
    stop(): void;
    updateState(state: DashboardState): void;
    private handleRequest;
    private handlePlantAnalysis;
    private handleMode;
    private handleControl;
}
//# sourceMappingURL=WebDashboardService.d.ts.map