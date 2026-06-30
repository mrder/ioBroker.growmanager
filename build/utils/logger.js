"use strict";
// ============================================================
// GrowManager – Logger-Wrapper
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrefixedLogger = void 0;
class PrefixedLogger {
    constructor(inner, prefix) {
        this.inner = inner;
        this.prefix = prefix;
    }
    debug(msg) { this.inner.debug(`[${this.prefix}] ${msg}`); }
    info(msg) { this.inner.info(`[${this.prefix}] ${msg}`); }
    warn(msg) { this.inner.warn(`[${this.prefix}] ${msg}`); }
    error(msg) { this.inner.error(`[${this.prefix}] ${msg}`); }
}
exports.PrefixedLogger = PrefixedLogger;
//# sourceMappingURL=logger.js.map