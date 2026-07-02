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
        socket?: IoBrokerSocket;        // injected by ioBroker admin v6+
        _growSocket?: IoBrokerSocket;   // our reference for object picker
        loadConfig?: (cb: (c: GrowManagerConfig) => void) => void;
        saveConfig?: (c: GrowManagerConfig) => Promise<void>;
    }
}

function detectInstanceId(): string {
    const m = window.location.search.match(/[?&]instance=([^&]+)/);
    if (m) return `system.adapter.growmanager.${m[1]}`;
    const p = window.location.pathname.match(/adapter\/([^/]+)/);
    return `system.adapter.${p ? p[1] : 'growmanager'}.0`;
}

function wireSocket(socket: IoBrokerSocket): void {
    window._growSocket = socket;
    const instanceId = detectInstanceId();

    window.loadConfig = (cb) => {
        socket.emit('getObject', instanceId, (_err: unknown, obj: unknown) => {
            const o = obj as { native?: GrowManagerConfig } | null;
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
                    if (err) reject(new Error(String(err)));
                    else resolve();
                });
            });
        });

    window.dispatchEvent(new CustomEvent('iobroker-ready'));
}

function setupBridge(): void {
    // 1. ioBroker admin v6 injects window.socket into the iframe
    if (window.socket) {
        wireSocket(window.socket);
        return;
    }

    // 2. Wait up to 1 s for admin to inject it
    let tries = 0;
    const poll = setInterval(() => {
        if (window.socket) {
            clearInterval(poll);
            wireSocket(window.socket);
            return;
        }
        if (++tries >= 10) {
            clearInterval(poll);
            loadSocketManually();
        }
    }, 100);
}

function loadSocketManually(): void {
    const script = document.createElement('script');
    script.src = '/socket.io/socket.io.js';
    script.onerror = () => console.warn('[GrowManager] socket.io nicht gefunden – Speichern deaktiviert');
    script.onload = () => {
        if (typeof window.io !== 'function') return;
        const socket = window.io();
        if (socket.connected) {
            wireSocket(socket);
        } else {
            socket.on('connect', () => wireSocket(socket));
        }
    };
    document.head.appendChild(script);
}

setupBridge();

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(<React.StrictMode><App /></React.StrictMode>);
