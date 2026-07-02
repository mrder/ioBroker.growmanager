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
        io?: (url?: string, opts?: object) => IoBrokerSocket;
        socket?: IoBrokerSocket;
        _growSocket?: IoBrokerSocket;
        _growInstanceId?: string;
        loadConfig?: (cb: (c: GrowManagerConfig) => void) => void;
        saveConfig?: (c: GrowManagerConfig) => Promise<void>;
    }
}

function detectInstanceId(): string {
    // URL param: ?instance=0
    const m = window.location.search.match(/[?&]instance=([^&]+)/);
    if (m) return `system.adapter.growmanager.${m[1]}`;
    // URL path: /adapter/growmanager/
    const p = window.location.pathname.match(/adapter\/([^/]+)/);
    if (p) return `system.adapter.${p[1]}.0`;
    return 'system.adapter.growmanager.0';
}

function wireSocket(socket: IoBrokerSocket, source: string): void {
    console.log(`[GrowManager] Socket verbunden via: ${source}`);
    window._growSocket = socket;
    window._growInstanceId = detectInstanceId();
    const instanceId = window._growInstanceId;
    console.log(`[GrowManager] Instance ID: ${instanceId}`);

    window.loadConfig = (cb) => {
        socket.emit('getObject', instanceId, (_err: unknown, obj: unknown) => {
            const o = obj as { native?: GrowManagerConfig } | null;
            console.log('[GrowManager] loadConfig:', o?.native ? 'OK' : 'leer');
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
                    else { console.log('[GrowManager] gespeichert!'); resolve(); }
                });
            });
        });

    window.dispatchEvent(new CustomEvent('iobroker-ready'));
}

function trySocket(socket: IoBrokerSocket | undefined, source: string): boolean {
    if (!socket) return false;
    try {
        wireSocket(socket, source);
        return true;
    } catch { return false; }
}

function setupBridge(): void {
    // 1. Eigenes window.socket (ioBroker admin inject)
    if (trySocket(window.socket, 'window.socket')) return;

    // 2. Parent-Fenster (ioBroker admin iframe — selbe Origin)
    try {
        const parentWin = window.parent as Window & { socket?: IoBrokerSocket };
        if (parentWin && parentWin !== window && trySocket(parentWin.socket, 'window.parent.socket')) return;
    } catch { /* cross-origin */ }

    // 3. Warten bis admin socket injiziert
    let tries = 0;
    const poll = setInterval(() => {
        if (trySocket(window.socket, 'window.socket (poll)')) { clearInterval(poll); return; }
        try {
            const pw = window.parent as Window & { socket?: IoBrokerSocket };
            if (pw && pw !== window && trySocket(pw.socket, 'window.parent.socket (poll)')) { clearInterval(poll); return; }
        } catch { /* ok */ }
        if (++tries >= 15) {
            clearInterval(poll);
            // 4. socket.io manuell laden
            loadSocketManually();
        }
    }, 200);
}

function loadSocketManually(): void {
    console.log('[GrowManager] Versuche socket.io manuell zu laden...');
    const script = document.createElement('script');
    script.src = '/socket.io/socket.io.js';
    script.onerror = () => {
        console.warn('[GrowManager] socket.io nicht gefunden – versuche Fetch-API');
        wireFetchFallback();
    };
    script.onload = () => {
        if (typeof window.io !== 'function') { wireFetchFallback(); return; }
        const socket = window.io();
        if (socket.connected) {
            wireSocket(socket, 'socket.io (bereits verbunden)');
        } else {
            socket.on('connect', () => wireSocket(socket, 'socket.io (nach connect)'));
        }
    };
    document.head.appendChild(script);
}

// Letzter Ausweg: ioBroker REST-API via fetch (kein socket nötig)
function wireFetchFallback(): void {
    const instanceId = detectInstanceId();
    window._growInstanceId = instanceId;
    console.log('[GrowManager] Fallback: fetch-API, instanceId:', instanceId);

    window.loadConfig = async (cb) => {
        try {
            const res = await fetch(`/v1/objects/${instanceId}`);
            if (res.ok) {
                const obj = await res.json() as { native?: GrowManagerConfig };
                if (obj?.native) { cb(obj.native); return; }
            }
            // Fallback auf ältere admin-API
            const res2 = await fetch(`/objects/${instanceId}`);
            if (res2.ok) {
                const obj2 = await res2.json() as { native?: GrowManagerConfig };
                if (obj2?.native) cb(obj2.native);
            }
        } catch (e) { console.error('[GrowManager] loadConfig fetch Fehler:', e); }
    };

    window.saveConfig = async (config: GrowManagerConfig): Promise<void> => {
        // Erst GET um vollständiges Objekt zu bekommen
        let obj: Record<string, unknown> | null = null;
        for (const url of [`/v1/objects/${instanceId}`, `/objects/${instanceId}`]) {
            try {
                const r = await fetch(url);
                if (r.ok) { obj = await r.json(); break; }
            } catch { /* weiter */ }
        }
        if (!obj) throw new Error('Objekt nicht gefunden via REST: ' + instanceId);
        obj['native'] = config;

        for (const [url, method] of [[`/v1/objects/${instanceId}`, 'PUT'], [`/objects/${instanceId}`, 'PUT']] as const) {
            try {
                const r = await fetch(url, {
                    method, headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(obj),
                });
                if (r.ok) { console.log('[GrowManager] gespeichert via fetch!'); return; }
            } catch { /* weiter */ }
        }
        throw new Error('Speichern fehlgeschlagen (REST-API nicht erreichbar)');
    };

    window.dispatchEvent(new CustomEvent('iobroker-ready'));
}

setupBridge();

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(<React.StrictMode><App /></React.StrictMode>);
