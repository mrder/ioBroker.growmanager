import type { GrowManagerConfig } from '../models/config';
import type { ILogger } from '../utils/logger';
export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}
export declare class ConfigurationService {
    private readonly log;
    constructor(log: ILogger);
    /**
     * Validiert die Gesamtkonfiguration.
     */
    validate(config: GrowManagerConfig): ValidationResult;
    private validateGroup;
    private validateSensor;
    /**
     * Exportiert die Konfiguration als JSON-String.
     */
    exportConfig(config: GrowManagerConfig): string;
    /**
     * Importiert und validiert eine Konfiguration.
     */
    importConfig(json: string): {
        config: GrowManagerConfig | null;
        result: ValidationResult;
    };
    /**
     * Migrationsfunktion für zukünftige Konfigurationsversionen.
     */
    migrate(raw: Partial<GrowManagerConfig>): GrowManagerConfig;
    /**
     * Erstellt eine Beispielkonfiguration für erste Inbetriebnahme.
     */
    createExampleConfig(): GrowManagerConfig;
}
//# sourceMappingURL=ConfigurationService.d.ts.map