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
const DEFAULT_STRAINS = [
    {
        id: 'strain-dante-inferno',
        name: 'Dante Inferno',
        type: 'hybrid',
        sativaPercent: 50,
        growWeeks: 4,
        bloomWeeks: 9,
        yieldGramsPerM2: 450,
        height: 'mittel',
        tempDayMin: 22,
        tempDayMax: 28,
        tempNightMin: 18,
        tempNightMax: 22,
        humidityVeg: 65,
        humidityBloom: 50,
        vpdMin: 0.8,
        vpdMax: 1.4,
        aroma: ['tropisch', 'zitrus', 'süß', 'exotisch'],
        effect: ['euphorisch', 'entspannend', 'kreativ'],
        thcPercent: 22,
        cbdPercent: 0.5,
        difficulty: 'mittel',
        breeder: 'Unbekannt',
        notes: 'Intensive tropische Aromen, gute Indoor-Performer.',
        createdAt: Date.now(),
        updatedAt: Date.now(),
    },
    {
        id: 'strain-purple-punch',
        name: 'Purple Punch',
        type: 'indica',
        sativaPercent: 20,
        growWeeks: 4,
        bloomWeeks: 8,
        yieldGramsPerM2: 400,
        height: 'klein',
        tempDayMin: 20,
        tempDayMax: 26,
        tempNightMin: 17,
        tempNightMax: 21,
        humidityVeg: 60,
        humidityBloom: 45,
        vpdMin: 0.9,
        vpdMax: 1.3,
        aroma: ['traube', 'beere', 'süß', 'vanille'],
        effect: ['entspannend', 'schläfrig', 'glücklich'],
        thcPercent: 20,
        cbdPercent: 0.5,
        difficulty: 'einfach',
        breeder: 'Supernova Gardens',
        notes: 'Starke lila Färbung bei kühlen Nachttemperaturen (15-18°C). Kurze kompakte Pflanzen.',
        createdAt: Date.now(),
        updatedAt: Date.now(),
    },
    {
        id: 'strain-seriousa',
        name: 'Seriousa',
        type: 'hybrid',
        sativaPercent: 40,
        growWeeks: 5,
        bloomWeeks: 9,
        yieldGramsPerM2: 500,
        height: 'groß',
        tempDayMin: 22,
        tempDayMax: 28,
        tempNightMin: 18,
        tempNightMax: 23,
        humidityVeg: 65,
        humidityBloom: 50,
        vpdMin: 0.8,
        vpdMax: 1.5,
        aroma: ['erdig', 'kiefern', 'würzig', 'holzig'],
        effect: ['entspannend', 'euphorisch', 'fokussiert'],
        thcPercent: 18,
        cbdPercent: 1.0,
        difficulty: 'mittel',
        breeder: 'Serious Seeds',
        notes: 'Robuste Sorte mit gutem Ertrag. Gute Resistenz gegen Schimmel und Schädlinge.',
        createdAt: Date.now(),
        updatedAt: Date.now(),
    },
];
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
        this.strainsGetCallback = null;
        this.strainsSetCallback = null;
        this.analysesGetCallback = null;
        this.analysesSetCallback = null;
        this.plantIdApiKey = '';
        this.strainsFilePath = '';
    }
    setPin(pin) { this.pin = pin; }
    setPlantIdApiKey(key) { this.plantIdApiKey = key; }
    setControlCallback(cb) { this.controlCallback = cb; }
    setModeCallback(cb) { this.modeCallback = cb; }
    setTrendsCallback(cb) { this.trendsCallback = cb; }
    setDatabaseCallback(cb) { this.databaseCallback = cb; }
    setLifestyleCallbacks(get, set) { this.lifestyleGetCallback = get; this.lifestyleSetCallback = set; }
    setStrainsCallbacks(get, set) { this.strainsGetCallback = get; this.strainsSetCallback = set; }
    setAnalysesCallbacks(get, set) { this.analysesGetCallback = get; this.analysesSetCallback = set; }
    start(port, bindAddress) {
        const htmlPath = path.join(this.adapterDir, 'admin', 'web', 'dashboard.html');
        this.strainsFilePath = path.join(this.adapterDir, 'strains.json');
        // Sorten laden (async, um ioBroker-State-Callback zu verwenden wenn gesetzt)
        this.loadStrains().catch(() => { });
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
    async loadStrains() {
        // Callback bevorzugen (ioBroker-State)
        if (this.strainsGetCallback) {
            try {
                const data = await this.strainsGetCallback();
                if (data.length > 0)
                    return data;
            }
            catch { /* ignore */ }
        }
        // Datei-Fallback: liest strains.json und migriert gleichzeitig in ioBroker-State
        try {
            if (fs.existsSync(this.strainsFilePath)) {
                const parsed = JSON.parse(fs.readFileSync(this.strainsFilePath, 'utf-8'));
                if (Array.isArray(parsed) && parsed.length > 0) {
                    await this.saveStrains(parsed);
                    return parsed;
                }
            }
        }
        catch { /* ignore */ }
        // Fallback: hardcodierte Defaults
        const now = Date.now();
        const seeded = DEFAULT_STRAINS.map(s => ({ ...s, createdAt: now, updatedAt: now }));
        await this.saveStrains(seeded);
        return seeded;
    }
    async saveStrains(strains) {
        // Callback bevorzugen (ioBroker-State)
        if (this.strainsSetCallback) {
            await this.strainsSetCallback(strains);
            return;
        }
        // Fallback: Datei
        try {
            fs.writeFileSync(this.strainsFilePath, JSON.stringify(strains, null, 2), 'utf-8');
        }
        catch (e) {
            this.log.error(`Strains speichern fehlgeschlagen: ${e}`);
        }
    }
    handleStrains(req, res, strainId) {
        const json = (data, status = 200) => {
            if (res.headersSent)
                return;
            res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify(data));
        };
        if (!strainId) {
            // GET /api/strains
            if (req.method === 'GET') {
                this.loadStrains().then(strains => json(strains)).catch(e => json({ error: String(e) }, 500));
                return;
            }
            // POST /api/strains
            if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => { body += chunk; if (body.length > 32768) {
                    if (!res.headersSent) {
                        res.writeHead(413);
                        res.end();
                    }
                    req.destroy();
                } });
                req.on('error', () => { });
                req.on('end', async () => {
                    try {
                        const strain = JSON.parse(body);
                        strain.id = `strain-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                        strain.createdAt = Date.now();
                        strain.updatedAt = Date.now();
                        const strains = await this.loadStrains();
                        strains.push(strain);
                        await this.saveStrains(strains);
                        json(strain, 201);
                    }
                    catch (e) {
                        json({ error: String(e) }, 400);
                    }
                });
                return;
            }
        }
        else {
            // GET /api/strains/:id, PUT /api/strains/:id, DELETE /api/strains/:id
            if (req.method === 'GET') {
                this.loadStrains().then(strains => {
                    const idx = strains.findIndex(s => s.id === strainId);
                    if (idx < 0) {
                        json({ error: 'Nicht gefunden' }, 404);
                        return;
                    }
                    json(strains[idx]);
                }).catch(e => json({ error: String(e) }, 500));
                return;
            }
            // PUT /api/strains/:id
            if (req.method === 'PUT') {
                let body = '';
                req.on('data', chunk => { body += chunk; if (body.length > 32768) {
                    if (!res.headersSent) {
                        res.writeHead(413);
                        res.end();
                    }
                    req.destroy();
                } });
                req.on('error', () => { });
                req.on('end', async () => {
                    try {
                        const strains = await this.loadStrains();
                        const idx = strains.findIndex(s => s.id === strainId);
                        const updated = JSON.parse(body);
                        updated.id = strainId;
                        updated.updatedAt = Date.now();
                        if (idx < 0) {
                            json({ error: 'Nicht gefunden' }, 404);
                            return;
                        }
                        strains[idx] = updated;
                        await this.saveStrains(strains);
                        json(updated);
                    }
                    catch (e) {
                        json({ error: String(e) }, 400);
                    }
                });
                return;
            }
            // DELETE /api/strains/:id
            if (req.method === 'DELETE') {
                this.loadStrains().then(async (strains) => {
                    const idx = strains.findIndex(s => s.id === strainId);
                    if (idx < 0) {
                        json({ error: 'Nicht gefunden' }, 404);
                        return;
                    }
                    strains.splice(idx, 1);
                    await this.saveStrains(strains);
                    json({ ok: true });
                }).catch(e => json({ error: String(e) }, 500));
                return;
            }
        }
        json({ error: 'Method not allowed' }, 405);
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
    async handleRequest(req, res) {
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
                req.on('data', chunk => { body += chunk; if (body.length > 4096) {
                    if (!res.headersSent) {
                        res.writeHead(413, { 'Content-Type': 'application/json' });
                        res.end('{"error":"too large"}');
                    }
                    req.destroy();
                } });
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
        // Sortenwiki API
        if (url === '/api/strains') {
            this.handleStrains(req, res);
            return;
        }
        const strainIdMatch = url.match(/^\/api\/strains\/([^/]+)$/);
        if (strainIdMatch) {
            this.handleStrains(req, res, strainIdMatch[1]);
            return;
        }
        // GET|PUT /api/analyses/:groupId
        const analysesMatch = url.match(/^\/api\/analyses\/([^/]+)$/);
        if (analysesMatch) {
            const groupId = analysesMatch[1];
            const jsonA = (data, status = 200) => {
                if (res.headersSent)
                    return;
                res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify(data));
            };
            if (req.method === 'GET') {
                const list = this.analysesGetCallback ? await this.analysesGetCallback(groupId) : [];
                jsonA(list);
                return;
            }
            if (req.method === 'PUT') {
                let body = '';
                req.on('data', chunk => { body += chunk; if (body.length > 524288) {
                    if (!res.headersSent) {
                        res.writeHead(413);
                        res.end();
                    }
                    req.destroy();
                } });
                req.on('error', () => { });
                req.on('end', async () => {
                    try {
                        const analyses = JSON.parse(body);
                        if (this.analysesSetCallback)
                            await this.analysesSetCallback(groupId, analyses);
                        jsonA({ ok: true });
                    }
                    catch (e) {
                        jsonA({ error: String(e) }, 400);
                    }
                });
                return;
            }
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