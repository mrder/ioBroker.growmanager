export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface ILogger {
    debug(msg: string): void;
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
}
export declare class PrefixedLogger implements ILogger {
    private readonly inner;
    private readonly prefix;
    constructor(inner: ILogger, prefix: string);
    debug(msg: string): void;
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
}
//# sourceMappingURL=logger.d.ts.map