// ============================================================
// GrowManager – ioBroker Adapter
// ============================================================

/// <reference types="@types/iobroker" />
import * as utils from '@iobroker/adapter-core';

import type {
    GrowManagerConfig,
    GroupConfig,
    GroupState,
    ClimateProfile,
    ControlDecision,
    DayNight,
    DegradationLevel,
    ActuatorType,
} from './models/config';

import { SensorService } from './services/SensorService';
import { ActuatorService } from './services/ActuatorService';
import { ScheduleService } from './services/ScheduleService';
import { AlarmService, ALARM_CODES } from './services/AlarmService';
import { SafetyService } from './services/SafetyService';
import { ClimateController } from './control/ClimateController';
import { DiagnosticsEngine } from './diagnostics/DiagnosticsEngine';
import { GroupCapabilityService } from './services/GroupCapabilityService';
import { AirSystemService } from './services/AirSystemService';
import { IrrigationService } from './services/IrrigationService';
import { CameraService } from './services/CameraService';
import { ConfigurationService } from './services/ConfigurationService';
import { SharedActorManager } from './services/SharedActorManager';
import { WebDashboardService } from './services/WebDashboardService';
import { NotificationService } from './services/NotificationService';
import { DatabaseService } from './services/DatabaseService';
import * as path from 'path';
import { PrefixedLogger } from './utils/logger';
import {
    calculateVPD,
    calculateLeafVPD,
    dewPoint,
    absoluteHumidity,
    condensationRisk,
} from './utils/calculations';

class GrowManagerAdapter extends utils.Adapter {
    private growConfig!: GrowManagerConfig;
    private cycleTimer: ioBroker.Timeout | null = null;
    private watchdogTimer: ioBroker.Interval | null = null;

    private readonly sensorService: SensorService;
    private readonly actuatorService: ActuatorService;
    private readonly scheduleService: ScheduleService;
    private readonly alarmService: AlarmService;
    private readonly safetyService: SafetyService;
    private readonly climateController: ClimateController;
    private readonly diagnosticsEngine: DiagnosticsEngine;
    private readonly capabilityService: GroupCapabilityService;
    private readonly airSystemService: AirSystemService;
    private readonly irrigationService: IrrigationService;
    private readonly cameraService: CameraService;
    private readonly configurationService: ConfigurationService;
    private readonly sharedActorManager: SharedActorManager;
    private readonly webDashboard: WebDashboardService;
    private readonly notificationService: NotificationService;
    private readonly databaseService: DatabaseService;

    // Laufzeit-Zustände
    private readonly groupStates = new Map<string, GroupState>();
    private readonly votingResults = new Map<string, boolean | number>(); // letzte Voting-Entscheidung je Aktor-ID
    private readonly directDesires = new Map<string, boolean | number>(); // aktueller Reglerwunsch für direkte Aktoren
    private readonly switchBlocks = new Map<string, { reason: string; until: number }>(); // canSwitch-Sperren für Dashboard
    private readonly lightChangeTimes = new Map<string, number>();
    private readonly lightTransitionFromNight = new Map<string, boolean>(); // true = Morgen-Übergang (Nacht→Tag)
    private readonly subscribedStateIds = new Set<string>();

    // Letzte bekannte Tag/Nacht-Zustände für Wechselerkennung
    private readonly lastDayNight = new Map<string, DayNight>();

    // Manuelle Übersteuerungen vom Dashboard {actuatorId → {command, until}}
    private readonly dashboardOverrides = new Map<string, { command: boolean | number; until: number }>();

    // Modus-Übersteuerungen vom Dashboard {groupId → 'auto'|'manual'}
    private readonly dashboardModeOverrides = new Map<string, string>();

    // Pending command verifications {actuatorId → timer}
    private readonly pendingVerify = new Map<string, ioBroker.Timeout>();
    // Lock gegen parallele Regelzyklen
    private cycleRunning = false;
    // Zeitstempel des letzten E-Stop-Schreibdurchlaufs; 0 = noch nie angewendet
    // Re-Apply alle 60s damit Geräte die reconnecten wieder sicher gestellt werden
    private emergencyStopLastAppliedAt = 0;

    // Außenluft-Sensorwerte {stateId → Wert}
    private readonly outdoorValues = new Map<string, number>();

    // Letzter bekannter kWh-Wert pro Aktor-State-ID für Delta-Berechnung
    private readonly lastKwhValues = new Map<string, number>();

    constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({ ...options, name: 'growmanager' });

        const log = {
            debug: (m: string) => this.log.debug(m),
            info: (m: string) => this.log.info(m),
            warn: (m: string) => this.log.warn(m),
            error: (m: string) => this.log.error(m),
        };

        this.alarmService = new AlarmService(log);
        this.safetyService = new SafetyService(this.alarmService, log);
        this.sensorService = new SensorService(log);
        this.actuatorService = new ActuatorService(log);
        this.scheduleService = new ScheduleService();
        this.climateController = new ClimateController(this.alarmService, log);
        this.diagnosticsEngine = new DiagnosticsEngine(this.alarmService, log);
        this.capabilityService = new GroupCapabilityService();
        this.airSystemService = new AirSystemService(this.alarmService, log);
        this.irrigationService = new IrrigationService(this.alarmService, log);
        this.cameraService = new CameraService(this.alarmService, log);
        this.configurationService = new ConfigurationService(log);
        this.sharedActorManager = new SharedActorManager();
        this.webDashboard = new WebDashboardService(log, path.join(__dirname, '..'));
        this.notificationService = new NotificationService(log, (adapter, command, data) => {
            this.sendTo(adapter, command, data as ioBroker.MessagePayload);
        });
        this.databaseService = new DatabaseService(
            log,
            async (id, val) => { await this.setStateAsync(id, { val, ack: true }); },
            async (id) => {
                const s = await this.getStateAsync(id);
                return typeof s?.val === 'string' ? s.val : null;
            },
        );

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    // ============================================================
    // Lifecycle
    // ============================================================

    private async onReady(): Promise<void> {
        this.log.info(`GrowManager v${this.version} startet`);
        this.growConfig = (this.config as unknown as GrowManagerConfig);

        if (!this.growConfig.groups) this.growConfig.groups = [];
        if (!this.growConfig.climateProfiles) this.growConfig.climateProfiles = [];
        if (!this.growConfig.alarmChannels) this.growConfig.alarmChannels = [];
        if (!this.growConfig.notifications) {
            this.growConfig.notifications = { enabled: false, channels: [], cooldownMinutes: 30 };
        }

        this.alarmService.setRetentionDays(this.growConfig.eventRetentionDays ?? 30);

        // Bewässerungsprotokoll
        this.irrigationService.setOnStop(event => {
            this.databaseService.addIrrigationEvent(event.groupId, {
                ts: event.startTs,
                zoneId: event.zoneId,
                zoneName: event.zoneName,
                durationSec: event.durationSec,
                startMoisture: event.startMoisture,
                endMoisture: event.endMoisture,
                trigger: event.trigger,
                flowLiters: event.flowLiters,
            }).catch(e => this.log.error(`IrrigationLog: ${e}`));
        });

        // Push-Benachrichtigungen: bei neuem Alarm benachrichtigen
        this.alarmService.addListener(({ alarm, isNew }) => {
            const notifCfg = this.growConfig.notifications;
            if (!notifCfg?.enabled) return;
            const groupName = this.growConfig.groups.find(g => g.id === alarm.groupId)?.name ?? alarm.groupId;
            this.notificationService.notify(alarm, isNew, groupName, notifCfg).catch(e => {
                this.log.error(`Notification-Fehler: ${e}`);
            });
        });

        // Instanz-States aktualisieren
        await this.setStateAsync('info.version', { val: this.version, ack: true });
        await this.setStateAsync('info.status', { val: 'initializing', ack: true });
        await this.setStateAsync('info.connection', { val: false, ack: true });

        // Kontroll-States abonnieren
        await this.subscribeStatesAsync('control.*');

        // Gruppen initialisieren
        for (const group of this.growConfig.groups) {
            try {
                await this.initGroup(group);
            } catch (err) {
                this.log.error(`Gruppe ${group.name}: Initialisierung fehlgeschlagen – ${err}`);
            }
        }

        // Start-Verhalten
        await this.applyStartBehavior();

        // Alarm-Kanäle einrichten
        this.setupAlarmChannels();

        await this.setStateAsync('info.status', { val: 'running', ack: true });
        await this.setStateAsync('info.connection', { val: true, ack: true });

        // Web-Dashboard starten
        const webPort = this.growConfig.webPort ?? 8097;
        const webBind = this.growConfig.webBindAddress ?? '0.0.0.0';
        this.webDashboard.setPin(this.growConfig.dashboardPin ?? '');
        this.webDashboard.setPlantIdApiKey(this.growConfig.plantIdApiKey ?? '');
        this.webDashboard.setModeCallback(async ({ groupId, mode }) => {
            const group = this.growConfig.groups.find(g => g.id === groupId);
            if (!group) throw new Error(`Gruppe ${groupId} nicht gefunden`);
            if (mode === 'auto') {
                this.dashboardModeOverrides.delete(groupId);
                for (const a of group.actuators) {
                    this.dashboardOverrides.delete(a.id);
                    this.actuatorService.unlockManual(a.id);
                }
                this.log.info(`Dashboard: Gruppe ${group.name} → AUTO (Locks aufgehoben, Sofort-Zyklus)`);
                // Sofort-Zyklus damit der korrekte Zustand direkt gesetzt wird
                await this.runCycle();
            } else {
                this.dashboardModeOverrides.set(groupId, mode);
                this.log.info(`Dashboard: Gruppe ${group.name} → MANUELL`);
            }
        });
        this.webDashboard.setTrendsCallback(async (groupId, variable) => {
            // Variablen-Name → tatsächlicher ioBroker-State-Pfad
            const varToPath: Record<string, string> = {
                temperature: 'climate.temperature',
                humidity:    'climate.humidity',
                vpd:         'climate.vpd',
                soilMoisture:'soil.moisture',
                co2:         'climate.co2',
            };
            const subPath = varToPath[variable] ?? `climate.${variable}`;
            const stateId = `${this.namespace}.groups.${groupId}.${subPath}`;
            const start = Date.now() - 48 * 3600 * 1000;
            const historyAdapters = ['history.0', 'influxdb.0', 'sql.0'];
            let foundAdapter: string | null = null;
            for (const adapter of historyAdapters) {
                try {
                    const pts = await this.queryHistory(adapter, stateId, start, Date.now());
                    if (pts.length > 0) return { points: pts };
                    if (!foundAdapter) foundAdapter = adapter;
                    this.log.debug(`History: ${adapter} hat keine Daten für ${stateId}`);
                } catch { /* Adapter nicht installiert, nächsten probieren */ }
            }
            if (foundAdapter) {
                return {
                    points: [],
                    hint: `History-Adapter (${foundAdapter}) gefunden, aber keine Daten für diesen State.\n` +
                        `Bitte in ioBroker unter Objekte → ${stateId} → History-Tab die Aufzeichnung aktivieren.`,
                };
            }
            // Kein History-Adapter → eigener Puffer als Fallback (nur temp/humidity/vpd)
            if (variable === 'temperature' || variable === 'humidity' || variable === 'vpd') {
                const pts = this.diagnosticsEngine.getHourlyHistory(groupId, variable);
                return { points: pts };
            }
            return {
                points: [],
                hint: `Kein History-Adapter installiert.\nBitte history.0, influxdb.0 oder sql.0 installieren\nund den State ${stateId} zur Aufzeichnung aktivieren.`,
            };
        });
        this.webDashboard.setControlCallback(async ({ groupId, actuatorId, command, durationMinutes }) => {
            // Aktor in eigener Gruppe suchen; falls nicht gefunden, quer über alle Gruppen (shared-from Sicht)
            let actuator = this.growConfig.groups.find(g => g.id === groupId)?.actuators.find(a => a.id === actuatorId);
            if (!actuator) {
                for (const g of this.growConfig.groups) {
                    actuator = g.actuators.find(a => a.id === actuatorId);
                    if (actuator) break;
                }
            }
            if (!actuator) throw new Error(`Aktor ${actuatorId} nicht gefunden`);
            this.dashboardOverrides.set(actuatorId, { command, until: Date.now() + durationMinutes * 60_000 });
            // Lock blockiert Auto-Zyklus und setzt requested auf manuellen Wert (→ korrekte LED-Anzeige)
            this.actuatorService.lockForManual(actuatorId, command);
            const val = command ? actuator.onValue : actuator.offValue;
            await this.setForeignStateAsync(actuator.commandStateId, { val: val as ioBroker.StateValue, ack: false });
            this.log.info(`Dashboard: ${actuator.name} → ${command ? 'EIN' : 'AUS'} (${durationMinutes} min)`);
        });
        this.webDashboard.setDatabaseCallback((groupId, type) => {
            switch (type) {
                case 'stats': return this.databaseService.getStats(groupId);
                case 'energy': return this.databaseService.getEnergy(groupId);
                case 'irrigation': return this.databaseService.getIrrigation(groupId);
            }
        });
        this.webDashboard.setLifestyleCallbacks(
            async (groupId) => {
                const s = await this.getStateAsync(`lifestyle.${groupId}`);
                if (typeof s?.val === 'string' && s.val) {
                    try { return JSON.parse(s.val); } catch { /* ignore */ }
                }
                return {};
            },
            async (groupId, data) => {
                await this.setObjectNotExistsAsync(`lifestyle.${groupId}`, {
                    type: 'state',
                    common: { name: `Lifestyle ${groupId}`, type: 'string', role: 'json', read: true, write: true, def: '{}' },
                    native: {},
                });
                await this.setStateAsync(`lifestyle.${groupId}`, { val: JSON.stringify(data), ack: true });
            },
        );
        this.webDashboard.setStrainsCallbacks(
            async () => {
                const state = await this.getStateAsync('database.strains');
                if (state?.val && typeof state.val === 'string') {
                    try {
                        const parsed = JSON.parse(state.val) as import('./services/WebDashboardService').StrainEntry[];
                        if (Array.isArray(parsed)) return parsed;
                    } catch { /* ignore */ }
                }
                return [];
            },
            async (strains) => {
                await this.setStateAsync('database.strains', JSON.stringify(strains), true);
            },
        );
        this.webDashboard.setAnalysesCallbacks(
            async (groupId) => {
                const state = await this.getStateAsync(`database.${groupId}.analyses`);
                if (state?.val && typeof state.val === 'string') {
                    try {
                        const parsed = JSON.parse(state.val) as import('./services/WebDashboardService').AnalysisEntry[];
                        if (Array.isArray(parsed)) return parsed;
                    } catch { /* ignore */ }
                }
                return [];
            },
            async (groupId, analyses) => {
                await this.setStateAsync(`database.${groupId}.analyses`, JSON.stringify(analyses), true);
            },
        );
        await this.initGlobalDatabase();
        this.webDashboard.start(webPort, webBind);

        // Regelzyklus starten
        this.scheduleNextCycle();

        // Watchdog
        this.watchdogTimer = this.setInterval(() => {
            this.actuatorService.tickOverrides();
            this.alarmService.cleanup(new Set(this.growConfig.groups.map(g => g.id)));
            // Tagesabschluss kurz nach Mitternacht
            for (const group of this.growConfig.groups) {
                this.databaseService.tickMidnight(group.id).catch(e => this.log.error(`DB Midnight: ${e}`));
            }
        }, 60000);

        this.log.info('GrowManager bereit');
    }

    private async initGroup(group: GroupConfig): Promise<void> {
        this.log.info(`Initialisiere Gruppe: ${group.name}`);

        // Sensor-States initialisieren
        for (const sensor of group.sensors) {
            this.sensorService.initState(sensor);
        }

        // Aktoren initialisieren
        for (const actuator of group.actuators) {
            this.actuatorService.initActuator(actuator);
        }

        // Bewässerungs-Zonen initialisieren
        for (const zone of group.irrigationZones) {
            this.irrigationService.initZone(zone);
        }

        // Kameras initialisieren
        for (const camera of group.cameras) {
            this.cameraService.initCamera(camera);
        }

        // Gruppen-Laufzeit-State anlegen
        const now = new Date();
        const dayNight = this.scheduleService.getDayNight(now, group.schedule);
        this.lastDayNight.set(group.id, dayNight);

        const groupState: GroupState = {
            id: group.id,
            mode: group.mode,
            degradation: 'FULL',
            dayNight,
            temperature: null,
            humidity: null,
            vpd: null,
            leafVpd: null,
            dewPoint: null,
            absoluteHumidity: null,
            condensationRisk: false,
            co2: null,
            sensorQuality: 0,
            sensors: new Map(),
            actuators: new Map(),
            alarmActive: false,
        };
        this.groupStates.set(group.id, groupState);

        // ioBroker-States für Gruppe anlegen
        await this.createGroupObjects(group);
        await this.createDatabaseObjects(group.id);
        await this.databaseService.loadGroup(group.id);

        // Sensor-States abonnieren + aktuelle Werte sofort einlesen
        for (const sensor of group.sensors) {
            if (!this.subscribedStateIds.has(sensor.stateId)) {
                await this.subscribeForeignStatesAsync(sensor.stateId);
                this.subscribedStateIds.add(sensor.stateId);
            }
            const current = await this.getForeignStateAsync(sensor.stateId);
            if (current) {
                // Date.now() als ts: Wert gilt ab Erststart als frisch, Stale-Timer beginnt jetzt
                const ss = this.sensorService.processValue(sensor, current.val as number, Date.now(), current.lc ?? current.ts);
                if (ss) groupState.sensors.set(sensor.id, ss);
            }

            // Health-State abonnieren falls konfiguriert
            if (sensor.healthStateId && !this.subscribedStateIds.has(sensor.healthStateId)) {
                await this.subscribeForeignStatesAsync(sensor.healthStateId);
                this.subscribedStateIds.add(sensor.healthStateId);
                const h = await this.getForeignStateAsync(sensor.healthStateId);
                if (h) this.applyHealthState(sensor.healthStateId, h.val, sensor.healthCheckType, sensor.healthCheckMin);
            }
        }

        // Außensensor abonnieren (optional)
        const outdoor = group.outdoorSensor;
        if (outdoor?.enabled) {
            for (const sid of [outdoor.tempStateId, outdoor.humidityStateId]) {
                if (sid && !this.subscribedStateIds.has(sid)) {
                    await this.subscribeForeignStatesAsync(sid);
                    this.subscribedStateIds.add(sid);
                    const st = await this.getForeignStateAsync(sid);
                    if (st && typeof st.val === 'number') this.outdoorValues.set(sid, st.val);
                }
            }
        }

        // Feedback- und Leistungs-States abonnieren
        for (const actuator of group.actuators) {
            if (actuator.feedbackStateId && !this.subscribedStateIds.has(actuator.feedbackStateId)) {
                await this.subscribeForeignStatesAsync(actuator.feedbackStateId);
                this.subscribedStateIds.add(actuator.feedbackStateId);
                const current = await this.getForeignStateAsync(actuator.feedbackStateId);
                if (current?.val !== null && current?.val !== undefined) {
                    this.actuatorService.processFeedback(actuator, current.val);
                }
            }
            // Kein separates Feedback: stateId selbst subscriben → ack:true = Gerätebestätigung
            if (!actuator.feedbackStateId && !this.subscribedStateIds.has(actuator.commandStateId)) {
                await this.subscribeForeignStatesAsync(actuator.commandStateId);
                this.subscribedStateIds.add(actuator.commandStateId);
                const current = await this.getForeignStateAsync(actuator.commandStateId);
                if (current?.ack && current.val !== null && current.val !== undefined) this.actuatorService.processFeedback(actuator, current.val as boolean | number);
            }
            if (actuator.powerStateId && !this.subscribedStateIds.has(actuator.powerStateId)) {
                await this.subscribeForeignStatesAsync(actuator.powerStateId);
                this.subscribedStateIds.add(actuator.powerStateId);
                const currentPower = await this.getForeignStateAsync(actuator.powerStateId);
                if (currentPower?.val !== null && currentPower?.val !== undefined) {
                    const actState = this.actuatorService.getState(actuator.id);
                    if (actState) this.actuatorService.processFeedback(actuator, actState.feedback, currentPower.val);
                }
            }
            if (actuator.energyStateId && !this.subscribedStateIds.has(actuator.energyStateId)) {
                await this.subscribeForeignStatesAsync(actuator.energyStateId);
                this.subscribedStateIds.add(actuator.energyStateId);
            }
            // Energie-Tracking: beim Start bereits-AN-Aktoren erfassen
            {
                const actState = this.actuatorService.getState(actuator.id);
                const isOn = actState
                    ? (typeof actState.effectiveState === 'boolean' ? actState.effectiveState : (actState.effectiveState as number) > 0)
                    : false;
                if (isOn && actuator.energyStateUnit !== 'kWh') {
                    let startRatedW = actuator.ratedPowerW ?? 0;
                    // W-Sensor: aktuellen Wert als Nennleistungs-Fallback lesen,
                    // da ioBroker State-Events nur bei Wertänderungen feuern.
                    if (actuator.energyStateUnit === 'W' && actuator.energyStateId && startRatedW === 0) {
                        const wState = await this.getForeignStateAsync(actuator.energyStateId);
                        if (typeof wState?.val === 'number' && wState.val > 0) startRatedW = wState.val;
                    }
                    this.databaseService.trackActuatorOn(group.id, actuator.id, actuator.name, startRatedW);
                }
            }
            if (actuator.healthStateId && !this.subscribedStateIds.has(actuator.healthStateId)) {
                await this.subscribeForeignStatesAsync(actuator.healthStateId);
                this.subscribedStateIds.add(actuator.healthStateId);
                const h = await this.getForeignStateAsync(actuator.healthStateId);
                if (h) this.applyHealthState(actuator.healthStateId, h.val, actuator.healthCheckType, actuator.healthCheckMin);
            }
        }
    }

    private async applyStartBehavior(): Promise<void> {
        const behavior = this.growConfig.startBehavior ?? 'lastState';
        this.log.info(`Start-Verhalten: ${behavior}`);
        switch (behavior) {
            case 'safeTurnOff':
                for (const group of this.growConfig.groups) {
                    for (const actuator of group.actuators) {
                        await this.setActuatorState(actuator.commandStateId, actuator.offValue);
                    }
                }
                break;
            case 'monitorOnly':
                this.safetyService.setGlobalMaintenance(true);
                break;
            default:
                break;
        }
    }

    private onUnload(callback: () => void): void {
        try {
            if (this.cycleTimer) this.clearTimeout(this.cycleTimer);
            if (this.watchdogTimer) this.clearInterval(this.watchdogTimer);
            for (const t of this.pendingVerify.values()) this.clearTimeout(t);
            this.pendingVerify.clear();
            this.webDashboard.stop();
            Promise.all([
                this.setStateAsync('info.connection', { val: false, ack: true }),
                this.setStateAsync('info.status', { val: 'stopped', ack: true }),
            ]).catch(() => {}).finally(() => callback());
        } catch {
            callback();
        }
    }

    // ============================================================
    // History-Adapter Abfrage
    // ============================================================

    private queryHistory(
        adapter: string,
        stateId: string,
        start: number,
        end: number
    ): Promise<Array<{ ts: number; value: number }>> {
        return new Promise((resolve, reject) => {
            const timer = this.setTimeout(() => reject(new Error(`${adapter} timeout`)), 4000);
            this.sendTo(adapter, 'getHistory', {
                id: stateId,
                options: { start, end, aggregate: 'none', count: 5000, addId: false },
            }, (result) => {
                this.clearTimeout(timer);
                const r = result as { result?: Array<{ ts: number; val: number }>; error?: string } | undefined;
                if (!r || r.error) { reject(new Error(r?.error ?? 'no result')); return; }
                const pts = (r.result ?? []).filter(p => p.val !== null && p.val !== undefined);
                resolve(pts.map(p => ({ ts: p.ts, value: Number(p.val) })));
            });
        });
    }

    // ============================================================
    // State-Abonnements
    // ============================================================

    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        if (!state) return;
        if (!this.growConfig) return;

        // Eigene Steuer-States verarbeiten
        if (id.startsWith(`${this.namespace}.control.`)) {
            this.handleControlState(id, state);
            return;
        }

        // Health-State-Änderungen verarbeiten
        for (const group of this.growConfig.groups) {
            for (const sensor of group.sensors) {
                if (sensor.healthStateId === id) {
                    this.applyHealthState(id, state.val, sensor.healthCheckType, sensor.healthCheckMin);
                }
            }
            for (const actuator of group.actuators) {
                if (actuator.healthStateId === id) {
                    this.applyHealthState(id, state.val, actuator.healthCheckType, actuator.healthCheckMin);
                }
            }
        }

        // Fremde States Sensoren zuordnen
        for (const group of this.growConfig.groups) {
            for (const sensor of group.sensors) {
                if (sensor.stateId === id) {
                    const sensorState = this.sensorService.processValue(
                        sensor,
                        state.val,
                        // Receiving onStateChange NOW means sensor reported NOW.
                        // state.ts can be old when value hasn't changed (no lc update),
                        // which would falsely trigger the stale check.
                        Math.max(state.ts, Date.now() - 5000),
                        state.lc ?? state.ts,
                        group.stabilityTimeSeconds
                    );
                    const gs = this.groupStates.get(group.id);
                    if (gs && sensorState) gs.sensors.set(sensor.id, sensorState);
                }
            }

            // Feedback/Leistung verarbeiten
            for (const actuator of group.actuators) {
                const isFeedback = actuator.feedbackStateId === id;
                const isCommandAck = !actuator.feedbackStateId && actuator.commandStateId === id;
                // Nur ack:true verarbeiten — eigene ack:false Schreibbefehle ignorieren
                if ((isFeedback || isCommandAck) && state.ack) {
                    this.actuatorService.processFeedback(actuator, state.val);
                    // Ausstehende Verifikation abbrechen, Gerät hat geantwortet
                    const t = this.pendingVerify.get(actuator.id);
                    if (t) { this.clearTimeout(t); this.pendingVerify.delete(actuator.id); }
                }
                if (actuator.powerStateId === id) {
                    const actState = this.actuatorService.getState(actuator.id);
                    if (actState) {
                        this.actuatorService.processFeedback(actuator, actState.feedback, state.val);
                    }
                }
                // Energie-Tracking: kWh-State
                if (actuator.energyStateId === id && typeof state.val === 'number' && actuator.energyStateUnit === 'kWh') {
                    const prev = this.lastKwhValues.get(id);
                    this.lastKwhValues.set(id, state.val);
                    if (prev !== undefined && state.val >= prev) {
                        const deltaWh = (state.val - prev) * 1000;
                        this.databaseService.trackActuatorWh(group.id, actuator.id, actuator.name, deltaWh, 0);
                    }
                }
                // Energie-Tracking: W-State (Momentanleistung) → Wh per Sample akkumulieren
                if (actuator.energyStateId === id && typeof state.val === 'number' && actuator.energyStateUnit === 'W') {
                    this.databaseService.updateActuatorPowerSample(group.id, actuator.id, state.val);
                }
            }

            // Außensensor-Werte aktualisieren
            const outdoor = group.outdoorSensor;
            if (outdoor?.enabled && typeof state.val === 'number') {
                if (outdoor.tempStateId === id || outdoor.humidityStateId === id) {
                    this.outdoorValues.set(id, state.val);
                }
            }
        }
    }

    private applyHealthState(
        stateId: string,
        val: ioBroker.StateValue,
        checkType?: 'boolean' | 'number',
        checkMin?: number
    ): void {
        let healthy: boolean;
        if (checkType === 'number') {
            healthy = typeof val === 'number' && val >= (checkMin ?? 1);
        } else {
            // boolean (default): true/1/"true" = healthy
            healthy = val === true || val === 1 || val === 'true';
        }
        this.sensorService.setDeviceHealth(stateId, healthy);
        // Für Aktoren: ActuatorState.health aktualisieren + Alarm
        for (const group of this.growConfig.groups) {
            for (const actuator of group.actuators) {
                if (actuator.healthStateId === stateId) {
                    this.actuatorService.setReachable(actuator.id, healthy);
                    if (!healthy) {
                        this.log.warn(`Aktor ${actuator.name} nicht erreichbar (${stateId} = ${val})`);
                        this.alarmService.raise(
                            ALARM_CODES.ACTUATOR_UNREACHABLE,
                            group.id,
                            actuator.id,
                            'fault',
                            `Aktor "${actuator.name}" nicht erreichbar`
                        );
                    } else {
                        this.alarmService.clear(ALARM_CODES.ACTUATOR_UNREACHABLE, group.id, actuator.id);
                    }
                }
            }
        }
        if (!healthy) {
            this.log.debug(`Health-State ${stateId} = ${val} → Gerät nicht erreichbar`);
        }
    }

    private handleControlState(id: string, state: ioBroker.State): void {
        if (state.ack) return; // Nur ack=false verarbeiten (Bedienbefehl)

        const key = id.split('.').pop();
        const ack = (v = state.val) => this.setStateAsync(id, { val: v, ack: true }).catch(e => this.log.warn(`ack ${id}: ${e}`));
        switch (key) {
            case 'emergencyStop':
                this.safetyService.setEmergencyStop(!!state.val);
                ack();
                break;
            case 'maintenance':
                this.safetyService.setGlobalMaintenance(!!state.val);
                ack();
                break;
            case 'enabled':
                ack();
                break;
            case 'acknowledgeAll':
                if (state.val) {
                    this.alarmService.acknowledgeAll();
                    ack(false);
                }
                break;
        }
    }

    // ============================================================
    // Regelzyklus
    // ============================================================

    private scheduleNextCycle(): void {
        const interval = (this.growConfig.controlCycleSeconds ?? 10) * 1000;
        this.cycleTimer = this.setTimeout(async () => {
            try {
                await this.runCycle();
            } catch (e) {
                this.log.error(`Unbehandelter Fehler im Regelzyklus: ${e}`);
            }
            this.scheduleNextCycle();
        }, interval);
    }

    private async runCycle(): Promise<void> {
        if (this.cycleRunning) {
            this.log.debug('Regelzyklus übersprungen – vorheriger Zyklus läuft noch');
            return;
        }
        this.cycleRunning = true;
        const cycleStart = Date.now();

        try {
            if (this.safetyService.isEmergencyStop()) {
                await this.handleEmergencyStop();
                return;
            }
            this.emergencyStopLastAppliedAt = 0; // E-Stop beendet → nächster E-Stop schreibt sofort

            // Gemeinsame Aktoren: Anforderungen sammeln und danach auflösen
            this.sharedActorManager.clearCycle();

            for (const group of this.growConfig.groups) {
                if (!group.enabled) continue;
                try {
                    await this.processGroup(group);
                } catch (err) {
                    this.log.error(`Gruppe ${group.name}: Fehler im Zyklus – ${err}`);
                }
            }

            // Teilnehmer-Abstimmungen für geteilte Aktoren mit sharedParticipants
            for (const group of this.growConfig.groups) {
                for (const actuatorConfig of group.actuators) {
                    if (!actuatorConfig.shared || !actuatorConfig.sharedParticipants?.length) continue;
                    const hysteresisSeconds = actuatorConfig.sharedVoteHysteresisSeconds ?? 60;

                    // Eigentümer-Stimme: aktuellen Klimabedarf berechnen (gleiche Logik wie Teilnehmer)
                    const ownerGs = this.groupStates.get(group.id);
                    // Tatsächlichen Hardware-Zustand lesen (nicht votingResults, das speichert nur
                    // Abstimmungsabsicht — wenn canSwitch blockiert hat, wäre votingResults=EIN
                    // obwohl der Aktor physisch aus ist → Phantom-Hysterese).
                    const currentActState = this.actuatorService.getState(actuatorConfig.id);
                    const sharedCurrentlyOn = (currentActState?.requested ?? false) !== false
                        && (currentActState?.requested ?? false) !== 0;
                    let ownerNeed = ownerGs
                        ? this.computeParticipantNeed(actuatorConfig.type, ownerGs, 3, sharedCurrentlyOn)
                        : { wantsOn: false as const, urgency: 0, reason: 'Kein Gruppenstatus' };

                    // Outdoor-Guard für Lüfter: Außenluft nur einsetzen wenn innen wärmer als außen.
                    // Ausnahme: VPD zu hoch (innen zu trocken) + Außenluft feuchter → Feuchte-Zuluft erlauben.
                    if (ownerNeed.wantsOn &&
                        (actuatorConfig.type === 'supplyFan' || actuatorConfig.type === 'exhaustFan') &&
                        actuatorConfig.outdoorGuardEnabled) {
                        const outdoorCfg = group.outdoorSensor;
                        if (outdoorCfg?.enabled && outdoorCfg.tempStateId) {
                            const outTemp = this.outdoorValues.get(outdoorCfg.tempStateId) ?? null;
                            const inTemp = ownerGs?.temperature ?? null;
                            if (outTemp !== null && inTemp !== null) {
                                const minDelta = outdoorCfg.minTempDeltaCelsius ?? 2;
                                if (inTemp - outTemp < minDelta) {
                                    // Ausnahme: Feuchte-Zuluft wenn Innen-VPD zu hoch und Außenluft feuchter
                                    let humidityException = false;
                                    if (outdoorCfg.humidityStateId) {
                                        const outHum = this.outdoorValues.get(outdoorCfg.humidityStateId) ?? null;
                                        const inHum = ownerGs?.humidity ?? null;
                                        const inVpd = ownerGs?.vpd ?? null;
                                        const spKey = ownerGs?.dayNight === 'night' ? 'night' : 'day';
                                        const vpdMax = ownerGs?.activeProfile?.[spKey]?.vpdMax ?? null;
                                        if (outHum !== null && inHum !== null && inVpd !== null && vpdMax !== null
                                            && inVpd > vpdMax && outHum > inHum) {
                                            humidityException = true;
                                            ownerNeed = { wantsOn: true, urgency: Math.min(1, (inVpd - vpdMax) / 0.3), reason: `VPD ${inVpd.toFixed(2)} kPa zu hoch + Außenluft feuchter (${outHum.toFixed(0)}% > ${inHum.toFixed(0)}%) – Feuchte-Zuluft` };
                                            this.log.debug(`SharedAktor ${actuatorConfig.name}: Feuchte-Zuluft-Ausnahme – Außen ${outHum.toFixed(0)}% > Innen ${inHum.toFixed(0)}%, VPD ${inVpd.toFixed(2)} > Max ${vpdMax.toFixed(2)}`);
                                        }
                                    }
                                    if (!humidityException) {
                                        this.log.debug(`SharedAktor ${actuatorConfig.name}: Outdoor-Guard – Außen ${outTemp.toFixed(1)}°C, Innen ${inTemp.toFixed(1)}°C, Delta < ${minDelta}°C → blockiert`);
                                        ownerNeed = { wantsOn: false, urgency: 0, reason: `Außenluft-Guard: Außen ${outTemp.toFixed(1)}°C, Innen ${inTemp.toFixed(1)}°C (Δ<${minDelta}°C)` };
                                    }
                                }
                            }
                        }
                    }

                    this.sharedActorManager.submitVote(actuatorConfig.id, {
                        groupId: group.id,
                        groupName: group.name,
                        wantsOn: ownerNeed.wantsOn,
                        weight: 1.0,
                        urgency: ownerNeed.urgency,
                        reason: ownerNeed.reason,
                    });

                    for (const participant of actuatorConfig.sharedParticipants) {
                        const pState = this.groupStates.get(participant.groupId);
                        if (!pState) continue;
                        const pGroup = this.growConfig.groups.find(g => g.id === participant.groupId);
                        let need = this.computeParticipantNeed(actuatorConfig.type, pState, 3, sharedCurrentlyOn);
                        // Outdoor-Guard für Teilnehmer-Stimmen (Zuluft/Abluft)
                        if (need.wantsOn &&
                            (actuatorConfig.type === 'supplyFan' || actuatorConfig.type === 'exhaustFan') &&
                            actuatorConfig.outdoorGuardEnabled) {
                            const pOutdoorCfg = pGroup?.outdoorSensor;
                            if (pOutdoorCfg?.enabled && pOutdoorCfg.tempStateId) {
                                const outTemp = this.outdoorValues.get(pOutdoorCfg.tempStateId) ?? null;
                                const inTemp = pState.temperature ?? null;
                                if (outTemp !== null && inTemp !== null) {
                                    const minDelta = pOutdoorCfg.minTempDeltaCelsius ?? 2;
                                    if (inTemp - outTemp < minDelta) {
                                        // Ausnahme: Feuchte-Zuluft wenn Innen-VPD zu hoch und Außenluft feuchter
                                        let humidityException = false;
                                        if (pOutdoorCfg.humidityStateId) {
                                            const outHum = this.outdoorValues.get(pOutdoorCfg.humidityStateId) ?? null;
                                            const inHum = pState.humidity ?? null;
                                            const inVpd = pState.vpd ?? null;
                                            const spKey = pState.dayNight === 'night' ? 'night' : 'day';
                                            const vpdMax = pState.activeProfile?.[spKey]?.vpdMax ?? null;
                                            if (outHum !== null && inHum !== null && inVpd !== null && vpdMax !== null
                                                && inVpd > vpdMax && outHum > inHum) {
                                                humidityException = true;
                                                need = { wantsOn: true, urgency: Math.min(1, (inVpd - vpdMax) / 0.3), reason: `VPD ${inVpd.toFixed(2)} kPa zu hoch + Außenluft feuchter (${outHum.toFixed(0)}% > ${inHum.toFixed(0)}%) – Feuchte-Zuluft (Teilnehmer)` };
                                                this.log.debug(`SharedAktor ${actuatorConfig.name} (Teilnehmer ${participant.groupId}): Feuchte-Zuluft-Ausnahme – Außen ${outHum.toFixed(0)}% > Innen ${inHum.toFixed(0)}%, VPD ${inVpd.toFixed(2)} > Max ${vpdMax.toFixed(2)}`);
                                            }
                                        }
                                        if (!humidityException) {
                                            this.log.debug(`SharedAktor ${actuatorConfig.name} (Teilnehmer ${participant.groupId}): Outdoor-Guard – Außen ${outTemp.toFixed(1)}°C, Innen ${inTemp.toFixed(1)}°C, Delta < ${minDelta}°C → blockiert`);
                                            need = { wantsOn: false, urgency: 0, reason: `Außenluft-Guard (Teilnehmer): Außen ${outTemp.toFixed(1)}°C, Innen ${inTemp.toFixed(1)}°C (Δ<${minDelta}°C)` };
                                        }
                                    }
                                }
                            }
                        }
                        this.sharedActorManager.submitVote(actuatorConfig.id, {
                            groupId: participant.groupId,
                            groupName: pGroup?.name ?? participant.groupId,
                            wantsOn: need.wantsOn,
                            weight: participant.influenceFactor / 100,
                            urgency: need.urgency,
                            reason: need.reason,
                        });
                    }

                    // Aktuellen Befehl als Basis für Hysterese ermitteln (currentActState oben bereits gelesen)
                    const currentCommand = currentActState?.requested ?? false;
                    const votingMode = actuatorConfig.sharedVotingMode ?? 'any';
                    const hysteresisForVoting = hysteresisSeconds;

                    const finalCommand = this.sharedActorManager.resolveWithVoting(
                        actuatorConfig.id,
                        votingMode,
                        hysteresisForVoting,
                        group.id,
                        currentCommand,
                    );

                    // Voting-Ergebnis für Dashboard-Anzeige speichern (unabhängig von canSwitch)
                    this.votingResults.set(actuatorConfig.id, finalCommand);

                    const can = this.actuatorService.canSwitch(actuatorConfig, finalCommand);
                    if (can.allowed) {
                        this.switchBlocks.delete(actuatorConfig.id);
                        const changed = this.actuatorService.recordCommand(actuatorConfig, finalCommand);
                        if (changed) {
                            await this.setActuatorState(actuatorConfig.commandStateId, finalCommand);
                            if (typeof finalCommand === 'boolean') {
                                this.setActuatorStateWithVerify(actuatorConfig, group.id, finalCommand);
                            }
                            this.log.info(`SharedAktor ${actuatorConfig.name} → ${finalCommand} (Abstimmung: ${votingMode})`);
                            // Energie-Tracking für geteilte Aktoren
                            if (actuatorConfig.energyStateUnit !== 'kWh') {
                                const isOn = finalCommand === true || (typeof finalCommand === 'number' && finalCommand > 0);
                                if (isOn) {
                                    this.databaseService.trackActuatorOn(group.id, actuatorConfig.id, actuatorConfig.name, actuatorConfig.ratedPowerW ?? 0);
                                } else {
                                    this.databaseService.trackActuatorOff(group.id, actuatorConfig.id, actuatorConfig.ratedPowerW ?? 0);
                                }
                            }
                        }
                    } else {
                        // Sperre für Dashboard-Anzeige merken (Countdown-Timer statt ⏳)
                        this.switchBlocks.set(actuatorConfig.id, {
                            reason: can.reason ?? 'Gesperrt',
                            until: Date.now() + (can.waitSeconds ?? 0) * 1000,
                        });
                    }
                }
            }

            // Gemeinsame Aktoren (Legacy): Konflikte auflösen und Befehle schreiben
            const sharedResults = this.sharedActorManager.resolveAll();
            for (const [, result] of sharedResults) {
                // Zuständigen Aktor in irgendeiner Gruppe finden
                for (const group of this.growConfig.groups) {
                    const act = group.actuators.find(a => a.id === result.actuatorId && a.shared);
                    if (act) {
                        // Wenn dieser Aktor sharedParticipants hat, wurde er bereits oben behandelt
                        if (act.sharedParticipants?.length) break;
                        const can = this.actuatorService.canSwitch(act, result.finalCommand);
                        if (can.allowed) {
                            const changed = this.actuatorService.recordCommand(act, result.finalCommand);
                            if (changed) {
                                await this.setActuatorState(act.commandStateId, result.finalCommand);
                                if (typeof result.finalCommand === 'boolean') {
                                    this.setActuatorStateWithVerify(act, result.winningGroupId, result.finalCommand);
                                }
                                this.log.info(`SharedAktor ${act.name} → ${result.finalCommand} (Gruppe ${result.winningGroupId}: ${result.reason})`);
                                // Energie-Tracking für Legacy-Pfad
                                if (act.energyStateUnit !== 'kWh') {
                                    const isOn = result.finalCommand === true || (typeof result.finalCommand === 'number' && result.finalCommand > 0);
                                    if (isOn) {
                                        this.databaseService.trackActuatorOn(result.winningGroupId, act.id, act.name, act.ratedPowerW ?? 0);
                                    } else {
                                        this.databaseService.trackActuatorOff(result.winningGroupId, act.id, act.ratedPowerW ?? 0);
                                    }
                                }
                            }
                        }
                        break;
                    }
                }
            }

            // Globale Alarm-States aktualisieren
            const activeAlarms = this.alarmService.getActiveAlarms();
            await this.setStateAsync('info.activeAlarms', { val: activeAlarms.length, ack: true });
            await this.setStateAsync('info.lastCycle', { val: cycleStart, ack: true });

            // Alarm-Objekte im ioBroker-Baum aktualisieren
            await this.updateAlarmObjects();

            // Web-Dashboard aktualisieren
            this.webDashboard.updateState(this.buildDashboardState());

        } catch (err) {
            this.log.error(`Fehler im Regelzyklus: ${err}`);
        } finally {
            this.cycleRunning = false;
        }
    }

    private async processGroup(config: GroupConfig): Promise<void> {
        const state = this.groupStates.get(config.id);
        if (!state) return;

        const now = new Date();

        // 1) Tag/Nacht bestimmen
        const dayNight = this.scheduleService.getDayNight(now, config.schedule);
        const prevDayNight = this.lastDayNight.get(config.id);
        if (dayNight !== prevDayNight) {
            this.lightChangeTimes.set(config.id, Date.now());
            if (dayNight === 'transition') {
                // Übergangsrichtung festhalten: Morgen = vorher Nacht, Abend = vorher Tag
                this.lightTransitionFromNight.set(config.id, prevDayNight === 'night');
            }
            this.lastDayNight.set(config.id, dayNight);
            this.log.info(`Gruppe ${config.name}: Wechsel zu ${dayNight}`);
        }
        state.dayNight = dayNight;
        state.nextScheduleChange = this.scheduleService.msUntilNextChange(now, config.schedule) + Date.now();

        // 2) Aggregierte Klimawerte berechnen
        const stab = config.stabilityTimeSeconds;
        const tempAgg = this.sensorService.aggregate(config.sensors, 'temperature', config.aggregationMethod, stab);
        const humAgg = this.sensorService.aggregate(config.sensors, 'humidity', config.aggregationMethod, stab);
        const leafTempAgg = this.sensorService.aggregate(config.sensors, 'leafTemperature', config.aggregationMethod, stab);

        if (tempAgg.usingBackup) this.log.warn(`Gruppe ${config.name}: Temperatur-Backup-Sensor aktiv (primary ausgefallen)`);
        if (humAgg.usingBackup) this.log.warn(`Gruppe ${config.name}: Feuchte-Backup-Sensor aktiv (primary ausgefallen)`);

        state.temperature = tempAgg.value;
        state.humidity = humAgg.value;
        state.co2 = this.sensorService.aggregate(config.sensors, 'co2', config.aggregationMethod, stab).value;

        // Abgeleitete Größen
        if (state.temperature !== null && state.humidity !== null) {
            state.vpd = calculateVPD(state.temperature, state.humidity);
            state.dewPoint = dewPoint(state.temperature, state.humidity);
            state.absoluteHumidity = absoluteHumidity(state.temperature, state.humidity);
            state.condensationRisk = condensationRisk(state.temperature, state.humidity);

            if (leafTempAgg.value !== null) {
                state.leafVpd = calculateLeafVPD(state.temperature, leafTempAgg.value, state.humidity);
            }
        } else {
            state.vpd = null;
            state.dewPoint = null;
            state.absoluteHumidity = null;
            state.condensationRisk = false;
            state.leafVpd = null;
        }

        state.sensorQuality = Math.round((tempAgg.quality + humAgg.quality) / 2);

        // Trend-Puffer befüllen
        if (state.temperature !== null) this.diagnosticsEngine.recordValue(config.id, 'temperature', state.temperature);
        if (state.humidity !== null) this.diagnosticsEngine.recordValue(config.id, 'humidity', state.humidity);
        if (state.vpd !== null) this.diagnosticsEngine.recordValue(config.id, 'vpd', state.vpd);
        if (state.co2 !== null) this.diagnosticsEngine.recordValue(config.id, 'co2', state.co2);

        // 3) Degradationsstufe bestimmen
        state.degradation = this.safetyService.computeDegradation(state, config);

        // 4) Aktives Profil laden
        const profile = this.growConfig.climateProfiles.find(p => p.id === config.profileId);
        const lightChangeTs = this.lightChangeTimes.get(config.id) ?? Date.now();
        const transitionFromNight = this.lightTransitionFromNight.get(config.id) ?? false;
        const setpoint = profile
            ? this.scheduleService.getActiveSetpoint(profile, dayNight, lightChangeTs, transitionFromNight)
            : null;

        state.activeProfile = profile;

        // 5) Regelentscheidung
        let decision: ControlDecision | null = null;
        if (setpoint && config.mode !== 'off') {
            const shadowMode = config.mode === 'monitorOnly' || this.safetyService.isGroupPaused(config.id);
            const outdoorCfg = config.outdoorSensor;
            const outdoorTemp = outdoorCfg?.enabled && outdoorCfg.tempStateId
                ? (this.outdoorValues.get(outdoorCfg.tempStateId) ?? null)
                : null;
            const outdoorHumidity = outdoorCfg?.enabled && outdoorCfg.humidityStateId
                ? (this.outdoorValues.get(outdoorCfg.humidityStateId) ?? null)
                : null;
            if (outdoorTemp !== null) this.log.debug(`Gruppe ${config.name}: Außen ${outdoorTemp.toFixed(1)}°C / ${outdoorHumidity?.toFixed(0) ?? '?'}%`);
            decision = this.climateController.decide(config, state, setpoint, shadowMode, outdoorTemp, outdoorHumidity);
            decision = this.safetyService.applySafetyRules(config, decision);
            state.lastDecision = decision;
        }

        // 6) Aktorbefehle schreiben
        if (decision) {
            await this.executeDecision(config, decision);
        }

        // 6d) Umluft-Aktoren: Wind-Simulator / Zeitfenster / alwaysOn (unabhängig von Klimaregelung)
        await this.tickCirculationActuators(config);

        // 6b) Fähigkeiten der Gruppe bewerten (für Logging/Admin-UI)
        const leafTempVal = leafTempAgg.value;
        const soilAgg = this.sensorService.aggregate(config.sensors, 'soilMoisture', config.aggregationMethod, stab);
        const capResult = this.capabilityService.evaluate(
            config, state.sensors, state.temperature, state.humidity, leafTempVal, soilAgg.value
        );
        if (capResult.degradation !== 'FULL' && capResult.degradationReason) {
            this.log.debug(`Gruppe ${config.name}: ${capResult.degradation} – ${capResult.degradationReason}`);
        }

        // 6c) Luftstrommanagement
        const isDay = dayNight !== 'night';
        const airSp = state.activeProfile
            ? this.scheduleService.getActiveSetpoint(state.activeProfile, dayNight, lightChangeTs, transitionFromNight)
            : null;
        const airDemand = this.airSystemService.computeAirDemand(
            config, config.airSystem, state.temperature,
            airSp?.temperature ?? null,
            state.humidity,
            airSp?.humidity ?? null,
            state.vpd,
            airSp?.vpdMin ?? null,
            airSp?.vpdMax ?? null,
            isDay
        );
        const airOutput = this.airSystemService.computeAirOutput(config.id, config, config.airSystem, airDemand);
        if (airOutput.available) {
            // Geteilte Aktoren werden ausschliesslich ueber das Voting-System gesteuert
            const exhaustAct = config.actuators.find(a => a.type === 'exhaustFan' && a.enabled && !a.shared);
            const supplyAct = config.actuators.find(a => a.type === 'supplyFan' && a.enabled && !a.shared);
            if (exhaustAct) {
                const canSw = this.actuatorService.canSwitch(exhaustAct, airOutput.exhaustCommand);
                if (canSw.allowed) {
                    const changed = this.actuatorService.recordCommand(exhaustAct, airOutput.exhaustCommand);
                    if (changed) {
                        await this.setActuatorState(exhaustAct.commandStateId, airOutput.exhaustCommand);
                        if (typeof airOutput.exhaustCommand === 'boolean') {
                            this.setActuatorStateWithVerify(exhaustAct, config.id, airOutput.exhaustCommand);
                        }
                        const isOn = airOutput.exhaustCommand === true || (typeof airOutput.exhaustCommand === 'number' && airOutput.exhaustCommand > 0);
                        if (exhaustAct.energyStateUnit !== 'kWh') {
                            if (isOn) this.databaseService.trackActuatorOn(config.id, exhaustAct.id, exhaustAct.name, exhaustAct.ratedPowerW ?? 0);
                            else this.databaseService.trackActuatorOff(config.id, exhaustAct.id, exhaustAct.ratedPowerW ?? 0);
                        }
                    }
                }
            }
            if (supplyAct) {
                const canSw = this.actuatorService.canSwitch(supplyAct, airOutput.supplyCommand);
                if (canSw.allowed) {
                    const changed = this.actuatorService.recordCommand(supplyAct, airOutput.supplyCommand);
                    if (changed) {
                        await this.setActuatorState(supplyAct.commandStateId, airOutput.supplyCommand);
                        if (typeof airOutput.supplyCommand === 'boolean') {
                            this.setActuatorStateWithVerify(supplyAct, config.id, airOutput.supplyCommand);
                        }
                        const isOn = airOutput.supplyCommand === true || (typeof airOutput.supplyCommand === 'number' && airOutput.supplyCommand > 0);
                        if (supplyAct.energyStateUnit !== 'kWh') {
                            if (isOn) this.databaseService.trackActuatorOn(config.id, supplyAct.id, supplyAct.name, supplyAct.ratedPowerW ?? 0);
                            else this.databaseService.trackActuatorOff(config.id, supplyAct.id, supplyAct.ratedPowerW ?? 0);
                        }
                    }
                }
            }
        }

        // Umluft
        const irrigatingNow = this.irrigationService.isAnyZoneRunning(config);
        const circCmds = this.airSystemService.computeCirculationCommands(config.id, config, isDay, irrigatingNow);
        for (const [actId, cmd] of circCmds) {
            const act = config.actuators.find(a => a.id === actId);
            if (act) {
                const canSw = this.actuatorService.canSwitch(act, cmd);
                if (canSw.allowed) {
                    const changed = this.actuatorService.recordCommand(act, cmd);
                    if (changed) {
                        await this.setActuatorState(act.commandStateId, cmd);
                        if (act.energyStateUnit !== 'kWh') {
                            if (cmd) this.databaseService.trackActuatorOn(config.id, act.id, act.name, act.ratedPowerW ?? 0);
                            else this.databaseService.trackActuatorOff(config.id, act.id, act.ratedPowerW ?? 0);
                        }
                    }
                }
            }
        }

        // 6d) Bewässerung
        for (const zone of config.irrigationZones) {
            if (!zone.enabled) continue;
            const irriDecision = this.irrigationService.decide(zone, config.id, state.sensors, now);
            const pumpAct = config.actuators.find(a => a.id === zone.pumpActuatorId);
            if (pumpAct && !irriDecision.blocked) {
                const canSw = this.actuatorService.canSwitch(pumpAct, irriDecision.command);
                if (canSw.allowed) {
                    const changed = this.actuatorService.recordCommand(pumpAct, irriDecision.command);
                    if (changed) {
                        await this.setActuatorState(pumpAct.commandStateId, irriDecision.command);
                        if (pumpAct.energyStateUnit !== 'kWh') {
                            if (irriDecision.command) this.databaseService.trackActuatorOn(config.id, pumpAct.id, pumpAct.name, pumpAct.ratedPowerW ?? 0);
                            else this.databaseService.trackActuatorOff(config.id, pumpAct.id, pumpAct.ratedPowerW ?? 0);
                        }
                    }
                }
            }
        }

        // 6e) Kamera-Snapshots
        const lightOn = dayNight === 'day' || dayNight === 'transition';
        for (const camera of config.cameras) {
            if (this.cameraService.shouldCapture(camera, lightOn)) {
                // Snapshot-Quelle: ioBroker-State lesen
                if (camera.sourceType === 'iobState' && camera.sourceId) {
                    try {
                        const snap = await this.getForeignStateAsync(camera.sourceId);
                        if (snap?.val && typeof snap.val === 'string') {
                            this.cameraService.recordSnapshot(camera.id, snap.val, config.id, camera);
                        } else {
                            this.cameraService.recordError(camera.id, config.id, camera, 'Kein gültiger Snapshot-State');
                        }
                    } catch (err) {
                        this.cameraService.recordError(camera.id, config.id, camera, String(err));
                    }
                }
                // Weitere sourceTypes (snapshotUrl, localPath) würden hier folgen
            }
        }

        // 7) Diagnose & Alarm
        for (const actuatorConfig of config.actuators) {
            const actState = this.actuatorService.getState(actuatorConfig.id);
            if (actState) {
                state.actuators.set(actuatorConfig.id, actState);
                this.diagnosticsEngine.checkActuatorFeedback(config.id, actuatorConfig, actState);
            }
        }

        this.diagnosticsEngine.evaluateEffectChecks(this.groupStates);

        // Sensor-Plausibilität
        const tempValues = config.sensors
            .filter(s => s.type === 'temperature')
            .map(s => this.sensorService.getState(s.id))
            .filter((s): s is NonNullable<typeof s> => s !== undefined && s.valid && typeof s.processedValue === 'number')
            .map(s => s.processedValue as number);

        if (tempValues.length > 1) {
            const threshold = config.sensorDisagreementThreshold ?? 5;
            this.diagnosticsEngine.checkSensorDisagreement(config.id, 'Temperatur', tempValues, threshold);
        }

        // 8) Benutzerdefinierte Alarmregeln auswerten
        this.evaluateCustomAlertRules(config, state);

        // 9) ioBroker-States aktualisieren
        await this.updateGroupStates(config, state);
    }

    private evaluateCustomAlertRules(
        config: import('./models/config').GroupConfig,
        state: import('./models/config').GroupState,
    ): void {
        const rules = (this.growConfig.customAlertRules ?? []).filter(r => r.enabled && r.groupId === config.id);
        if (rules.length === 0) return;

        const metricValue = (metric: import('./models/config').CustomAlertMetric): number | null => {
            switch (metric) {
                case 'temperature':    return state.temperature;
                case 'humidity':       return state.humidity;
                case 'vpd':            return state.vpd;
                default: {
                    // Für alle anderen: erste gültige Messung des passenden Sensor-Typs
                    for (const sensorCfg of config.sensors) {
                        if (sensorCfg.type !== metric) continue;
                        const ss = state.sensors.get(sensorCfg.id);
                        if (ss?.valid && typeof ss.processedValue === 'number') return ss.processedValue;
                    }
                    return null;
                }
            }
        };

        for (const rule of rules) {
            const val = metricValue(rule.metric);
            if (val === null) continue;

            let triggered = false;
            switch (rule.condition) {
                case 'above':   triggered = val > (rule.threshold ?? 0); break;
                case 'below':   triggered = val < (rule.threshold ?? 0); break;
                case 'outside': triggered = val < (rule.thresholdMin ?? 0) || val > (rule.thresholdMax ?? 0); break;
                case 'inside':  triggered = val >= (rule.thresholdMin ?? 0) && val <= (rule.thresholdMax ?? 0); break;
            }

            if (triggered) {
                const condDesc = rule.condition === 'above'   ? `> ${rule.threshold}`
                    : rule.condition === 'below'   ? `< ${rule.threshold}`
                    : rule.condition === 'outside' ? `außerhalb ${rule.thresholdMin}–${rule.thresholdMax}`
                    : `innerhalb ${rule.thresholdMin}–${rule.thresholdMax}`;
                this.alarmService.raise(
                    ALARM_CODES.CUSTOM_ALERT, config.id, rule.id, rule.severity,
                    `${rule.name}: ${rule.metric} = ${val.toFixed(2)} (${condDesc})`,
                );
            } else {
                this.alarmService.clear(ALARM_CODES.CUSTOM_ALERT, config.id, rule.id);
            }
        }
    }

    private async tickCirculationActuators(config: GroupConfig): Promise<void> {
        const now = new Date();
        for (const act of config.actuators) {
            if (act.type !== 'circulationFan' || !act.enabled || !act.circulationMode) continue;
            if (act.shared) continue; // geteilte Aktoren laufen über SharedActorManager

            const actState = this.actuatorService.getState(act.id);
            if (!actState || actState.manualLock) continue;

            let wantsOn: boolean;
            switch (act.circulationMode) {
                case 'windSimulator': {
                    // Wind-Sim verwaltet seine eigenen Timer — canSwitch/minimumOn/Off überspringen
                    wantsOn = this.actuatorService.tickWindSimulator(act, now);
                    const changed = this.actuatorService.recordCommand(act, wantsOn);
                    if (changed) {
                        await this.setActuatorState(act.commandStateId, wantsOn ? act.onValue : act.offValue);
                        // Kein Verify-Timer: WindSim togglet schnell; Mismatch innerhalb der Phase ist kein Fehler
                        this.log.info(`Umluft ${act.name}: → ${wantsOn ? 'EIN' : 'AUS'} (windSimulator)`);
                        // Energie-Tracking (Nennleistung)
                        if (act.energyStateUnit !== 'kWh') {
                            if (wantsOn) this.databaseService.trackActuatorOn(config.id, act.id, act.name, act.ratedPowerW ?? 0);
                            else this.databaseService.trackActuatorOff(config.id, act.id, act.ratedPowerW ?? 0);
                        }
                    }
                    continue;
                }
                case 'schedule':
                    wantsOn = this.actuatorService.isCirculationScheduleActive(act, now);
                    break;
                case 'alwaysOn':
                default:
                    wantsOn = true;
            }

            const canSwitch = this.actuatorService.canSwitch(act, wantsOn);
            if (!canSwitch.allowed) continue;

            const changed = this.actuatorService.recordCommand(act, wantsOn);
            if (changed) {
                await this.setActuatorState(act.commandStateId, wantsOn ? act.onValue : act.offValue);
                this.setActuatorStateWithVerify(act, config.id, wantsOn ? act.onValue as boolean | number : act.offValue as boolean | number);
                this.log.info(`Umluft ${act.name}: → ${wantsOn ? 'EIN' : 'AUS'} (${act.circulationMode})`);
                if (act.energyStateUnit !== 'kWh') {
                    if (wantsOn) this.databaseService.trackActuatorOn(config.id, act.id, act.name, act.ratedPowerW ?? 0);
                    else this.databaseService.trackActuatorOff(config.id, act.id, act.ratedPowerW ?? 0);
                }
            }
        }
    }

    private async executeDecision(config: GroupConfig, decision: ControlDecision): Promise<void> {
        for (const action of decision.actions) {
            if (action.blocked) continue;

            const actuatorConfig = config.actuators.find(a => a.id === action.actuatorId);
            if (!actuatorConfig) continue;

            // Umluft-Aktoren mit eigenem Modus werden ausschließlich von tickCirculationActuators gesteuert
            if (actuatorConfig.type === 'circulationFan' &&
                actuatorConfig.circulationMode && actuatorConfig.circulationMode !== 'alwaysOn') continue;

            // Gemeinsam genutzte Aktoren werden über SharedActorManager aufgelöst
            if (actuatorConfig.shared) {
                this.sharedActorManager.submitRequest({
                    groupId: config.id,
                    groupPriority: config.priority,
                    actuatorId: actuatorConfig.id,
                    requested: action.requested,
                    reason: action.reason,
                    isCritical: false,
                });
                // Aktoren mit sharedParticipants werden ausschließlich durch die Voting-Loop
                // in runCycle() gesteuert. recordCommand() darf NICHT hier aufgerufen werden,
                // weil sonst die Voting-Loop changed=false sieht und setActuatorState nie sendet.
                continue;
            }

            // Aktuellen Reglerwunsch für Dashboard-Anzeige speichern (unabhängig von canSwitch)
            this.directDesires.set(actuatorConfig.id, action.requested);

            const canSwitch = this.actuatorService.canSwitch(actuatorConfig, action.requested);
            if (!canSwitch.allowed) {
                this.log.debug(
                    `Aktor ${actuatorConfig.name}: gesperrt – ${canSwitch.reason} (${canSwitch.waitSeconds}s)`
                );
                this.switchBlocks.set(actuatorConfig.id, {
                    reason: canSwitch.reason ?? 'Gesperrt',
                    until: Date.now() + (canSwitch.waitSeconds ?? 0) * 1000,
                });
                continue;
            }
            this.switchBlocks.delete(actuatorConfig.id);

            const changed = this.actuatorService.recordCommand(actuatorConfig, action.requested);
            if (changed) {
                await this.setActuatorState(actuatorConfig.commandStateId, action.requested);
                if (typeof action.requested === 'boolean') {
                    this.setActuatorStateWithVerify(actuatorConfig, config.id, action.requested);
                } else {
                    // Numerischer Befehl: laufende Verify-Timer abbrechen (kein Feedback-Check für Prozentwerte)
                    const pending = this.pendingVerify.get(actuatorConfig.id);
                    if (pending) { this.clearTimeout(pending); this.pendingVerify.delete(actuatorConfig.id); }
                }
                // Energie-Tracking: ratedPowerW-Fallback (nur wenn kein kWh-Sensor konfiguriert)
                if (actuatorConfig.energyStateUnit !== 'kWh') {
                    if (action.requested === true || (typeof action.requested === 'number' && action.requested > 0)) {
                        this.databaseService.trackActuatorOn(config.id, actuatorConfig.id, actuatorConfig.name, actuatorConfig.ratedPowerW ?? 0);
                    } else {
                        this.databaseService.trackActuatorOff(config.id, actuatorConfig.id, actuatorConfig.ratedPowerW ?? 0);
                    }
                }
                this.log.info(
                    `Gruppe ${config.name}: ${actuatorConfig.name} → ${action.requested} (${action.reason})`
                );

                // Wirkungsprüfung registrieren
                if (actuatorConfig.type === 'heating' && action.requested) {
                    const currentTemp = this.groupStates.get(config.id)?.temperature;
                    if (currentTemp !== null && currentTemp !== undefined) {
                        this.diagnosticsEngine.startEffectCheck(
                            config.id, actuatorConfig.id, 'temperature', 1,
                            currentTemp, 600, 1800, 0.3
                        );
                    }
                }
            }
        }
    }

    // ============================================================
    // Teilnehmer-Bedarfsermittlung für Abstimmungen
    // ============================================================

    /**
     * Berechnet ob eine Gruppe einen Aktor vom gegebenen Typ benötigt,
     * basierend auf dem aktuellen Gruppenstand und Klimaprofil-Sollwerten.
     */
    private computeParticipantNeed(
        actuatorType: ActuatorType,
        gs: GroupState,
        defaultHysteresis: number,
        currentlyOn = false,
    ): { wantsOn: boolean; urgency: number; reason: string } {
        const hyst = defaultHysteresis;
        const tempHyst = 1.5;  // °C

        // Sollwerte aus aktivem Profil ermitteln
        let tempSetpoint: number | null = null;
        let humSetpoint: number | null = null;
        let vpdMax: number | null = null;
        let vpdMin: number | null = null;
        if (gs.activeProfile) {
            const spKey = gs.dayNight === 'night' ? 'night' : 'day';
            const sp = gs.activeProfile[spKey];
            if (sp) {
                tempSetpoint = sp.temperature ?? null;
                humSetpoint = sp.humidity ?? null;
                vpdMax = sp.vpdMax ?? null;
                vpdMin = sp.vpdMin ?? null;
            }
        }

        switch (actuatorType) {
            case 'dehumidifier': {
                const hum = gs.humidity;
                if (hum === null) return { wantsOn: false, urgency: 0, reason: 'Kein Feuchtesensor' };

                // VPD-Modus: wenn beide VPD-Grenzen konfiguriert sind, entscheidet nur der VPD.
                // Entfeuchter senkt Feuchte → erhöht VPD und erzeugt Abwärme → darf VPD
                // nicht in den Überbereich treiben.
                if (vpdMin !== null && vpdMax !== null) {
                    if (gs.vpd === null) {
                        // VPD konfiguriert aber Sensor nicht verfügbar → sicherer Stopp
                        return { wantsOn: false, urgency: 0, reason: 'VPD konfiguriert, aber kein Sensor – Entfeuchter gesperrt' };
                    }
                    if (gs.vpd < vpdMin) {
                        const deficit = vpdMin - gs.vpd;
                        return { wantsOn: true, urgency: Math.min(1, deficit / 0.5), reason: `VPD ${gs.vpd.toFixed(2)} kPa zu niedrig (Soll >${vpdMin.toFixed(2)}) – Entfeuchten` };
                    }
                    if (gs.vpd > vpdMax) {
                        // VPD zu hoch → Entfeuchter würde es weiter verschlimmern → gesperrt.
                        // Urgency proportional zum Überschuss: bei 'any'-Modus greift jede Überschreitung
                        // als hartes Veto (urgency > 0); bei 'majority'-Modus wird Überschuss gegen
                        // Restbedarf der anderen Gruppe abgewogen.
                        const excess_dh = gs.vpd - vpdMax;
                        return { wantsOn: false, urgency: Math.min(1, excess_dh / 0.3), reason: `VPD ${gs.vpd.toFixed(2)} kPa zu hoch – Entfeuchter gesperrt` };
                    }
                    // Hysterese: wenn gerade EIN, bis Mitte des Sollbereichs weiterlaufen
                    const vpdMid_dh = (vpdMin + vpdMax) / 2;
                    if (currentlyOn && gs.vpd < vpdMid_dh) {
                        const urgency = Math.max(0, (vpdMid_dh - gs.vpd) / (vpdMid_dh - vpdMin));
                        return { wantsOn: true, urgency, reason: `VPD ${gs.vpd.toFixed(2)} kPa noch unter Mitte ${vpdMid_dh.toFixed(2)} – weiter Entfeuchten` };
                    }
                    // VPD im Sollbereich (oder über Mitte) → Entfeuchter pausiert
                    return { wantsOn: false, urgency: 0, reason: `VPD ${gs.vpd.toFixed(2)} kPa im Sollbereich – Entfeuchter pausiert` };
                }

                // Feuchtemodus (kein VPD konfiguriert): RH-Setpoint mit Guard
                const dehum_vpdGuard = vpdMax !== null
                    ? (vpdMin !== null ? vpdMax - (vpdMax - vpdMin) * 0.33 : vpdMax - 0.1)
                    : null;
                if (dehum_vpdGuard !== null && gs.vpd !== null && gs.vpd > dehum_vpdGuard) {
                    return { wantsOn: false, urgency: 0, reason: `VPD ${gs.vpd.toFixed(2)} kPa im Schutzbereich (>${dehum_vpdGuard.toFixed(2)}) – Entfeuchter gesperrt` };
                }
                const target = humSetpoint ?? 60;
                const excess = hum - (target + hyst);
                if (excess > 0) return { wantsOn: true, urgency: Math.min(1, excess / 10), reason: `RH ${hum.toFixed(0)}% > Soll ${target}% – Entfeuchten` };
                return { wantsOn: false, urgency: 0, reason: `RH ${hum.toFixed(0)}% im Sollbereich` };
            }
            case 'humidifier': {
                const hum = gs.humidity;
                if (hum === null) return { wantsOn: false, urgency: 0, reason: 'Kein Feuchtesensor' };

                // VPD-Modus: wenn beide VPD-Grenzen konfiguriert sind, entscheidet nur der VPD.
                if (vpdMin !== null && vpdMax !== null) {
                    if (gs.vpd === null) {
                        return { wantsOn: false, urgency: 0, reason: 'VPD konfiguriert, aber kein Sensor – Befeuchter gesperrt' };
                    }
                    if (gs.vpd > vpdMax) {
                        const excess = gs.vpd - vpdMax;
                        return { wantsOn: true, urgency: Math.min(1, excess / 0.5), reason: `VPD ${gs.vpd.toFixed(2)} kPa zu hoch (Soll <${vpdMax.toFixed(2)}) – Befeuchten` };
                    }
                    if (gs.vpd < vpdMin) {
                        // VPD zu niedrig → Befeuchter würde es weiter verschlimmern → gesperrt
                        const deficit_hum = vpdMin - gs.vpd;
                        return { wantsOn: false, urgency: Math.min(1, deficit_hum / 0.3), reason: `VPD ${gs.vpd.toFixed(2)} kPa zu niedrig – Befeuchter gesperrt` };
                    }
                    // Hysterese: wenn gerade EIN, bis Mitte des Sollbereichs weiterlaufen
                    const vpdMid_hum = (vpdMin + vpdMax) / 2;
                    if (currentlyOn && gs.vpd > vpdMid_hum) {
                        const urgency = Math.max(0, (gs.vpd - vpdMid_hum) / (vpdMax - vpdMid_hum));
                        return { wantsOn: true, urgency, reason: `VPD ${gs.vpd.toFixed(2)} kPa noch über Mitte ${vpdMid_hum.toFixed(2)} – weiter Befeuchten` };
                    }
                    // VPD im Sollbereich (oder unter Mitte) → Befeuchter pausiert
                    return { wantsOn: false, urgency: 0, reason: `VPD ${gs.vpd.toFixed(2)} kPa im Sollbereich – Befeuchter pausiert` };
                }

                // Feuchtemodus (kein VPD konfiguriert): RH-Setpoint mit Guard
                const hum_vpdGuard = vpdMin !== null
                    ? (vpdMax !== null ? vpdMin + (vpdMax - vpdMin) * 0.33 : vpdMin + 0.1)
                    : null;
                if (hum_vpdGuard !== null && gs.vpd !== null && gs.vpd < hum_vpdGuard) {
                    return { wantsOn: false, urgency: 0, reason: `VPD ${gs.vpd.toFixed(2)} kPa im Schutzbereich (<${hum_vpdGuard.toFixed(2)}) – Befeuchter gesperrt` };
                }
                const target = humSetpoint ?? 50;
                const deficit = (target - hyst) - hum;
                if (deficit > 0) return { wantsOn: true, urgency: Math.min(1, deficit / 10), reason: `RH ${hum.toFixed(0)}% < Soll ${target}% – Befeuchten` };
                return { wantsOn: false, urgency: 0, reason: `RH ${hum.toFixed(0)}% im Sollbereich` };
            }
            case 'cooling':
            case 'exhaustFan':
            case 'supplyFan': {
                const target = tempSetpoint ?? 25;
                const temp = gs.temperature;
                if (temp !== null) {
                    // Unterkühlung: Kühlung treibt andere Gruppe unter Minimum → urgentes Veto
                    const undershoot = (target - tempHyst) - temp;
                    if (undershoot > 0) {
                        return { wantsOn: false, urgency: Math.min(1, undershoot / 5), reason: `T ${temp.toFixed(1)}°C < Min ${(target - tempHyst).toFixed(1)}°C – Kühlung gesperrt` };
                    }
                    // Hysterese: wenn gerade EIN, bis Sollwert (Mitte) weiterkühlen
                    if (currentlyOn && temp > target) {
                        return { wantsOn: true, urgency: Math.max(0, (temp - target) / tempHyst), reason: `T ${temp.toFixed(1)}°C noch über Sollwert ${target}°C – weiter Kühlen` };
                    }
                    const excess = temp - (target + tempHyst);
                    if (excess > 0) return { wantsOn: true, urgency: Math.min(1, excess / 5), reason: `T ${temp.toFixed(1)}°C > Soll ${target}°C – Lüftung/Kühlung` };
                }
                // VPD klar zu hoch → Lüftung/Kühlung hilft
                if (vpdMax !== null && gs.vpd !== null && gs.vpd > vpdMax + 0.2) {
                    const excess = gs.vpd - vpdMax;
                    return { wantsOn: true, urgency: Math.min(1, excess / 0.5), reason: `VPD ${gs.vpd.toFixed(2)} kPa zu hoch – Lüftung` };
                }
                // Präventiv (nur Zuluft/Abluft): Temp schon über Sollwert → frühzeitig lüften
                // bevor Hysterese überschritten wird. Outdoor-Guard blockiert bei ungünstiger Außenluft.
                if (actuatorType === 'supplyFan' || actuatorType === 'exhaustFan') {
                    if (temp !== null && tempSetpoint !== null && temp > tempSetpoint) {
                        return { wantsOn: true, urgency: 0.1, reason: `T ${temp.toFixed(1)}°C > Sollwert ${tempSetpoint}°C – präventive Lüftung` };
                    }
                    if (vpdMax !== null && vpdMin !== null && gs.vpd !== null) {
                        const mid = vpdMin + (vpdMax - vpdMin) * 0.5;
                        if (gs.vpd > mid) {
                            return { wantsOn: true, urgency: 0.1, reason: `VPD ${gs.vpd.toFixed(2)} kPa in oberer Hälfte (>${mid.toFixed(2)}) – präventive Lüftung` };
                        }
                    }
                }
                return { wantsOn: false, urgency: 0, reason: `T/VPD im Sollbereich` };
            }
            case 'heating': {
                const target = tempSetpoint ?? 20;
                const temp = gs.temperature;
                if (temp === null) return { wantsOn: false, urgency: 0, reason: 'Kein Temperatursensor' };
                // Überhitzung: Heizung treibt andere Gruppe über Maximum → urgentes Veto
                const overshoot = temp - (target + tempHyst);
                if (overshoot > 0) {
                    return { wantsOn: false, urgency: Math.min(1, overshoot / 5), reason: `T ${temp.toFixed(1)}°C > Max ${(target + tempHyst).toFixed(1)}°C – Heizung gesperrt` };
                }
                // Hysterese: wenn gerade EIN, bis Sollwert (Mitte) weiterheizen
                if (currentlyOn && temp < target) {
                    return { wantsOn: true, urgency: Math.max(0, (target - temp) / tempHyst), reason: `T ${temp.toFixed(1)}°C noch unter Sollwert ${target}°C – weiter Heizen` };
                }
                const deficit = (target - tempHyst) - temp;
                return {
                    wantsOn: deficit > 0,
                    urgency: Math.min(1, Math.max(0, deficit / 5)),
                    reason: deficit > 0 ? `T ${temp.toFixed(1)}°C < Soll ${target}°C – Heizen` : `T ${temp.toFixed(1)}°C im Sollbereich`,
                };
            }
            case 'circulationFan':
            case 'damper': {
                // Zirkulationslüfter: läuft wenn Temp oder VPD erhöht
                const target = tempSetpoint ?? 25;
                const temp = gs.temperature;
                if (temp !== null && temp > target + tempHyst) {
                    return { wantsOn: true, urgency: Math.min(1, (temp - target - tempHyst) / 5), reason: `T ${temp.toFixed(1)}°C > Soll ${target}°C – Umluft` };
                }
                if (vpdMax !== null && gs.vpd !== null && gs.vpd > vpdMax + 0.3) {
                    return { wantsOn: true, urgency: Math.min(1, (gs.vpd - vpdMax) / 0.5), reason: `VPD ${gs.vpd.toFixed(2)} kPa zu hoch – Umluft` };
                }
                return { wantsOn: false, urgency: 0, reason: 'T/VPD im Sollbereich' };
            }
            case 'co2Valve': {
                // CO2 wird selten geteilt; kein Teilnehmer-Bedarf
                return { wantsOn: false, urgency: 0, reason: 'CO2-Ventil: kein Teilnehmer-Bedarf' };
            }
            default:
                return { wantsOn: false, urgency: 0, reason: 'Unbekannter Aktortyp' };
        }
    }

    // ============================================================
    // ioBroker-State-Schreibfunktionen
    // ============================================================

    private async setActuatorState(stateId: string, value: boolean | number | string | unknown): Promise<void> {
        try {
            await this.setForeignStateAsync(stateId, { val: value as ioBroker.StateValue, ack: false });
        } catch (err) {
            this.log.error(`Fehler beim Schreiben von ${stateId}: ${err}`);
        }
    }

    /**
     * Schreibt einen Aktorbefehl und prüft nach verifyDelay Sekunden ob der
     * State tatsächlich gesetzt wurde. Bei Abweichung: 1x Retry, dann Alarm.
     */
    private setActuatorStateWithVerify(
        actuatorConfig: import('./models/config').ActuatorConfig,
        groupId: string,
        value: boolean | number,
        verifyDelaySec = 10,
    ): void {
        // Ausstehende Verifikation für diesen Aktor abbrechen
        const existing = this.pendingVerify.get(actuatorConfig.id);
        if (existing) this.clearTimeout(existing);

        const schedule = (isRetry: boolean) => this.setTimeout(async () => {
            try {
            this.pendingVerify.delete(actuatorConfig.id);

            // Tatsächlichen Gerätezustand ermitteln:
            // - Wenn dedizierter feedbackStateId konfiguriert → direkt lesen
            // - Sonst → letzten bestätigten (ack=true) Zustand aus ActuatorService nutzen
            //   (commandStateId würde den von UNS geschriebenen Wert zurückliefern → immer "OK")
            let actualOn: boolean;
            if (actuatorConfig.feedbackStateId) {
                const actual = await this.getForeignStateAsync(actuatorConfig.feedbackStateId);
                if (!actual || actual.val === null || actual.val === undefined) return;
                const actVal = actual.val;
                actualOn = typeof actVal === 'boolean' ? actVal : (actVal as number) > 0;
            } else {
                const tracked = this.actuatorService.getState(actuatorConfig.id);
                if (tracked?.feedback === null || tracked?.feedback === undefined) {
                    // Noch kein Feedback empfangen – bei Retry trotzdem Alarm
                    if (isRetry) {
                        this.log.error(`Aktor ${actuatorConfig.name}: kein Feedback nach Befehl ${value}`);
                        this.alarmService.raise(
                            ALARM_CODES.ACTUATOR_NO_FEEDBACK,
                            groupId,
                            actuatorConfig.id,
                            'warning',
                            `Kein Gerätestatus empfangen nach Befehl "${value}"`,
                        );
                    }
                    return;
                }
                const fb = tracked.feedback;
                actualOn = typeof fb === 'boolean' ? fb : (fb as number) > 0;
            }

            const requestedOn = typeof value === 'boolean' ? value : value > 0;
            if (requestedOn === actualOn) {
                this.alarmService.clear(ALARM_CODES.ACTUATOR_NO_FEEDBACK, groupId, actuatorConfig.id);
                return;
            }
            if (!isRetry) {
                this.log.warn(`Aktor ${actuatorConfig.name}: Soll=${value} aber Ist=${actualOn} – 1x Retry`);
                await this.setActuatorState(actuatorConfig.commandStateId, value);
                this.pendingVerify.set(actuatorConfig.id, schedule(true));
            } else {
                this.log.error(`Aktor ${actuatorConfig.name}: Gerät reagiert nicht auf Befehl ${value}`);
                this.alarmService.raise(
                    ALARM_CODES.ACTUATOR_NO_FEEDBACK,
                    groupId,
                    actuatorConfig.id,
                    'warning',
                    `Gerät hat auf Befehl "${value}" nicht reagiert`,
                );
            }
            } catch (err) {
                this.log.warn(`setActuatorStateWithVerify ${actuatorConfig.name}: ${err}`);
            }
        }, verifyDelaySec * 1000) as ioBroker.Timeout;

        this.pendingVerify.set(actuatorConfig.id, schedule(false));
    }

    private buildDashboardState() {
        const activeAlarms = this.alarmService.getActiveAlarms();
        const groups = this.growConfig.groups
            .filter(g => g.enabled)
            .map(g => {
                const state = this.groupStates.get(g.id);
                const groupAlarms = activeAlarms
                    .filter(a => a.groupId === g.id)
                    .slice(0, 5)
                    .map(a => ({ id: a.id, code: a.code, severity: a.severity, message: a.message, since: a.since }));

                const now2 = Date.now();
                const actuators: import('./services/WebDashboardService').DashboardActuatorState[] = g.actuators
                    .filter(a => a.enabled)
                    .map(a => {
                        const as = this.actuatorService.getState(a.id);
                        const switchBlock = this.switchBlocks.get(a.id);
                        const blockUntilTs = as?.blockedUntil ?? (switchBlock && switchBlock.until > now2 ? switchBlock.until : undefined);
                        const blockSecondsLeft = blockUntilTs ? Math.max(0, Math.round((blockUntilTs - now2) / 1000)) : undefined;
                        const blockReason = as?.blockedReason ?? switchBlock?.reason;
                        const wsInfo = a.circulationMode === 'windSimulator'
                            ? this.actuatorService.getWindSimInfo(a.id)
                            : undefined;
                        // Soll-Anzeige: aktueller Reglerwunsch (unabhängig von canSwitch)
                        // - Geteilte Aktoren mit Teilnehmern → Voting-Ergebnis
                        // - Direkte Aktoren → Reglerwunsch aus letztem executeDecision-Aufruf
                        // - Fallback → letzter gesendeter Befehl
                        const displayCommand = (a.shared && a.sharedParticipants?.length)
                            ? (this.votingResults.get(a.id) ?? as?.requested ?? null)
                            : (this.directDesires.get(a.id) ?? as?.requested ?? null);
                        return {
                            id: a.id,
                            name: a.name,
                            type: a.type,
                            command: displayCommand,
                            effectiveState: as?.effectiveState ?? null,
                            feedback: as?.feedback ?? null,
                            health: as?.health ?? 'unknown',
                            shared: a.shared,
                            sharedVotingMode: a.sharedVotingMode,
                            sharedParticipants: a.sharedParticipants,
                            votes: (a.shared && a.sharedParticipants?.length)
                                ? this.sharedActorManager.getVotes(a.id)
                                : undefined,
                            manualLock: as?.manualLock ?? false,
                            blocked: as?.blocked ?? false,
                            blockReason: blockReason,
                            blockSecondsLeft: blockSecondsLeft && blockSecondsLeft > 0 ? blockSecondsLeft : undefined,
                            blockUntil: blockUntilTs && (blockSecondsLeft ?? 0) > 0 ? blockUntilTs : undefined,
                            windSimIsOn: wsInfo?.isOn,
                            windSimNextChangeAt: wsInfo?.nextChangeAt,
                            power: as?.power ?? null,
                            ratedPowerW: a.ratedPowerW,
                        };
                    });

                // Externe geteilte Aktoren: Aktoren aus anderen Gruppen die diese Gruppe als Teilnehmer listen
                for (const otherGroup of this.growConfig.groups) {
                    if (otherGroup.id === g.id) continue;
                    for (const a of otherGroup.actuators) {
                        if (!a.enabled || !a.shared || !a.sharedParticipants?.length) continue;
                        const participant = a.sharedParticipants.find(p => p.groupId === g.id);
                        if (!participant) continue;
                        // Nur hinzufügen wenn dieser Aktor nicht schon in der eigenen Gruppe konfiguriert ist
                        const alreadyOwn = g.actuators.some(oa => oa.commandStateId === a.commandStateId);
                        if (alreadyOwn) continue;
                        const as = this.actuatorService.getState(a.id);
                        actuators.push({
                            id: a.id,
                            name: a.name,
                            type: a.type,
                            command: this.votingResults.get(a.id) ?? as?.requested ?? null,
                            effectiveState: as?.effectiveState ?? null,
                            feedback: as?.feedback ?? null,
                            health: as?.health ?? 'unknown',
                            sharedVotingMode: a.sharedVotingMode,
                            sharedParticipants: a.sharedParticipants,
                            sharedFromGroupId: otherGroup.id,
                            sharedFromGroupName: otherGroup.name,
                            influenceFactor: participant.influenceFactor,
                        });
                    }
                }

                // Sollwerte aus aktivem Klimaprofil
                let setpointTemp: number | null = null;
                let setpointTempTolerance: number | null = null;
                let setpointHumidity: number | null = null;
                let setpointHumidityTolerance: number | null = null;
                let setpointVpdMin: number | null = null;
                let setpointVpdMax: number | null = null;
                let setpointSoilMoistureTarget: number | null = null;
                let setpointSoilMoistureTolerance: number | null = null;
                let setpointCo2Target: number | null = null;
                let setpointCo2Tolerance: number | null = null;
                if (state?.activeProfile) {
                    const sp = this.scheduleService.getActiveSetpoint(state.activeProfile, state.dayNight ?? 'day', this.lightChangeTimes.get(g.id) ?? Date.now(), this.lightTransitionFromNight.get(g.id) ?? false);
                    setpointTemp = sp.temperature;
                    setpointTempTolerance = sp.temperatureTolerance;
                    setpointHumidity = sp.humidity;
                    setpointHumidityTolerance = sp.humidityTolerance;
                    setpointVpdMin = sp.vpdMin;
                    setpointVpdMax = sp.vpdMax;
                    setpointSoilMoistureTarget = sp.soilMoistureTarget ?? null;
                    setpointSoilMoistureTolerance = sp.soilMoistureTolerance ?? null;
                    setpointCo2Target = sp.co2Target ?? null;
                    setpointCo2Tolerance = sp.co2Tolerance ?? null;
                }

                // Zusätzliche Sensorwerte: Einzelwerte für Typen wo mehrere sinnvoll sind
                const soilAggDb = this.sensorService.aggregate(g.sensors, 'soilMoisture', g.aggregationMethod);
                const leafTempAggDb = this.sensorService.aggregate(g.sensors, 'leafTemperature', g.aggregationMethod);

                const soilSensors = g.sensors
                    .filter(s => s.enabled && s.type === 'soilMoisture')
                    .map(s => ({ id: s.id, name: s.name, value: (this.sensorService.getState(s.id)?.processedValue as number | null) ?? null }));

                const leafSensors = g.sensors
                    .filter(s => s.enabled && s.type === 'leafTemperature')
                    .map(s => ({ id: s.id, name: s.name, value: (this.sensorService.getState(s.id)?.processedValue as number | null) ?? null }));

                const sensorDetails = g.sensors
                    .filter(s => s.enabled)
                    .map(s => {
                        const ss = this.sensorService.getState(s.id);
                        return {
                            id: s.id,
                            name: s.name,
                            type: s.type,
                            quality: ss?.quality ?? 0,
                            valid: ss?.valid ?? false,
                            stale: ss?.stale ?? true,
                            error: ss?.error,
                        };
                    });

                // Sensoren in "monitor"-Rolle
                const monitorSensors = g.sensors
                    .filter(s => s.enabled && (s.role === 'monitor' || (!['primary','backup'].includes(s.role ?? 'primary'))))
                    .map(s => s.name);

                // Kamera-URL (erste snapshotUrl-Kamera der Gruppe)
                const cam = (g.cameras as Array<{ enabled: boolean; sourceType: string; sourceId: string }> | undefined)?.find(c => c.enabled && c.sourceType === 'snapshotUrl');
                const cameraUrl = cam?.sourceId ?? null;

                // Manuelle Übersteuerungen für diese Gruppe
                const now = Date.now();
                const manualOverrides: Record<string, { command: boolean | number; until: number }> = {};
                for (const a of g.actuators) {
                    const ov = this.dashboardOverrides.get(a.id);
                    if (ov && ov.until > now) manualOverrides[a.id] = ov;
                    else if (ov) this.dashboardOverrides.delete(a.id);
                }
                // Manuelle Übersteuerungen auch für externe geteilte Aktoren anzeigen (Teilnehmer-Sicht)
                for (const a of actuators) {
                    if (!a.sharedFromGroupId || manualOverrides[a.id]) continue;
                    const ov = this.dashboardOverrides.get(a.id);
                    if (ov && ov.until > now) manualOverrides[a.id] = ov;
                }

                return {
                    id: g.id,
                    name: g.name,
                    color: g.color,
                    phase: g.phase,
                    mode: g.mode,
                    runtimeMode: this.dashboardModeOverrides.get(g.id) ?? 'auto',
                    health: state?.degradation ?? 'FAULT',
                    temperature: state?.temperature ?? null,
                    humidity: state?.humidity ?? null,
                    vpd: state?.vpd ?? null,
                    soilMoisture: soilAggDb.value,
                    soilSensors,
                    co2: state?.co2 ?? null,
                    leafTemperature: leafTempAggDb.value,
                    leafSensors,
                    sensorDetails,
                    isDay: state?.dayNight === 'day',
                    dayNight: state?.dayNight ?? 'day',
                    sensorQuality: state?.sensorQuality ?? 0,
                    actuators,
                    alarms: groupAlarms,
                    lastDecision: state?.lastDecision ? JSON.stringify(state.lastDecision) : '',
                    irrigationRunning: this.irrigationService.isAnyZoneRunning(g),
                    setpointTemp,
                    setpointTempTolerance,
                    setpointHumidity,
                    setpointHumidityTolerance,
                    setpointVpdMin,
                    setpointVpdMax,
                    setpointSoilMoistureTarget,
                    setpointSoilMoistureTolerance,
                    setpointCo2Target,
                    setpointCo2Tolerance,
                    monitorSensors,
                    cameraUrl,
                    manualOverrides,
                    outdoorTemp: g.outdoorSensor?.enabled && g.outdoorSensor.tempStateId
                        ? (this.outdoorValues.get(g.outdoorSensor.tempStateId) ?? null)
                        : null,
                    outdoorHumidity: g.outdoorSensor?.enabled && g.outdoorSensor.humidityStateId
                        ? (this.outdoorValues.get(g.outdoorSensor.humidityStateId) ?? null)
                        : null,
                };
            });

        return {
            ts: Date.now(),
            adapterVersion: this.version ?? '0.1.0',
            health: 'running',
            activeAlarms: activeAlarms.length,
            groups,
        };
    }

    private async updateGroupStates(config: GroupConfig, state: GroupState): Promise<void> {
        const base = `groups.${config.id}`;
        const updates: Array<[string, ioBroker.StateValue]> = [
            [`${base}.info.name`, config.name],
            [`${base}.info.enabled`, config.enabled],
            [`${base}.info.mode`, config.mode],
            [`${base}.info.phase`, config.phase],
            [`${base}.info.health`, state.degradation],
            [`${base}.climate.temperature`, state.temperature ?? null],
            [`${base}.climate.humidity`, state.humidity ?? null],
            [`${base}.climate.vpd`, state.vpd !== null ? Math.round(state.vpd * 1000) / 1000 : null],
            [`${base}.climate.dewPoint`, state.dewPoint !== null ? Math.round(state.dewPoint * 10) / 10 : null],
            [`${base}.climate.absoluteHumidity`, state.absoluteHumidity !== null ? Math.round(state.absoluteHumidity * 10) / 10 : null],
            [`${base}.climate.condensationRisk`, state.condensationRisk],
            [`${base}.climate.sensorQuality`, state.sensorQuality],
            [`${base}.climate.co2`, this.sensorService.aggregate(config.sensors, 'co2', config.aggregationMethod, config.stabilityTimeSeconds).value],
            [`${base}.diagnostics.sensorHealth`, state.sensorQuality],
            [`${base}.diagnostics.lastDecision`, state.lastDecision ? JSON.stringify(state.lastDecision) : ''],
        ];

        if (state.activeProfile) {
            const sp = this.scheduleService.getActiveSetpoint(
                state.activeProfile,
                state.dayNight,
                this.lightChangeTimes.get(config.id) ?? Date.now(),
                this.lightTransitionFromNight.get(config.id) ?? false
            );
            updates.push(
                [`${base}.climate.targetTemperature`, sp.temperature],
                [`${base}.climate.targetHumidity`, sp.humidity],
                [`${base}.climate.targetVpd`, (sp.vpdMin != null && sp.vpdMax != null) ? (sp.vpdMin + sp.vpdMax) / 2 : null]
            );
        }

        if (state.nextScheduleChange) {
            updates.push([`${base}.info.nextChange`, state.nextScheduleChange]);
        }

        const alarmSev = this.alarmService.getHighestSeverity(config.id);
        updates.push([`${base}.alarms.active`, this.alarmService.getActiveAlarms().some(a => a.groupId === config.id)]);
        updates.push([`${base}.alarms.highestSeverity`, alarmSev ?? 'none']);

        for (const [key, val] of updates) {
            await this.setStateAsync(key, { val, ack: true });
        }

        // Sensor-Tagesstatistik akkumulieren
        const sensors: Array<[string, string, number | null]> = [
            ['temperature', 'Temperatur', state.temperature],
            ['humidity', 'Luftfeuchte', state.humidity],
            ['vpd', 'VPD', state.vpd],
        ];
        for (const [sid, name, val] of sensors) {
            if (val !== null) this.databaseService.trackSensorValue(config.id, sid, val, name);
        }
        for (const [, ss] of state.sensors) {
            const sVal = typeof ss.processedValue === 'number' ? ss.processedValue : null;
            if (sVal !== null) {
                const sConf = config.sensors.find(s => s.id === ss.id);
                if (sConf && sConf.type !== 'door') this.databaseService.trackSensorValue(config.id, ss.id, sVal, sConf.name);
            }
        }

        // Soil-States schreiben (immer, auch wenn keine Zones konfiguriert)
        let soilMoistureSum = 0;
        let soilMoistureCount = 0;
        let irrigationRequired = false;
        for (const zone of config.irrigationZones) {
            const zs = this.irrigationService.getState(zone.id);
            if (zs) {
                if (zs.currentMoisture !== null) {
                    soilMoistureSum += zs.currentMoisture;
                    soilMoistureCount++;
                }
                if (zone.enabled !== false && (zs.running || (zs.currentMoisture !== null && zs.currentMoisture < zone.startMoisture))) {
                    irrigationRequired = true;
                }
            }
        }
        const soilMoisture = soilMoistureCount > 0 ? soilMoistureSum / soilMoistureCount : null;
        await this.setStateAsync(`${base}.soil.moisture`, { val: soilMoisture, ack: true });
        await this.setStateAsync(`${base}.soil.irrigationRequired`, { val: irrigationRequired, ack: true });

        // Aktorzustände
        for (const actuatorConfig of config.actuators) {
            const actState = this.actuatorService.getState(actuatorConfig.id);
            if (!actState) continue;
            const aBase = `${base}.actuators.${actuatorConfig.id}`;
            await this.setStateAsync(`${aBase}.command`, { val: actState.requested as ioBroker.StateValue, ack: true });
            await this.setStateAsync(`${aBase}.requested`, { val: actState.requested as ioBroker.StateValue, ack: true });
            await this.setStateAsync(`${aBase}.feedback`, { val: actState.feedback as ioBroker.StateValue, ack: true });
            await this.setStateAsync(`${aBase}.power`, { val: actState.power, ack: true });
            await this.setStateAsync(`${aBase}.effectiveState`, { val: actState.effectiveState as ioBroker.StateValue, ack: true });
            await this.setStateAsync(`${aBase}.health`, { val: actState.health, ack: true });
        }
    }

    // ============================================================
    // Objekte anlegen
    // ============================================================

    private async createGroupObjects(group: GroupConfig): Promise<void> {
        const base = `groups.${group.id}`;

        // Channels
        for (const channel of ['info', 'climate', 'soil', 'actuators', 'diagnostics', 'alarms']) {
            await this.setObjectNotExistsAsync(`${base}.${channel}`, {
                type: 'channel',
                common: { name: channel },
                native: {},
            });
        }

        // Info States
        await this.createStateDef(`${base}.info.name`, 'string', 'text', group.name);
        await this.createStateDef(`${base}.info.enabled`, 'boolean', 'indicator', group.enabled);
        await this.createStateDef(`${base}.info.mode`, 'string', 'text', group.mode);
        await this.createStateDef(`${base}.info.phase`, 'string', 'text', group.phase);
        await this.createStateDef(`${base}.info.health`, 'string', 'text', 'FULL');
        await this.createStateDef(`${base}.info.nextChange`, 'number', 'value.time', 0);

        // Klima States
        const climateStates: Array<[string, string, string, number | null]> = [
            ['temperature', '°C', 'value.temperature', null],
            ['humidity', '%', 'value.humidity', null],
            ['vpd', 'kPa', 'value', null],
            ['dewPoint', '°C', 'value.temperature', null],
            ['absoluteHumidity', 'g/m³', 'value', null],
            ['targetTemperature', '°C', 'value.temperature', null],
            ['targetHumidity', '%', 'value.humidity', null],
            ['targetVpd', 'kPa', 'value', null],
            ['sensorQuality', '%', 'value', 0],
            ['co2', 'ppm', 'value.co2', null],
        ];
        for (const [name, unit, role, def] of climateStates) {
            await this.createStateDef(`${base}.climate.${name}`, 'number', role, def, unit);
        }
        await this.createStateDef(`${base}.climate.condensationRisk`, 'boolean', 'indicator', false);

        // Soil States (optional – auch ohne IrrigationZones anlegen)
        await this.createStateDef(`${base}.soil.moisture`, 'number', 'value.humidity', null, '%');
        await this.createStateDef(`${base}.soil.irrigationRequired`, 'boolean', 'indicator', false);

        // Diagnostics
        await this.createStateDef(`${base}.diagnostics.sensorHealth`, 'number', 'value', 0, '%');
        await this.createStateDef(`${base}.diagnostics.lastDecision`, 'string', 'text', '');
        await this.createStateDef(`${base}.diagnostics.actuatorHealth`, 'string', 'text', 'ok');

        // Alarms
        await this.createStateDef(`${base}.alarms.active`, 'boolean', 'indicator.alarm', false);
        await this.createStateDef(`${base}.alarms.highestSeverity`, 'string', 'text', 'none');
        await this.createStateDef(`${base}.alarms.lastMessage`, 'string', 'text', '');

        // Aktoren
        for (const actuator of group.actuators) {
            const aBase = `${base}.actuators.${actuator.id}`;
            await this.setObjectNotExistsAsync(aBase, {
                type: 'channel',
                common: { name: actuator.name },
                native: {},
            });
            await this.createStateDef(`${aBase}.command`, 'mixed', 'switch', actuator.offValue as ioBroker.StateValue);
            await this.createStateDef(`${aBase}.requested`, 'mixed', 'indicator', actuator.offValue as ioBroker.StateValue);
            await this.createStateDef(`${aBase}.feedback`, 'mixed', 'indicator', null);
            await this.createStateDef(`${aBase}.power`, 'number', 'value.power', null, 'W');
            await this.createStateDef(`${aBase}.effectiveState`, 'mixed', 'indicator', actuator.offValue as ioBroker.StateValue);
            await this.createStateDef(`${aBase}.override`, 'boolean', 'switch', false, undefined, true);
            await this.createStateDef(`${aBase}.health`, 'string', 'text', 'unknown');
        }
    }

    private async initGlobalDatabase(): Promise<void> {
        await this.setObjectNotExistsAsync('database', { type: 'folder', common: { name: 'Datenbank' }, native: {} });
        await this.setObjectNotExistsAsync('database.strains', {
            type: 'state',
            common: { name: 'Sortenwiki', type: 'string', role: 'json', read: true, write: true, def: '[]' },
            native: {},
        });
        const strainsState = await this.getStateAsync('database.strains');
        if (!strainsState || !strainsState.val) {
            await this.setStateAsync('database.strains', { val: '[]', ack: true });
        }
    }

    private async createDatabaseObjects(groupId: string): Promise<void> {
        const base = `database.${groupId}`;
        await this.setObjectNotExistsAsync('database', { type: 'folder', common: { name: 'Datenbank' }, native: {} });
        await this.setObjectNotExistsAsync(base, { type: 'folder', common: { name: `DB Gruppe ${groupId}` }, native: {} });
        for (const key of ['stats', 'energy', 'irrigation', 'analyses']) {
            await this.setObjectNotExistsAsync(`${base}.${key}`, {
                type: 'state',
                common: { name: key, type: 'string', role: 'json', read: true, write: key === 'analyses', def: '[]' },
                native: {},
            });
            const s = await this.getStateAsync(`${base}.${key}`);
            if (!s) await this.setStateAsync(`${base}.${key}`, { val: '[]', ack: true });
        }
    }

    private async createStateDef(
        id: string,
        type: ioBroker.CommonType | 'mixed',
        role: string,
        def: ioBroker.StateValue,
        unit?: string,
        write = false
    ): Promise<void> {
        const common: ioBroker.StateCommon = {
            name: id.split('.').pop() ?? id,
            type: type as ioBroker.CommonType,
            role,
            read: true,
            write,
            def: def ?? null,
        };
        if (unit) (common as ioBroker.StateCommon & { unit: string }).unit = unit;
        await this.setObjectNotExistsAsync(id, {
            type: 'state',
            common,
            native: {},
        });
    }

    private async handleEmergencyStop(): Promise<void> {
        const now = Date.now();
        // Schreibdurchlauf maximal alle 60s — verhindert Spam, erlaubt aber Re-Apply
        // damit Geräte die zwischenzeitlich reconnecten wieder in den sicheren Zustand gebracht werden
        if (this.emergencyStopLastAppliedAt > 0 && now - this.emergencyStopLastAppliedAt < 60_000) return;
        this.emergencyStopLastAppliedAt = now;
        for (const group of this.growConfig.groups) {
            for (const actuator of group.actuators) {
                const safeVal = actuator.safeState === 'off' ? actuator.offValue : actuator.onValue;
                await this.setActuatorState(actuator.commandStateId, safeVal);
            }
        }
    }

    // ============================================================
    // Alarm-Objekte im ioBroker-Baum
    // ============================================================

    private async updateAlarmObjects(): Promise<void> {
        const allAlarms = this.alarmService.getAllAlarms();
        for (const alarm of allAlarms) {
            const base = `alarms.${alarm.id}`;
            // Kanal anlegen
            await this.setObjectNotExistsAsync(base, {
                type: 'channel',
                common: { name: `Alarm ${alarm.code}` },
                native: {},
            });
            // States anlegen und setzen
            await this.setObjectNotExistsAsync(`${base}.active`, {
                type: 'state',
                common: { name: 'active', type: 'boolean', role: 'indicator.alarm', read: true, write: false, def: false },
                native: {},
            });
            await this.setObjectNotExistsAsync(`${base}.severity`, {
                type: 'state',
                common: { name: 'severity', type: 'string', role: 'text', read: true, write: false, def: 'info' },
                native: {},
            });
            await this.setObjectNotExistsAsync(`${base}.groupId`, {
                type: 'state',
                common: { name: 'groupId', type: 'string', role: 'text', read: true, write: false, def: '' },
                native: {},
            });
            await this.setObjectNotExistsAsync(`${base}.code`, {
                type: 'state',
                common: { name: 'code', type: 'string', role: 'text', read: true, write: false, def: '' },
                native: {},
            });
            await this.setObjectNotExistsAsync(`${base}.message`, {
                type: 'state',
                common: { name: 'message', type: 'string', role: 'text', read: true, write: false, def: '' },
                native: {},
            });
            await this.setObjectNotExistsAsync(`${base}.since`, {
                type: 'state',
                common: { name: 'since', type: 'number', role: 'value.time', read: true, write: false, def: 0 },
                native: {},
            });
            await this.setObjectNotExistsAsync(`${base}.acknowledged`, {
                type: 'state',
                common: { name: 'acknowledged', type: 'boolean', role: 'indicator', read: true, write: false, def: false },
                native: {},
            });

            await this.setStateAsync(`${base}.active`, { val: alarm.active, ack: true });
            await this.setStateAsync(`${base}.severity`, { val: alarm.severity, ack: true });
            await this.setStateAsync(`${base}.groupId`, { val: alarm.groupId, ack: true });
            await this.setStateAsync(`${base}.code`, { val: alarm.code, ack: true });
            await this.setStateAsync(`${base}.message`, { val: alarm.message, ack: true });
            await this.setStateAsync(`${base}.since`, { val: alarm.since, ack: true });
            await this.setStateAsync(`${base}.acknowledged`, { val: alarm.acknowledged, ack: true });
        }
    }

    // ============================================================
    // Alarm-Kanäle einrichten
    // ============================================================

    private setupAlarmChannels(): void {
        const channels = this.growConfig.alarmChannels ?? [];
        if (channels.length === 0) return;

        this.alarmService.addListener((event) => {
            // Nur aktive Alarme weiterleiten – clear-Events ignorieren
            const alarm = event.alarm;
            if (!alarm.active) return;
            const alarmText = `[${alarm.severity.toUpperCase()}] ${alarm.code}: ${alarm.message}`;
            const now = new Date();
            const nowHH = now.getHours();
            const nowMM = now.getMinutes();

            for (const channel of channels) {
                if (!channel.enabled) continue;

                // Schweregrad-Filter
                const severityOrder = ['info', 'warning', 'fault', 'critical'];
                const alarmIdx = severityOrder.indexOf(alarm.severity);
                const minIdx = severityOrder.indexOf(channel.minSeverity);
                if (alarmIdx < minIdx) continue;

                // Ruhezeiten prüfen
                if (channel.quietHours) {
                    const qh = channel.quietHours;
                    const nowTotal = nowHH * 60 + nowMM;
                    const startTotal = qh.startHH * 60 + qh.startMM;
                    const endTotal = qh.endHH * 60 + qh.endMM;
                    const inQuiet = startTotal <= endTotal
                        ? nowTotal >= startTotal && nowTotal < endTotal
                        : nowTotal >= startTotal || nowTotal < endTotal;
                    if (inQuiet) continue;
                }

                // State-Weiterleitung
                if (channel.targetStateId) {
                    this.setForeignStateAsync(channel.targetStateId, { val: alarmText, ack: false })
                        .catch(err => this.log.warn(`AlarmChannel ${channel.name}: State-Fehler: ${err}`));
                }

                // Adapter-Nachricht
                if (channel.sendToAdapter && channel.sendToInstance) {
                    this.sendTo(channel.sendToInstance, 'send', { text: alarmText });
                }
            }
        });

        this.log.info(`${channels.length} Alarmkanal(e) konfiguriert`);
    }

    // ============================================================
    // Admin-Nachrichten
    // ============================================================

    private async onMessage(obj: ioBroker.Message): Promise<void> {
        if (!obj) return;
        this.log.debug(`Message: ${obj.command}`);

        switch (obj.command) {
            case 'getGroups':
                if (obj.callback) {
                    this.sendTo(obj.from, obj.command, this.growConfig.groups, obj.callback);
                }
                break;
            case 'getGroupState':
                if (obj.callback && obj.message && typeof obj.message === 'object' && 'groupId' in obj.message) {
                    const gs = this.groupStates.get((obj.message as { groupId: string }).groupId);
                    // Maps don't survive JSON serialization — convert to plain objects
                    const payload = gs ? {
                        ...gs,
                        sensors: Object.fromEntries(gs.sensors),
                        actuators: Object.fromEntries(gs.actuators),
                    } : null;
                    this.sendTo(obj.from, obj.command, payload as unknown as ioBroker.MessagePayload, obj.callback);
                }
                break;
            case 'setOverride':
                if (obj.message && typeof obj.message === 'object') {
                    const msg = obj.message as { groupId: string; actuatorId: string; value: boolean | number; durationMinutes: number };
                    const durationMin = typeof msg.durationMinutes === 'number' && msg.durationMinutes > 0 ? msg.durationMinutes : 60;
                    const group = this.growConfig.groups.find(g => g.id === msg.groupId);
                    const actuator = group?.actuators.find(a => a.id === msg.actuatorId);
                    if (actuator) {
                        this.actuatorService.setOverride(actuator, msg.value, durationMin);
                        if (obj.callback) this.sendTo(obj.from, obj.command, { ok: true }, obj.callback);
                    } else if (obj.callback) {
                        this.sendTo(obj.from, obj.command, { ok: false, error: `Aktor nicht gefunden: ${msg.actuatorId}` }, obj.callback);
                    }
                }
                break;
            case 'acknowledgeAlarm':
                if (obj.message && typeof obj.message === 'object' && 'alarmId' in obj.message) {
                    this.alarmService.acknowledge((obj.message as { alarmId: string }).alarmId);
                    if (obj.callback) this.sendTo(obj.from, obj.command, { ok: true }, obj.callback);
                }
                break;
            case 'getAlarms':
                if (obj.callback) {
                    this.sendTo(obj.from, obj.command, this.alarmService.getAllAlarms(), obj.callback);
                }
                break;
            case 'exportConfig':
                if (obj.callback) {
                    const json = this.configurationService.exportConfig(this.growConfig);
                    this.sendTo(obj.from, obj.command, { json } as unknown as ioBroker.MessagePayload, obj.callback);
                }
                break;
            case 'importConfig':
                if (obj.message && typeof obj.message === 'object' && 'json' in obj.message) {
                    const importResult = this.configurationService.importConfig((obj.message as { json: string }).json);
                    if (obj.callback) {
                        this.sendTo(obj.from, obj.command, importResult.result as unknown as ioBroker.MessagePayload, obj.callback);
                    }
                    if (importResult.config) {
                        this.growConfig = importResult.config;
                        this.log.info('Konfiguration importiert');
                        this.restart();
                    }
                }
                break;
            case 'getCapabilities':
                if (obj.callback && obj.message && typeof obj.message === 'object' && 'groupId' in obj.message) {
                    const gId = (obj.message as { groupId: string }).groupId;
                    const grp = this.growConfig.groups.find(g => g.id === gId);
                    const gs2 = this.groupStates.get(gId);
                    if (grp && gs2) {
                        const soilAgg2 = this.sensorService.aggregate(grp.sensors, 'soilMoisture', grp.aggregationMethod);
                        const leafAgg2 = this.sensorService.aggregate(grp.sensors, 'leafTemperature', grp.aggregationMethod);
                        const cap = this.capabilityService.evaluate(grp, gs2.sensors, gs2.temperature, gs2.humidity, leafAgg2.value, soilAgg2.value);
                        this.sendTo(obj.from, obj.command, cap as unknown as ioBroker.MessagePayload, obj.callback);
                    } else {
                        this.sendTo(obj.from, obj.command, { error: 'Gruppe nicht gefunden' } as unknown as ioBroker.MessagePayload, obj.callback);
                    }
                }
                break;
            case 'triggerIrrigation':
                if (obj.message && typeof obj.message === 'object') {
                    const tMsg = obj.message as { groupId: string; zoneId: string; durationSeconds?: number };
                    const tGrp = this.growConfig.groups.find(g => g.id === tMsg.groupId);
                    const tZone = tGrp?.irrigationZones.find(z => z.id === tMsg.zoneId);
                    if (tZone) {
                        const ok = this.irrigationService.triggerManual(tZone, tMsg.durationSeconds);
                        if (obj.callback) this.sendTo(obj.from, obj.command, { ok } as unknown as ioBroker.MessagePayload, obj.callback);
                    } else {
                        if (obj.callback) this.sendTo(obj.from, obj.command, { error: 'Zone nicht gefunden' } as unknown as ioBroker.MessagePayload, obj.callback);
                    }
                }
                break;
            case 'stopIrrigation':
                if (obj.message && typeof obj.message === 'object') {
                    const sMsg = obj.message as { groupId?: string; zoneId: string };
                    this.irrigationService.stopNow(sMsg.zoneId, 'Manuell gestoppt', sMsg.groupId);
                    if (obj.callback) this.sendTo(obj.from, obj.command, { ok: true } as unknown as ioBroker.MessagePayload, obj.callback);
                }
                break;
            case 'clearAlarmFault':
                if (obj.message && typeof obj.message === 'object' && 'zoneId' in obj.message) {
                    this.irrigationService.clearFault((obj.message as { zoneId: string }).zoneId);
                    if (obj.callback) this.sendTo(obj.from, obj.command, { ok: true } as unknown as ioBroker.MessagePayload, obj.callback);
                }
                break;
            case 'detectAdapters': {
                const ADAPTER_MAP: Array<{ adapter: string; type: string }> = [
                    { adapter: 'telegram',     type: 'telegram' },
                    { adapter: 'whatsapp-cmb', type: 'whatsapp' },
                    { adapter: 'signal-cmb',   type: 'signal' },
                    { adapter: 'pushover',     type: 'pushover' },
                ];
                const detected: Array<{ type: string; instance: string }> = [];
                for (const { adapter, type } of ADAPTER_MAP) {
                    for (let i = 0; i <= 4; i++) {
                        try {
                            const adapterObj = await this.getForeignObjectAsync(`system.adapter.${adapter}.${i}`);
                            if (adapterObj) detected.push({ type, instance: String(i) });
                        } catch { /* nicht installiert */ }
                    }
                }
                detected.push({ type: 'discord', instance: '' });
                if (obj.callback) {
                    this.sendTo(obj.from, obj.command, { detected } as unknown as ioBroker.MessagePayload, obj.callback);
                }
                break;
            }
            case 'testNotification': {
                if (obj.message && typeof obj.message === 'object' && 'channel' in obj.message) {
                    const channel = (obj.message as { channel: import('./models/config').NotificationChannel }).channel;
                    const result = await this.notificationService.sendTest(channel);
                    if (obj.callback) {
                        this.sendTo(obj.from, obj.command, result as unknown as ioBroker.MessagePayload, obj.callback);
                    }
                }
                break;
            }
            default:
                if (obj.callback) {
                    this.sendTo(obj.from, obj.command, { error: `Unbekannter Befehl: ${obj.command}` }, obj.callback);
                }
        }
    }

}

// Adapter instanziieren
if (require.main !== module) {
    module.exports = (options: Partial<utils.AdapterOptions>) =>
        new GrowManagerAdapter(options);
} else {
    (() => new GrowManagerAdapter())();
}
