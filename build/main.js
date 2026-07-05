"use strict";
// ============================================================
// GrowManager – ioBroker Adapter
// ============================================================
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
/// <reference types="@types/iobroker" />
const utils = __importStar(require("@iobroker/adapter-core"));
const SensorService_1 = require("./services/SensorService");
const ActuatorService_1 = require("./services/ActuatorService");
const ScheduleService_1 = require("./services/ScheduleService");
const AlarmService_1 = require("./services/AlarmService");
const SafetyService_1 = require("./services/SafetyService");
const ClimateController_1 = require("./control/ClimateController");
const DiagnosticsEngine_1 = require("./diagnostics/DiagnosticsEngine");
const GroupCapabilityService_1 = require("./services/GroupCapabilityService");
const AirSystemService_1 = require("./services/AirSystemService");
const IrrigationService_1 = require("./services/IrrigationService");
const CameraService_1 = require("./services/CameraService");
const ConfigurationService_1 = require("./services/ConfigurationService");
const SharedActorManager_1 = require("./services/SharedActorManager");
const WebDashboardService_1 = require("./services/WebDashboardService");
const NotificationService_1 = require("./services/NotificationService");
const path = __importStar(require("path"));
const calculations_1 = require("./utils/calculations");
class GrowManagerAdapter extends utils.Adapter {
    constructor(options = {}) {
        super({ ...options, name: 'growmanager' });
        this.cycleTimer = null;
        this.watchdogTimer = null;
        // Laufzeit-Zustände
        this.groupStates = new Map();
        this.lightChangeTimes = new Map();
        this.subscribedStateIds = new Set();
        // Letzte bekannte Tag/Nacht-Zustände für Wechselerkennung
        this.lastDayNight = new Map();
        // Manuelle Übersteuerungen vom Dashboard {actuatorId → {command, until}}
        this.dashboardOverrides = new Map();
        // Modus-Übersteuerungen vom Dashboard {groupId → 'auto'|'manual'}
        this.dashboardModeOverrides = new Map();
        // Außenluft-Sensorwerte {stateId → Wert}
        this.outdoorValues = new Map();
        const log = {
            debug: (m) => this.log.debug(m),
            info: (m) => this.log.info(m),
            warn: (m) => this.log.warn(m),
            error: (m) => this.log.error(m),
        };
        this.alarmService = new AlarmService_1.AlarmService(log);
        this.safetyService = new SafetyService_1.SafetyService(this.alarmService, log);
        this.sensorService = new SensorService_1.SensorService(log);
        this.actuatorService = new ActuatorService_1.ActuatorService(log);
        this.scheduleService = new ScheduleService_1.ScheduleService();
        this.climateController = new ClimateController_1.ClimateController(this.alarmService, log);
        this.diagnosticsEngine = new DiagnosticsEngine_1.DiagnosticsEngine(this.alarmService, log);
        this.capabilityService = new GroupCapabilityService_1.GroupCapabilityService();
        this.airSystemService = new AirSystemService_1.AirSystemService(this.alarmService, log);
        this.irrigationService = new IrrigationService_1.IrrigationService(this.alarmService, log);
        this.cameraService = new CameraService_1.CameraService(this.alarmService, log);
        this.configurationService = new ConfigurationService_1.ConfigurationService(log);
        this.sharedActorManager = new SharedActorManager_1.SharedActorManager();
        this.webDashboard = new WebDashboardService_1.WebDashboardService(log, path.join(__dirname, '..'));
        this.notificationService = new NotificationService_1.NotificationService(log, (adapter, command, data) => {
            this.sendTo(adapter, command, data);
        });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }
    // ============================================================
    // Lifecycle
    // ============================================================
    async onReady() {
        this.log.info(`GrowManager v${this.version} startet`);
        this.growConfig = this.config;
        if (!this.growConfig.groups)
            this.growConfig.groups = [];
        if (!this.growConfig.climateProfiles)
            this.growConfig.climateProfiles = [];
        if (!this.growConfig.alarmChannels)
            this.growConfig.alarmChannels = [];
        if (!this.growConfig.notifications) {
            this.growConfig.notifications = { enabled: false, channels: [], cooldownMinutes: 30 };
        }
        this.alarmService.setRetentionDays(this.growConfig.eventRetentionDays ?? 30);
        // Push-Benachrichtigungen: bei neuem Alarm benachrichtigen
        this.alarmService.addListener(({ alarm, isNew }) => {
            const notifCfg = this.growConfig.notifications;
            if (!notifCfg?.enabled)
                return;
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
            }
            catch (err) {
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
        this.webDashboard.setModeCallback(async ({ groupId, mode }) => {
            const group = this.growConfig.groups.find(g => g.id === groupId);
            if (!group)
                throw new Error(`Gruppe ${groupId} nicht gefunden`);
            if (mode === 'auto') {
                this.dashboardModeOverrides.delete(groupId);
                for (const a of group.actuators) {
                    this.dashboardOverrides.delete(a.id);
                    this.actuatorService.unlockManual(a.id);
                }
                this.log.info(`Dashboard: Gruppe ${group.name} → AUTO (Locks aufgehoben, Sofort-Zyklus)`);
                // Sofort-Zyklus damit der korrekte Zustand direkt gesetzt wird
                await this.runCycle();
            }
            else {
                this.dashboardModeOverrides.set(groupId, mode);
                this.log.info(`Dashboard: Gruppe ${group.name} → MANUELL`);
            }
        });
        this.webDashboard.setTrendsCallback(async (groupId, variable) => {
            const stateId = `${this.namespace}.groups.${groupId}.climate.${variable}`;
            const start = Date.now() - 48 * 3600 * 1000;
            const historyAdapters = ['history.0', 'influxdb.0', 'sql.0'];
            for (const adapter of historyAdapters) {
                try {
                    const pts = await this.queryHistory(adapter, stateId, start, Date.now());
                    if (pts.length > 0)
                        return { points: pts };
                    // Adapter antwortet, aber keine Daten → State-Aufzeichnung nicht aktiviert
                    return {
                        points: [],
                        hint: `History-Adapter (${adapter}) gefunden, aber keine Daten für diesen State.\n` +
                            `Bitte in ioBroker unter Objekte → ${stateId} → History-Tab die Aufzeichnung aktivieren.`,
                    };
                }
                catch { /* Adapter nicht installiert, nächsten probieren */ }
            }
            // Kein History-Adapter → eigener Puffer als Fallback
            const pts = this.diagnosticsEngine.getHourlyHistory(groupId, variable);
            return { points: pts };
        });
        this.webDashboard.setControlCallback(async ({ groupId, actuatorId, command, durationMinutes }) => {
            // Aktor in eigener Gruppe suchen; falls nicht gefunden, quer über alle Gruppen (shared-from Sicht)
            let actuator = this.growConfig.groups.find(g => g.id === groupId)?.actuators.find(a => a.id === actuatorId);
            if (!actuator) {
                for (const g of this.growConfig.groups) {
                    actuator = g.actuators.find(a => a.id === actuatorId);
                    if (actuator)
                        break;
                }
            }
            if (!actuator)
                throw new Error(`Aktor ${actuatorId} nicht gefunden`);
            this.dashboardOverrides.set(actuatorId, { command, until: Date.now() + durationMinutes * 60000 });
            // Lock blockiert Auto-Zyklus und setzt requested auf manuellen Wert (→ korrekte LED-Anzeige)
            this.actuatorService.lockForManual(actuatorId, command);
            const val = command ? actuator.onValue : actuator.offValue;
            await this.setForeignStateAsync(actuator.commandStateId, { val: val, ack: false });
            this.log.info(`Dashboard: ${actuator.name} → ${command ? 'EIN' : 'AUS'} (${durationMinutes} min)`);
        });
        this.webDashboard.start(webPort, webBind);
        // Regelzyklus starten
        this.scheduleNextCycle();
        // Watchdog
        this.watchdogTimer = this.setInterval(() => {
            this.actuatorService.tickOverrides();
            this.alarmService.cleanup();
        }, 60000);
        this.log.info('GrowManager bereit');
    }
    async initGroup(group) {
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
        const groupState = {
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
            sensorQuality: 0,
            sensors: new Map(),
            actuators: new Map(),
            alarmActive: false,
        };
        this.groupStates.set(group.id, groupState);
        // ioBroker-States für Gruppe anlegen
        await this.createGroupObjects(group);
        // Sensor-States abonnieren + aktuelle Werte sofort einlesen
        for (const sensor of group.sensors) {
            if (!this.subscribedStateIds.has(sensor.stateId)) {
                await this.subscribeForeignStatesAsync(sensor.stateId);
                this.subscribedStateIds.add(sensor.stateId);
            }
            const current = await this.getForeignStateAsync(sensor.stateId);
            if (current) {
                // Date.now() als ts: Wert gilt ab Erststart als frisch, Stale-Timer beginnt jetzt
                const ss = this.sensorService.processValue(sensor, current.val, Date.now(), current.lc ?? current.ts);
                if (ss)
                    groupState.sensors.set(sensor.id, ss);
            }
            // Health-State abonnieren falls konfiguriert
            if (sensor.healthStateId && !this.subscribedStateIds.has(sensor.healthStateId)) {
                await this.subscribeForeignStatesAsync(sensor.healthStateId);
                this.subscribedStateIds.add(sensor.healthStateId);
                const h = await this.getForeignStateAsync(sensor.healthStateId);
                if (h)
                    this.applyHealthState(sensor.healthStateId, h.val, sensor.healthCheckType, sensor.healthCheckMin);
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
                    if (st && typeof st.val === 'number')
                        this.outdoorValues.set(sid, st.val);
                }
            }
        }
        // Feedback- und Leistungs-States abonnieren
        for (const actuator of group.actuators) {
            if (actuator.feedbackStateId && !this.subscribedStateIds.has(actuator.feedbackStateId)) {
                await this.subscribeForeignStatesAsync(actuator.feedbackStateId);
                this.subscribedStateIds.add(actuator.feedbackStateId);
            }
            // Kein separates Feedback: stateId selbst subscriben → ack:true = Gerätebestätigung
            if (!actuator.feedbackStateId && !this.subscribedStateIds.has(actuator.commandStateId)) {
                await this.subscribeForeignStatesAsync(actuator.commandStateId);
                this.subscribedStateIds.add(actuator.commandStateId);
                const current = await this.getForeignStateAsync(actuator.commandStateId);
                if (current?.ack)
                    this.actuatorService.processFeedback(actuator, current.val);
            }
            if (actuator.powerStateId && !this.subscribedStateIds.has(actuator.powerStateId)) {
                await this.subscribeForeignStatesAsync(actuator.powerStateId);
                this.subscribedStateIds.add(actuator.powerStateId);
            }
            if (actuator.healthStateId && !this.subscribedStateIds.has(actuator.healthStateId)) {
                await this.subscribeForeignStatesAsync(actuator.healthStateId);
                this.subscribedStateIds.add(actuator.healthStateId);
                const h = await this.getForeignStateAsync(actuator.healthStateId);
                if (h)
                    this.applyHealthState(actuator.healthStateId, h.val, actuator.healthCheckType, actuator.healthCheckMin);
            }
        }
    }
    async applyStartBehavior() {
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
    onUnload(callback) {
        try {
            if (this.cycleTimer)
                this.clearTimeout(this.cycleTimer);
            if (this.watchdogTimer)
                this.clearInterval(this.watchdogTimer);
            this.webDashboard.stop();
            this.setStateAsync('info.connection', { val: false, ack: true }).catch(() => { });
            this.setStateAsync('info.status', { val: 'stopped', ack: true }).catch(() => { });
        }
        catch { /* ignore */ }
        callback();
    }
    // ============================================================
    // History-Adapter Abfrage
    // ============================================================
    queryHistory(adapter, stateId, start, end) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`${adapter} timeout`)), 4000);
            this.sendTo(adapter, 'getHistory', {
                id: stateId,
                options: { start, end, aggregate: 'none', count: 5000, addId: false },
            }, (result) => {
                clearTimeout(timer);
                const r = result;
                if (!r || r.error) {
                    reject(new Error(r?.error ?? 'no result'));
                    return;
                }
                const pts = (r.result ?? []).filter(p => p.val !== null && p.val !== undefined);
                resolve(pts.map(p => ({ ts: p.ts, value: Number(p.val) })));
            });
        });
    }
    // ============================================================
    // State-Abonnements
    // ============================================================
    onStateChange(id, state) {
        if (!state)
            return;
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
                    const sensorState = this.sensorService.processValue(sensor, state.val, 
                    // Receiving onStateChange NOW means sensor reported NOW.
                    // state.ts can be old when value hasn't changed (no lc update),
                    // which would falsely trigger the stale check.
                    Math.max(state.ts, Date.now() - 5000), state.lc ?? state.ts, group.stabilityTimeSeconds);
                    const gs = this.groupStates.get(group.id);
                    if (gs)
                        gs.sensors.set(sensor.id, sensorState);
                }
            }
            // Feedback/Leistung verarbeiten
            for (const actuator of group.actuators) {
                if (actuator.feedbackStateId === id) {
                    this.actuatorService.processFeedback(actuator, state.val);
                }
                else if (!actuator.feedbackStateId && actuator.commandStateId === id && state.ack) {
                    // Zigbee/Z-Wave schreibt ack:true wenn Gerät den Zustand bestätigt hat
                    this.actuatorService.processFeedback(actuator, state.val);
                }
                if (actuator.powerStateId === id) {
                    const actState = this.actuatorService.getState(actuator.id);
                    if (actState) {
                        this.actuatorService.processFeedback(actuator, actState.feedback, state.val);
                    }
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
    applyHealthState(stateId, val, checkType, checkMin) {
        let healthy;
        if (checkType === 'number') {
            healthy = typeof val === 'number' && val >= (checkMin ?? 1);
        }
        else {
            // boolean (default): true/1/"true" = healthy
            healthy = val === true || val === 1 || val === 'true';
        }
        (0, SensorService_1.setDeviceHealth)(stateId, healthy);
        // Für Aktoren: ActuatorState.health aktualisieren + Alarm
        for (const group of this.growConfig.groups) {
            for (const actuator of group.actuators) {
                if (actuator.healthStateId === stateId) {
                    this.actuatorService.setReachable(actuator.id, healthy);
                    if (!healthy) {
                        this.log.warn(`Aktor ${actuator.name} nicht erreichbar (${stateId} = ${val})`);
                        this.alarmService.raise(AlarmService_1.ALARM_CODES.ACTUATOR_UNREACHABLE, group.id, actuator.id, 'fault', `Aktor "${actuator.name}" nicht erreichbar`);
                    }
                    else {
                        this.alarmService.clear(AlarmService_1.ALARM_CODES.ACTUATOR_UNREACHABLE, group.id, actuator.id);
                    }
                }
            }
        }
        if (!healthy) {
            this.log.debug(`Health-State ${stateId} = ${val} → Gerät nicht erreichbar`);
        }
    }
    handleControlState(id, state) {
        if (state.ack)
            return; // Nur ack=false verarbeiten (Bedienbefehl)
        const key = id.split('.').pop();
        switch (key) {
            case 'emergencyStop':
                this.safetyService.setEmergencyStop(!!state.val);
                this.setStateAsync(id, { val: state.val, ack: true });
                break;
            case 'maintenance':
                this.safetyService.setGlobalMaintenance(!!state.val);
                this.setStateAsync(id, { val: state.val, ack: true });
                break;
            case 'enabled':
                this.setStateAsync(id, { val: state.val, ack: true });
                break;
            case 'acknowledgeAll':
                if (state.val) {
                    this.alarmService.acknowledgeAll();
                    this.setStateAsync(id, { val: false, ack: true });
                }
                break;
        }
    }
    // ============================================================
    // Regelzyklus
    // ============================================================
    scheduleNextCycle() {
        const interval = (this.growConfig.controlCycleSeconds ?? 10) * 1000;
        this.cycleTimer = this.setTimeout(async () => {
            await this.runCycle();
            this.scheduleNextCycle();
        }, interval);
    }
    async runCycle() {
        const cycleStart = Date.now();
        try {
            if (this.safetyService.isEmergencyStop()) {
                await this.handleEmergencyStop();
                return;
            }
            // Gemeinsame Aktoren: Anforderungen sammeln und danach auflösen
            this.sharedActorManager.clearCycle();
            for (const group of this.growConfig.groups) {
                if (!group.enabled)
                    continue;
                try {
                    await this.processGroup(group);
                }
                catch (err) {
                    this.log.error(`Gruppe ${group.name}: Fehler im Zyklus – ${err}`);
                }
            }
            // Teilnehmer-Abstimmungen für geteilte Aktoren mit sharedParticipants
            for (const group of this.growConfig.groups) {
                for (const actuatorConfig of group.actuators) {
                    if (!actuatorConfig.shared || !actuatorConfig.sharedParticipants?.length)
                        continue;
                    const hysteresisSeconds = actuatorConfig.sharedVoteHysteresisSeconds ?? 60;
                    // Eigentümer-Stimme einreichen (Ergebnis aus processGroup)
                    const ownerActState = this.actuatorService.getState(actuatorConfig.id);
                    const ownerWantsOn = ownerActState
                        ? this.actuatorService.isRequestingOn(actuatorConfig, ownerActState.requested)
                        : false;
                    this.sharedActorManager.submitVote(actuatorConfig.id, {
                        groupId: group.id,
                        wantsOn: ownerWantsOn,
                        weight: 1.0,
                        urgency: 1.0,
                        reason: `Eigentümer ${group.name}`,
                    });
                    for (const participant of actuatorConfig.sharedParticipants) {
                        const pState = this.groupStates.get(participant.groupId);
                        if (!pState)
                            continue;
                        const need = this.computeParticipantNeed(actuatorConfig.type, pState, 3);
                        this.sharedActorManager.submitVote(actuatorConfig.id, {
                            groupId: participant.groupId,
                            wantsOn: need.wantsOn,
                            weight: participant.influenceFactor / 100,
                            urgency: need.urgency,
                            reason: `Teilnehmer ${participant.groupId}`,
                        });
                    }
                    // Aktuellen Befehl als Basis für Hysterese ermitteln
                    const currentActState = this.actuatorService.getState(actuatorConfig.id);
                    const currentCommand = currentActState?.requested ?? false;
                    const votingMode = actuatorConfig.sharedVotingMode ?? 'any';
                    const hysteresisForVoting = hysteresisSeconds;
                    const finalCommand = this.sharedActorManager.resolveWithVoting(actuatorConfig.id, votingMode, hysteresisForVoting, group.id, currentCommand);
                    const can = this.actuatorService.canSwitch(actuatorConfig, finalCommand);
                    if (can.allowed) {
                        const changed = this.actuatorService.recordCommand(actuatorConfig, finalCommand);
                        if (changed) {
                            await this.setActuatorState(actuatorConfig.commandStateId, finalCommand);
                            this.log.info(`SharedAktor ${actuatorConfig.name} → ${finalCommand} (Abstimmung: ${votingMode})`);
                        }
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
                        if (act.sharedParticipants?.length)
                            break;
                        const can = this.actuatorService.canSwitch(act, result.finalCommand);
                        if (can.allowed) {
                            const changed = this.actuatorService.recordCommand(act, result.finalCommand);
                            if (changed) {
                                await this.setActuatorState(act.commandStateId, result.finalCommand);
                                this.log.info(`SharedAktor ${act.name} → ${result.finalCommand} (Gruppe ${result.winningGroupId}: ${result.reason})`);
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
        }
        catch (err) {
            this.log.error(`Fehler im Regelzyklus: ${err}`);
        }
    }
    async processGroup(config) {
        const state = this.groupStates.get(config.id);
        if (!state)
            return;
        const now = new Date();
        // 1) Tag/Nacht bestimmen
        const dayNight = this.scheduleService.getDayNight(now, config.schedule);
        const prevDayNight = this.lastDayNight.get(config.id);
        if (dayNight !== prevDayNight) {
            this.lightChangeTimes.set(config.id, Date.now());
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
        if (tempAgg.usingBackup)
            this.log.warn(`Gruppe ${config.name}: Temperatur-Backup-Sensor aktiv (primary ausgefallen)`);
        if (humAgg.usingBackup)
            this.log.warn(`Gruppe ${config.name}: Feuchte-Backup-Sensor aktiv (primary ausgefallen)`);
        state.temperature = tempAgg.value;
        state.humidity = humAgg.value;
        // Abgeleitete Größen
        if (state.temperature !== null && state.humidity !== null) {
            state.vpd = (0, calculations_1.calculateVPD)(state.temperature, state.humidity);
            state.dewPoint = (0, calculations_1.dewPoint)(state.temperature, state.humidity);
            state.absoluteHumidity = (0, calculations_1.absoluteHumidity)(state.temperature, state.humidity);
            state.condensationRisk = (0, calculations_1.condensationRisk)(state.temperature, state.humidity);
            if (leafTempAgg.value !== null) {
                state.leafVpd = (0, calculations_1.calculateLeafVPD)(state.temperature, leafTempAgg.value, state.humidity);
            }
        }
        else {
            state.vpd = null;
            state.dewPoint = null;
            state.absoluteHumidity = null;
            state.condensationRisk = false;
            state.leafVpd = null;
        }
        state.sensorQuality = Math.round((tempAgg.quality + humAgg.quality) / 2);
        // Trend-Puffer befüllen
        if (state.temperature !== null)
            this.diagnosticsEngine.recordValue(config.id, 'temperature', state.temperature);
        if (state.humidity !== null)
            this.diagnosticsEngine.recordValue(config.id, 'humidity', state.humidity);
        if (state.vpd !== null)
            this.diagnosticsEngine.recordValue(config.id, 'vpd', state.vpd);
        // 3) Degradationsstufe bestimmen
        state.degradation = this.safetyService.computeDegradation(state, config);
        // 4) Aktives Profil laden
        const profile = this.growConfig.climateProfiles.find(p => p.id === config.profileId);
        const lightChangeTs = this.lightChangeTimes.get(config.id) ?? Date.now();
        const setpoint = profile
            ? this.scheduleService.getActiveSetpoint(profile, dayNight, lightChangeTs)
            : null;
        state.activeProfile = profile;
        // 5) Regelentscheidung
        let decision = null;
        if (setpoint && config.mode !== 'off') {
            const shadowMode = config.mode === 'monitorOnly' || this.safetyService.isGroupPaused(config.id);
            const outdoorCfg = config.outdoorSensor;
            const outdoorTemp = outdoorCfg?.enabled && outdoorCfg.tempStateId
                ? (this.outdoorValues.get(outdoorCfg.tempStateId) ?? null)
                : null;
            const outdoorHumidity = outdoorCfg?.enabled && outdoorCfg.humidityStateId
                ? (this.outdoorValues.get(outdoorCfg.humidityStateId) ?? null)
                : null;
            if (outdoorTemp !== null)
                this.log.debug(`Gruppe ${config.name}: Außen ${outdoorTemp.toFixed(1)}°C / ${outdoorHumidity?.toFixed(0) ?? '?'}%`);
            decision = this.climateController.decide(config, state, setpoint, shadowMode, outdoorTemp, outdoorHumidity);
            decision = this.safetyService.applySafetyRules(config, decision);
            state.lastDecision = decision;
        }
        // 6) Aktorbefehle schreiben
        if (decision) {
            await this.executeDecision(config, decision);
        }
        // 6b) Fähigkeiten der Gruppe bewerten (für Logging/Admin-UI)
        const leafTempVal = leafTempAgg.value;
        const soilAgg = this.sensorService.aggregate(config.sensors, 'soilMoisture', config.aggregationMethod, stab);
        const capResult = this.capabilityService.evaluate(config, state.sensors, state.temperature, state.humidity, leafTempVal, soilAgg.value);
        if (capResult.degradation !== 'FULL' && capResult.degradationReason) {
            this.log.debug(`Gruppe ${config.name}: ${capResult.degradation} – ${capResult.degradationReason}`);
        }
        // 6c) Luftstrommanagement
        const isDay = dayNight !== 'night';
        const airDemand = this.airSystemService.computeAirDemand(config, config.airSystem, state.temperature, state.activeProfile
            ? this.scheduleService.getActiveSetpoint(state.activeProfile, dayNight, lightChangeTs).temperature
            : null, state.humidity, state.activeProfile
            ? this.scheduleService.getActiveSetpoint(state.activeProfile, dayNight, lightChangeTs).humidity
            : null, state.vpd, state.activeProfile
            ? this.scheduleService.getActiveSetpoint(state.activeProfile, dayNight, lightChangeTs).vpdMin
            : null, state.activeProfile
            ? this.scheduleService.getActiveSetpoint(state.activeProfile, dayNight, lightChangeTs).vpdMax
            : null, isDay);
        const airOutput = this.airSystemService.computeAirOutput(config.id, config, config.airSystem, airDemand);
        if (airOutput.available) {
            const exhaustAct = config.actuators.find(a => a.type === 'exhaustFan' && a.enabled);
            const supplyAct = config.actuators.find(a => a.type === 'supplyFan' && a.enabled);
            if (exhaustAct) {
                const canSw = this.actuatorService.canSwitch(exhaustAct, airOutput.exhaustCommand);
                if (canSw.allowed) {
                    const changed = this.actuatorService.recordCommand(exhaustAct, airOutput.exhaustCommand);
                    if (changed)
                        await this.setActuatorState(exhaustAct.commandStateId, airOutput.exhaustCommand);
                }
            }
            if (supplyAct && airOutput.supplyCommand !== false) {
                const canSw = this.actuatorService.canSwitch(supplyAct, airOutput.supplyCommand);
                if (canSw.allowed) {
                    const changed = this.actuatorService.recordCommand(supplyAct, airOutput.supplyCommand);
                    if (changed)
                        await this.setActuatorState(supplyAct.commandStateId, airOutput.supplyCommand);
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
                    if (changed)
                        await this.setActuatorState(act.commandStateId, cmd);
                }
            }
        }
        // 6d) Bewässerung
        for (const zone of config.irrigationZones) {
            if (!zone.enabled)
                continue;
            const irriDecision = this.irrigationService.decide(zone, config.id, state.sensors, now);
            const pumpAct = config.actuators.find(a => a.id === zone.pumpActuatorId);
            if (pumpAct && !irriDecision.blocked) {
                const canSw = this.actuatorService.canSwitch(pumpAct, irriDecision.command);
                if (canSw.allowed) {
                    const changed = this.actuatorService.recordCommand(pumpAct, irriDecision.command);
                    if (changed)
                        await this.setActuatorState(pumpAct.commandStateId, irriDecision.command);
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
                        }
                        else {
                            this.cameraService.recordError(camera.id, config.id, camera, 'Kein gültiger Snapshot-State');
                        }
                    }
                    catch (err) {
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
            .filter((s) => s !== undefined && s.valid && typeof s.processedValue === 'number')
            .map(s => s.processedValue);
        if (tempValues.length > 1) {
            const threshold = config.sensorDisagreementThreshold ?? 5;
            this.diagnosticsEngine.checkSensorDisagreement(config.id, 'Temperatur', tempValues, threshold);
        }
        // 8) ioBroker-States aktualisieren
        await this.updateGroupStates(config, state);
    }
    async executeDecision(config, decision) {
        for (const action of decision.actions) {
            if (action.blocked)
                continue;
            const actuatorConfig = config.actuators.find(a => a.id === action.actuatorId);
            if (!actuatorConfig)
                continue;
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
                // State aktualisieren damit Voting-Loop den aktuellen Gruppen-Wunsch lesen kann
                if (actuatorConfig.sharedParticipants?.length) {
                    this.actuatorService.recordCommand(actuatorConfig, action.requested);
                }
                continue;
            }
            const canSwitch = this.actuatorService.canSwitch(actuatorConfig, action.requested);
            if (!canSwitch.allowed) {
                this.log.debug(`Aktor ${actuatorConfig.name}: gesperrt – ${canSwitch.reason} (${canSwitch.waitSeconds}s)`);
                continue;
            }
            const changed = this.actuatorService.recordCommand(actuatorConfig, action.requested);
            if (changed) {
                await this.setActuatorState(actuatorConfig.commandStateId, action.requested);
                this.log.info(`Gruppe ${config.name}: ${actuatorConfig.name} → ${action.requested} (${action.reason})`);
                // Wirkungsprüfung registrieren
                if (actuatorConfig.type === 'heating' && action.requested) {
                    const currentTemp = this.groupStates.get(config.id)?.temperature;
                    if (currentTemp !== null && currentTemp !== undefined) {
                        this.diagnosticsEngine.startEffectCheck(config.id, actuatorConfig.id, 'temperature', 1, currentTemp, 600, 1800, 0.3);
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
    computeParticipantNeed(actuatorType, gs, defaultHysteresis) {
        const hyst = defaultHysteresis;
        const tempHyst = 1.5; // °C
        // Sollwerte aus aktivem Profil ermitteln
        let tempSetpoint = null;
        let humSetpoint = null;
        if (gs.activeProfile) {
            const sp = gs.activeProfile[gs.dayNight === 'night' ? 'night' : 'day'];
            tempSetpoint = sp.temperature;
            humSetpoint = sp.humidity;
        }
        // VPD-Sollwerte für VPD-geregelte Gruppen
        let vpdMax = null;
        let vpdMin = null;
        if (gs.activeProfile) {
            const sp = gs.activeProfile[gs.dayNight === 'night' ? 'night' : 'day'];
            vpdMax = sp.vpdMax ?? null;
            vpdMin = sp.vpdMin ?? null;
        }
        switch (actuatorType) {
            case 'dehumidifier': {
                const target = humSetpoint ?? 60;
                const hum = gs.humidity;
                if (hum === null)
                    return { wantsOn: false, urgency: 0 };
                const excess = hum - (target + hyst);
                if (excess > 0)
                    return { wantsOn: true, urgency: Math.min(1, excess / 10) };
                // VPD zu niedrig → Luftfeuchtigkeit zu hoch → Entfeuchter
                if (vpdMin !== null && gs.vpd !== null && gs.vpd < vpdMin - 0.2) {
                    const deficit = vpdMin - gs.vpd;
                    return { wantsOn: true, urgency: Math.min(1, deficit / 0.5) };
                }
                return { wantsOn: false, urgency: 0 };
            }
            case 'humidifier': {
                const target = humSetpoint ?? 50;
                const hum = gs.humidity;
                if (hum === null)
                    return { wantsOn: false, urgency: 0 };
                const deficit = (target - hyst) - hum;
                if (deficit > 0)
                    return { wantsOn: true, urgency: Math.min(1, deficit / 10) };
                // VPD zu hoch → Luftfeuchtigkeit zu niedrig → Befeuchter
                if (vpdMax !== null && gs.vpd !== null && gs.vpd > vpdMax + 0.2) {
                    const excess = gs.vpd - vpdMax;
                    return { wantsOn: true, urgency: Math.min(1, excess / 0.5) };
                }
                return { wantsOn: false, urgency: 0 };
            }
            case 'cooling':
            case 'exhaustFan':
            case 'supplyFan': {
                const target = tempSetpoint ?? 25;
                const temp = gs.temperature;
                if (temp !== null) {
                    const excess = temp - (target + tempHyst);
                    if (excess > 0)
                        return { wantsOn: true, urgency: Math.min(1, excess / 5) };
                }
                // VPD-basiert: zu hoch → Lüftung/Kühlung hilft
                if (vpdMax !== null && gs.vpd !== null && gs.vpd > vpdMax + 0.2) {
                    const excess = gs.vpd - vpdMax;
                    return { wantsOn: true, urgency: Math.min(1, excess / 0.5) };
                }
                return { wantsOn: false, urgency: 0 };
            }
            case 'heating': {
                const target = tempSetpoint ?? 20;
                const temp = gs.temperature;
                if (temp === null)
                    return { wantsOn: false, urgency: 0 };
                const deficit = (target - tempHyst) - temp;
                return {
                    wantsOn: deficit > 0,
                    urgency: Math.min(1, Math.max(0, deficit / 5)),
                };
            }
            case 'circulationFan':
            case 'damper': {
                // Zirkulationslüfter: läuft wenn Temp oder VPD erhöht
                const target = tempSetpoint ?? 25;
                const temp = gs.temperature;
                if (temp !== null && temp > target + tempHyst) {
                    return { wantsOn: true, urgency: Math.min(1, (temp - target - tempHyst) / 5) };
                }
                if (vpdMax !== null && gs.vpd !== null && gs.vpd > vpdMax + 0.3) {
                    return { wantsOn: true, urgency: Math.min(1, (gs.vpd - vpdMax) / 0.5) };
                }
                return { wantsOn: false, urgency: 0 };
            }
            case 'co2Valve': {
                // CO2 wird selten geteilt; kein Teilnehmer-Bedarf
                return { wantsOn: false, urgency: 0 };
            }
            default:
                return { wantsOn: false, urgency: 0 };
        }
    }
    // ============================================================
    // ioBroker-State-Schreibfunktionen
    // ============================================================
    async setActuatorState(stateId, value) {
        try {
            await this.setForeignStateAsync(stateId, { val: value, ack: false });
        }
        catch (err) {
            this.log.error(`Fehler beim Schreiben von ${stateId}: ${err}`);
        }
    }
    buildDashboardState() {
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
            const actuators = g.actuators
                .filter(a => a.enabled)
                .map(a => {
                const as = this.actuatorService.getState(a.id);
                const blockSecondsLeft = as?.blockedUntil
                    ? Math.max(0, Math.round((as.blockedUntil - now2) / 1000))
                    : undefined;
                return {
                    id: a.id,
                    name: a.name,
                    type: a.type,
                    command: as?.requested ?? null,
                    effectiveState: as?.effectiveState ?? null,
                    feedback: as?.feedback ?? null,
                    health: as?.health ?? 'unknown',
                    sharedVotingMode: a.sharedVotingMode,
                    sharedParticipants: a.sharedParticipants,
                    manualLock: as?.manualLock ?? false,
                    blocked: as?.blocked ?? false,
                    blockReason: as?.blockedReason,
                    blockSecondsLeft: blockSecondsLeft && blockSecondsLeft > 0 ? blockSecondsLeft : undefined,
                };
            });
            // Externe geteilte Aktoren: Aktoren aus anderen Gruppen die diese Gruppe als Teilnehmer listen
            for (const otherGroup of this.growConfig.groups) {
                if (otherGroup.id === g.id)
                    continue;
                for (const a of otherGroup.actuators) {
                    if (!a.enabled || !a.shared || !a.sharedParticipants?.length)
                        continue;
                    const participant = a.sharedParticipants.find(p => p.groupId === g.id);
                    if (!participant)
                        continue;
                    // Nur hinzufügen wenn dieser Aktor nicht schon in der eigenen Gruppe konfiguriert ist
                    const alreadyOwn = g.actuators.some(oa => oa.commandStateId === a.commandStateId);
                    if (alreadyOwn)
                        continue;
                    const as = this.actuatorService.getState(a.id);
                    actuators.push({
                        id: a.id,
                        name: a.name,
                        type: a.type,
                        command: as?.requested ?? null,
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
            let setpointTemp = null;
            let setpointHumidity = null;
            let setpointVpdMin = null;
            let setpointVpdMax = null;
            let setpointSoilMoistureTarget = null;
            let setpointSoilMoistureTolerance = null;
            let setpointCo2Target = null;
            let setpointCo2Tolerance = null;
            if (state?.activeProfile) {
                const sp = this.scheduleService.getActiveSetpoint(state.activeProfile, state.dayNight ?? 'day', this.lightChangeTimes.get(g.id) ?? 0);
                setpointTemp = sp.temperature;
                setpointHumidity = sp.humidity;
                setpointVpdMin = sp.vpdMin;
                setpointVpdMax = sp.vpdMax;
                setpointSoilMoistureTarget = sp.soilMoistureTarget ?? null;
                setpointSoilMoistureTolerance = sp.soilMoistureTolerance ?? null;
                setpointCo2Target = sp.co2Target ?? null;
                setpointCo2Tolerance = sp.co2Tolerance ?? null;
            }
            // Zusätzliche Sensorwerte: Einzelwerte für Typen wo mehrere sinnvoll sind
            const soilAggDb = this.sensorService.aggregate(g.sensors, 'soilMoisture', g.aggregationMethod);
            const co2Agg = this.sensorService.aggregate(g.sensors, 'co2', g.aggregationMethod);
            const leafTempAggDb = this.sensorService.aggregate(g.sensors, 'leafTemperature', g.aggregationMethod);
            const soilSensors = g.sensors
                .filter(s => s.enabled && s.type === 'soilMoisture')
                .map(s => ({ id: s.id, name: s.name, value: this.sensorService.getState(s.id)?.processedValue ?? null }));
            const leafSensors = g.sensors
                .filter(s => s.enabled && s.type === 'leafTemperature')
                .map(s => ({ id: s.id, name: s.name, value: this.sensorService.getState(s.id)?.processedValue ?? null }));
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
                .filter(s => s.enabled && (s.role === 'monitor' || (!['primary', 'backup'].includes(s.role ?? 'primary'))))
                .map(s => s.name);
            // Kamera-URL (erste snapshotUrl-Kamera der Gruppe)
            const cam = g.cameras?.find(c => c.enabled && c.sourceType === 'snapshotUrl');
            const cameraUrl = cam?.sourceId ?? null;
            // Manuelle Übersteuerungen für diese Gruppe
            const now = Date.now();
            const manualOverrides = {};
            for (const a of g.actuators) {
                const ov = this.dashboardOverrides.get(a.id);
                if (ov && ov.until > now)
                    manualOverrides[a.id] = ov;
                else if (ov)
                    this.dashboardOverrides.delete(a.id);
            }
            // Manuelle Übersteuerungen auch für externe geteilte Aktoren anzeigen (Teilnehmer-Sicht)
            for (const a of actuators) {
                if (!a.sharedFromGroupId || manualOverrides[a.id])
                    continue;
                const ov = this.dashboardOverrides.get(a.id);
                if (ov && ov.until > now)
                    manualOverrides[a.id] = ov;
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
                co2: co2Agg.value,
                leafTemperature: leafTempAggDb.value,
                leafSensors,
                sensorDetails,
                isDay: state?.dayNight !== 'night',
                sensorQuality: state?.sensorQuality ?? 0,
                actuators,
                alarms: groupAlarms,
                lastDecision: state?.lastDecision ? JSON.stringify(state.lastDecision) : '',
                irrigationRunning: this.irrigationService.isAnyZoneRunning(g),
                setpointTemp,
                setpointHumidity,
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
    async updateGroupStates(config, state) {
        const base = `groups.${config.id}`;
        const updates = [
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
            [`${base}.diagnostics.sensorHealth`, state.sensorQuality],
            [`${base}.diagnostics.lastDecision`, state.lastDecision ? JSON.stringify(state.lastDecision) : ''],
        ];
        if (state.activeProfile) {
            const sp = this.scheduleService.getActiveSetpoint(state.activeProfile, state.dayNight, this.lightChangeTimes.get(config.id) ?? Date.now());
            updates.push([`${base}.climate.targetTemperature`, sp.temperature], [`${base}.climate.targetHumidity`, sp.humidity], [`${base}.climate.targetVpd`, (sp.vpdMin + sp.vpdMax) / 2]);
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
        // Soil-States schreiben (immer, auch wenn keine Zones konfiguriert)
        let soilMoisture = null;
        let irrigationRequired = false;
        for (const zone of config.irrigationZones) {
            const zs = this.irrigationService.getState(zone.id);
            if (zs) {
                if (zs.currentMoisture !== null) {
                    soilMoisture = soilMoisture === null
                        ? zs.currentMoisture
                        : (soilMoisture + zs.currentMoisture) / 2;
                }
                if (zs.running || (zs.currentMoisture !== null && zs.currentMoisture < zone.startMoisture)) {
                    irrigationRequired = true;
                }
            }
        }
        await this.setStateAsync(`${base}.soil.moisture`, { val: soilMoisture, ack: true });
        await this.setStateAsync(`${base}.soil.irrigationRequired`, { val: irrigationRequired, ack: true });
        // Aktorzustände
        for (const actuatorConfig of config.actuators) {
            const actState = this.actuatorService.getState(actuatorConfig.id);
            if (!actState)
                continue;
            const aBase = `${base}.actuators.${actuatorConfig.id}`;
            await this.setStateAsync(`${aBase}.command`, { val: actState.requested, ack: true });
            await this.setStateAsync(`${aBase}.requested`, { val: actState.requested, ack: true });
            await this.setStateAsync(`${aBase}.feedback`, { val: actState.feedback, ack: true });
            await this.setStateAsync(`${aBase}.power`, { val: actState.power, ack: true });
            await this.setStateAsync(`${aBase}.effectiveState`, { val: actState.effectiveState, ack: true });
            await this.setStateAsync(`${aBase}.health`, { val: actState.health, ack: true });
        }
    }
    // ============================================================
    // Objekte anlegen
    // ============================================================
    async createGroupObjects(group) {
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
        const climateStates = [
            ['temperature', '°C', 'value.temperature', null],
            ['humidity', '%', 'value.humidity', null],
            ['vpd', 'kPa', 'value', null],
            ['dewPoint', '°C', 'value.temperature', null],
            ['absoluteHumidity', 'g/m³', 'value', null],
            ['targetTemperature', '°C', 'value.temperature', null],
            ['targetHumidity', '%', 'value.humidity', null],
            ['targetVpd', 'kPa', 'value', null],
            ['sensorQuality', '%', 'value', 0],
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
            await this.createStateDef(`${aBase}.command`, 'mixed', 'switch', actuator.offValue);
            await this.createStateDef(`${aBase}.requested`, 'mixed', 'indicator', actuator.offValue);
            await this.createStateDef(`${aBase}.feedback`, 'mixed', 'indicator', null);
            await this.createStateDef(`${aBase}.power`, 'number', 'value.power', null, 'W');
            await this.createStateDef(`${aBase}.effectiveState`, 'mixed', 'indicator', actuator.offValue);
            await this.createStateDef(`${aBase}.override`, 'boolean', 'switch', false, undefined, true);
            await this.createStateDef(`${aBase}.health`, 'string', 'text', 'unknown');
        }
    }
    async createStateDef(id, type, role, def, unit, write = false) {
        const common = {
            name: id.split('.').pop() ?? id,
            type: type,
            role,
            read: true,
            write,
            def: def ?? null,
        };
        if (unit)
            common.unit = unit;
        await this.setObjectNotExistsAsync(id, {
            type: 'state',
            common,
            native: {},
        });
    }
    async handleEmergencyStop() {
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
    async updateAlarmObjects() {
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
    setupAlarmChannels() {
        const channels = this.growConfig.alarmChannels ?? [];
        if (channels.length === 0)
            return;
        this.alarmService.addListener((event) => {
            // Nur neue oder wiederholte Alarme weiterleiten
            const alarm = event.alarm;
            const alarmText = `[${alarm.severity.toUpperCase()}] ${alarm.code}: ${alarm.message}`;
            const now = new Date();
            const nowHH = now.getHours();
            const nowMM = now.getMinutes();
            for (const channel of channels) {
                if (!channel.enabled)
                    continue;
                // Schweregrad-Filter
                const severityOrder = ['info', 'warning', 'fault', 'critical'];
                const alarmIdx = severityOrder.indexOf(alarm.severity);
                const minIdx = severityOrder.indexOf(channel.minSeverity);
                if (alarmIdx < minIdx)
                    continue;
                // Ruhezeiten prüfen
                if (channel.quietHours) {
                    const qh = channel.quietHours;
                    const nowTotal = nowHH * 60 + nowMM;
                    const startTotal = qh.startHH * 60 + qh.startMM;
                    const endTotal = qh.endHH * 60 + qh.endMM;
                    const inQuiet = startTotal <= endTotal
                        ? nowTotal >= startTotal && nowTotal < endTotal
                        : nowTotal >= startTotal || nowTotal < endTotal;
                    if (inQuiet)
                        continue;
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
    async onMessage(obj) {
        if (!obj)
            return;
        this.log.debug(`Message: ${obj.command}`);
        switch (obj.command) {
            case 'getGroups':
                if (obj.callback) {
                    this.sendTo(obj.from, obj.command, this.growConfig.groups, obj.callback);
                }
                break;
            case 'getGroupState':
                if (obj.callback && obj.message && typeof obj.message === 'object' && 'groupId' in obj.message) {
                    const gs = this.groupStates.get(obj.message.groupId);
                    this.sendTo(obj.from, obj.command, (gs ?? null), obj.callback);
                }
                break;
            case 'setOverride':
                if (obj.message && typeof obj.message === 'object') {
                    const msg = obj.message;
                    const group = this.growConfig.groups.find(g => g.id === msg.groupId);
                    const actuator = group?.actuators.find(a => a.id === msg.actuatorId);
                    if (actuator) {
                        this.actuatorService.setOverride(actuator, msg.value, msg.durationMinutes);
                    }
                    if (obj.callback)
                        this.sendTo(obj.from, obj.command, { ok: true }, obj.callback);
                }
                break;
            case 'acknowledgeAlarm':
                if (obj.message && typeof obj.message === 'object' && 'alarmId' in obj.message) {
                    this.alarmService.acknowledge(obj.message.alarmId);
                    if (obj.callback)
                        this.sendTo(obj.from, obj.command, { ok: true }, obj.callback);
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
                    this.sendTo(obj.from, obj.command, { json }, obj.callback);
                }
                break;
            case 'importConfig':
                if (obj.message && typeof obj.message === 'object' && 'json' in obj.message) {
                    const importResult = this.configurationService.importConfig(obj.message.json);
                    if (importResult.config) {
                        this.growConfig = importResult.config;
                        this.log.info('Konfiguration importiert');
                    }
                    if (obj.callback) {
                        this.sendTo(obj.from, obj.command, importResult.result, obj.callback);
                    }
                }
                break;
            case 'getCapabilities':
                if (obj.callback && obj.message && typeof obj.message === 'object' && 'groupId' in obj.message) {
                    const gId = obj.message.groupId;
                    const grp = this.growConfig.groups.find(g => g.id === gId);
                    const gs2 = this.groupStates.get(gId);
                    if (grp && gs2) {
                        const soilAgg2 = this.sensorService.aggregate(grp.sensors, 'soilMoisture', grp.aggregationMethod);
                        const leafAgg2 = this.sensorService.aggregate(grp.sensors, 'leafTemperature', grp.aggregationMethod);
                        const cap = this.capabilityService.evaluate(grp, gs2.sensors, gs2.temperature, gs2.humidity, leafAgg2.value, soilAgg2.value);
                        this.sendTo(obj.from, obj.command, cap, obj.callback);
                    }
                    else {
                        this.sendTo(obj.from, obj.command, { error: 'Gruppe nicht gefunden' }, obj.callback);
                    }
                }
                break;
            case 'triggerIrrigation':
                if (obj.message && typeof obj.message === 'object') {
                    const tMsg = obj.message;
                    const tGrp = this.growConfig.groups.find(g => g.id === tMsg.groupId);
                    const tZone = tGrp?.irrigationZones.find(z => z.id === tMsg.zoneId);
                    if (tZone) {
                        const ok = this.irrigationService.triggerManual(tZone, tMsg.durationSeconds);
                        if (obj.callback)
                            this.sendTo(obj.from, obj.command, { ok }, obj.callback);
                    }
                    else {
                        if (obj.callback)
                            this.sendTo(obj.from, obj.command, { error: 'Zone nicht gefunden' }, obj.callback);
                    }
                }
                break;
            case 'stopIrrigation':
                if (obj.message && typeof obj.message === 'object') {
                    const sMsg = obj.message;
                    this.irrigationService.stopNow(sMsg.zoneId, 'Manuell gestoppt');
                    if (obj.callback)
                        this.sendTo(obj.from, obj.command, { ok: true }, obj.callback);
                }
                break;
            case 'clearAlarmFault':
                if (obj.message && typeof obj.message === 'object' && 'zoneId' in obj.message) {
                    this.irrigationService.clearFault(obj.message.zoneId);
                    if (obj.callback)
                        this.sendTo(obj.from, obj.command, { ok: true }, obj.callback);
                }
                break;
            case 'detectAdapters': {
                // Prüft welche Benachrichtigungs-Adapter installiert sind
                const checks = [
                    { type: 'telegram', ids: ['telegram.0', 'telegram.1'] },
                    { type: 'whatsapp', ids: ['whatsapp-cmb.0', 'whatsapp-cmb.1'] },
                    { type: 'signal', ids: ['signal-cmb.0'] },
                ];
                const detected = [];
                for (const check of checks) {
                    for (const id of check.ids) {
                        try {
                            const adapterObj = await this.getForeignObjectAsync(`system.adapter.${id}`);
                            if (adapterObj) {
                                detected.push({ type: check.type, instance: id.split('.').pop() ?? '0' });
                                break; // Erste gefundene Instanz reicht
                            }
                        }
                        catch { /* nicht installiert */ }
                    }
                }
                // Discord ist immer verfügbar (nur Webhook-URL nötig)
                detected.push({ type: 'discord', instance: '' });
                if (obj.callback) {
                    this.sendTo(obj.from, obj.command, { detected }, obj.callback);
                }
                break;
            }
            case 'testNotification': {
                if (obj.message && typeof obj.message === 'object' && 'channel' in obj.message) {
                    const channel = obj.message.channel;
                    const result = await this.notificationService.sendTest(channel);
                    if (obj.callback) {
                        this.sendTo(obj.from, obj.command, result, obj.callback);
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
    module.exports = (options) => new GrowManagerAdapter(options);
}
else {
    (() => new GrowManagerAdapter())();
}
//# sourceMappingURL=main.js.map