/**
 * Prüft ob der aktuelle Zeitpunkt innerhalb eines Zeitfensters liegt.
 * Berücksichtigt Midnight-Wrap.
 */
export declare function isInTimeWindow(now: Date, startHH: number, startMM: number, endHH: number, endMM: number): boolean;
/**
 * Berechnet Minuten bis zum nächsten Zeitfenster-Start.
 */
export declare function minutesUntil(now: Date, targetHH: number, targetMM: number): number;
/**
 * Gibt einen menschenlesbaren Zeitstring zurück (HH:MM).
 */
export declare function formatTime(hh: number, mm: number): string;
/**
 * Konvertiert Sekunden in lesbaren String.
 */
export declare function formatDuration(seconds: number): string;
/**
 * Prüft ob ein Timestamp älter als maxAge Sekunden ist.
 */
export declare function isStale(timestampMs: number, maxAgeSeconds: number): boolean;
/**
 * Berechnet den Übergangs-Fortschritt (0..1) zwischen zwei Zuständen.
 * @param changeTs Timestamp des letzten Zustandswechsels
 * @param durationSeconds Übergangsdauer in Sekunden
 */
export declare function transitionProgress(changeTs: number, durationSeconds: number): number;
//# sourceMappingURL=time.d.ts.map