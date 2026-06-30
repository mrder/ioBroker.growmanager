import type { CameraConfig, GroupConfig } from '../models/config';
import type { AlarmService } from './AlarmService';
import type { ILogger } from '../utils/logger';
export interface CameraState {
    cameraId: string;
    lastSnapshotTs: number;
    lastSnapshotPath: string;
    snapshotCount: number;
    health: 'ok' | 'offline' | 'error' | 'unknown';
    lastError?: string;
    analysisResult?: CameraAnalysisResult;
    lastAnalysisTs: number;
}
export interface CameraAnalysisResult {
    ts: number;
    confidence: number;
    tags: string[];
    healthScore: number;
    rawText: string;
    source: 'localBasic' | 'localAI' | 'externalAI' | 'manual';
}
export declare class CameraService {
    private readonly alarmService;
    private readonly log;
    private readonly cameraStates;
    private readonly nextSnapshotAt;
    constructor(alarmService: AlarmService, log: ILogger);
    initCamera(camera: CameraConfig): void;
    /**
     * Prüft ob jetzt ein Snapshot gemacht werden soll.
     * Berücksichtigt Intervall und Lichtbedingung.
     */
    shouldCapture(camera: CameraConfig, isLightOn: boolean): boolean;
    /**
     * Registriert einen erfolgreich aufgenommenen Snapshot.
     * Der Pfad wird von außen übergeben (ioBroker-State-Wert oder lokaler Pfad).
     */
    recordSnapshot(cameraId: string, path: string, groupId: string, camera: CameraConfig): void;
    /**
     * Fehler beim Snapshot-Abruf registrieren.
     */
    recordError(cameraId: string, groupId: string, camera: CameraConfig, error: string): void;
    /**
     * Speichert ein Analyse-Ergebnis (von externem AI-Dienst oder lokalem OpenCV).
     */
    recordAnalysis(cameraId: string, result: CameraAnalysisResult, camera: CameraConfig): void;
    /**
     * Prüft ob eine Analyse fällig ist (Intervall in Stunden).
     */
    shouldAnalyze(camera: CameraConfig): boolean;
    /**
     * Einfache Bild-Analyse ohne externe KI (Farbdurchschnitt, Helligkeitstrend).
     * Placeholder – echte Implementierung würde z.B. OpenCV im Node-Addon nutzen.
     */
    analyzeLocal(cameraId: string, imagePath: string, camera: CameraConfig): CameraAnalysisResult | null;
    getState(cameraId: string): CameraState | undefined;
    /**
     * Gibt alle Kamerazustände einer Gruppe zurück.
     */
    getGroupStates(group: GroupConfig): CameraState[];
}
//# sourceMappingURL=CameraService.d.ts.map