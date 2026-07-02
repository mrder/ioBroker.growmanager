import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import type { GrowManagerConfig } from './types';

interface IoBrokerSocket {
    emit: (event: string, ...args: unknown[]) => void;
    on: (event: string, cb: (...args: unknown[]) => void) => void;
    connected?: boolean;
}

declare global {
    interface Window {
        socket?: IoBrokerSocket;
        _growSocket?: IoBrokerSocket;
        _growInstanceId?: string;
        loadConfig?: (cb: (c: GrowManagerConfig) => void) => void;
        saveConfig?: (c: GrowManagerConfig) => Promise<void>;
    }
}

function detectInstanceId(): string {
    const m = window.location.search.match(/[?&]instance=([^&]+)/);
    if (m) return `system.adapter.growmanager.${m[1]}`;
    return 'system.adapter.growmanager.0';
}

function wireSocket(socket: IoBrokerSocket, source: string): void {
    if (window._growSocket) return; // bereits verdrahtet
    console.log(`[GrowManager] Socket bereit via: ${source}`);
    window._growSocket = socket;
    const instanceId = detectInstanceId();
    window._growInstanceId = instanceId;
    console.log(`[GrowManager] Instance ID: ${instanceId}`);

    window.loadConfig = (cb) => {
        socket.emit('getObject', instanceId, (_err: unknown, obj: unknown) => {
            const o = obj as { native?: GrowManagerConfig } | null;
            console.log('[GrowManager] loadConfig:', o?.native ? 'OK' : 'kein Objekt');
            if (o?.native) cb(o.native);
        });
    };

    window.saveConfig = (config: GrowManagerConfig): Promise<void> =>
        new Promise((resolve, reject) => {
            socket.emit('getObject', instanceId, (_err: unknown, obj: unknown) => {
                const o = obj as Record<string, unknown> | null;
                if (!o) { reject(new Error('Objekt nicht gefunden: ' + instanceId)); return; }
                o['native'] = config;
                socket.emit('setObject', instanceId, o, (err: unknown) => {
                    if (err) { console.error('[GrowManager] setObject Fehler:', err); reject(new Error(String(err))); }
                    else { console.log('[GrowManager] Config gespeichert!'); resolve(); }
                });
            });
        });

    window.dispatchEvent(new CustomEvent('iobroker-ready'));
}

function connectViaSocketIo(): void {
    // ioBroker admin v6 lädt socket.io.js im Elternframe, nicht im iframe.
    // Wir laden es selbst – dann ist window.io = { connect: fn } in UNSEREM Frame verfügbar.
    const script = document.createElement('script');
    script.src = '/socket.io/socket.io.js';
    script.onload = () => {
        type IoLib = { connect: (url: string, opts: object) => IoBrokerSocket };
        const io = (window as unknown as { io?: IoLib }).io;
        if (!io?.connect) {
            console.warn('[GrowManager] socket.io.js geladen aber io.connect fehlt');
            wireFetchFallback();
            return;
        }
        console.log('[GrowManager] socket.io.js geladen, verbinde...');
        const socket = io.connect(window.location.origin, {
            name: 'GrowManager Admin',
            pongTimeout: 60000,
            pingInterval: 5000,
        });
        // 'connect' feuert nach Erhalt des ___ready___-Protokollnachrichte
        socket.on('connect', () => wireSocket(socket, 'io.connect()'));
        setTimeout(() => {
            if (!window._growSocket) {
                console.warn('[GrowManager] Socket timeout nach 10 s → fetch fallback');
                wireFetchFallback();
            }
        }, 10000);
    };
    script.onerror = () => {
        console.warn('[GrowManager] socket.io.js nicht ladbar → fetch fallback');
        wireFetchFallback();
    };
    document.head.appendChild(script);
}

function wireFetchFallback(): void {
    if (window._growSocket) return;
    const instanceId = detectInstanceId();
    window._growInstanceId = instanceId;
    console.log('[GrowManager] Fetch-Fallback, instanceId:', instanceId);

    window.loadConfig = async (cb) => {
        for (const url of [`/v1/objects/${instanceId}`, `/objects/${instanceId}`]) {
            try {
                const r = await fetch(url);
                if (r.ok) { const o = await r.json() as { native?: GrowManagerConfig }; if (o?.native) { cb(o.native); return; } }
            } catch { /* weiter */ }
        }
        console.error('[GrowManager] loadConfig via fetch fehlgeschlagen');
    };

    window.saveConfig = async (config: GrowManagerConfig): Promise<void> => {
        let obj: Record<string, unknown> | null = null;
        for (const url of [`/v1/objects/${instanceId}`, `/objects/${instanceId}`]) {
            try { const r = await fetch(url); if (r.ok) { obj = await r.json(); break; } } catch { /* ok */ }
        }
        if (!obj) throw new Error('Objekt nicht via REST gefunden');
        obj['native'] = config;
        for (const url of [`/v1/objects/${instanceId}`, `/objects/${instanceId}`]) {
            try {
                const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
                if (r.ok) { console.log('[GrowManager] gespeichert via fetch'); return; }
            } catch { /* weiter */ }
        }
        throw new Error('Speichern fehlgeschlagen');
    };

    window.dispatchEvent(new CustomEvent('iobroker-ready'));
}

function setupBridge(): void {
    // 1. window.socket – von admin v5 direkt injiziert (seltenster Fall)
    if (window.socket) {
        wireSocket(window.socket, 'window.socket');
        return;
    }
    // 2. parent.socket – admin v6 könnte Socket im Elternframe bereitstellen
    try {
        const pw = window.parent as Window & { socket?: IoBrokerSocket };
        if (pw && pw !== window && pw.socket) {
            wireSocket(pw.socket, 'parent.socket');
            return;
        }
    } catch { /* cross-origin */ }

    // 3. Standardweg: socket.io.js selbst laden + io.connect()
    connectViaSocketIo();
}

setupBridge();

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(<React.StrictMode><App /></React.StrictMode>);
