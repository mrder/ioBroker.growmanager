// ============================================================
// GrowManager Admin-UI
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import type { GrowManagerConfig, GroupConfig, ClimateProfile } from './types';

// ioBroker Admin-Globals (werden vom Admin-Framework bereitgestellt)
declare const socket: {
    emit: (event: string, namespace: string, id: string, callback: (err: unknown, val: unknown) => void) => void;
};

declare function getObject(id: string, callback: (err: unknown, obj: unknown) => void): void;

// sendTo-Wrapper (vom Admin-Framework bereitgestellt)
declare function sendTo(
    instanceName: string,
    command: string,
    data: unknown,
    callback?: (result: unknown) => void
): void;

// ---- Tabs --------------------------------------------------

type TabId = 'dashboard' | 'groups' | 'profiles' | 'alarms' | 'diagnostics' | 'settings';

const TABS: Array<{ id: TabId; label: string }> = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'groups', label: 'Gruppen' },
    { id: 'profiles', label: 'Profile' },
    { id: 'alarms', label: 'Alarme' },
    { id: 'diagnostics', label: 'Diagnose' },
    { id: 'settings', label: 'Einstellungen' },
];

// ---- Hilfsfunktionen ----------------------------------------

function formatVpd(vpd: number | null): string {
    if (vpd === null) return '–';
    return `${vpd.toFixed(2)} kPa`;
}

function formatTemp(t: number | null): string {
    if (t === null) return '–';
    return `${t.toFixed(1)} °C`;
}

function formatHum(h: number | null): string {
    if (h === null) return '–';
    return `${h.toFixed(0)} %`;
}

function severityColor(sev: string): string {
    switch (sev) {
        case 'critical': return '#d32f2f';
        case 'fault': return '#f57c00';
        case 'warning': return '#fbc02d';
        case 'info': return '#1976d2';
        default: return '#4caf50';
    }
}

// ---- GroupCard ---------------------------------------------

interface GroupLiveState {
    temperature: number | null;
    humidity: number | null;
    vpd: number | null;
    mode: string;
    health: string;
    phase: string;
    sensorQuality: number;
    alarmSeverity: string;
    nextChange: string;
    actuators: Record<string, { requested: unknown; feedback: unknown; power: number | null; health: string }>;
    lastDecision: string;
}

interface GroupCardProps {
    group: GroupConfig;
    live: GroupLiveState | null;
    onManualOverride: (groupId: string, actuatorId: string) => void;
}

const GroupCard: React.FC<GroupCardProps> = ({ group, live, onManualOverride }) => {
    const [expanded, setExpanded] = useState(false);

    const healthColor = live ? {
        FULL: '#4caf50',
        LIMITED: '#fbc02d',
        FALLBACK: '#f57c00',
        MONITOR_ONLY: '#1976d2',
        SAFE: '#9e9e9e',
        FAULT: '#d32f2f',
    }[live.health] ?? '#9e9e9e' : '#9e9e9e';

    return (
        <div style={styles.card}>
            <div style={styles.cardHeader} onClick={() => setExpanded(!expanded)}>
                <span style={styles.cardTitle}>{group.name}</span>
                <span style={{ ...styles.badge, backgroundColor: healthColor }}>
                    {live?.health ?? '…'}
                </span>
            </div>

            <div style={styles.cardClimate}>
                <span>{formatTemp(live?.temperature ?? null)}</span>
                <span>{formatHum(live?.humidity ?? null)}</span>
                <span>{formatVpd(live?.vpd ?? null)}</span>
            </div>

            <div style={styles.cardMeta}>
                <small>Phase: {live?.phase ?? group.phase}</small>
                <small>Modus: {live?.mode ?? group.mode}</small>
                <small>Qualität: {live?.sensorQuality ?? 0} %</small>
            </div>

            {live?.alarmSeverity && live.alarmSeverity !== 'none' && (
                <div style={{ ...styles.alarmBanner, backgroundColor: severityColor(live.alarmSeverity) }}>
                    ⚠ Alarm: {live.alarmSeverity}
                </div>
            )}

            {expanded && (
                <div style={styles.expandedSection}>
                    {/* Aktoren */}
                    <div style={styles.sectionTitle}>Aktoren</div>
                    {group.actuators.map(act => {
                        const actState = live?.actuators[act.id];
                        return (
                            <div key={act.id} style={styles.actuatorRow}>
                                <span>{act.name}</span>
                                <span style={actState?.requested ? styles.stateOn : styles.stateOff}>
                                    {actState?.requested ? 'EIN' : 'AUS'}
                                </span>
                                {actState?.power !== null && actState?.power !== undefined && (
                                    <span style={styles.powerLabel}>{actState.power} W</span>
                                )}
                                <span style={styles.healthLabel}>{actState?.health ?? '–'}</span>
                                <button
                                    style={styles.overrideBtn}
                                    onClick={() => onManualOverride(group.id, act.id)}
                                >
                                    Override
                                </button>
                            </div>
                        );
                    })}

                    {/* Letzte Entscheidung */}
                    {live?.lastDecision && (
                        <div style={styles.decisionBox}>
                            <div style={styles.sectionTitle}>Letzte Regelentscheidung</div>
                            <DecisionDisplay raw={live.lastDecision} />
                        </div>
                    )}

                    {live?.nextChange && (
                        <div style={styles.nextChange}>Nächster Wechsel: {live.nextChange}</div>
                    )}
                </div>
            )}
        </div>
    );
};

// ---- Entscheidungsanzeige (Klartext) -----------------------

const DecisionDisplay: React.FC<{ raw: string }> = ({ raw }) => {
    try {
        const decision = JSON.parse(raw);
        return (
            <div style={styles.decisionText}>
                <p><strong>{decision.reason}</strong></p>
                <ul>
                    {decision.actions?.map((a: { actuatorId: string; requested: unknown; reason: string; blocked: boolean; blockedReason?: string }) => (
                        <li key={a.actuatorId} style={{ color: a.blocked ? '#999' : '#000' }}>
                            <strong>{a.actuatorId}</strong>: {String(a.requested)}
                            {a.blocked && ` (gesperrt: ${a.blockedReason})`}
                            {' – '}{a.reason}
                        </li>
                    ))}
                </ul>
            </div>
        );
    } catch {
        return <p style={{ fontFamily: 'monospace', fontSize: 12 }}>{raw}</p>;
    }
};

// ---- Default-Factories -------------------------------------------------------

const defaultGroup = (): GroupConfig => ({
    id: `group-${Date.now()}`,
    name: 'Neue Gruppe',
    description: '',
    color: '#4caf50',
    enabled: true,
    phase: 'growth',
    mode: 'monitorOnly',
    schedule: { lightOn: { startHH: 6, startMM: 0, endHH: 18, endMM: 0 }, transitionMinutes: 30 },
    sensors: [],
    actuators: [],
    irrigationZones: [],
    cameras: [],
    profileId: '',
    alarmProfileId: '',
    priority: 1,
    aggregationMethod: 'median',
    minValidSensors: 1,
    fallbackChain: ['temperature', 'schedule', 'monitorOnly'],
    stabilityTimeSeconds: 120,
});

const defaultSensor = (): GroupConfig['sensors'][0] => ({
    id: `sensor-${Date.now()}`,
    name: 'Neuer Sensor',
    stateId: '',
    type: 'temperature',
    role: 'primary',
    unit: '°C',
    offset: 0,
    multiplier: 1,
    weight: 1,
    validMin: -40,
    validMax: 100,
    staleAfterSeconds: 300,
    unchangedAlarmSeconds: 3600,
    minUpdateRateSeconds: 0,
    smoothing: 'none',
    outlierFilter: false,
    errorBehavior: 'ignore',
    useForControl: true,
    enabled: true,
});

const defaultActuator = (): GroupConfig['actuators'][0] => ({
    id: `actuator-${Date.now()}`,
    name: 'Neuer Aktor',
    type: 'exhaustFan',
    commandStateId: '',
    dataType: 'boolean',
    onValue: true,
    offValue: false,
    supportsPercent: false,
    powerOnThreshold: 0,
    speedOnThreshold: 0,
    onDelaySeconds: 0,
    offDelaySeconds: 0,
    minimumOnSeconds: 0,
    minimumOffSeconds: 30,
    maximumOnSeconds: 0,
    maxSwitchesPerHour: 0,
    coastDownSeconds: 0,
    safeState: 'off',
    feedbackMissingBehavior: 'warn',
    manualOverride: false,
    overrideDurationMinutes: 60,
    invertLogic: false,
    interlockIds: [],
    shared: false,
    enabled: true,
});

const defaultIrrigationZone = (): GroupConfig['irrigationZones'][0] => ({
    id: `zone-${Date.now()}`,
    name: 'Neue Zone',
    enabled: true,
    moistureSensorIds: [],
    startMoisture: 40,
    targetMoisture: 70,
    maxRunSeconds: 300,
    minPauseMinutes: 60,
    pumpActuatorId: '',
    dryRunProtection: true,
    leakageAlarmSeconds: 0,
});

// ---- SensorEditor Modal -------------------------------------------------------

interface SensorEditorProps {
    sensor: GroupConfig['sensors'][0] | null;
    onSave: (s: GroupConfig['sensors'][0]) => void;
    onClose: () => void;
}

const SensorEditor: React.FC<SensorEditorProps> = ({ sensor, onSave, onClose }) => {
    const [edit, setEdit] = useState(sensor ?? defaultSensor());

    const f = (key: keyof typeof edit) => ({
        value: String(edit[key] ?? ''),
        onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
            setEdit(prev => ({ ...prev, [key]: e.target.value })),
    });

    const SENSOR_UNITS: Record<string, string> = {
        temperature: '°C', humidity: '%', pressure: 'hPa', co2: 'ppm',
        vpd: 'kPa', soilMoisture: '%', flow: 'L/min', light: 'lux', leafTemperature: '°C',
    };

    return (
        <div style={styles.modalOverlay}>
            <div style={{ ...styles.modal, maxWidth: 520 }}>
                <h4 style={{ margin: '0 0 16px' }}>{sensor ? 'Sensor bearbeiten' : 'Neuer Sensor'}</h4>

                <label style={styles.fieldLabel}>Name</label>
                <input style={styles.input} {...f('name')} />

                <label style={styles.fieldLabel}>Typ</label>
                <select style={styles.select} value={edit.type}
                    onChange={e => setEdit(prev => ({
                        ...prev,
                        type: e.target.value as typeof prev.type,
                        unit: SENSOR_UNITS[e.target.value] ?? '',
                    }))}>
                    <option value="temperature">Temperatur</option>
                    <option value="leafTemperature">Blatttemperatur</option>
                    <option value="humidity">Luftfeuchte</option>
                    <option value="pressure">Luftdruck</option>
                    <option value="co2">CO₂</option>
                    <option value="vpd">VPD</option>
                    <option value="soilMoisture">Bodenfeuchte</option>
                    <option value="flow">Durchfluss</option>
                    <option value="light">Licht</option>
                    <option value="custom">Benutzerdefiniert</option>
                </select>

                <label style={styles.fieldLabel}>Rolle</label>
                <select style={styles.select} {...f('role')}>
                    <option value="primary">Primär (Regelgröße)</option>
                    <option value="backup">Backup (bei Ausfall Primär)</option>
                    <option value="plausibility">Plausibilitätsprüfung</option>
                    <option value="safetyLimit">Sicherheitslimit</option>
                    <option value="displayOnly">Nur Anzeige</option>
                    <option value="effectCheck">Wirkungsprüfung</option>
                </select>

                <StateIdInput
                    label="ioBroker State-ID"
                    value={edit.stateId}
                    onChange={v => setEdit(prev => ({ ...prev, stateId: v }))}
                    placeholder="z.B. zigbee.0.sensor1.temperature"
                />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    <div>
                        <label style={styles.fieldLabel}>Einheit</label>
                        <input style={styles.input} {...f('unit')} />
                    </div>
                    <div>
                        <label style={styles.fieldLabel}>Min</label>
                        <input style={styles.input} type="number" value={edit.validMin}
                            onChange={e => setEdit(prev => ({ ...prev, validMin: +e.target.value }))} />
                    </div>
                    <div>
                        <label style={styles.fieldLabel}>Max</label>
                        <input style={styles.input} type="number" value={edit.validMax}
                            onChange={e => setEdit(prev => ({ ...prev, validMax: +e.target.value }))} />
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>
                        <label style={styles.fieldLabel}>Offset</label>
                        <input style={styles.input} type="number" step="0.1" value={edit.offset}
                            onChange={e => setEdit(prev => ({ ...prev, offset: +e.target.value }))} />
                    </div>
                    <div>
                        <label style={styles.fieldLabel}>Multiplier</label>
                        <input style={styles.input} type="number" step="0.01" value={edit.multiplier}
                            onChange={e => setEdit(prev => ({ ...prev, multiplier: +e.target.value }))} />
                    </div>
                </div>

                <label style={styles.fieldLabel}>Glättung</label>
                <select style={styles.select} {...f('smoothing')}>
                    <option value="none">Keine</option>
                    <option value="movingAverage">Gleitender Mittelwert</option>
                    <option value="median">Median</option>
                    <option value="exponential">Exponentiell</option>
                </select>

                <label style={styles.fieldLabel}>Fehlerverhalten</label>
                <select style={styles.select} {...f('errorBehavior')}>
                    <option value="ignore">Ignorieren</option>
                    <option value="switchToBackup">Backup verwenden</option>
                    <option value="lockControl">Regelung sperren</option>
                    <option value="activateSafeMode">Sicherheitsmodus</option>
                </select>

                <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                        <input type="checkbox" checked={edit.useForControl}
                            onChange={e => setEdit(prev => ({ ...prev, useForControl: e.target.checked }))} />
                        Für Regelung nutzen
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                        <input type="checkbox" checked={edit.enabled}
                            onChange={e => setEdit(prev => ({ ...prev, enabled: e.target.checked }))} />
                        Aktiv
                    </label>
                </div>

                <div style={styles.editorButtons}>
                    <button style={styles.btnPrimary} onClick={() => onSave({ ...edit, id: edit.id || `sensor-${Date.now()}` })}>Speichern</button>
                    <button style={styles.btnSecondary} onClick={onClose}>Abbrechen</button>
                </div>
            </div>
        </div>
    );
};

// ---- ActuatorEditor Modal -------------------------------------------------------

interface ActuatorEditorProps {
    actuator: GroupConfig['actuators'][0] | null;
    onSave: (a: GroupConfig['actuators'][0]) => void;
    onClose: () => void;
}

const ActuatorEditor: React.FC<ActuatorEditorProps> = ({ actuator, onSave, onClose }) => {
    const [edit, setEdit] = useState(actuator ?? defaultActuator());

    const f = (key: keyof typeof edit) => ({
        value: String(edit[key] ?? ''),
        onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
            setEdit(prev => ({ ...prev, [key]: e.target.value })),
    });

    return (
        <div style={styles.modalOverlay}>
            <div style={{ ...styles.modal, maxWidth: 560 }}>
                <h4 style={{ margin: '0 0 16px' }}>{actuator ? 'Aktor bearbeiten' : 'Neuer Aktor'}</h4>

                <label style={styles.fieldLabel}>Name</label>
                <input style={styles.input} {...f('name')} />

                <label style={styles.fieldLabel}>Typ</label>
                <select style={styles.select} {...f('type')}>
                    <option value="light">Licht</option>
                    <option value="exhaustFan">Abluft</option>
                    <option value="supplyFan">Zuluft</option>
                    <option value="circulationFan">Umluft</option>
                    <option value="heating">Heizung</option>
                    <option value="cooling">Kühlung</option>
                    <option value="humidifier">Befeuchter</option>
                    <option value="dehumidifier">Entfeuchter</option>
                    <option value="irrigation">Bewässerung</option>
                    <option value="co2Valve">CO₂-Ventil</option>
                    <option value="damper">Klappe</option>
                    <option value="custom">Benutzerdefiniert</option>
                </select>

                <StateIdInput
                    label="Befehls-State-ID (schreiben)"
                    value={edit.commandStateId}
                    onChange={v => setEdit(prev => ({ ...prev, commandStateId: v }))}
                    placeholder="z.B. tasmota.0.switch.POWER"
                />

                <StateIdInput
                    label="Feedback-State-ID (lesen, optional)"
                    value={edit.feedbackStateId ?? ''}
                    onChange={v => setEdit(prev => ({ ...prev, feedbackStateId: v || undefined }))}
                    placeholder="z.B. tasmota.0.switch.STATE"
                />

                <label style={styles.fieldLabel}>Datentyp</label>
                <select style={styles.select} {...f('dataType')}>
                    <option value="boolean">Boolean (true/false)</option>
                    <option value="number">Zahl (0-100%)</option>
                    <option value="string">Text</option>
                </select>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>
                        <label style={styles.fieldLabel}>Sicherer Zustand</label>
                        <select style={styles.select} value={edit.safeState}
                            onChange={e => setEdit(prev => ({ ...prev, safeState: e.target.value as typeof prev.safeState }))}>
                            <option value="off">AUS</option>
                            <option value="on">EIN</option>
                            <option value="keep">Beibehalten</option>
                            <option value="minLevel">Mindestniveau</option>
                        </select>
                    </div>
                    <div>
                        <label style={styles.fieldLabel}>Fehlendendes Feedback</label>
                        <select style={styles.select} value={edit.feedbackMissingBehavior}
                            onChange={e => setEdit(prev => ({ ...prev, feedbackMissingBehavior: e.target.value as typeof prev.feedbackMissingBehavior }))}>
                            <option value="warn">Warnung</option>
                            <option value="alarm">Alarm</option>
                            <option value="block">Sperren</option>
                        </select>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 4 }}>
                    <div>
                        <label style={styles.fieldLabel}>Min. Einschaltzeit (s)</label>
                        <input style={styles.input} type="number" min={0} value={edit.minimumOnSeconds}
                            onChange={e => setEdit(prev => ({ ...prev, minimumOnSeconds: +e.target.value }))} />
                    </div>
                    <div>
                        <label style={styles.fieldLabel}>Min. Ausschaltzeit (s)</label>
                        <input style={styles.input} type="number" min={0} value={edit.minimumOffSeconds}
                            onChange={e => setEdit(prev => ({ ...prev, minimumOffSeconds: +e.target.value }))} />
                    </div>
                    <div>
                        <label style={styles.fieldLabel}>Max. Laufzeit (s)</label>
                        <input style={styles.input} type="number" min={0} value={edit.maximumOnSeconds}
                            onChange={e => setEdit(prev => ({ ...prev, maximumOnSeconds: +e.target.value }))} />
                    </div>
                </div>

                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                        <input type="checkbox" checked={edit.supportsPercent}
                            onChange={e => setEdit(prev => ({ ...prev, supportsPercent: e.target.checked }))} />
                        Prozentwert (0–100)
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                        <input type="checkbox" checked={edit.shared}
                            onChange={e => setEdit(prev => ({ ...prev, shared: e.target.checked }))} />
                        Geteilt (mehrere Gruppen)
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                        <input type="checkbox" checked={edit.invertLogic}
                            onChange={e => setEdit(prev => ({ ...prev, invertLogic: e.target.checked }))} />
                        Logik invertieren
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                        <input type="checkbox" checked={edit.enabled}
                            onChange={e => setEdit(prev => ({ ...prev, enabled: e.target.checked }))} />
                        Aktiv
                    </label>
                </div>

                <div style={styles.editorButtons}>
                    <button style={styles.btnPrimary} onClick={() => onSave({ ...edit, id: edit.id || `actuator-${Date.now()}` })}>Speichern</button>
                    <button style={styles.btnSecondary} onClick={onClose}>Abbrechen</button>
                </div>
            </div>
        </div>
    );
};

// ---- IrrigationZoneEditor Modal -------------------------------------------------------

interface IrrigationZoneEditorProps {
    zone: GroupConfig['irrigationZones'][0] | null;
    actuators: GroupConfig['actuators'];
    sensors: GroupConfig['sensors'];
    onSave: (z: GroupConfig['irrigationZones'][0]) => void;
    onClose: () => void;
}

const IrrigationZoneEditor: React.FC<IrrigationZoneEditorProps> = ({ zone, actuators, sensors, onSave, onClose }) => {
    const [edit, setEdit] = useState(zone ?? defaultIrrigationZone());

    const moistureSensors = sensors.filter(s => s.type === 'soilMoisture');
    const pumpActuators = actuators.filter(a => a.type === 'irrigation' || a.type === 'custom');

    return (
        <div style={styles.modalOverlay}>
            <div style={{ ...styles.modal, maxWidth: 480 }}>
                <h4 style={{ margin: '0 0 16px' }}>{zone ? 'Zone bearbeiten' : 'Neue Bewässerungszone'}</h4>

                <label style={styles.fieldLabel}>Name</label>
                <input style={styles.input} value={edit.name}
                    onChange={e => setEdit(prev => ({ ...prev, name: e.target.value }))} />

                <label style={styles.fieldLabel}>Pumpen-Aktor</label>
                <select style={styles.select} value={edit.pumpActuatorId}
                    onChange={e => setEdit(prev => ({ ...prev, pumpActuatorId: e.target.value }))}>
                    <option value="">– wählen –</option>
                    {actuators.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                {pumpActuators.length === 0 && (
                    <p style={{ fontSize: 12, color: '#f57c00', margin: '4px 0' }}>
                        Tipp: Zuerst einen Aktor vom Typ „Bewässerung" anlegen.
                    </p>
                )}

                <label style={styles.fieldLabel}>Bodenfeuchte-Sensoren (optional)</label>
                {moistureSensors.length === 0 ? (
                    <p style={{ fontSize: 12, color: '#888', margin: '4px 0' }}>
                        Kein Bodenfeuchte-Sensor konfiguriert → nur Timer-Betrieb via triggerManual().
                    </p>
                ) : (
                    moistureSensors.map(s => (
                        <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0', cursor: 'pointer' }}>
                            <input type="checkbox"
                                checked={edit.moistureSensorIds.includes(s.id)}
                                onChange={e => setEdit(prev => ({
                                    ...prev,
                                    moistureSensorIds: e.target.checked
                                        ? [...prev.moistureSensorIds, s.id]
                                        : prev.moistureSensorIds.filter(id => id !== s.id),
                                }))} />
                            {s.name}
                        </label>
                    ))
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>
                        <label style={styles.fieldLabel}>Start bei Feuchte (%)</label>
                        <input style={styles.input} type="number" min={0} max={100} value={edit.startMoisture}
                            onChange={e => setEdit(prev => ({ ...prev, startMoisture: +e.target.value }))} />
                    </div>
                    <div>
                        <label style={styles.fieldLabel}>Ziel-Feuchte (%)</label>
                        <input style={styles.input} type="number" min={0} max={100} value={edit.targetMoisture}
                            onChange={e => setEdit(prev => ({ ...prev, targetMoisture: +e.target.value }))} />
                    </div>
                    <div>
                        <label style={styles.fieldLabel}>Max. Laufzeit (s)</label>
                        <input style={styles.input} type="number" min={1} value={edit.maxRunSeconds}
                            onChange={e => setEdit(prev => ({ ...prev, maxRunSeconds: +e.target.value }))} />
                    </div>
                    <div>
                        <label style={styles.fieldLabel}>Mindestpause (min)</label>
                        <input style={styles.input} type="number" min={0} value={edit.minPauseMinutes}
                            onChange={e => setEdit(prev => ({ ...prev, minPauseMinutes: +e.target.value }))} />
                    </div>
                </div>

                <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                        <input type="checkbox" checked={edit.dryRunProtection}
                            onChange={e => setEdit(prev => ({ ...prev, dryRunProtection: e.target.checked }))} />
                        Trockenläuferschutz
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                        <input type="checkbox" checked={edit.enabled}
                            onChange={e => setEdit(prev => ({ ...prev, enabled: e.target.checked }))} />
                        Aktiv
                    </label>
                </div>

                <div style={styles.editorButtons}>
                    <button style={styles.btnPrimary} onClick={() => onSave(edit)}>Speichern</button>
                    <button style={styles.btnSecondary} onClick={onClose}>Abbrechen</button>
                </div>
            </div>
        </div>
    );
};

// ---- GroupEditor -------------------------------------------

type GroupEditorTab = 'basis' | 'sensoren' | 'aktoren' | 'bewaesserung';

interface GroupEditorProps {
    group: GroupConfig | null;
    profiles: ClimateProfile[];
    onSave: (g: GroupConfig) => void;
    onCancel: () => void;
}

const GroupEditor: React.FC<GroupEditorProps> = ({ group, profiles, onSave, onCancel }) => {
    const [edit, setEdit] = useState<GroupConfig>(group ?? defaultGroup());
    const [tab, setTab] = useState<GroupEditorTab>('basis');
    const [editingSensor, setEditingSensor] = useState<GroupConfig['sensors'][0] | null | 'new'>(null);
    const [editingActuator, setEditingActuator] = useState<GroupConfig['actuators'][0] | null | 'new'>(null);
    const [editingZone, setEditingZone] = useState<GroupConfig['irrigationZones'][0] | null | 'new'>(null);

    const field = (key: keyof GroupConfig) => ({
        value: String(edit[key] ?? ''),
        onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
            setEdit(prev => ({ ...prev, [key]: e.target.value })),
    });

    const tabStyle = (t: GroupEditorTab): React.CSSProperties => ({
        padding: '8px 14px', border: 'none', background: 'transparent', cursor: 'pointer',
        fontSize: 13, borderBottom: tab === t ? '2px solid #2e7d32' : '2px solid transparent',
        color: tab === t ? '#2e7d32' : '#555', fontWeight: tab === t ? 600 : 400,
    });

    return (
        <div style={{ ...styles.editor, maxWidth: 700 }}>
            <h3 style={{ margin: '0 0 16px' }}>{group ? `Gruppe: ${edit.name}` : 'Neue Gruppe'}</h3>

            {/* Tab-Leiste */}
            <div style={{ display: 'flex', borderBottom: '1px solid #e0e0e0', marginBottom: 16 }}>
                <button style={tabStyle('basis')} onClick={() => setTab('basis')}>
                    Grundeinstellungen
                </button>
                <button style={tabStyle('sensoren')} onClick={() => setTab('sensoren')}>
                    Sensoren ({edit.sensors.length})
                </button>
                <button style={tabStyle('aktoren')} onClick={() => setTab('aktoren')}>
                    Aktoren ({edit.actuators.length})
                </button>
                <button style={tabStyle('bewaesserung')} onClick={() => setTab('bewaesserung')}>
                    Bewässerung ({edit.irrigationZones.length})
                </button>
            </div>

            {/* ---- TAB: Grundeinstellungen ---- */}
            {tab === 'basis' && (
                <div>
                    <label style={styles.fieldLabel}>Name</label>
                    <input style={styles.input} {...field('name')} />

                    <label style={styles.fieldLabel}>Beschreibung</label>
                    <input style={styles.input} {...field('description')} />

                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 }}>
                        <label style={{ ...styles.fieldLabel, margin: 0 }}>Farbe</label>
                        <input type="color" value={edit.color}
                            onChange={e => setEdit(prev => ({ ...prev, color: e.target.value }))}
                            style={{ width: 48, height: 32, border: 'none', cursor: 'pointer', borderRadius: 4 }} />
                        <span style={{ fontSize: 13, color: '#666' }}>{edit.color}</span>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', cursor: 'pointer' }}>
                            <input type="checkbox" checked={edit.enabled}
                                onChange={e => setEdit(prev => ({ ...prev, enabled: e.target.checked }))} />
                            Gruppe aktiv
                        </label>
                    </div>

                    <label style={styles.fieldLabel}>Pflanzenphase</label>
                    <select style={styles.select} {...field('phase')}>
                        <option value="seedling">Keimling</option>
                        <option value="growth">Wachstum</option>
                        <option value="bloom">Blüte</option>
                        <option value="drying">Trocknung</option>
                        <option value="custom">Benutzerdefiniert</option>
                    </select>

                    <label style={styles.fieldLabel}>Betriebsart</label>
                    <select style={styles.select} {...field('mode')}>
                        <option value="off">Aus</option>
                        <option value="monitorOnly">Nur Überwachung</option>
                        <option value="schedule">Zeitplan</option>
                        <option value="temperature">Temperaturregelung</option>
                        <option value="humidity">Feuchteregelung</option>
                        <option value="vpd">VPD-Regelung</option>
                        <option value="combined">Kombiniert</option>
                        <option value="maintenance">Wartung</option>
                    </select>

                    <label style={styles.fieldLabel}>Klimaprofil</label>
                    <select style={styles.select} {...field('profileId')}>
                        <option value="">– Kein Profil –</option>
                        {profiles.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                    </select>

                    <label style={styles.fieldLabel}>Licht AN / AUS</label>
                    <div style={styles.timeRow}>
                        <input style={{ ...styles.input, width: 58 }} type="number" min={0} max={23}
                            value={edit.schedule.lightOn.startHH}
                            onChange={e => setEdit(prev => ({ ...prev, schedule: { ...prev.schedule, lightOn: { ...prev.schedule.lightOn, startHH: +e.target.value } } }))} />
                        <span>:</span>
                        <input style={{ ...styles.input, width: 58 }} type="number" min={0} max={59}
                            value={edit.schedule.lightOn.startMM}
                            onChange={e => setEdit(prev => ({ ...prev, schedule: { ...prev.schedule, lightOn: { ...prev.schedule.lightOn, startMM: +e.target.value } } }))} />
                        <span style={{ color: '#888' }}>bis</span>
                        <input style={{ ...styles.input, width: 58 }} type="number" min={0} max={23}
                            value={edit.schedule.lightOn.endHH}
                            onChange={e => setEdit(prev => ({ ...prev, schedule: { ...prev.schedule, lightOn: { ...prev.schedule.lightOn, endHH: +e.target.value } } }))} />
                        <span>:</span>
                        <input style={{ ...styles.input, width: 58 }} type="number" min={0} max={59}
                            value={edit.schedule.lightOn.endMM}
                            onChange={e => setEdit(prev => ({ ...prev, schedule: { ...prev.schedule, lightOn: { ...prev.schedule.lightOn, endMM: +e.target.value } } }))} />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div>
                            <label style={styles.fieldLabel}>Aggregationsmethode</label>
                            <select style={styles.select} value={edit.aggregationMethod}
                                onChange={e => setEdit(prev => ({ ...prev, aggregationMethod: e.target.value as GroupConfig['aggregationMethod'] }))}>
                                <option value="median">Median (empfohlen)</option>
                                <option value="mean">Mittelwert</option>
                                <option value="weightedMean">Gewichteter Mittelwert</option>
                                <option value="min">Minimum</option>
                                <option value="max">Maximum</option>
                            </select>
                        </div>
                        <div>
                            <label style={styles.fieldLabel}>Stabilitätszeit Sensor (s)</label>
                            <input style={styles.input} type="number" min={0} value={edit.stabilityTimeSeconds}
                                onChange={e => setEdit(prev => ({ ...prev, stabilityTimeSeconds: +e.target.value }))} />
                        </div>
                    </div>
                </div>
            )}

            {/* ---- TAB: Sensoren ---- */}
            {tab === 'sensoren' && (
                <div>
                    <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#666', fontSize: 13 }}>
                            {edit.sensors.length === 0
                                ? 'Keine Sensoren – Regelung ist nicht möglich, nur Überwachung.'
                                : `${edit.sensors.length} Sensor(en) konfiguriert`}
                        </span>
                        <button style={styles.btnPrimary} onClick={() => setEditingSensor('new')}>+ Sensor</button>
                    </div>

                    {edit.sensors.map(s => (
                        <div key={s.id} style={styles.listRow}>
                            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                                <span style={{ fontWeight: 600 }}>{s.name}</span>
                                <span style={{ fontSize: 12, color: '#666' }}>{s.type} · {s.role} · {s.stateId || <em>keine State-ID</em>}</span>
                            </div>
                            <span style={{ ...styles.badge2, background: s.enabled ? '#e8f5e9' : '#f5f5f5', color: s.enabled ? '#2e7d32' : '#999' }}>
                                {s.enabled ? 'aktiv' : 'inaktiv'}
                            </span>
                            <button style={styles.btnSecondary} onClick={() => setEditingSensor(s)}>Bearbeiten</button>
                            <button style={{ ...styles.btnSecondary, color: '#d32f2f', marginLeft: 6 }}
                                onClick={() => setEdit(prev => ({ ...prev, sensors: prev.sensors.filter(x => x.id !== s.id) }))}>
                                ✕
                            </button>
                        </div>
                    ))}

                    {editingSensor !== null && (
                        <SensorEditor
                            sensor={editingSensor === 'new' ? null : editingSensor}
                            onSave={s => {
                                setEdit(prev => ({
                                    ...prev,
                                    sensors: editingSensor === 'new'
                                        ? [...prev.sensors, s]
                                        : prev.sensors.map(x => x.id === s.id ? s : x),
                                }));
                                setEditingSensor(null);
                            }}
                            onClose={() => setEditingSensor(null)}
                        />
                    )}
                </div>
            )}

            {/* ---- TAB: Aktoren ---- */}
            {tab === 'aktoren' && (
                <div>
                    <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#666', fontSize: 13 }}>
                            {edit.actuators.length === 0
                                ? 'Keine Aktoren – nur Überwachung möglich.'
                                : `${edit.actuators.length} Aktor(en) konfiguriert`}
                        </span>
                        <button style={styles.btnPrimary} onClick={() => setEditingActuator('new')}>+ Aktor</button>
                    </div>

                    {edit.actuators.map(a => (
                        <div key={a.id} style={styles.listRow}>
                            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                                <span style={{ fontWeight: 600 }}>{a.name}</span>
                                <span style={{ fontSize: 12, color: '#666' }}>{a.type} · {a.commandStateId || <em>keine State-ID</em>}
                                    {a.shared && ' · geteilt'}{a.supportsPercent && ' · %'}
                                </span>
                            </div>
                            <span style={{ ...styles.badge2, background: a.enabled ? '#e8f5e9' : '#f5f5f5', color: a.enabled ? '#2e7d32' : '#999' }}>
                                {a.enabled ? 'aktiv' : 'inaktiv'}
                            </span>
                            <button style={styles.btnSecondary} onClick={() => setEditingActuator(a)}>Bearbeiten</button>
                            <button style={{ ...styles.btnSecondary, color: '#d32f2f', marginLeft: 6 }}
                                onClick={() => setEdit(prev => ({ ...prev, actuators: prev.actuators.filter(x => x.id !== a.id) }))}>
                                ✕
                            </button>
                        </div>
                    ))}

                    {editingActuator !== null && (
                        <ActuatorEditor
                            actuator={editingActuator === 'new' ? null : editingActuator}
                            onSave={a => {
                                setEdit(prev => ({
                                    ...prev,
                                    actuators: editingActuator === 'new'
                                        ? [...prev.actuators, a]
                                        : prev.actuators.map(x => x.id === a.id ? a : x),
                                }));
                                setEditingActuator(null);
                            }}
                            onClose={() => setEditingActuator(null)}
                        />
                    )}
                </div>
            )}

            {/* ---- TAB: Bewässerung ---- */}
            {tab === 'bewaesserung' && (
                <div>
                    <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#666', fontSize: 13 }}>
                            {edit.irrigationZones.length === 0
                                ? 'Keine Bewässerungszonen – Bewässerung deaktiviert.'
                                : `${edit.irrigationZones.length} Zone(n)`}
                        </span>
                        <button style={styles.btnPrimary} onClick={() => setEditingZone('new')}>+ Zone</button>
                    </div>

                    {edit.irrigationZones.map(z => (
                        <div key={z.id} style={styles.listRow}>
                            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                                <span style={{ fontWeight: 600 }}>{z.name}</span>
                                <span style={{ fontSize: 12, color: '#666' }}>
                                    Pumpe: {(edit.actuators.find(a => a.id === z.pumpActuatorId)?.name ?? z.pumpActuatorId) || '–'} ·
                                    Feuchte: {z.startMoisture}% → {z.targetMoisture}% ·
                                    Max: {z.maxRunSeconds}s
                                    {z.moistureSensorIds.length === 0 && ' · nur Timer'}
                                </span>
                            </div>
                            <button style={styles.btnSecondary} onClick={() => setEditingZone(z)}>Bearbeiten</button>
                            <button style={{ ...styles.btnSecondary, color: '#d32f2f', marginLeft: 6 }}
                                onClick={() => setEdit(prev => ({ ...prev, irrigationZones: prev.irrigationZones.filter(x => x.id !== z.id) }))}>
                                ✕
                            </button>
                        </div>
                    ))}

                    {editingZone !== null && (
                        <IrrigationZoneEditor
                            zone={editingZone === 'new' ? null : editingZone}
                            actuators={edit.actuators}
                            sensors={edit.sensors}
                            onSave={z => {
                                setEdit(prev => ({
                                    ...prev,
                                    irrigationZones: editingZone === 'new'
                                        ? [...prev.irrigationZones, z]
                                        : prev.irrigationZones.map(x => x.id === z.id ? z : x),
                                }));
                                setEditingZone(null);
                            }}
                            onClose={() => setEditingZone(null)}
                        />
                    )}
                </div>
            )}

            <div style={{ ...styles.editorButtons, marginTop: 20, paddingTop: 16, borderTop: '1px solid #e0e0e0' }}>
                <button style={styles.btnPrimary} onClick={() => onSave(edit)}>💾 Speichern</button>
                <button style={styles.btnSecondary} onClick={onCancel}>Abbrechen</button>
            </div>
        </div>
    );
};

// ---- AlarmView ---------------------------------------------

interface AlarmRecord {
    id: string;
    code: string;
    groupId: string;
    severity: string;
    message: string;
    since: number;
    acknowledged: boolean;
    repeatCount: number;
    active: boolean;
}

const AlarmView: React.FC<{ alarms: AlarmRecord[]; onAck: (id: string) => void }> = ({ alarms, onAck }) => {
    const active = alarms.filter(a => a.active);
    const cleared = alarms.filter(a => !a.active).slice(0, 20);

    return (
        <div>
            <h3>Aktive Alarme ({active.length})</h3>
            {active.length === 0 && <p style={{ color: '#4caf50' }}>Keine aktiven Alarme.</p>}
            {active.map(alarm => (
                <div key={alarm.id} style={{ ...styles.alarmRow, borderLeftColor: severityColor(alarm.severity) }}>
                    <div>
                        <strong>[{alarm.severity.toUpperCase()}]</strong> {alarm.code} – {alarm.groupId}
                    </div>
                    <div style={{ fontSize: 13 }}>{alarm.message}</div>
                    <div style={{ fontSize: 11, color: '#666' }}>
                        Seit: {new Date(alarm.since).toLocaleString()} | Wiederholungen: {alarm.repeatCount}
                    </div>
                    {!alarm.acknowledged && (
                        <button style={styles.btnSecondary} onClick={() => onAck(alarm.id)}>Quittieren</button>
                    )}
                </div>
            ))}

            {cleared.length > 0 && (
                <>
                    <h3>Letzte gelöschte Alarme</h3>
                    {cleared.map(alarm => (
                        <div key={alarm.id} style={{ ...styles.alarmRow, opacity: 0.6, borderLeftColor: '#9e9e9e' }}>
                            <strong>{alarm.code}</strong> – {alarm.groupId}: {alarm.message}
                        </div>
                    ))}
                </>
            )}
        </div>
    );
};

// ---- ObjectPicker ------------------------------------------

interface ObjEntry { id: string; name: string; type: string; role: string }

function fetchObjects(filter: string): Promise<ObjEntry[]> {
    return new Promise(resolve => {
        const sock = (window as Window & { _growSocket?: { emit: (...a: unknown[]) => void } })._growSocket;
        if (!sock) { resolve([]); return; }
        sock.emit(
            'getObjectView', 'system', 'state',
            { startkey: filter || '', endkey: filter ? filter + '香' : '香' },
            (_err: unknown, res: unknown) => {
                const rows = (res as { rows?: Array<{ id: string; value: { common?: { name?: unknown; type?: string; role?: string } } }> } | null)?.rows ?? [];
                resolve(
                    rows.slice(0, 200).map(r => ({
                        id: r.id,
                        name: typeof r.value?.common?.name === 'string'
                            ? r.value.common.name
                            : (r.value?.common?.name as Record<string, string> | undefined)?.de ?? '',
                        type: r.value?.common?.type ?? '',
                        role: r.value?.common?.role ?? '',
                    }))
                );
            }
        );
    });
}

interface ObjectPickerProps {
    onSelect: (id: string) => void;
    onClose: () => void;
    typeFilter?: string; // 'boolean' | 'number' | ''
}

const ObjectPicker: React.FC<ObjectPickerProps> = ({ onSelect, onClose, typeFilter }) => {
    const [search, setSearch] = React.useState('');
    const [results, setResults] = React.useState<ObjEntry[]>([]);
    const [loading, setLoading] = React.useState(false);

    const doSearch = React.useCallback((q: string) => {
        setLoading(true);
        fetchObjects(q).then(res => {
            const filtered = typeFilter ? res.filter(r => r.type === typeFilter) : res;
            setResults(filtered);
            setLoading(false);
        });
    }, [typeFilter]);

    React.useEffect(() => { doSearch(''); }, [doSearch]);

    const handleSearch = (q: string) => {
        setSearch(q);
        doSearch(q);
    };

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: '#fff', borderRadius: 8, padding: 20, width: 560, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.25)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <h4 style={{ margin: 0 }}>ioBroker Objektbaum</h4>
                    <button style={{ border: 'none', background: 'none', fontSize: 20, cursor: 'pointer' }} onClick={onClose}>×</button>
                </div>
                <input
                    style={{ ...styles.input, marginBottom: 8 }}
                    placeholder="Suchen: z.B. zigbee, temperature, 0.sensor…"
                    value={search}
                    autoFocus
                    onChange={e => handleSearch(e.target.value)}
                />
                {typeFilter && (
                    <p style={{ fontSize: 11, color: '#888', margin: '0 0 8px' }}>Nur Typ: <strong>{typeFilter}</strong></p>
                )}
                <div style={{ overflowY: 'auto', flex: 1, border: '1px solid #e0e0e0', borderRadius: 4 }}>
                    {loading && <div style={{ padding: 16, color: '#888' }}>Lade…</div>}
                    {!loading && results.length === 0 && (
                        <div style={{ padding: 16, color: '#888' }}>
                            Keine Objekte gefunden. Suche verfeinern oder manuell eingeben.
                        </div>
                    )}
                    {results.map(r => (
                        <div
                            key={r.id}
                            style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2 }}
                            onMouseEnter={e => (e.currentTarget.style.background = '#f5f5f5')}
                            onMouseLeave={e => (e.currentTarget.style.background = '')}
                            onClick={() => { onSelect(r.id); onClose(); }}
                        >
                            <span style={{ fontSize: 13, fontFamily: 'monospace', color: '#1976d2' }}>{r.id}</span>
                            {r.name && <span style={{ fontSize: 11, color: '#666' }}>{r.name}</span>}
                            <span style={{ fontSize: 11, color: '#999' }}>{r.type}{r.role ? ` · ${r.role}` : ''}</span>
                        </div>
                    ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                    <button style={styles.btnSecondary} onClick={onClose}>Abbrechen</button>
                </div>
            </div>
        </div>
    );
};

// ---- StateIdInput ------------------------------------------

interface StateIdInputProps {
    value: string;
    onChange: (id: string) => void;
    label: string;
    placeholder?: string;
    typeFilter?: string;
}

const StateIdInput: React.FC<StateIdInputProps> = ({ value, onChange, label, placeholder, typeFilter }) => {
    const [pickerOpen, setPickerOpen] = React.useState(false);

    return (
        <div>
            <label style={styles.fieldLabel}>{label}</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                    style={{ ...styles.input, flex: 1, fontFamily: 'monospace', fontSize: 12 }}
                    type="text"
                    value={value}
                    placeholder={placeholder ?? 'z.B. zigbee.0.device.temperature'}
                    onChange={e => onChange(e.target.value)}
                />
                <button
                    style={{ ...styles.btnSecondary, whiteSpace: 'nowrap' }}
                    type="button"
                    title="Aus ioBroker Objektbaum wählen"
                    onClick={() => setPickerOpen(true)}
                >
                    🔍 Wählen
                </button>
            </div>
            {pickerOpen && (
                <ObjectPicker
                    typeFilter={typeFilter}
                    onSelect={onChange}
                    onClose={() => setPickerOpen(false)}
                />
            )}
        </div>
    );
};

// ---- ProfilesView ------------------------------------------

import type { ClimateSetpoint } from './types';

const defaultSetpoint = (): ClimateSetpoint => ({
    temperature: 24, temperatureTolerance: 1, humidity: 60, humidityTolerance: 5,
    vpdMin: 0.8, vpdMax: 1.2, temperatureMin: 18, temperatureMax: 30,
    temperatureCritical: 35, humidityMin: 40, humidityMax: 80, humidityCritical: 85,
    condensationRiskMaxHumidity: 80,
});

const defaultProfile = (): ClimateProfile => ({
    id: `profile-${Date.now()}`,
    name: 'Neues Profil',
    phase: 'growth',
    transitionMinutes: 30,
    day: defaultSetpoint(),
    night: { ...defaultSetpoint(), temperature: 20, humidity: 55 },
});

function SetpointForm({ label, sp, onChange }: { label: string; sp: ClimateSetpoint; onChange: (s: ClimateSetpoint) => void }) {
    const n = (key: keyof ClimateSetpoint) => ({
        value: sp[key],
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...sp, [key]: +e.target.value }),
    });
    const row = (lbl: string, k: keyof ClimateSetpoint, step = 0.1) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ width: 220, fontSize: 13 }}>{lbl}</span>
            <input style={{ ...styles.input, width: 80 }} type="number" step={step} {...n(k)} />
        </div>
    );
    return (
        <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 8, color: '#2e7d32' }}>{label}</div>
            {row('Ziel-Temperatur (°C)', 'temperature')}
            {row('Toleranz Temp. (±°C)', 'temperatureTolerance')}
            {row('Min Temp (°C)', 'temperatureMin')}
            {row('Max Temp (°C)', 'temperatureMax')}
            {row('Kritisch Temp (°C)', 'temperatureCritical')}
            {row('Ziel-Luftfeuchte (%)', 'humidity', 1)}
            {row('Toleranz Feuchte (±%)', 'humidityTolerance', 1)}
            {row('Min Feuchte (%)', 'humidityMin', 1)}
            {row('Max Feuchte (%)', 'humidityMax', 1)}
            {row('VPD Min (kPa)', 'vpdMin')}
            {row('VPD Max (kPa)', 'vpdMax')}
        </div>
    );
}

const ProfilesView: React.FC<{
    profiles: ClimateProfile[];
    onChange: (p: ClimateProfile[]) => void;
}> = ({ profiles, onChange }) => {
    const [editing, setEditing] = React.useState<ClimateProfile | null>(null);

    if (editing) {
        return (
            <div style={styles.editor}>
                <h3 style={{ margin: '0 0 16px' }}>{editing.name}</h3>

                <label style={styles.fieldLabel}>Name</label>
                <input style={styles.input} value={editing.name}
                    onChange={e => setEditing(prev => prev && ({ ...prev, name: e.target.value }))} />

                <label style={styles.fieldLabel}>Pflanzenphase</label>
                <select style={styles.select} value={editing.phase}
                    onChange={e => setEditing(prev => prev && ({ ...prev, phase: e.target.value as ClimateProfile['phase'] }))}>
                    <option value="seedling">Keimling</option>
                    <option value="growth">Wachstum</option>
                    <option value="bloom">Blüte</option>
                    <option value="drying">Trocknung</option>
                    <option value="custom">Benutzerdefiniert</option>
                </select>

                <label style={styles.fieldLabel}>Tag/Nacht-Übergang (min)</label>
                <input style={styles.input} type="number" value={editing.transitionMinutes}
                    onChange={e => setEditing(prev => prev && ({ ...prev, transitionMinutes: +e.target.value }))} />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 16 }}>
                    <SetpointForm label="☀️ Tag" sp={editing.day}
                        onChange={day => setEditing(prev => prev && ({ ...prev, day }))} />
                    <SetpointForm label="🌙 Nacht" sp={editing.night}
                        onChange={night => setEditing(prev => prev && ({ ...prev, night }))} />
                </div>

                <div style={styles.editorButtons}>
                    <button style={styles.btnPrimary} onClick={() => {
                        onChange(profiles.some(p => p.id === editing.id)
                            ? profiles.map(p => p.id === editing.id ? editing : p)
                            : [...profiles, editing]);
                        setEditing(null);
                    }}>💾 Speichern</button>
                    <button style={styles.btnSecondary} onClick={() => setEditing(null)}>Abbrechen</button>
                </div>
            </div>
        );
    }

    return (
        <div>
            <button style={styles.btnPrimary} onClick={() => setEditing(defaultProfile())}>+ Neues Klimaprofil</button>
            {profiles.length === 0 && (
                <p style={{ color: '#888', marginTop: 16 }}>Noch keine Klimaprofile. Erstelle Profile mit Tag/Nacht-Sollwerten für Temperatur, Feuchte und VPD.</p>
            )}
            {profiles.map(p => (
                <div key={p.id} style={styles.listRow}>
                    <div>
                        <strong>{p.name}</strong>
                        <span style={{ color: '#666', marginLeft: 12, fontSize: 12 }}>{p.phase}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#888' }}>
                        Tag: {p.day.temperature}°C / {p.day.humidity}% · Nacht: {p.night.temperature}°C / {p.night.humidity}%
                    </div>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                        <button style={styles.btnSecondary} onClick={() => setEditing({ ...p })}>Bearbeiten</button>
                        <button style={{ ...styles.btnSecondary, color: '#d32f2f' }}
                            onClick={() => { if (window.confirm(`Profil „${p.name}" löschen?`)) onChange(profiles.filter(x => x.id !== p.id)); }}>
                            Löschen
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
};

// ---- Settings ----------------------------------------------

const SettingsView: React.FC<{
    config: GrowManagerConfig;
    onChange: (c: GrowManagerConfig) => void;
}> = ({ config, onChange }) => {
    const field = (key: keyof GrowManagerConfig) => ({
        value: String(config[key] ?? ''),
        onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
            onChange({ ...config, [key]: e.target.value }),
    });

    return (
        <div style={styles.editor}>
            <h3>Globale Einstellungen</h3>

            <label style={styles.fieldLabel}>Sprache</label>
            <select style={styles.select} {...field('language')}>
                <option value="de">Deutsch</option>
                <option value="en">English</option>
            </select>

            <label style={styles.fieldLabel}>Regelzyklus (Sekunden)</label>
            <input style={styles.input} type="number" min={1} {...field('controlCycleSeconds')} />

            <label style={styles.fieldLabel}>Ereignis-Aufbewahrung (Tage)</label>
            <input style={styles.input} type="number" min={1} {...field('eventRetentionDays')} />

            <label style={styles.fieldLabel}>Web-Port</label>
            <input style={styles.input} type="number" {...field('webPort')} />

            <label style={styles.fieldLabel}>Start-Verhalten</label>
            <select style={styles.select} {...field('startBehavior')}>
                <option value="lastState">Letzten Zustand übernehmen</option>
                <option value="delayedStart">Automatik verzögert starten</option>
                <option value="safeTurnOff">Alle Aktoren sicher ausschalten</option>
                <option value="monitorOnly">Nur überwachen</option>
            </select>

            <label style={styles.fieldLabel}>Log-Level</label>
            <select style={styles.select} {...field('logLevel')}>
                <option value="debug">Debug</option>
                <option value="info">Info</option>
                <option value="warn">Warnung</option>
                <option value="error">Fehler</option>
            </select>

            <hr style={{ margin: '24px 0', borderColor: '#e0e0e0' }} />
            <h4 style={{ margin: '0 0 12px' }}>Konfiguration Export / Import</h4>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <button
                    style={styles.btnSecondary}
                    type="button"
                    onClick={() => {
                        if (typeof sendTo !== 'undefined') {
                            sendTo('growmanager.0', 'exportConfig', {}, (result: unknown) => {
                                const res = result as { json?: string };
                                if (res?.json) {
                                    const blob = new Blob([res.json], { type: 'application/json' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = 'growmanager-config.json';
                                    a.click();
                                    URL.revokeObjectURL(url);
                                }
                            });
                        } else {
                            alert('sendTo nicht verfügbar (nur in ioBroker Admin nutzbar)');
                        }
                    }}
                >
                    Konfiguration exportieren
                </button>

                <label style={{ ...styles.btnSecondary, cursor: 'pointer', display: 'inline-block' }}>
                    Konfiguration importieren
                    <input
                        type="file"
                        accept=".json"
                        style={{ display: 'none' }}
                        onChange={e => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = ev => {
                                const json = ev.target?.result as string;
                                if (typeof sendTo !== 'undefined') {
                                    sendTo('growmanager.0', 'importConfig', { json }, (result: unknown) => {
                                        const res = result as { valid?: boolean; errors?: string[] };
                                        if (res?.valid) {
                                            alert('Konfiguration erfolgreich importiert. Seite neu laden.');
                                        } else {
                                            alert(`Import fehlgeschlagen:\n${(res?.errors ?? []).join('\n')}`);
                                        }
                                    });
                                } else {
                                    alert('sendTo nicht verfügbar (nur in ioBroker Admin nutzbar)');
                                }
                            };
                            reader.readAsText(file);
                            // Input zurücksetzen damit dieselbe Datei nochmals gewählt werden kann
                            e.target.value = '';
                        }}
                    />
                </label>
            </div>
        </div>
    );
};

// ---- Hauptkomponente ----------------------------------------

const App: React.FC = () => {
    const [activeTab, setActiveTab] = useState<TabId>('dashboard');
    const [config, setConfig] = useState<GrowManagerConfig>({
        language: 'de',
        sampleInterval: 10,
        controlCycleSeconds: 10,
        maxConcurrentSwitches: 5,
        maintenanceMode: false,
        startBehavior: 'lastState',
        logLevel: 'info',
        eventRetentionDays: 30,
        webPort: 8097,
        webBindAddress: '127.0.0.1',
        webAuth: false,
        groups: [],
        climateProfiles: [],
        alarmChannels: [],
    });
    const [editingGroup, setEditingGroup] = useState<GroupConfig | null | 'new'>(null);
    const [alarms, setAlarms] = useState<AlarmRecord[]>([]);
    const [liveStates, setLiveStates] = useState<Record<string, GroupLiveState>>({});
    const [dirty, setDirty] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'ok' | 'err'>('idle');
    const [saveError, setSaveError] = useState('');
    const [socketReady, setSocketReady] = useState(false);

    // ioBroker-Anbindung
    useEffect(() => {
        const load = () => {
            const w = window as Window & { loadConfig?: (cb: (c: GrowManagerConfig) => void) => void };
            if (typeof w.loadConfig === 'function') {
                setSocketReady(true);
                w.loadConfig((c: GrowManagerConfig) => setConfig(c));
            }
        };
        load();
        window.addEventListener('iobroker-ready', load);
        return () => window.removeEventListener('iobroker-ready', load);
    }, []);

    const saveToIoBroker = useCallback((newConfig: GrowManagerConfig) => {
        const w = window as Window & { saveConfig?: (c: GrowManagerConfig) => Promise<void> };
        if (typeof w.saveConfig !== 'function') {
            setSaveStatus('err');
            setSaveError('Keine Verbindung zu ioBroker – prüfe Browser-Konsole (F12)');
            return;
        }
        setSaveStatus('saving');
        w.saveConfig(newConfig)
            .then(() => {
                setDirty(false);
                setSaveStatus('ok');
                setTimeout(() => setSaveStatus('idle'), 3000);
            })
            .catch((e: unknown) => {
                setSaveStatus('err');
                setSaveError(String(e));
            });
    }, []);

    const handleGroupSave = useCallback((g: GroupConfig) => {
        setConfig(prev => {
            const newConfig = {
                ...prev,
                groups: editingGroup && editingGroup !== 'new'
                    ? prev.groups.map(gr => gr.id === g.id ? g : gr)
                    : [...prev.groups, g],
            };
            // Direkt speichern — kein zweiter "Speichern"-Klick nötig
            setTimeout(() => saveToIoBroker(newConfig), 0);
            return newConfig;
        });
        setEditingGroup(null);
    }, [editingGroup, saveToIoBroker]);

    const handleSave = useCallback(() => saveToIoBroker(config), [config, saveToIoBroker]);

    const handleAck = useCallback((alarmId: string) => {
        setAlarms(prev => prev.map(a => a.id === alarmId ? { ...a, acknowledged: true } : a));
    }, []);

    const handleOverride = useCallback((groupId: string, actuatorId: string) => {
        // Hier würde ein Dialog erscheinen
        alert(`Override für ${groupId} / ${actuatorId} – Funktion in Vollversion verfügbar`);
    }, []);

    const renderTab = (): React.ReactNode => {
        switch (activeTab) {
            case 'dashboard':
                return (
                    <div style={styles.grid}>
                        {config.groups.map(g => (
                            <GroupCard
                                key={g.id}
                                group={g}
                                live={liveStates[g.id] ?? null}
                                onManualOverride={handleOverride}
                            />
                        ))}
                        {config.groups.length === 0 && (
                            <div style={styles.emptyState}>
                                Noch keine Gruppen angelegt. Wechsle zu „Gruppen" und erstelle deine erste Grow-Gruppe.
                            </div>
                        )}
                    </div>
                );

            case 'groups':
                if (editingGroup !== null) {
                    return (
                        <GroupEditor
                            group={editingGroup === 'new' ? null : editingGroup}
                            profiles={config.climateProfiles}
                            onSave={handleGroupSave}
                            onCancel={() => setEditingGroup(null)}
                        />
                    );
                }
                return (
                    <div>
                        <button style={styles.btnPrimary} onClick={() => setEditingGroup('new')}>
                            + Neue Gruppe
                        </button>
                        {config.groups.map(g => (
                            <div key={g.id} style={styles.listRow}>
                                <span>{g.name}</span>
                                <span style={{ color: '#666', marginLeft: 16 }}>{g.phase} / {g.mode}</span>
                                <div style={{ marginLeft: 'auto' }}>
                                    <button style={styles.btnSecondary} onClick={() => setEditingGroup(g)}>Bearbeiten</button>
                                    <button style={{ ...styles.btnSecondary, color: '#d32f2f', marginLeft: 8 }}
                                        onClick={() => {
                                            if (window.confirm(`Gruppe „${g.name}" wirklich löschen?`)) {
                                                setConfig(prev => ({ ...prev, groups: prev.groups.filter(gr => gr.id !== g.id) }));
                                                setDirty(true);
                                            }
                                        }}>
                                        Löschen
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                );

            case 'alarms':
                return <AlarmView alarms={alarms} onAck={handleAck} />;

            case 'settings':
                return (
                    <SettingsView
                        config={config}
                        onChange={c => { setConfig(c); setDirty(true); }}
                    />
                );

            case 'diagnostics':
                return (
                    <div>
                        <h3>Diagnose</h3>
                        {config.groups.map(g => {
                            const ls = liveStates[g.id];
                            return (
                                <div key={g.id} style={styles.card}>
                                    <h4>{g.name}</h4>
                                    <p>Degradation: <strong>{ls?.health ?? '–'}</strong></p>
                                    <p>Sensorqualität: {ls?.sensorQuality ?? '–'} %</p>
                                    {ls?.lastDecision && <DecisionDisplay raw={ls.lastDecision} />}
                                </div>
                            );
                        })}
                    </div>
                );

            case 'profiles':
                return <ProfilesView
                    profiles={config.climateProfiles}
                    onChange={profiles => { setConfig(prev => ({ ...prev, climateProfiles: profiles })); setDirty(true); }}
                />;

            default:
                return null;
        }
    };

    return (
        <div style={styles.root}>
            {/* Header */}
            <div style={styles.header}>
                <h2 style={{ margin: 0 }}>🌿 GrowManager</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 11, color: socketReady ? '#4caf50' : '#f57c00' }}
                          title={socketReady ? (window as Window & {_growInstanceId?: string})._growInstanceId ?? '' : 'Warte auf ioBroker-Verbindung…'}>
                        {socketReady ? '● Verbunden' : '○ Verbinde…'}
                    </span>
                    {saveStatus === 'saving' && <span style={{ fontSize: 13, color: '#888' }}>⏳ Speichern…</span>}
                    {saveStatus === 'ok' && <span style={{ color: '#4caf50', fontSize: 13 }}>✓ Gespeichert</span>}
                    {saveStatus === 'err' && (
                        <span style={{ color: '#d32f2f', fontSize: 13, cursor: 'help' }} title={saveError}>
                            ✗ Fehler – F12 für Details
                        </span>
                    )}
                    {(dirty || saveStatus === 'saving') && (
                        <button style={styles.btnPrimary} onClick={handleSave} disabled={saveStatus === 'saving'}>
                            💾 Speichern
                        </button>
                    )}
                </div>
            </div>

            {/* Navigation */}
            <div style={styles.nav}>
                {TABS.map(tab => (
                    <button
                        key={tab.id}
                        style={{
                            ...styles.navBtn,
                            ...(activeTab === tab.id ? styles.navBtnActive : {}),
                        }}
                        onClick={() => setActiveTab(tab.id)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Inhalt */}
            <div style={styles.content}>
                {renderTab()}
            </div>
        </div>
    );
};

// ---- Styles ------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
    root: {
        fontFamily: 'Roboto, Arial, sans-serif',
        fontSize: 14,
        backgroundColor: '#f5f5f5',
        minHeight: '100vh',
        color: '#212121',
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 20px',
        backgroundColor: '#2e7d32',
        color: '#fff',
    },
    nav: {
        display: 'flex',
        backgroundColor: '#fff',
        borderBottom: '1px solid #e0e0e0',
        padding: '0 8px',
    },
    navBtn: {
        padding: '10px 16px',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        fontSize: 14,
        color: '#555',
        borderBottom: '3px solid transparent',
    },
    navBtnActive: {
        color: '#2e7d32',
        borderBottom: '3px solid #2e7d32',
        fontWeight: 600,
    },
    content: {
        padding: 20,
        maxWidth: 1200,
        margin: '0 auto',
    },
    grid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        gap: 16,
    },
    card: {
        backgroundColor: '#fff',
        borderRadius: 8,
        padding: 16,
        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
    },
    cardHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        cursor: 'pointer',
        marginBottom: 8,
    },
    cardTitle: {
        fontWeight: 600,
        fontSize: 16,
    },
    badge: {
        color: '#fff',
        borderRadius: 4,
        padding: '2px 8px',
        fontSize: 12,
        fontWeight: 600,
    },
    cardClimate: {
        display: 'flex',
        gap: 24,
        fontSize: 22,
        fontWeight: 600,
        color: '#2e7d32',
        margin: '8px 0',
    },
    cardMeta: {
        display: 'flex',
        gap: 16,
        color: '#666',
    },
    alarmBanner: {
        marginTop: 8,
        padding: '4px 8px',
        color: '#fff',
        borderRadius: 4,
        fontSize: 12,
    },
    expandedSection: {
        marginTop: 12,
        borderTop: '1px solid #e0e0e0',
        paddingTop: 12,
    },
    sectionTitle: {
        fontWeight: 600,
        marginBottom: 6,
        fontSize: 12,
        textTransform: 'uppercase',
        color: '#888',
    },
    actuatorRow: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '4px 0',
        borderBottom: '1px solid #f0f0f0',
        fontSize: 13,
    },
    stateOn: { color: '#2e7d32', fontWeight: 600, minWidth: 36 },
    stateOff: { color: '#666', minWidth: 36 },
    powerLabel: { color: '#1976d2', fontSize: 12, minWidth: 48 },
    healthLabel: { fontSize: 11, color: '#888', marginLeft: 'auto' },
    overrideBtn: {
        padding: '2px 8px',
        fontSize: 11,
        cursor: 'pointer',
        border: '1px solid #ccc',
        borderRadius: 4,
        background: '#fafafa',
    },
    decisionBox: { marginTop: 12 },
    decisionText: { fontSize: 13, lineHeight: 1.6 },
    nextChange: { marginTop: 8, fontSize: 12, color: '#888' },
    emptyState: {
        gridColumn: '1 / -1',
        padding: 32,
        textAlign: 'center',
        color: '#888',
        background: '#fff',
        borderRadius: 8,
        border: '2px dashed #e0e0e0',
    },
    editor: {
        backgroundColor: '#fff',
        borderRadius: 8,
        padding: 24,
        maxWidth: 600,
        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
    },
    fieldLabel: {
        display: 'block',
        fontWeight: 600,
        marginTop: 12,
        marginBottom: 4,
        fontSize: 13,
    },
    input: {
        display: 'block',
        width: '100%',
        padding: '8px 10px',
        fontSize: 14,
        border: '1px solid #ccc',
        borderRadius: 4,
        boxSizing: 'border-box',
    },
    select: {
        display: 'block',
        width: '100%',
        padding: '8px 10px',
        fontSize: 14,
        border: '1px solid #ccc',
        borderRadius: 4,
        boxSizing: 'border-box',
        backgroundColor: '#fff',
    },
    timeRow: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
    },
    editorButtons: {
        display: 'flex',
        gap: 12,
        marginTop: 20,
    },
    btnPrimary: {
        padding: '8px 18px',
        backgroundColor: '#2e7d32',
        color: '#fff',
        border: 'none',
        borderRadius: 4,
        cursor: 'pointer',
        fontSize: 14,
        fontWeight: 600,
    },
    btnSecondary: {
        padding: '8px 18px',
        backgroundColor: '#fff',
        color: '#333',
        border: '1px solid #ccc',
        borderRadius: 4,
        cursor: 'pointer',
        fontSize: 14,
    },
    listRow: {
        display: 'flex',
        alignItems: 'center',
        padding: '10px 0',
        borderBottom: '1px solid #e0e0e0',
    },
    alarmRow: {
        backgroundColor: '#fff',
        borderLeft: '4px solid #ccc',
        padding: 12,
        marginBottom: 8,
        borderRadius: 4,
        boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
    },
    modalOverlay: {
        position: 'fixed' as const,
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        overflowY: 'auto' as const,
        padding: '40px 16px',
    },
    modal: {
        background: '#fff',
        borderRadius: 8,
        padding: 24,
        width: '100%',
        boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
    },
    badge2: {
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 4,
        marginRight: 8,
        whiteSpace: 'nowrap' as const,
    },
};

export default App;
