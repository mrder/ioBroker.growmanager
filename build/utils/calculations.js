"use strict";
// ============================================================
// GrowManager – Klimaberechnungen
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.sensorQuality = exports.aggregateValues = exports.hysteresisCheck = exports.curveInterpolate = exports.exponentialSmoothing = exports.linearTrend = exports.lerp = exports.removeOutliers = exports.weightedMean = exports.median = exports.condensationRisk = exports.absoluteHumidity = exports.dewPoint = exports.calculateLeafVPD = exports.calculateVPD = exports.saturationVaporPressure = void 0;
/**
 * Berechnet den Sättigungsdampfdruck in kPa.
 * Formel: Magnus-Näherung
 */
function saturationVaporPressure(tempC) {
    return 0.6108 * Math.exp((17.27 * tempC) / (tempC + 237.3));
}
exports.saturationVaporPressure = saturationVaporPressure;
/**
 * Berechnet den VPD (Vapour Pressure Deficit) in kPa.
 * @param tempC Lufttemperatur in °C
 * @param rhPercent Relative Luftfeuchtigkeit in %
 */
function calculateVPD(tempC, rhPercent) {
    const svp = saturationVaporPressure(tempC);
    const avp = svp * (rhPercent / 100);
    return Math.max(0, svp - avp);
}
exports.calculateVPD = calculateVPD;
/**
 * Berechnet den Leaf-VPD unter Verwendung der Blatttemperatur.
 * @param airTempC Lufttemperatur in °C
 * @param leafTempC Blatttemperatur in °C
 * @param rhPercent Relative Luftfeuchtigkeit in %
 */
function calculateLeafVPD(airTempC, leafTempC, rhPercent) {
    const leafSvp = saturationVaporPressure(leafTempC);
    const airAvp = saturationVaporPressure(airTempC) * (rhPercent / 100);
    return Math.max(0, leafSvp - airAvp);
}
exports.calculateLeafVPD = calculateLeafVPD;
/**
 * Berechnet den Taupunkt in °C (Magnus-Formel).
 */
function dewPoint(tempC, rhPercent) {
    if (rhPercent <= 0)
        return -999; // Math.log(0) = -Infinity → NaN downstream
    const a = 17.27;
    const b = 237.3;
    const rh = rhPercent / 100;
    const gamma = (a * tempC) / (b + tempC) + Math.log(rh);
    return (b * gamma) / (a - gamma);
}
exports.dewPoint = dewPoint;
/**
 * Berechnet die absolute Feuchte in g/m³.
 */
function absoluteHumidity(tempC, rhPercent) {
    const svp = saturationVaporPressure(tempC) * 1000; // Pa
    const rh = rhPercent / 100;
    return (2165 * svp * rh) / (273.15 + tempC);
}
exports.absoluteHumidity = absoluteHumidity;
/**
 * Prüft Kondensationsrisiko: true wenn Taupunkt innerhalb von 2 K der Lufttemperatur.
 */
function condensationRisk(tempC, rhPercent, marginK = 2) {
    const dp = dewPoint(tempC, rhPercent);
    return tempC - dp < marginK;
}
exports.condensationRisk = condensationRisk;
/**
 * Berechnet den Median eines Zahlen-Arrays.
 */
function median(values) {
    if (values.length === 0)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
exports.median = median;
/**
 * Berechnet den gewichteten Mittelwert.
 */
function weightedMean(values, weights) {
    let sum = 0;
    let weightSum = 0;
    for (let i = 0; i < values.length; i++) {
        sum += values[i] * weights[i];
        weightSum += weights[i];
    }
    return weightSum === 0 ? 0 : sum / weightSum;
}
exports.weightedMean = weightedMean;
/**
 * Entfernt Ausreißer mittels IQR-Methode (±1.5 × IQR vom Median).
 */
function removeOutliers(values) {
    if (values.length < 4)
        return values;
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    const low = q1 - 1.5 * iqr;
    const high = q3 + 1.5 * iqr;
    return values.filter(v => v >= low && v <= high);
}
exports.removeOutliers = removeOutliers;
/**
 * Lineare Interpolation zwischen zwei Punkten.
 */
function lerp(from, to, t) {
    return from + (to - from) * Math.max(0, Math.min(1, t));
}
exports.lerp = lerp;
/**
 * Berechnet den linearen Trend (Steigung in Einheit/Minute) über ein Wertefenster.
 * @param points Array von { ts: Timestamp in ms, value: Wert }
 */
function linearTrend(points) {
    if (points.length < 2)
        return null;
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
exports.linearTrend = linearTrend;
/**
 * Berechnet exponentiell geglätteten Mittelwert (EMA).
 * @param prev Vorheriger geglätteter Wert
 * @param current Aktueller Rohwert
 * @param alpha Glättungsfaktor 0..1 (höher = weniger Glättung)
 */
function exponentialSmoothing(prev, current, alpha) {
    return alpha * current + (1 - alpha) * prev;
}
exports.exponentialSmoothing = exponentialSmoothing;
/**
 * Kennlinien-Interpolation über Stützpunkte.
 */
function curveInterpolate(input, points) {
    if (points.length === 0)
        return 0;
    if (points.length === 1)
        return points[0].y;
    const sorted = [...points].sort((a, b) => a.x - b.x);
    if (input <= sorted[0].x)
        return sorted[0].y;
    if (input >= sorted[sorted.length - 1].x)
        return sorted[sorted.length - 1].y;
    for (let i = 0; i < sorted.length - 1; i++) {
        if (input >= sorted[i].x && input <= sorted[i + 1].x) {
            const dx = sorted[i + 1].x - sorted[i].x;
            if (dx === 0)
                return sorted[i].y; // Doppelter Stützpunkt → Division durch 0 vermeiden
            const t = (input - sorted[i].x) / dx;
            return lerp(sorted[i].y, sorted[i + 1].y, t);
        }
    }
    return 0;
}
exports.curveInterpolate = curveInterpolate;
/**
 * Prüft ob ein Wert innerhalb eines Bereichs liegt (inkl. Hysterese).
 * Gibt 0 zurück wenn in Zone, -1 wenn zu niedrig, +1 wenn zu hoch.
 */
function hysteresisCheck(value, setpoint, hysteresis, currentState) {
    const half = hysteresis / 2;
    if (value < setpoint - half)
        return -1;
    if (value > setpoint + half)
        return 1;
    // Im Totband: Zustand beibehalten (außer wir sind noch im undefinierten Zustand)
    return currentState === 0 ? 0 : currentState;
}
exports.hysteresisCheck = hysteresisCheck;
/**
 * Aggregiert mehrere Sensorwerte je nach Methode.
 */
function aggregateValues(values, weights, method) {
    if (values.length === 0)
        return null;
    switch (method) {
        case 'median': return median(values);
        case 'mean': return values.reduce((a, b) => a + b, 0) / values.length;
        case 'weightedMean': return weightedMean(values, weights);
        case 'min': return Math.min(...values);
        case 'max': return Math.max(...values);
    }
}
exports.aggregateValues = aggregateValues;
/**
 * Berechnet Sensorqualität (0–100 %) basierend auf Anzahl gültiger Sensoren.
 */
function sensorQuality(validCount, totalCount) {
    if (totalCount === 0)
        return 0;
    return Math.round((validCount / totalCount) * 100);
}
exports.sensorQuality = sensorQuality;
//# sourceMappingURL=calculations.js.map