/**
 * Berechnet den Sättigungsdampfdruck in kPa.
 * Formel: Magnus-Näherung
 */
export declare function saturationVaporPressure(tempC: number): number;
/**
 * Berechnet den VPD (Vapour Pressure Deficit) in kPa.
 * @param tempC Lufttemperatur in °C
 * @param rhPercent Relative Luftfeuchtigkeit in %
 */
export declare function calculateVPD(tempC: number, rhPercent: number): number;
/**
 * Berechnet den Leaf-VPD unter Verwendung der Blatttemperatur.
 * @param airTempC Lufttemperatur in °C
 * @param leafTempC Blatttemperatur in °C
 * @param rhPercent Relative Luftfeuchtigkeit in %
 */
export declare function calculateLeafVPD(airTempC: number, leafTempC: number, rhPercent: number): number;
/**
 * Berechnet den Taupunkt in °C (Magnus-Formel).
 */
export declare function dewPoint(tempC: number, rhPercent: number): number;
/**
 * Berechnet die absolute Feuchte in g/m³.
 */
export declare function absoluteHumidity(tempC: number, rhPercent: number): number;
/**
 * Prüft Kondensationsrisiko: true wenn Taupunkt innerhalb von 2 K der Lufttemperatur.
 */
export declare function condensationRisk(tempC: number, rhPercent: number, marginK?: number): boolean;
/**
 * Berechnet den Median eines Zahlen-Arrays.
 */
export declare function median(values: number[]): number;
/**
 * Berechnet den gewichteten Mittelwert.
 */
export declare function weightedMean(values: number[], weights: number[]): number;
/**
 * Entfernt Ausreißer mittels IQR-Methode (±1.5 × IQR vom Median).
 */
export declare function removeOutliers(values: number[]): number[];
/**
 * Lineare Interpolation zwischen zwei Punkten.
 */
export declare function lerp(from: number, to: number, t: number): number;
/**
 * Berechnet den linearen Trend (Steigung in Einheit/Minute) über ein Wertefenster.
 * @param points Array von { ts: Timestamp in ms, value: Wert }
 */
export declare function linearTrend(points: Array<{
    ts: number;
    value: number;
}>): number | null;
/**
 * Berechnet exponentiell geglätteten Mittelwert (EMA).
 * @param prev Vorheriger geglätteter Wert
 * @param current Aktueller Rohwert
 * @param alpha Glättungsfaktor 0..1 (höher = weniger Glättung)
 */
export declare function exponentialSmoothing(prev: number, current: number, alpha: number): number;
/**
 * Kennlinien-Interpolation über Stützpunkte.
 */
export declare function curveInterpolate(input: number, points: Array<{
    x: number;
    y: number;
}>): number;
/**
 * Prüft ob ein Wert innerhalb eines Bereichs liegt (inkl. Hysterese).
 * Gibt 0 zurück wenn in Zone, -1 wenn zu niedrig, +1 wenn zu hoch.
 */
export declare function hysteresisCheck(value: number, setpoint: number, hysteresis: number, currentState: -1 | 0 | 1): -1 | 0 | 1;
/**
 * Aggregiert mehrere Sensorwerte je nach Methode.
 */
export declare function aggregateValues(values: number[], weights: number[], method: 'median' | 'mean' | 'weightedMean' | 'min' | 'max'): number | null;
/**
 * Berechnet Sensorqualität (0–100 %) basierend auf Anzahl gültiger Sensoren.
 */
export declare function sensorQuality(validCount: number, totalCount: number): number;
//# sourceMappingURL=calculations.d.ts.map