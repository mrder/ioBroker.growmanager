import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import type { GrowManagerConfig } from './types';

interface IoBrokerSocket {
    emit: (event: string, ...args: unknown[]) => void;
    on: (event: string, cb: (...args: unknown[]) => void) => void;
    connected?: boolean;
}

// ioBroker WebSockets v3 setzt globalThis.io = { connect: fn }, KEIN aufrufbares io()
type IoBrokerIo =
    | ((url?: string, opts?: object) => IoBrokerSocket)
    | { connect: (url?: string, opts?: object) => IoBrokerSocket };

declare global {
    interface Window {
        io?: IoBrokerIo;
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
    const p = window.location.pathname.match(/adapter\/([^/]+)/);
    if (p) return `system.adapter.${p[1]}.0`;
    return 'system.adapter.growmanager.0';
}

function wireSocket(socket: IoBrokerSocket, source: string): void {
    console.log(`[GrowManager] Socket bereit via: ${source}`);
    window._growSocket = socket;
    const instanceId = detectInstanceId();
    window._growInstanceId = instanceId;
    console.log(`[GrowManager] Instance ID: ${instanceId}`);

    window.loadConfig = (cb) => {
        socket.emit('getObject', instanceId, (_err: unknown, obj: unknown) => {
            const o = obj as { native?: GrowManagerConfig } | null;
            console.log('[GrowManager] loadConfig:', o?.native ? 'OK' : 'kein native-Objekt');
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

function createSocket(io: IoBrokerIo): IoBrokerSocket {
    // ioBroker WebSockets v3: io = { connect: fn }
    if (typeof io === 'function') {
        return io('/');
    }
    // Muss options-Objekt haben, sonst wirft SocketClient "No options provided!"
    return io.connect('/', { name: 'GrowManager Admin', pongTimeout: 60000, pingInterval: 5000 });
}

function setupBridge(): void {
    // 1. window.socket direkt (ältere ioBroker admin Versionen)
    if (window.socket) {
        wireSocket(window.socket, 'window.socket');
        return;
    }

    // 2. window.io sofort verfügbar (ioBroker WebSockets bereits injected)
    if (window.io) {
        const socket = createSocket(window.io);
        // ioBroker SocketClient queued emits intern → wireSocket sofort, nicht erst nach connect
        wireSocket(socket, 'window.io (sofort)');
        return;
    }

    // 3. window.parent.socket (iframe, selbe Origin)
    try {
        const pw = window.parent as Window & { socket?: IoBrokerSocket };
        if (pw && pw !== window && pw.socket) {
            wireSocket(pw.socket, 'window.parent.socket');
            return;
        }
    } catch { /* cross-origin */ }

    // 4. Polling – ioBroker admin injiziert socket ggf. leicht verzögert
    let tries = 0;
    const poll = setInterval(() => {
        if (window.socket) { clearInterval(poll); wireSocket(window.socket, 'window.socket (poll)'); return; }
        if (window.io) {
            clearInterval(poll);
            wireSocket(createSocket(window.io), 'window.io (poll)');
            return;
        }
        try {
            const pw = window.parent as Window & { socket?: IoBrokerSocket };
            if (pw && pw !== window && pw.socket) { clearInterval(poll); wireSocket(pw.socket, 'parent.socket (poll)'); return; }
        } catch { /* ok */ }

        if (++tries >= 20) { // 4 Sekunden
            clearInterval(poll);
            console.warn('[GrowManager] Kein ioBroker-Socket gefunden nach 4 s – Fallback auf fetch API');
            wireFetchFallback();
        }
    }, 200);
}

function wireFetchFallback(): void {
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
        console.error('[GrowManager] loadConfig: kein Objekt via fetch gefunden');
    };

    window.saveConfig = async (config: GrowManagerConfig): Promise<void> => {
        let obj: Record<string, unknown> | null = null;
        for (const url of [`/v1/objects/${instanceId}`, `/objects/${instanceId}`]) {
            try { const r = await fetch(url); if (r.ok) { obj = await r.json(); break; } } catch { /* ok */ }
        }
        if (!obj) throw new Error('Objekt nicht via REST gefunden: ' + instanceId);
        obj['native'] = config;
        for (const url of [`/v1/objects/${instanceId}`, `/objects/${instanceId}`]) {
            try {
                const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
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
