"use strict";
// ============================================================
// GrowManager – WebDashboardService
// Interner HTTP-Server für das Live-Dashboard (Port 8097).
// Stellt JSON-Snapshot (/api/state) und SSE-Stream (/api/events) bereit.
// ============================================================
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebDashboardService = void 0;
const http = __importStar(require("http"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class WebDashboardService {
    constructor(log, adapterDir) {
        this.log = log;
        this.adapterDir = adapterDir;
        this.server = null;
        this.sseClients = new Set();
        this.state = {
            ts: Date.now(),
            adapterVersion: '0.1.0',
            health: 'starting',
            activeAlarms: 0,
            groups: [],
        };
        this.dashboardHtml = '';
        this.pin = '';
        this.controlCallback = null;
    }
    setPin(pin) { this.pin = pin; }
    setControlCallback(cb) { this.controlCallback = cb; }
    start(port, bindAddress) {
        const htmlPath = path.join(this.adapterDir, 'admin', 'web', 'dashboard.html');
        try {
            this.dashboardHtml = fs.readFileSync(htmlPath, 'utf-8');
        }
        catch {
            this.log.warn(`WebDashboard: HTML nicht gefunden unter ${htmlPath}`);
            this.dashboardHtml = '<html><body><p>dashboard.html nicht gefunden.</p></body></html>';
        }
        this.server = http.createServer((req, res) => this.handleRequest(req, res));
        this.server.on('error', err => this.log.error(`WebDashboard: ${err.message}`));
        this.server.listen(port, bindAddress, () => {
            this.log.info(`GrowManager Dashboard erreichbar unter http://${bindAddress}:${port}/`);
        });
    }
    stop() {
        for (const client of this.sseClients) {
            try {
                client.end();
            }
            catch { /* ignore */ }
        }
        this.sseClients.clear();
        this.server?.close();
        this.server = null;
    }
    updateState(state) {
        this.state = state;
        if (this.sseClients.size > 0) {
            const data = `data: ${JSON.stringify(state)}\n\n`;
            for (const client of this.sseClients) {
                try {
                    client.write(data);
                }
                catch {
                    this.sseClients.delete(client);
                }
            }
        }
    }
    handleRequest(req, res) {
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
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
    }
    handleControl(req, res) {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const payload = JSON.parse(body);
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
            }
            catch (e) {
                this.log.error(`WebDashboard Control-Fehler: ${e}`);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: String(e) }));
            }
        });
    }
}
exports.WebDashboardService = WebDashboardService;
//# sourceMappingURL=WebDashboardService.js.map