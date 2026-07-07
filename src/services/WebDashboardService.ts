// ============================================================
// GrowManager – WebDashboardService
// Interner HTTP-Server für das Live-Dashboard (Port 8097).
// Stellt JSON-Snapshot (/api/state) und SSE-Stream (/api/events) bereit.
// ============================================================

import * as http from 'http';
import * as https from 'https';
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
    manualLock?: boolean;
    blocked?: boolean;
    blockReason?: string;
    blockSecondsLeft?: number;
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
    soilSensors: Array<{ id: string; name: string; value: number | null }>;
    co2: number | null;
    leafTemperature: number | null;
    leafSensors: Array<{ id: string; name: string; value: number | null }>;
    sensorDetails: Array<{ id: string; name: string; type: string; quality: number; valid: boolean; stale: boolean; error?: string }>;
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

const DEFAULT_STRAINS: StrainEntry[] = [
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
    private databaseCallback: ((groupId: string, type: 'stats' | 'energy' | 'irrigation') => unknown) | null = null;
    private lifestyleGetCallback: ((groupId: string) => Promise<unknown>) | null = null;
    private lifestyleSetCallback: ((groupId: string, data: unknown) => Promise<void>) | null = null;
    private plantIdApiKey = '';
    private strainsFilePath = '';

    constructor(
        private readonly log: {
            info: (m: string) => void;
            warn: (m: string) => void;
            error: (m: string) => void;
        },
        private readonly adapterDir: string,
    ) {}

    setPin(pin: string): void { this.pin = pin; }
    setPlantIdApiKey(key: string): void { this.plantIdApiKey = key; }
    setControlCallback(cb: (cmd: ControlCommand) => Promise<void>): void { this.controlCallback = cb; }
    setModeCallback(cb: (cmd: ModeCommand) => Promise<void>): void { this.modeCallback = cb; }
    setTrendsCallback(cb: (groupId: string, variable: string) => Promise<{ points: Array<{ ts: number; value: number }>; hint?: string }>): void { this.trendsCallback = cb; }
    setDatabaseCallback(cb: (groupId: string, type: 'stats' | 'energy' | 'irrigation') => unknown): void { this.databaseCallback = cb; }
    setLifestyleCallbacks(
        get: (groupId: string) => Promise<unknown>,
        set: (groupId: string, data: unknown) => Promise<void>,
    ): void { this.lifestyleGetCallback = get; this.lifestyleSetCallback = set; }

    start(port: number, bindAddress: string): void {
        const htmlPath = path.join(this.adapterDir, 'admin', 'web', 'dashboard.html');
        this.strainsFilePath = path.join(this.adapterDir, 'strains.json');
        // Standardsorten beim Start anlegen wenn noch keine Datei existiert
        if (!fs.existsSync(this.strainsFilePath)) {
            this.loadStrains();
        }
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

    private loadStrains(): StrainEntry[] {
        try {
            if (fs.existsSync(this.strainsFilePath)) {
                const parsed = JSON.parse(fs.readFileSync(this.strainsFilePath, 'utf-8')) as StrainEntry[];
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
        } catch { /* ignore */ }
        // Erste Nutzung: mitgelieferte strains.json aus Adapter-Verzeichnis probieren
        const bundledPath = path.join(this.adapterDir, 'strains.json');
        if (bundledPath !== this.strainsFilePath && fs.existsSync(bundledPath)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(bundledPath, 'utf-8')) as StrainEntry[];
                if (Array.isArray(parsed) && parsed.length > 0) {
                    this.saveStrains(parsed);
                    return parsed;
                }
            } catch { /* ignore */ }
        }
        // Fallback: hardcodierte Defaults
        const now = Date.now();
        const seeded = DEFAULT_STRAINS.map(s => ({ ...s, createdAt: now, updatedAt: now }));
        this.saveStrains(seeded);
        return seeded;
    }

    private saveStrains(strains: StrainEntry[]): void {
        try {
            fs.writeFileSync(this.strainsFilePath, JSON.stringify(strains, null, 2), 'utf-8');
        } catch (e) {
            this.log.error(`Strains speichern fehlgeschlagen: ${e}`);
        }
    }

    private handleStrains(req: http.IncomingMessage, res: http.ServerResponse, strainId?: string): void {
        const json = (data: unknown, status = 200) => {
            if (res.headersSent) return;
            res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify(data));
        };

        if (!strainId) {
            // GET /api/strains
            if (req.method === 'GET') { json(this.loadStrains()); return; }

            // POST /api/strains
            if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => { body += chunk; if (body.length > 32768) { if (!res.headersSent) { res.writeHead(413); res.end(); } req.destroy(); } });
                req.on('error', () => { /* ignore */ });
                req.on('end', () => {
                    try {
                        const strain = JSON.parse(body) as StrainEntry;
                        strain.id = `strain-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                        strain.createdAt = Date.now();
                        strain.updatedAt = Date.now();
                        const strains = this.loadStrains();
                        strains.push(strain);
                        this.saveStrains(strains);
                        json(strain, 201);
                    } catch (e) { json({ error: String(e) }, 400); }
                });
                return;
            }
        } else {
            const strains = this.loadStrains();
            const idx = strains.findIndex(s => s.id === strainId);

            // GET /api/strains/:id
            if (req.method === 'GET') {
                if (idx < 0) { json({ error: 'Nicht gefunden' }, 404); return; }
                json(strains[idx]); return;
            }

            // PUT /api/strains/:id
            if (req.method === 'PUT') {
                let body = '';
                req.on('data', chunk => { body += chunk; if (body.length > 32768) { if (!res.headersSent) { res.writeHead(413); res.end(); } req.destroy(); } });
                req.on('error', () => { /* ignore */ });
                req.on('end', () => {
                    try {
                        const updated = JSON.parse(body) as StrainEntry;
                        updated.id = strainId;
                        updated.updatedAt = Date.now();
                        if (idx < 0) { json({ error: 'Nicht gefunden' }, 404); return; }
                        strains[idx] = updated;
                        this.saveStrains(strains);
                        json(updated);
                    } catch (e) { json({ error: String(e) }, 400); }
                });
                return;
            }

            // DELETE /api/strains/:id
            if (req.method === 'DELETE') {
                if (idx < 0) { json({ error: 'Nicht gefunden' }, 404); return; }
                strains.splice(idx, 1);
                this.saveStrains(strains);
                json({ ok: true }); return;
            }
        }
        json({ error: 'Method not allowed' }, 405);
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
            } else {
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end('[]');
            }
            return;
        }

        const dbMatch = url.match(/^\/api\/database\/([^/]+)\/(stats|energy|irrigation)$/);
        if (dbMatch) {
            const cb = this.databaseCallback;
            const data = cb ? cb(dbMatch[1], dbMatch[2] as 'stats' | 'energy' | 'irrigation') : [];
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
                } else {
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end('{}');
                }
                return;
            }
            if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => { body += chunk; if (body.length > 4096) { if (!res.headersSent) { res.writeHead(413, { 'Content-Type': 'application/json' }); res.end('{"error":"too large"}'); } req.destroy(); } });
                req.on('error', () => { /* ignore */ });
                req.on('end', async () => {
                    try {
                        const data = JSON.parse(body);
                        const cb = this.lifestyleSetCallback;
                        if (cb) await cb(lsMatch[1], data);
                        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                        res.end('{"ok":true}');
                    } catch (e) {
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

        // Camera proxy: fetches image from local camera URL server-side, avoids browser CORS
        if (url === '/api/cam-proxy' && req.method === 'GET') {
            const rawUrl = new URL(req.url ?? '/', `http://localhost`).searchParams.get('url');
            if (!rawUrl) {
                res.writeHead(400); res.end('Missing url param'); return;
            }
            try {
                const camUrl = new URL(decodeURIComponent(rawUrl));
                // Only allow http/https to prevent SSRF to internal services
                if (camUrl.protocol !== 'http:' && camUrl.protocol !== 'https:') {
                    res.writeHead(400); res.end('Bad protocol'); return;
                }
                const lib = camUrl.protocol === 'https:' ? https : http;
                const proxyReq = lib.get(camUrl.toString(), proxyRes => {
                    if (res.headersSent) { proxyRes.resume(); return; }
                    const ct = proxyRes.headers['content-type'] ?? 'image/jpeg';
                    res.writeHead(proxyRes.statusCode ?? 200, {
                        'Content-Type': ct,
                        'Cache-Control': 'no-store',
                        'Access-Control-Allow-Origin': '*',
                    });
                    proxyRes.pipe(res);
                    proxyRes.on('error', () => { if (!res.writableEnded) res.end(); });
                });
                proxyReq.setTimeout(8000, () => {
                    proxyReq.destroy();
                    if (!res.headersSent) { res.writeHead(504); res.end(); }
                    else if (!res.writableEnded) { res.end(); }
                });
                proxyReq.on('error', () => {
                    if (!res.headersSent) { res.writeHead(502); res.end(); }
                    else if (!res.writableEnded) { res.end(); }
                });
            } catch {
                res.writeHead(400); res.end('Invalid url');
            }
            return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
    }

    private handlePlantAnalysis(req: http.IncomingMessage, res: http.ServerResponse): void {
        if (!this.plantIdApiKey) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Kein Plant.id API-Key konfiguriert. Bitte in den globalen Einstellungen hinterlegen.' }));
            return;
        }
        let body = '';
        req.on('data', chunk => { body += chunk; if (body.length > 8 * 1024 * 1024) req.destroy(); });
        req.on('error', () => { /* ignore */ });
        req.on('end', () => {
            let imageBase64: string;
            try {
                const parsed = JSON.parse(body) as { image?: string };
                if (!parsed.image) throw new Error('Kein Bild');
                // Base64-Daten-URL bereinigen
                imageBase64 = parsed.image.replace(/^data:image\/[a-z]+;base64,/, '');
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `Ungültige Anfrage: ${e}` }));
                return;
            }

            const payload = JSON.stringify({
                images: [imageBase64],
                similar_images: true,
            });

            const options: https.RequestOptions = {
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

    private handleMode(req: http.IncomingMessage, res: http.ServerResponse): void {
        let body = '';
        req.on('data', chunk => { body += chunk; if (body.length > 65536) req.destroy(); });
        req.on('error', () => { /* intentional destroy on oversized body */ });
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
        req.on('data', chunk => { body += chunk; if (body.length > 65536) req.destroy(); });
        req.on('error', () => { /* intentional destroy on oversized body */ });
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
