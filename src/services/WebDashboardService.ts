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

    constructor(
        private readonly log: {
            info: (m: string) => void;
            warn: (m: string) => void;
            error: (m: string) => void;
        },
        private readonly adapterDir: string,
    ) {}

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
            // Sofort aktuellen Stand senden
            res.write(`data: ${JSON.stringify(this.state)}\n\n`);
            this.sseClients.add(res);
            req.on('close', () => this.sseClients.delete(res));
            return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
    }
}
