"use strict";
// ============================================================
// GrowManager – Zeit-Hilfsfunktionen
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.transitionProgress = exports.isStale = exports.formatDuration = exports.formatTime = exports.minutesUntil = exports.isInTimeWindow = void 0;
/**
 * Prüft ob der aktuelle Zeitpunkt innerhalb eines Zeitfensters liegt.
 * Berücksichtigt Midnight-Wrap.
 */
function isInTimeWindow(now, startHH, startMM, endHH, endMM) {
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const startMin = startHH * 60 + startMM;
    const endMin = endHH * 60 + endMM;
    if (startMin <= endMin) {
        return nowMin >= startMin && nowMin < endMin;
    }
    else {
        // Midnight wrap
        return nowMin >= startMin || nowMin < endMin;
    }
}
exports.isInTimeWindow = isInTimeWindow;
/**
 * Berechnet Minuten bis zum nächsten Zeitfenster-Start.
 */
function minutesUntil(now, targetHH, targetMM) {
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const targetMin = targetHH * 60 + targetMM;
    const diff = targetMin - nowMin;
    return diff >= 0 ? diff : diff + 1440;
}
exports.minutesUntil = minutesUntil;
/**
 * Gibt einen menschenlesbaren Zeitstring zurück (HH:MM).
 */
function formatTime(hh, mm) {
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
exports.formatTime = formatTime;
/**
 * Konvertiert Sekunden in lesbaren String.
 */
function formatDuration(seconds) {
    if (seconds < 60)
        return `${seconds}s`;
    if (seconds < 3600)
        return `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}min`;
}
exports.formatDuration = formatDuration;
/**
 * Prüft ob ein Timestamp älter als maxAge Sekunden ist.
 */
function isStale(timestampMs, maxAgeSeconds) {
    return Date.now() - timestampMs > maxAgeSeconds * 1000;
}
exports.isStale = isStale;
/**
 * Berechnet den Übergangs-Fortschritt (0..1) zwischen zwei Zuständen.
 * @param changeTs Timestamp des letzten Zustandswechsels
 * @param durationSeconds Übergangsdauer in Sekunden
 */
function transitionProgress(changeTs, durationSeconds) {
    if (durationSeconds <= 0)
        return 1; // kein Übergang konfiguriert → sofort am Ziel
    const elapsed = (Date.now() - changeTs) / 1000;
    return Math.min(1, elapsed / durationSeconds);
}
exports.transitionProgress = transitionProgress;
//# sourceMappingURL=time.js.map