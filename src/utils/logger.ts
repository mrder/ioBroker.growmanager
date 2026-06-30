// ============================================================
// GrowManager – Logger-Wrapper
// ============================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ILogger {
    debug(msg: string): void;
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
}

export class PrefixedLogger implements ILogger {
    constructor(
        private readonly inner: ILogger,
        private readonly prefix: string
    ) {}

    debug(msg: string): void { this.inner.debug(`[${this.prefix}] ${msg}`); }
    info(msg: string): void { this.inner.info(`[${this.prefix}] ${msg}`); }
    warn(msg: string): void { this.inner.warn(`[${this.prefix}] ${msg}`); }
    error(msg: string): void { this.inner.error(`[${this.prefix}] ${msg}`); }
}
