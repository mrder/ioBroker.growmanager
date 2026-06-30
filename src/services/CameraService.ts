// ============================================================
// GrowManager – CameraService
// Timelapse, Snapshot-Verwaltung, optionale Bildanalyse.
// Ist kein Snapshot abrufbar → kein Fehler, nur kein Bild.
// ============================================================

import type { CameraConfig, GroupConfig } from '../models/config';
import type { AlarmService } from './AlarmService';
import { ALARM_CODES } from './AlarmService';
import type { ILogger } from '../utils/logger';

export interface CameraState {
    cameraId: string;
    lastSnapshotTs: number;      // 0 = noch kein Snapshot
    lastSnapshotPath: string;
    snapshotCount: number;
    health: 'ok' | 'offline' | 'error' | 'unknown';
    lastError?: string;
    analysisResult?: CameraAnalysisResult;
    lastAnalysisTs: number;
}

export interface CameraAnalysisResult {
    ts: number;
    confidence: number;           // 0..1
    tags: string[];               // z.B. ['yellowLeaves', 'overwatered', 'healthy']
    healthScore: number;          // 0..100 Schätzung Pflanzengesundheit
    rawText: string;
    source: 'localBasic' | 'localAI' | 'externalAI' | 'manual';
}

export class CameraService {
    private readonly cameraStates = new Map<string, CameraState>();
    private readonly nextSnapshotAt = new Map<string, number>();

    constructor(
        private readonly alarmService: AlarmService,
        private readonly log: ILogger
    ) {}

    initCamera(camera: CameraConfig): void {
        if (this.cameraStates.has(camera.id)) return;
        this.cameraStates.set(camera.id, {
            cameraId: camera.id,
            lastSnapshotTs: 0,
            lastSnapshotPath: '',
            snapshotCount: 0,
            health: 'unknown',
            lastAnalysisTs: 0,
        });
        this.nextSnapshotAt.set(camera.id, Date.now());
    }

    /**
     * Prüft ob jetzt ein Snapshot gemacht werden soll.
     * Berücksichtigt Intervall und Lichtbedingung.
     */
    shouldCapture(camera: CameraConfig, isLightOn: boolean): boolean {
        if (!camera.enabled) return false;
        if (camera.captureOnlyWhenLightOn && !isLightOn) return false;

        const next = this.nextSnapshotAt.get(camera.id) ?? 0;
        return Date.now() >= next;
    }

    /**
     * Registriert einen erfolgreich aufgenommenen Snapshot.
     * Der Pfad wird von außen übergeben (ioBroker-State-Wert oder lokaler Pfad).
     */
    recordSnapshot(
        cameraId: string,
        path: string,
        groupId: string,
        camera: CameraConfig
    ): void {
        const state = this.cameraStates.get(cameraId);
        if (!state) return;

        state.lastSnapshotTs = Date.now();
        state.lastSnapshotPath = path;
        state.snapshotCount++;
        state.health = 'ok';
        state.lastError = undefined;

        // Nächsten Snapshot-Zeitpunkt setzen
        this.nextSnapshotAt.set(
            cameraId,
            Date.now() + camera.captureIntervalMinutes * 60000
        );

        this.alarmService.clear(ALARM_CODES.CAMERA_OFFLINE, groupId, `camera:${cameraId}`);
        this.log.debug(`Kamera ${cameraId}: Snapshot #${state.snapshotCount} gespeichert`);
    }

    /**
     * Fehler beim Snapshot-Abruf registrieren.
     */
    recordError(cameraId: string, groupId: string, camera: CameraConfig, error: string): void {
        const state = this.cameraStates.get(cameraId);
        if (!state) return;

        state.health = 'error';
        state.lastError = error;

        // Alarm nur wenn Kamera seit längerem offline
        const minutesSinceLastSnapshot = state.lastSnapshotTs > 0
            ? (Date.now() - state.lastSnapshotTs) / 60000
            : 999;

        if (minutesSinceLastSnapshot > camera.captureIntervalMinutes * 3) {
            state.health = 'offline';
            this.alarmService.raise(
                ALARM_CODES.CAMERA_OFFLINE,
                groupId,
                `camera:${cameraId}`,
                'warning',
                `Kamera ${camera.name} antwortet nicht (${minutesSinceLastSnapshot.toFixed(0)} min seit letztem Snapshot)`
            );
        }

        // Nächsten Versuch in 5 Minuten
        this.nextSnapshotAt.set(cameraId, Date.now() + 5 * 60000);
        this.log.warn(`Kamera ${cameraId}: Fehler – ${error}`);
    }

    /**
     * Speichert ein Analyse-Ergebnis (von externem AI-Dienst oder lokalem OpenCV).
     */
    recordAnalysis(cameraId: string, result: CameraAnalysisResult, camera: CameraConfig): void {
        const state = this.cameraStates.get(cameraId);
        if (!state) return;

        if (result.confidence >= camera.minimumConfidence) {
            state.analysisResult = result;
            state.lastAnalysisTs = Date.now();
            this.log.info(
                `Kamera ${cameraId}: Analyse gespeichert (Score ${result.healthScore}, Tags: ${result.tags.join(', ')})`
            );
        } else {
            this.log.debug(
                `Kamera ${cameraId}: Analyse verworfen (Konfidenz ${result.confidence.toFixed(2)} < ${camera.minimumConfidence})`
            );
        }
    }

    /**
     * Prüft ob eine Analyse fällig ist (Intervall in Stunden).
     */
    shouldAnalyze(camera: CameraConfig): boolean {
        if (!camera.enabled) return false;
        if (camera.analysisMode === 'off' || camera.analysisMode === 'timelapse') return false;
        const state = this.cameraStates.get(camera.id);
        if (!state || state.lastSnapshotTs === 0) return false;

        const hoursSinceAnalysis = state.lastAnalysisTs > 0
            ? (Date.now() - state.lastAnalysisTs) / 3600000
            : 999;

        return hoursSinceAnalysis >= camera.aiAnalysisIntervalHours;
    }

    /**
     * Einfache Bild-Analyse ohne externe KI (Farbdurchschnitt, Helligkeitstrend).
     * Placeholder – echte Implementierung würde z.B. OpenCV im Node-Addon nutzen.
     */
    analyzeLocal(
        cameraId: string,
        imagePath: string,
        camera: CameraConfig
    ): CameraAnalysisResult | null {
        if (camera.analysisMode !== 'localBasic' && camera.analysisMode !== 'localAI') {
            return null;
        }
        // Placeholder – gibt eine neutrale Bewertung zurück
        this.log.debug(`Kamera ${cameraId}: Lokale Analyse von ${imagePath} (Placeholder)`);
        return {
            ts: Date.now(),
            confidence: 0.5,
            tags: ['analysisNotImplemented'],
            healthScore: 50,
            rawText: 'Lokale Analyse noch nicht implementiert',
            source: 'localBasic',
        };
    }

    getState(cameraId: string): CameraState | undefined {
        return this.cameraStates.get(cameraId);
    }

    /**
     * Gibt alle Kamerazustände einer Gruppe zurück.
     */
    getGroupStates(group: GroupConfig): CameraState[] {
        return group.cameras
            .filter(c => c.enabled)
            .map(c => this.cameraStates.get(c.id))
            .filter((s): s is CameraState => s !== undefined);
    }
}
