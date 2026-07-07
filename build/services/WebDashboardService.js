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
const https = __importStar(require("https"));
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
        this.modeCallback = null;
        this.trendsCallback = null;
        this.databaseCallback = null;
        this.lifestyleGetCallback = null;
        this.lifestyleSetCallback = null;
        this.plantIdApiKey = '';
    }
    setPin(pin) { this.pin = pin; }
    setPlantIdApiKey(key) { this.plantIdApiKey = key; }
    setControlCallback(cb) { this.controlCallback = cb; }
    setModeCallback(cb) { this.modeCallback = cb; }
    setTrendsCallback(cb) { this.trendsCallback = cb; }
    setDatabaseCallback(cb) { this.databaseCallback = cb; }
    setLifestyleCallbacks(get, set) { this.lifestyleGetCallback = get; this.lifestyleSetCallback = set; }
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
        if (url === '/api/mode' && req.method === 'POST') {
            this.handleMode(req, res);
            return;
        }
        const trendMatch = url.match(/^\/api\/trends\/([^/]+)\/(temperature|humidity|vpd|soilMoisture|co2)$/);
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
            }
            else {
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end('[]');
            }
            return;
        }
        const dbMatch = url.match(/^\/api\/database\/([^/]+)\/(stats|energy|irrigation)$/);
        if (dbMatch) {
            const cb = this.databaseCallback;
            const data = cb ? cb(dbMatch[1], dbMatch[2]) : [];
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify(data));
            return;
        }
        const lsMatch = url.match(/^\/api\/lifestyle\/([^/]+)$/);
        if (lsMatch) {
            if (req.method === 'GET') {
                const cb = this.lifestyleGetCallback;
                if (cb) {
                    cb(lsMatch[1])
                        .then(data => {
                        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                        res.end(JSON.stringify(data ?? {}));
                    })
                        .catch(() => {
                        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                        res.end('{}');
                    });
                }
                else {
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end('{}');
                }
                return;
            }
            if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => { body += chunk; if (body.length > 4096)
                    req.destroy(); });
                req.on('error', () => { });
                req.on('end', async () => {
                    try {
                        const data = JSON.parse(body);
                        const cb = this.lifestyleSetCallback;
                        if (cb)
                            await cb(lsMatch[1], data);
                        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                        res.end('{"ok":true}');
                    }
                    catch (e) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: String(e) }));
                    }
                });
                return;
            }
        }
        if (url === '/api/plant-analysis' && req.method === 'POST') {
            this.handlePlantAnalysis(req, res);
            return;
        }
        // Camera proxy: fetches image from local camera URL server-side, avoids browser CORS
        if (url === '/api/cam-proxy' && req.method === 'GET') {
            const rawUrl = new URL(req.url ?? '/', `http://localhost`).searchParams.get('url');
            if (!rawUrl) {
                res.writeHead(400);
                res.end('Missing url param');
                return;
            }
            try {
                const camUrl = new URL(decodeURIComponent(rawUrl));
                // Only allow http/https to prevent SSRF to internal services
                if (camUrl.protocol !== 'http:' && camUrl.protocol !== 'https:') {
                    res.writeHead(400);
                    res.end('Bad protocol');
                    return;
                }
                const lib = camUrl.protocol === 'https:' ? https : http;
                const proxyReq = lib.get(camUrl.toString(), proxyRes => {
                    if (res.headersSent) {
                        proxyRes.resume();
                        return;
                    }
                    const ct = proxyRes.headers['content-type'] ?? 'image/jpeg';
                    res.writeHead(proxyRes.statusCode ?? 200, {
                        'Content-Type': ct,
                        'Cache-Control': 'no-store',
                        'Access-Control-Allow-Origin': '*',
                    });
                    proxyRes.pipe(res);
                    proxyRes.on('error', () => { if (!res.writableEnded)
                        res.end(); });
                });
                proxyReq.setTimeout(8000, () => {
                    proxyReq.destroy();
                    if (!res.headersSent) {
                        res.writeHead(504);
                        res.end();
                    }
                    else if (!res.writableEnded) {
                        res.end();
                    }
                });
                proxyReq.on('error', () => {
                    if (!res.headersSent) {
                        res.writeHead(502);
                        res.end();
                    }
                    else if (!res.writableEnded) {
                        res.end();
                    }
                });
            }
            catch {
                res.writeHead(400);
                res.end('Invalid url');
            }
            return;
        }
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
    }
    handlePlantAnalysis(req, res) {
        if (!this.plantIdApiKey) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Kein Plant.id API-Key konfiguriert. Bitte in den globalen Einstellungen hinterlegen.' }));
            return;
        }
        let body = '';
        req.on('data', chunk => { body += chunk; if (body.length > 8 * 1024 * 1024)
            req.destroy(); });
        req.on('error', () => { });
        req.on('end', () => {
            let imageBase64;
            try {
                const parsed = JSON.parse(body);
                if (!parsed.image)
                    throw new Error('Kein Bild');
                // Base64-Daten-URL bereinigen
                imageBase64 = parsed.image.replace(/^data:image\/[a-z]+;base64,/, '');
            }
            catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `Ungültige Anfrage: ${e}` }));
                return;
            }
            const payload = JSON.stringify({
                images: [imageBase64],
                similar_images: true,
            });
            const options = {
                hostname: 'plant.id',
                path: '/api/v3/health_assessment',
                method: 'POST',
                headers: {
                    'Api-Key': this.plantIdApiKey,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                },
            };
            const plantReq = https.request(options, plantRes => {
                let data = '';
                plantRes.on('data', chunk => { data += chunk; });
                plantRes.on('end', () => {
                    res.writeHead(plantRes.statusCode ?? 200, {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                    });
                    res.end(data);
                });
            });
            plantReq.on('error', err => {
                this.log.error(`Plant.id API Fehler: ${err.message}`);
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `Plant.id nicht erreichbar: ${err.message}` }));
            });
            plantReq.write(payload);
            plantReq.end();
        });
    }
    handleMode(req, res) {
        let body = '';
        req.on('data', chunk => { body += chunk; if (body.length > 65536)
            req.destroy(); });
        req.on('error', () => { });
        req.on('end', async () => {
            try {
                const payload = JSON.parse(body);
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
            }
            catch (e) {
                this.log.error(`WebDashboard Mode-Fehler: ${e}`);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: String(e) }));
            }
        });
    }
    handleControl(req, res) {
        let body = '';
        req.on('data', chunk => { body += chunk; if (body.length > 65536)
            req.destroy(); });
        req.on('error', () => { });
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