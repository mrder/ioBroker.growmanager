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
    constructor(log: {
        info: (m: string) => void;
        warn: (m: string) => void;
        error: (m: string) => void;
    }, adapterDir: string);
    setPin(pin: string): void;
    setControlCallback(cb: (cmd: ControlCommand) => Promise<void>): void;
    setModeCallback(cb: (cmd: ModeCommand) => Promise<void>): void;
    setTrendsCallback(cb: (groupId: string, variable: string) => Promise<{
        points: Array<{
            ts: number;
            value: number;
        }>;
        hint?: string;
    }>): void;
    start(port: number, bindAddress: string): void;
    stop(): void;
    updateState(state: DashboardState): void;
    private handleRequest;
    private handleMode;
    private handleControl;
}
//# sourceMappingURL=WebDashboardService.d.ts.map