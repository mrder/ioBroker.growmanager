// ============================================================
// Unit-Tests: ConfigurationService
// ============================================================

import { ConfigurationService } from '../../src/services/ConfigurationService';
import type { ILogger } from '../../src/utils/logger';

const mockLogger: ILogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};

describe('ConfigurationService', () => {
    let service: ConfigurationService;

    beforeEach(() => {
        service = new ConfigurationService(mockLogger);
    });

    test('Beispielkonfiguration ist valide', () => {
        const cfg = service.createExampleConfig();
        const result = service.validate(cfg);
        expect(result.errors).toEqual([]);
        expect(result.valid).toBe(true);
    });

    test('Export/Import-Roundtrip', () => {
        const cfg = service.createExampleConfig();
        const json = service.exportConfig(cfg);
        const { config, result } = service.importConfig(json);
        expect(result.valid).toBe(true);
        expect(config?.groups.length).toBe(cfg.groups.length);
    });

    test('Ungültiger JSON-String wird abgelehnt', () => {
        const { config, result } = service.importConfig('{ nicht: valides json }');
        expect(config).toBeNull();
        expect(result.valid).toBe(false);
    });

    test('Fehlende Gruppen-ID wird erkannt', () => {
        const cfg = service.createExampleConfig();
        (cfg.groups[0] as { id: string }).id = '';
        const result = service.validate(cfg);
        expect(result.errors.some(e => e.includes('ID'))).toBe(true);
    });

    test('Doppelte Gruppen-ID wird erkannt', () => {
        const cfg = service.createExampleConfig();
        const clone = { ...cfg.groups[0], name: 'Klon' };
        cfg.groups.push(clone);
        const result = service.validate(cfg);
        expect(result.errors.some(e => e.includes('Doppelte'))).toBe(true);
    });

    test('Migration füllt fehlende Defaults auf', () => {
        const migrated = service.migrate({ language: 'de' });
        expect(migrated.controlCycleSeconds).toBe(10);
        expect(migrated.groups).toEqual([]);
    });
});
