import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import type { GrowManagerConfig } from './types';

declare global {
    interface Window {
        io?: (url?: string, opts?: object) => SocketIOClient;
        loadConfig?: (cb: (c: GrowManagerConfig) => void) => void;
        saveConfig?: (c: GrowManagerConfig) => void;
    }
}

interface SocketIOClient {
    emit: (event: string, ...args: unknown[]) => void;
    on: (event: string, cb: (...args: unknown[]) => void) => void;
}

function detectInstanceId(): string {
    // URL pattern: /adapter/growmanager/ or similar
    const m = window.location.pathname.match(/adapter\/([^/]+)/);
    const adapterName = m ? m[1] : 'growmanager';
    return `system.adapter.${adapterName}.0`;
}

function setupBridge(): void {
    // ioBroker admin provides socket.io at the root of the admin server
    const socketScript = document.createElement('script');
    socketScript.src = '/socket.io/socket.io.js';
    socketScript.onload = () => {
        if (typeof window.io !== 'function') return;
        const socket: SocketIOClient = window.io();
        const instanceId = detectInstanceId();

        window.loadConfig = (cb) => {
            socket.emit('getObject', instanceId, (_err: unknown, obj: unknown) => {
                const o = obj as { native?: GrowManagerConfig } | null;
                if (o?.native) cb(o.native);
            });
        };

        window.saveConfig = (config) => {
            socket.emit('getObject', instanceId, (_err: unknown, obj: unknown) => {
                const o = obj as Record<string, unknown> | null;
                if (o) {
                    o['native'] = config;
                    socket.emit('setObject', instanceId, o, () => { /* saved */ });
                }
            });
        };

        // Auto-load on socket ready
        socket.on('connect', () => {
            // trigger re-render via custom event if App is already mounted
            window.dispatchEvent(new CustomEvent('iobroker-ready'));
        });
    };
    document.head.appendChild(socketScript);
}

setupBridge();

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(<React.StrictMode><App /></React.StrictMode>);
