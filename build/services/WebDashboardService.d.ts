export interface DashboardActuatorState {
    id: string;
    name: string;
    type: string;
    command: boolean | number | null;
    effectiveState: boolean | number | string | null;
    feedback: boolean | number | string | null;
    health: string;
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
    setTrendsCallback(cb: (groupId: string, variable: string) => Array<{
        ts: number;
        value: number;
    }>): void;
    start(port: number, bindAddress: string): void;
    stop(): void;
    updateState(state: DashboardState): void;
    private handleRequest;
    private handleMode;
    private handleControl;
}
//# sourceMappingURL=WebDashboardService.d.ts.map