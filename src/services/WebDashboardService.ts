// ============================================================
// GrowManager – WebDashboardService
// Interner HTTP-Server für das Live-Dashboard (Port 8097).
// Stellt JSON-Snapshot (/api/state) und SSE-Stream (/api/events) bereit.
// ============================================================

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

export interface DashboardActuatorState {
    id: string;
    name: string;
    type: string;
    command: boolean | number | null;
    effectiveState: boolean | number | string | null;
    feedback: boolean | number | string | null;
    health: string;
    sharedVotingMode?: string;
    sharedParticipants?: Array<{ groupId: string; influenceFactor: number }>;
    // Wird gesetzt wenn dieser Aktor in einer anderen Gruppe konfiguriert ist (Teilnehmer-Sicht)
    sharedFromGroupId?: string;
    sharedFromGroupName?: string;
    influenceFactor?: number;  // Einfluss dieser Gruppe auf den geteilten Aktor (0-100)
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
    soilSensors: Array<{ id: string; name: string; value: number | null }>;
    co2: number | null;
    leafTemperature: number | null;
    leafSensors: Array<{ id: string; name: string; value: number | null }>;
    sensorDetails: Array<{ id: string; name: string; type: string; quality: number; valid: boolean; stale: boolean; error?: string }>;
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
    manualOverrides: Record<string, { command: boolean | number; until: number }>;
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

export class WebDashboardService {
    private server: http.Server | null = null;
    private readonly sseClients = new Set<http.ServerResponse>();
    private state: DashboardState = {
        ts: Date.now(),
        adapterVersion: '0.1.0',
        health: 'starting',
        activeAlarms: 0,
        groups: [],
    };
    private dashboardHtml = '';
    private pin = '';
    private controlCallback: ((cmd: ControlCommand) => Promise<void>) | null = null;
    private modeCallback: ((cmd: ModeCommand) => Promise<void>) | null = null;
    private trendsCallback: ((groupId: string, variable: string) => Promise<{ points: Array<{ ts: number; value: number }>; hint?: string }>) | null = null;

    constructor(
        private readonly log: {
            info: (m: string) => void;
            warn: (m: string) => void;
            error: (m: string) => void;
        },
        private readonly adapterDir: string,
    ) {}

    setPin(pin: string): void { this.pin = pin; }
    setControlCallback(cb: (cmd: ControlCommand) => Promise<void>): void { this.controlCallback = cb; }
    setModeCallback(cb: (cmd: ModeCommand) => Promise<void>): void { this.modeCallback = cb; }
    setTrendsCallback(cb: (groupId: string, variable: string) => Promise<{ points: Array<{ ts: number; value: number }>; hint?: string }>): void { this.trendsCallback = cb; }

    start(port: number, bindAddress: string): void {
        const htmlPath = path.join(this.adapterDir, 'admin', 'web', 'dashboard.html');
        try {
            this.dashboardHtml = fs.readFileSync(htmlPath, 'utf-8');
        } catch {
            this.log.warn(`WebDashboard: HTML nicht gefunden unter ${htmlPath}`);
            this.dashboardHtml = '<html><body><p>dashboard.html nicht gefunden.</p></body></html>';
        }

        this.server = http.createServer((req, res) => this.handleRequest(req, res));
        this.server.on('error', err => this.log.error(`WebDashboard: ${err.message}`));
        this.server.listen(port, bindAddress, () => {
            this.log.info(`GrowManager Dashboard erreichbar unter http://${bindAddress}:${port}/`);
        });
    }

    stop(): void {
        for (const client of this.sseClients) {
            try { client.end(); } catch { /* ignore */ }
        }
        this.sseClients.clear();
        this.server?.close();
        this.server = null;
    }

    updateState(state: DashboardState): void {
        this.state = state;
        if (this.sseClients.size > 0) {
            const data = `data: ${JSON.stringify(state)}\n\n`;
            for (const client of this.sseClients) {
                try {
                    client.write(data);
                } catch {
                    this.sseClients.delete(client);
                }
            }
        }
    }

    private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
        const url = (req.url ?? '/').split('?')[0];

        // CORS für lokale Entwicklung
        res.setHeader('Access-Control-Allow-Origin', '*');

        if (url === '/' || url === '/index.html') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(this.dashboardHtml);
            return;
        }

        if (url === '/api/state') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(this.state));
            return;
        }

        if (url === '/api/events') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            });
            res.write(`data: ${JSON.stringify(this.state)}\n\n`);
            this.sseClients.add(res);
            req.on('close', () => this.sseClients.delete(res));
            return;
        }

        if (url === '/api/control' && req.method === 'POST') {
            this.handleControl(req, res);
            return;
        }

        if (url === '/api/mode' && req.method === 'POST') {
            this.handleMode(req, res);
            return;
        }

        const trendMatch = url.match(/^\/api\/trends\/([^/]+)\/(temperature|humidity|vpd)$/);
        if (trendMatch) {
            const cb = this.trendsCallback;
            if (cb) {
                cb(trendMatch[1], trendMatch[2])
                    .then(data => {
                        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                        res.end(JSON.stringify(data));
                    })
                    .catch(err => {
                        this.log.error(`Trend-Abfrage fehlgeschlagen: ${err}`);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end('[]');
                    });
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end('[]');
            }
            return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
    }

    private handleMode(req: http.IncomingMessage, res: http.ServerResponse): void {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const payload = JSON.parse(body) as { groupId: string; mode: string; pin?: string };

                if (this.pin && payload.pin !== this.pin) {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Falsche PIN' }));
                    return;
                }

                if (!this.modeCallback) {
                    res.writeHead(503, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Adapter nicht bereit' }));
                    return;
                }

                await this.modeCallback({ groupId: payload.groupId, mode: payload.mode });

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
            } catch (e) {
                this.log.error(`WebDashboard Mode-Fehler: ${e}`);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: String(e) }));
            }
        });
    }

    private handleControl(req: http.IncomingMessage, res: http.ServerResponse): void {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const payload = JSON.parse(body) as {
                    groupId: string; actuatorId: string;
                    command: boolean | number; durationMinutes?: number; pin?: string;
                };

                if (this.pin && payload.pin !== this.pin) {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Falsche PIN' }));
                    return;
                }

                if (!this.controlCallback) {
                    res.writeHead(503, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Adapter nicht bereit' }));
                    return;
                }

                await this.controlCallback({
                    groupId: payload.groupId,
                    actuatorId: payload.actuatorId,
                    command: payload.command,
                    durationMinutes: payload.durationMinutes ?? 60,
                });

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
            } catch (e) {
                this.log.error(`WebDashboard Control-Fehler: ${e}`);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: String(e) }));
            }
        });
    }
}
