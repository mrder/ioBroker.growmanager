// ============================================================
// GrowManager – Klimaberechnungen
// ============================================================

/**
 * Berechnet den Sättigungsdampfdruck in kPa.
 * Formel: Magnus-Näherung
 */
export function saturationVaporPressure(tempC: number): number {
    return 0.6108 * Math.exp((17.27 * tempC) / (tempC + 237.3));
}

/**
 * Berechnet den VPD (Vapour Pressure Deficit) in kPa.
 * @param tempC Lufttemperatur in °C
 * @param rhPercent Relative Luftfeuchtigkeit in %
 */
export function calculateVPD(tempC: number, rhPercent: number): number {
    const svp = saturationVaporPressure(tempC);
    const avp = svp * (rhPercent / 100);
    return Math.max(0, svp - avp);
}

/**
 * Berechnet den Leaf-VPD unter Verwendung der Blatttemperatur.
 * @param airTempC Lufttemperatur in °C
 * @param leafTempC Blatttemperatur in °C
 * @param rhPercent Relative Luftfeuchtigkeit in %
 */
export function calculateLeafVPD(airTempC: number, leafTempC: number, rhPercent: number): number {
    const leafSvp = saturationVaporPressure(leafTempC);
    const airAvp = saturationVaporPressure(airTempC) * (rhPercent / 100);
    return Math.max(0, leafSvp - airAvp);
}

/**
 * Berechnet den Taupunkt in °C (Magnus-Formel).
 */
export function dewPoint(tempC: number, rhPercent: number): number {
    const a = 17.27;
    const b = 237.3;
    const rh = rhPercent / 100;
    const gamma = (a * tempC) / (b + tempC) + Math.log(rh);
    return (b * gamma) / (a - gamma);
}

/**
 * Berechnet die absolute Feuchte in g/m³.
 */
export function absoluteHumidity(tempC: number, rhPercent: number): number {
    const svp = saturationVaporPressure(tempC) * 1000; // Pa
    const rh = rhPercent / 100;
    return (2165 * svp * rh) / (273.15 + tempC);
}

/**
 * Prüft Kondensationsrisiko: true wenn Taupunkt innerhalb von 2 K der Lufttemperatur.
 */
export function condensationRisk(tempC: number, rhPercent: number, marginK = 2): boolean {
    const dp = dewPoint(tempC, rhPercent);
    return tempC - dp < marginK;
}

/**
 * Berechnet den Median eines Zahlen-Arrays.
 */
export function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Berechnet den gewichteten Mittelwert.
 */
export function weightedMean(values: number[], weights: number[]): number {
    let sum = 0;
    let weightSum = 0;
    for (let i = 0; i < values.length; i++) {
        sum += values[i] * weights[i];
        weightSum += weights[i];
    }
    return weightSum === 0 ? 0 : sum / weightSum;
}

/**
 * Entfernt Ausreißer mittels IQR-Methode (±1.5 × IQR vom Median).
 */
export function removeOutliers(values: number[]): number[] {
    if (values.length < 4) return values;
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    const low = q1 - 1.5 * iqr;
    const high = q3 + 1.5 * iqr;
    return values.filter(v => v >= low && v <= high);
}

/**
 * Lineare Interpolation zwischen zwei Punkten.
 */
export function lerp(from: number, to: number, t: number): number {
    return from + (to - from) * Math.max(0, Math.min(1, t));
}

/**
 * Berechnet den linearen Trend (Steigung in Einheit/Minute) über ein Wertefenster.
 * @param points Array von { ts: Timestamp in ms, value: Wert }
 */
export function linearTrend(points: Array<{ ts: number; value: number }>): number | null {
    if (points.length < 2) return null;
    const n = points.length;
    // Normalisierung: t in Minuten relativ zum ersten Punkt
    const t0 = points[0].ts;
    const xs = points.map(p => (p.ts - t0) / 60000);
    const ys = points.map(p => p.value);
    const meanX = xs.reduce((a, b) => a + b, 0) / n;
    const meanY = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
        num += (xs[i] - meanX) * (ys[i] - meanY);
        den += (xs[i] - meanX) ** 2;
    }
    return den === 0 ? 0 : num / den;
}

/**
 * Berechnet exponentiell geglätteten Mittelwert (EMA).
 * @param prev Vorheriger geglätteter Wert
 * @param current Aktueller Rohwert
 * @param alpha Glättungsfaktor 0..1 (höher = weniger Glättung)
 */
export function exponentialSmoothing(prev: number, current: number, alpha: number): number {
    return alpha * current + (1 - alpha) * prev;
}

/**
 * Kennlinien-Interpolation über Stützpunkte.
 */
export function curveInterpolate(
    input: number,
    points: Array<{ x: number; y: number }>
): number {
    if (points.length === 0) return 0;
    if (points.length === 1) return points[0].y;
    const sorted = [...points].sort((a, b) => a.x - b.x);
    if (input <= sorted[0].x) return sorted[0].y;
    if (input >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y;
    for (let i = 0; i < sorted.length - 1; i++) {
        if (input >= sorted[i].x && input <= sorted[i + 1].x) {
            const t = (input - sorted[i].x) / (sorted[i + 1].x - sorted[i].x);
            return lerp(sorted[i].y, sorted[i + 1].y, t);
        }
    }
    return 0;
}

/**
 * Prüft ob ein Wert innerhalb eines Bereichs liegt (inkl. Hysterese).
 * Gibt 0 zurück wenn in Zone, -1 wenn zu niedrig, +1 wenn zu hoch.
 */
export function hysteresisCheck(
    value: number,
    setpoint: number,
    hysteresis: number,
    currentState: -1 | 0 | 1
): -1 | 0 | 1 {
    const half = hysteresis / 2;
    if (value < setpoint - half) return -1;
    if (value > setpoint + half) return 1;
    // Im Totband: Zustand beibehalten (außer wir sind noch im undefinierten Zustand)
    return currentState === 0 ? 0 : currentState;
}

/**
 * Aggregiert mehrere Sensorwerte je nach Methode.
 */
export function aggregateValues(
    values: number[],
    weights: number[],
    method: 'median' | 'mean' | 'weightedMean' | 'min' | 'max'
): number | null {
    if (values.length === 0) return null;
    switch (method) {
        case 'median': return median(values);
        case 'mean': return values.reduce((a, b) => a + b, 0) / values.length;
        case 'weightedMean': return weightedMean(values, weights);
        case 'min': return Math.min(...values);
        case 'max': return Math.max(...values);
    }
}

/**
 * Berechnet Sensorqualität (0–100 %) basierend auf Anzahl gültiger Sensoren.
 */
export function sensorQuality(validCount: number, totalCount: number): number {
    if (totalCount === 0) return 0;
    return Math.round((validCount / totalCount) * 100);
}
