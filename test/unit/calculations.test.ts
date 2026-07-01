// ============================================================
// Unit-Tests: Klimaberechnungen
// ============================================================

import {
    calculateVPD,
    calculateLeafVPD,
    dewPoint,
    absoluteHumidity,
    condensationRisk,
    median,
    weightedMean,
    removeOutliers,
    linearTrend,
    exponentialSmoothing,
    hysteresisCheck,
    aggregateValues,
    sensorQuality,
} from '../../src/utils/calculations';

describe('VPD-Berechnungen', () => {
    test('VPD bei 25°C / 60% RH', () => {
        const vpd = calculateVPD(25, 60);
        expect(vpd).toBeCloseTo(1.267, 2);
    });

    test('VPD nie negativ', () => {
        expect(calculateVPD(20, 100)).toBe(0);
        expect(calculateVPD(10, 110)).toBe(0);
    });

    test('VPD steigt mit höherer Temperatur', () => {
        expect(calculateVPD(30, 60)).toBeGreaterThan(calculateVPD(25, 60));
    });

    test('VPD sinkt mit höherer Luftfeuchtigkeit', () => {
        expect(calculateVPD(25, 70)).toBeLessThan(calculateVPD(25, 60));
    });

    test('Leaf-VPD mit Blatttemperatur', () => {
        const leafVpd = calculateLeafVPD(25, 23, 60);
        // Kälteres Blatt → niedrigerer SVP Blatt → niedrigerer Leaf-VPD
        expect(leafVpd).toBeLessThan(calculateVPD(25, 60));
        expect(leafVpd).toBeGreaterThan(0);
    });
});

describe('Taupunkt', () => {
    test('Taupunkt bei 25°C / 60%', () => {
        const dp = dewPoint(25, 60);
        expect(dp).toBeCloseTo(16.7, 1);
    });

    test('Taupunkt bei 100% = Lufttemperatur', () => {
        expect(dewPoint(20, 100)).toBeCloseTo(20, 0);
    });
});

describe('Absolute Feuchte', () => {
    test('Absolute Feuchte > 0 bei realistischen Werten', () => {
        expect(absoluteHumidity(25, 60)).toBeGreaterThan(0);
    });

    test('Absolute Feuchte steigt mit Temperatur (gleiche RH)', () => {
        expect(absoluteHumidity(30, 60)).toBeGreaterThan(absoluteHumidity(20, 60));
    });
});

describe('Kondensationsrisiko', () => {
    test('Risiko bei Taupunkt nah an Lufttemperatur', () => {
        expect(condensationRisk(20, 99)).toBe(true);
    });

    test('Kein Risiko bei trockener Luft', () => {
        expect(condensationRisk(25, 40)).toBe(false);
    });

    test('Eigene Marge berücksichtigen', () => {
        // Bei 25°C / 60% ist Taupunkt ~16.7°C → Abstand ~8.3K
        expect(condensationRisk(25, 60, 5)).toBe(false);
        expect(condensationRisk(25, 60, 10)).toBe(true);
    });
});

describe('Statistik-Funktionen', () => {
    test('Median ungerade Anzahl', () => {
        expect(median([3, 1, 2])).toBe(2);
    });

    test('Median gerade Anzahl', () => {
        expect(median([1, 2, 3, 4])).toBe(2.5);
    });

    test('Median leeres Array', () => {
        expect(median([])).toBe(0);
    });

    test('Gewichteter Mittelwert', () => {
        expect(weightedMean([10, 20], [1, 3])).toBe(17.5);
    });

    test('Gewichteter Mittelwert leere Arrays', () => {
        expect(weightedMean([], [])).toBe(0);
    });

    test('Ausreißerentfernung', () => {
        const vals = [20, 21, 20.5, 100, 21, 20.8];
        const filtered = removeOutliers(vals);
        expect(filtered).not.toContain(100);
        expect(filtered.length).toBeGreaterThan(0);
    });

    test('Ausreißerentfernung bei wenigen Werten (kein Filter)', () => {
        expect(removeOutliers([1, 2, 100])).toEqual([1, 2, 100]);
    });
});

describe('Linearer Trend', () => {
    test('Steigender Trend', () => {
        const points = [
            { ts: 0, value: 20 },
            { ts: 60000, value: 21 },
            { ts: 120000, value: 22 },
        ];
        const trend = linearTrend(points);
        expect(trend).toBeCloseTo(1, 2); // 1 Einheit/Minute
    });

    test('Fallender Trend', () => {
        const points = [
            { ts: 0, value: 25 },
            { ts: 60000, value: 24 },
            { ts: 120000, value: 23 },
        ];
        const trend = linearTrend(points);
        expect(trend).toBeCloseTo(-1, 2);
    });

    test('Zu wenige Punkte → null', () => {
        expect(linearTrend([{ ts: 0, value: 20 }])).toBeNull();
    });
});

describe('Exponentielles Glätten', () => {
    test('Mit alpha=1 wird Rohwert übernommen', () => {
        expect(exponentialSmoothing(20, 25, 1)).toBe(25);
    });

    test('Mit alpha=0 wird altes beibehalten', () => {
        expect(exponentialSmoothing(20, 25, 0)).toBe(20);
    });

    test('Mittleres alpha interpoliert', () => {
        const result = exponentialSmoothing(20, 30, 0.5);
        expect(result).toBe(25);
    });
});

describe('Hysterese', () => {
    test('Überschreitung erkennen', () => {
        expect(hysteresisCheck(27, 25, 2, 0)).toBe(1);
    });

    test('Unterschreitung erkennen', () => {
        expect(hysteresisCheck(23, 25, 2, 0)).toBe(-1);
    });

    test('Im Totband: Zustand beibehalten', () => {
        expect(hysteresisCheck(25, 25, 2, 1)).toBe(1);
        expect(hysteresisCheck(25, 25, 2, -1)).toBe(-1);
        expect(hysteresisCheck(25, 25, 2, 0)).toBe(0);
    });
});

describe('Aggregation', () => {
    test('Median-Aggregation', () => {
        expect(aggregateValues([20, 22, 21], [1, 1, 1], 'median')).toBe(21);
    });

    test('Mean-Aggregation', () => {
        expect(aggregateValues([20, 22, 21], [1, 1, 1], 'mean')).toBeCloseTo(21, 5);
    });

    test('Min-Aggregation', () => {
        expect(aggregateValues([20, 22, 21], [1, 1, 1], 'min')).toBe(20);
    });

    test('Max-Aggregation', () => {
        expect(aggregateValues([20, 22, 21], [1, 1, 1], 'max')).toBe(22);
    });

    test('Leeres Array → null', () => {
        expect(aggregateValues([], [], 'median')).toBeNull();
    });
});

describe('Sensorqualität', () => {
    test('100% wenn alle gültig', () => {
        expect(sensorQuality(3, 3)).toBe(100);
    });

    test('0% wenn keiner gültig', () => {
        expect(sensorQuality(0, 3)).toBe(0);
    });

    test('0% ohne Sensoren', () => {
        expect(sensorQuality(0, 0)).toBe(0);
    });

    test('Anteilsrechnung', () => {
        expect(sensorQuality(2, 4)).toBe(50);
    });
});
