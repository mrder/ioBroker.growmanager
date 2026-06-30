// ============================================================
// GrowManager – Zeit-Hilfsfunktionen
// ============================================================

/**
 * Prüft ob der aktuelle Zeitpunkt innerhalb eines Zeitfensters liegt.
 * Berücksichtigt Midnight-Wrap.
 */
export function isInTimeWindow(
    now: Date,
    startHH: number,
    startMM: number,
    endHH: number,
    endMM: number
): boolean {
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const startMin = startHH * 60 + startMM;
    const endMin = endHH * 60 + endMM;
    if (startMin <= endMin) {
        return nowMin >= startMin && nowMin < endMin;
    } else {
        // Midnight wrap
        return nowMin >= startMin || nowMin < endMin;
    }
}

/**
 * Berechnet Minuten bis zum nächsten Zeitfenster-Start.
 */
export function minutesUntil(now: Date, targetHH: number, targetMM: number): number {
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const targetMin = targetHH * 60 + targetMM;
    const diff = targetMin - nowMin;
    return diff >= 0 ? diff : diff + 1440;
}

/**
 * Gibt einen menschenlesbaren Zeitstring zurück (HH:MM).
 */
export function formatTime(hh: number, mm: number): string {
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Konvertiert Sekunden in lesbaren String.
 */
export function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}min`;
}

/**
 * Prüft ob ein Timestamp älter als maxAge Sekunden ist.
 */
export function isStale(timestampMs: number, maxAgeSeconds: number): boolean {
    return Date.now() - timestampMs > maxAgeSeconds * 1000;
}

/**
 * Berechnet den Übergangs-Fortschritt (0..1) zwischen zwei Zuständen.
 * @param changeTs Timestamp des letzten Zustandswechsels
 * @param durationSeconds Übergangsdauer in Sekunden
 */
export function transitionProgress(changeTs: number, durationSeconds: number): number {
    const elapsed = (Date.now() - changeTs) / 1000;
    return Math.min(1, elapsed / durationSeconds);
}
