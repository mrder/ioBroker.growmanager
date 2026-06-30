export interface DashboardActuatorState {
    id: string;
    name: string;
    type: string;
    command: boolean | number | null;
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
}
export interface DashboardState {
    ts: number;
    adapterVersion: string;
    health: string;
    activeAlarms: number;
    groups: DashboardGroupState[];
}
export declare class WebDashboardService {
    private readonly log;
    private readonly adapterDir;
    private server;
    private readonly sseClients;
    private state;
    private dashboardHtml;
    constructor(log: {
        info: (m: string) => void;
        warn: (m: string) => void;
        error: (m: string) => void;
    }, adapterDir: string);
    start(port: number, bindAddress: string): void;
    stop(): void;
    updateState(state: DashboardState): void;
    private handleRequest;
}
//# sourceMappingURL=WebDashboardService.d.ts.map