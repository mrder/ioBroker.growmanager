// ============================================================
// GrowManager Admin-UI
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import type { GrowManagerConfig, GroupConfig, ClimateProfile, ControlTarget, ControlDirection, OutdoorSensorConfig, SharedParticipant, NotificationChannel, NotificationConfig, NotificationChannelType, WindSimulatorConfig, CirculationScheduleWindow } from './types';

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

// ioBroker Admin 5+ hat kein globales sendTo mehr – socket.emit als primären Weg nutzen.
function iobSendTo(target: string, cmd: string, data: unknown, cb: (r: unknown) => void): void {
    const sock = (window as unknown as Record<string, unknown>).socket as { emit: (...a: unknown[]) => void } | undefined;
    const legacy = (window as unknown as Record<string, unknown>).sendTo as ((t: string, c: string, d: unknown, cb: (r: unknown) => void) => void) | undefined;
    if (sock?.emit) {
        sock.emit('sendTo', target, cmd, data, cb);
    } else if (legacy) {
        legacy(target, cmd, data, cb);
    } else {
        cb(null);
    }
}

// ---- InfoTip -----------------------------------------------
const InfoTip: React.FC<{ text: string }> = ({ text }) => {
    const [visible, setVisible] = useState(false);
    return (
        <span style={{ position: 'relative', display: 'inline-block', marginLeft: 5, verticalAlign: 'middle' }}>
            <span
                onMouseEnter={() => setVisible(true)}
                onMouseLeave={() => setVisible(false)}
                style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 15, height: 15, borderRadius: '50%',
                    background: '#1976d2', color: '#fff',
                    fontSize: 10, fontWeight: 700, cursor: 'default', userSelect: 'none',
                }}
            >i</span>
            {visible && (
                <span style={{
                    position: 'absolute', left: 20, top: '50%', transform: 'translateY(-50%)',
                    background: '#333', color: '#fff', borderRadius: 6, padding: '6px 10px',
                    fontSize: 12, lineHeight: 1.4, whiteSpace: 'pre-wrap', maxWidth: 260,
                    zIndex: 9999, boxShadow: '0 2px 8px rgba(0,0,0,0.3)', pointerEvents: 'none',
                }}>{text}</span>
            )}
        </span>
    );
};

// Hilfsfunktion: Label mit optionalem InfoTip
const FieldLabel: React.FC<{ children: React.ReactNode; tip?: string }> = ({ children, tip }) => (
    <label style={{ display: 'block', fontWeight: 600, marginTop: 12, marginBottom: 4, fontSize: 13 }}>
        {children}{tip && <InfoTip text={tip} />}
    </label>
);

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
    sensorDisagreementThreshold: 5,
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
    staleAfterSeconds: 900,
    unchangedAlarmSeconds: 3600,
    minUpdateRateSeconds: 0,
    smoothing: 'none',
    outlierFilter: false,
    errorBehavior: 'ignore',
    useForControl: true,
    controlPriority: 1,
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
    outdoorGuardEnabled: false,
});

const defaultOutdoorSensor = (): OutdoorSensorConfig => ({
    enabled: false,
    tempStateId: '',
    humidityStateId: '',
    minTempDeltaCelsius: 2,
    maxHumidityDeltaPercent: 10,
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

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
                    <div>
                        <label style={styles.fieldLabel}>Rolle</label>
                        <select style={styles.select} {...f('role')}>
                            <option value="primary">Primär (Hauptregelwert)</option>
                            <option value="backup">Backup (Fallback bei Ausfall)</option>
                            <option value="monitor">Nur Überwachung (nie Regelgröße)</option>
                        </select>
                    </div>
                    <div>
                        <label style={styles.fieldLabel}>Priorität</label>
                        <input style={styles.input} type="number" min={1} max={99}
                            value={edit.controlPriority ?? 1}
                            onChange={e => setEdit(prev => ({ ...prev, controlPriority: +e.target.value }))}
                            title="1 = höchste Priorität. Bei mehreren Primär/Backup-Sensoren gleicher Art bestimmt die Priorität die Reihenfolge." />
                    </div>
                </div>
                {edit.role === 'backup' && (
                    <div style={{ fontSize: 12, color: '#f57c00', padding: '4px 8px', background: '#fff8e1', borderRadius: 4, marginTop: 2 }}>
                        ⚠ Backup-Sensor wird nur genutzt wenn alle Primär-Sensoren dieses Typs ausfallen oder veraltet sind.
                    </div>
                )}
                {edit.role === 'monitor' && (
                    <div style={{ fontSize: 12, color: '#1565c0', padding: '4px 8px', background: '#e3f2fd', borderRadius: 4, marginTop: 2 }}>
                        ℹ Überwachungs-Sensor erzeugt Alarme, beeinflusst aber keine Regelung.
                    </div>
                )}

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

                <hr style={{ margin: '14px 0', borderColor: '#e0e0e0' }} />

                <StateIdInput
                    label="Gerätestatus (Erreichbarkeit)"
                    tip={"Prüft ob das Gerät erreichbar/online ist.\nBeispiele:\n• available (bool) → true = ok\n• link_quality (Zahl) → ≥ Mindestwert = ok\n• alive (bool) → true = ok\n\nUnabhängig vom Schaltzustand des Aktors!"}
                    value={edit.healthStateId ?? ''}
                    onChange={v => setEdit(prev => ({ ...prev, healthStateId: v || undefined }))}
                    placeholder="z.B. zigbee.0.device.available"
                />

                {edit.healthStateId && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
                        <div>
                            <label style={styles.fieldLabel}>Typ des Status-Werts</label>
                            <select style={styles.select}
                                value={edit.healthCheckType ?? 'boolean'}
                                onChange={e => setEdit(prev => ({ ...prev, healthCheckType: e.target.value as 'boolean' | 'number' }))}>
                                <option value="boolean">Boolean (true = ok)</option>
                                <option value="number">Zahl (≥ Mindestwert = ok)</option>
                            </select>
                        </div>
                        {(edit.healthCheckType ?? 'boolean') === 'number' && (
                            <div>
                                <label style={styles.fieldLabel}>Mindestwert (z.B. 10 für link_quality)</label>
                                <input style={styles.input} type="number" min={0}
                                    value={edit.healthCheckMin ?? 1}
                                    onChange={e => setEdit(prev => ({ ...prev, healthCheckMin: +e.target.value }))} />
                            </div>
                        )}
                    </div>
                )}

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
    allGroups: GroupConfig[];
    ownerGroupId?: string;
    onSave: (a: GroupConfig['actuators'][0]) => void;
    onClose: () => void;
}

// ---- CirculationFanSettings --------------------------------

const defaultWindSim = (): WindSimulatorConfig => ({
    minOnSeconds: 30, maxOnSeconds: 180, minOffSeconds: 20, maxOffSeconds: 120,
});

const defaultScheduleWindow = (): CirculationScheduleWindow => ({
    startHH: 6, startMM: 0, endHH: 22, endMM: 0,
});

const CirculationFanSettings: React.FC<{
    edit: ReturnType<typeof defaultActuator>;
    setEdit: React.Dispatch<React.SetStateAction<ReturnType<typeof defaultActuator>>>;
}> = ({ edit, setEdit }) => {
    const mode = edit.circulationMode ?? 'alwaysOn';
    const ws = edit.windSimulator ?? defaultWindSim();
    const schedule = edit.circulationSchedule ?? [];

    const setMode = (m: 'windSimulator' | 'schedule' | 'alwaysOn') =>
        setEdit(prev => ({ ...prev, circulationMode: m }));

    const setWs = (key: keyof WindSimulatorConfig, val: number) =>
        setEdit(prev => ({ ...prev, windSimulator: { ...(prev.windSimulator ?? defaultWindSim()), [key]: val } }));

    const addWindow = () =>
        setEdit(prev => ({ ...prev, circulationSchedule: [...(prev.circulationSchedule ?? []), defaultScheduleWindow()] }));

    const removeWindow = (i: number) =>
        setEdit(prev => ({ ...prev, circulationSchedule: (prev.circulationSchedule ?? []).filter((_, idx) => idx !== i) }));

    const setWindow = (i: number, key: keyof CirculationScheduleWindow, val: number) =>
        setEdit(prev => {
            const arr = [...(prev.circulationSchedule ?? [])];
            arr[i] = { ...arr[i], [key]: val };
            return { ...prev, circulationSchedule: arr };
        });

    const sectionStyle: React.CSSProperties = {
        background: '#f0f4ff', border: '1px solid #c5d0e8', borderRadius: 8,
        padding: '14px 16px', marginTop: 14,
    };
    const inp: React.CSSProperties = {
        width: '100%', padding: '5px 8px', borderRadius: 4,
        border: '1px solid #ccc', fontSize: 13, boxSizing: 'border-box',
    };

    return (
        <div style={sectionStyle}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>🌀 Umluft-Betriebsart</div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                {(['alwaysOn', 'windSimulator', 'schedule'] as const).map(m => (
                    <button key={m} onClick={() => setMode(m)}
                        style={{
                            flex: 1, padding: '6px 4px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                            border: mode === m ? '2px solid #1976d2' : '1px solid #ccc',
                            background: mode === m ? '#1976d2' : '#fff',
                            color: mode === m ? '#fff' : '#333', fontWeight: mode === m ? 700 : 400,
                        }}>
                        {m === 'alwaysOn' ? 'Immer EIN' : m === 'windSimulator' ? '🎲 Windsimulator' : '🕐 Zeitfenster'}
                    </button>
                ))}
            </div>

            {mode === 'alwaysOn' && (
                <p style={{ margin: 0, fontSize: 12, color: '#666' }}>
                    Lüfter läuft dauerhaft — nur manuelle Sperren oder Sicherheitsabschaltungen stoppen ihn.
                </p>
            )}

            {mode === 'windSimulator' && (
                <>
                    <p style={{ margin: '0 0 10px', fontSize: 12, color: '#555' }}>
                        Zufällige EIN/AUS-Intervalle innerhalb der konfigurierten Min/Max-Grenzen — simuliert natürlichen Wind.
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div>
                            <label style={{ display: 'block', fontWeight: 600, fontSize: 12, marginBottom: 3 }}>Min. EIN (s)</label>
                            <input style={inp} type="number" min={1} value={ws.minOnSeconds}
                                onChange={e => setWs('minOnSeconds', +e.target.value)} />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontWeight: 600, fontSize: 12, marginBottom: 3 }}>Max. EIN (s)</label>
                            <input style={inp} type="number" min={1} value={ws.maxOnSeconds}
                                onChange={e => setWs('maxOnSeconds', +e.target.value)} />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontWeight: 600, fontSize: 12, marginBottom: 3 }}>Min. AUS (s)</label>
                            <input style={inp} type="number" min={1} value={ws.minOffSeconds}
                                onChange={e => setWs('minOffSeconds', +e.target.value)} />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontWeight: 600, fontSize: 12, marginBottom: 3 }}>Max. AUS (s)</label>
                            <input style={inp} type="number" min={1} value={ws.maxOffSeconds}
                                onChange={e => setWs('maxOffSeconds', +e.target.value)} />
                        </div>
                    </div>
                    <p style={{ margin: '8px 0 0', fontSize: 11, color: '#888' }}>
                        Beispiel: Min EIN 30s / Max EIN 180s / Min AUS 20s / Max AUS 120s → natürlicher Windrhythmus
                    </p>
                </>
            )}

            {mode === 'schedule' && (
                <>
                    <p style={{ margin: '0 0 10px', fontSize: 12, color: '#555' }}>
                        Lüfter läuft nur innerhalb der definierten Zeitfenster (max. 3 Fenster).
                    </p>
                    {schedule.map((w, i) => (
                        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                            <span style={{ fontSize: 12, minWidth: 20 }}>#{i + 1}</span>
                            <input style={{ ...inp, width: 52 }} type="number" min={0} max={23} value={w.startHH}
                                onChange={e => setWindow(i, 'startHH', +e.target.value)} />
                            <span style={{ fontSize: 13 }}>:</span>
                            <input style={{ ...inp, width: 52 }} type="number" min={0} max={59} value={w.startMM}
                                onChange={e => setWindow(i, 'startMM', +e.target.value)} />
                            <span style={{ fontSize: 12, margin: '0 4px' }}>bis</span>
                            <input style={{ ...inp, width: 52 }} type="number" min={0} max={23} value={w.endHH}
                                onChange={e => setWindow(i, 'endHH', +e.target.value)} />
                            <span style={{ fontSize: 13 }}>:</span>
                            <input style={{ ...inp, width: 52 }} type="number" min={0} max={59} value={w.endMM}
                                onChange={e => setWindow(i, 'endMM', +e.target.value)} />
                            <span style={{ fontSize: 11, color: '#888', flex: 1 }}>Uhr</span>
                            <button onClick={() => removeWindow(i)}
                                style={{ background: '#e53935', color: '#fff', border: 'none', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontSize: 12 }}>
                                ✕
                            </button>
                        </div>
                    ))}
                    {schedule.length < 3 && (
                        <button onClick={addWindow}
                            style={{ marginTop: 4, padding: '5px 12px', borderRadius: 6, border: '1px solid #1976d2', background: '#fff', color: '#1976d2', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                            + Zeitfenster hinzufügen
                        </button>
                    )}
                </>
            )}
        </div>
    );
};

const ActuatorEditor: React.FC<ActuatorEditorProps> = ({ actuator, allGroups, ownerGroupId, onSave, onClose }) => {
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

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>
                        <label style={styles.fieldLabel}>Regelziel (controlTarget)</label>
                        <select style={styles.select}
                            value={edit.controlTarget ?? ''}
                            onChange={e => setEdit(prev => ({ ...prev, controlTarget: (e.target.value || undefined) as ControlTarget | undefined }))}>
                            <option value="">– Auto (vom Typ abgeleitet) –</option>
                            <option value="temperature">Temperatur</option>
                            <option value="humidity">Luftfeuchtigkeit</option>
                            <option value="vpd">VPD (koordiniert)</option>
                            <option value="co2">CO₂</option>
                            <option value="soilMoisture">Bodenfeuchte</option>
                            <option value="light">Licht (Zeitplan)</option>
                            <option value="timer">Timer (immer EIN)</option>
                            <option value="custom">Benutzerdefiniert</option>
                        </select>
                    </div>
                    <div>
                        <label style={styles.fieldLabel}>Wirkrichtung</label>
                        <select style={styles.select}
                            value={edit.controlDirection ?? ''}
                            onChange={e => setEdit(prev => ({ ...prev, controlDirection: (e.target.value || undefined) as ControlDirection | undefined }))}>
                            <option value="">– Auto (vom Typ abgeleitet) –</option>
                            <option value="up">Erhöhen (up) – z.B. Heizung, Befeuchter</option>
                            <option value="down">Senken (down) – z.B. Abluft, Entfeuchter</option>
                            <option value="both">Beides</option>
                        </select>
                    </div>
                </div>
                {(edit.type === 'exhaustFan' || edit.type === 'supplyFan') && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0', cursor: 'pointer', fontSize: 13 }}>
                        <input type="checkbox"
                            checked={edit.outdoorGuardEnabled ?? false}
                            onChange={e => setEdit(prev => ({ ...prev, outdoorGuardEnabled: e.target.checked }))} />
                        <span>Außenluft-Guard aktivieren</span>
                        <span style={{ fontSize: 11, color: '#888' }}>(Gruppe muss Außensensor haben → Lüfter sperren wenn Außen ungünstiger)</span>
                    </label>
                )}

                {/* Stufenregelung: nur für Aktoren die Klima beeinflussen (nicht Licht/Umluft/CO₂) */}
                {!['light', 'circulationFan', 'co2Valve', 'irrigation', 'custom'].includes(edit.type) && (
                    <div style={{ background: '#f5f8ff', border: '1px solid #d0daf0', borderRadius: 8, padding: '12px 14px', marginTop: 14 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
                            Stufenregelung
                            <InfoTip text={'Ermöglicht gestaffelte Regelung:\n• Stufe 1 (Primär) = Lüftung schaltet zuerst\n• Stufe 2 (Eskalation) = Klimagerät/Heizung schaltet erst wenn Stufe 1 seit X Minuten läuft und das Ziel noch nicht erreicht ist\n• Kein Limit = kein Stufensystem (Standard)'} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <div>
                                <label style={styles.fieldLabel}>Stufe dieses Aktors</label>
                                <select style={styles.select}
                                    value={edit.escalationStage ?? ''}
                                    onChange={e => setEdit(prev => ({
                                        ...prev,
                                        escalationStage: e.target.value ? +e.target.value as 1 | 2 : undefined,
                                    }))}>
                                    <option value="">– Kein Stufensystem –</option>
                                    <option value="1">Stufe 1 – Primär (Lüftung zuerst)</option>
                                    <option value="2">Stufe 2 – Eskalation (Klimagerät / Heizung)</option>
                                </select>
                            </div>
                            {edit.escalationStage === 2 && (
                                <div>
                                    <label style={styles.fieldLabel}>Eskalations-Verzögerung (min)</label>
                                    <input style={styles.input} type="number" min={1} max={120}
                                        value={edit.escalationDelayMinutes ?? 10}
                                        onChange={e => setEdit(prev => ({ ...prev, escalationDelayMinutes: +e.target.value }))} />
                                    <span style={{ fontSize: 11, color: '#888' }}>Stufe 2 schaltet erst nach dieser Zeit</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {edit.type === 'circulationFan' && (
                    <CirculationFanSettings edit={edit} setEdit={setEdit} />
                )}

                <StateIdInput
                    label="Befehls-State (schreiben)"
                    tip={"Der State, in den der Adapter den Schaltbefehl schreibt.\nBeispiele:\n• tasmota.0.POWER\n• zigbee.0.device.state\n• shelly.0.relay0"}
                    value={edit.commandStateId}
                    onChange={v => setEdit(prev => ({ ...prev, commandStateId: v }))}
                    placeholder="z.B. tasmota.0.switch.POWER"
                />

                <StateIdInput
                    label="Rückmelde-State (Ist-Zustand, optional)"
                    tip={"Der State, den das Gerät als tatsächlichen Schaltzustand zurückmeldet.\nGETRENNT vom Befehls-State und vom Gerätestatus!\n\nBeispiel Zigbee-Steckdose:\n• Befehl: zigbee.0.device.state → 'ON'\n• Rückmeldung: zigbee.0.device.state_l (echo)\n\nWird im Dashboard als 'Ist-Zustand' neben dem Soll-Zustand angezeigt."}
                    value={edit.feedbackStateId ?? ''}
                    onChange={v => setEdit(prev => ({ ...prev, feedbackStateId: v || undefined }))}
                    placeholder="z.B. zigbee.0.device.state_l"
                />

                {/* Energie-Tracking */}
                <div style={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 6, padding: 10, marginTop: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#f0b429' }}>⚡ Energie-Tracking (optional)</div>
                    <StateIdInput
                        label="Energie-State (W oder kWh)"
                        tip="State der Watt oder kWh liefert (z.B. tasmota.0.ENERGY_Power). Ohne State wird die Nennleistung × Laufzeit gerechnet."
                        value={edit.energyStateId ?? ''}
                        onChange={v => setEdit(prev => ({ ...prev, energyStateId: v || undefined }))}
                        placeholder="z.B. shelly.0.device.Power (optional)"
                    />
                    {edit.energyStateId && (
                        <div style={{ marginTop: 6 }}>
                            <label style={styles.fieldLabel}>Einheit des Energy-States</label>
                            <select style={styles.select}
                                value={edit.energyStateUnit ?? 'W'}
                                onChange={e => setEdit(prev => ({ ...prev, energyStateUnit: e.target.value as 'W' | 'kWh' }))}>
                                <option value="W">Watt (W) – Momentanleistung</option>
                                <option value="kWh">Kilowattstunden (kWh) – Zählerwert</option>
                            </select>
                        </div>
                    )}
                    <div style={{ marginTop: 6 }}>
                        <label style={styles.fieldLabel}>Nennleistung (W) – Fallback ohne State</label>
                        <input style={styles.input} type="number" min={0} step={1}
                            value={edit.ratedPowerW ?? ''}
                            placeholder="z.B. 600"
                            onChange={e => setEdit(prev => ({ ...prev, ratedPowerW: e.target.value ? +e.target.value : undefined }))} />
                        <span style={{ fontSize: 11, color: '#888' }}>Laufzeit × Nennleistung → Wh/Tag (nur wenn kein Energy-State)</span>
                    </div>
                </div>

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
                            <option value="disable">Deaktivieren</option>
                        </select>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginTop: 4 }}>
                    {edit.circulationMode !== 'windSimulator' && (<div>
                        <label style={styles.fieldLabel}>Min. Einschaltzeit (s)</label>
                        <input style={styles.input} type="number" min={0} value={edit.minimumOnSeconds}
                            onChange={e => setEdit(prev => ({ ...prev, minimumOnSeconds: +e.target.value }))} />
                    </div>)}
                    {edit.circulationMode !== 'windSimulator' && (<div>
                        <label style={styles.fieldLabel}>Min. Ausschaltzeit (s)</label>
                        <input style={styles.input} type="number" min={0} value={edit.minimumOffSeconds}
                            onChange={e => setEdit(prev => ({ ...prev, minimumOffSeconds: +e.target.value }))} />
                    </div>)}
                    <div>
                        <label style={styles.fieldLabel}>Max. Laufzeit (s)</label>
                        <input style={styles.input} type="number" min={0} value={edit.maximumOnSeconds}
                            onChange={e => setEdit(prev => ({ ...prev, maximumOnSeconds: +e.target.value }))} />
                    </div>
                    <div>
                        <FieldLabel tip="Mindestabweichung vom Sollwert bevor dieser Aktor schaltet. Überschreibt die Profil-Toleranz. Einheit: °C (Temp), % (Feuchte), kPa (VPD). 0 = Profil-Toleranz nutzen.">Schaltschwelle</FieldLabel>
                        <input style={styles.input} type="number" min={0} step={0.1} value={edit.actuatorHysteresis ?? 0}
                            onChange={e => setEdit(prev => ({ ...prev, actuatorHysteresis: +e.target.value || undefined }))} />
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

                {edit.shared && (
                    <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(25,118,210,0.06)', borderRadius: 6, border: '1px solid #bbdefb' }}>
                        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: '#1976d2' }}>Abstimmungs-Einstellungen (Geteilt)</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <div>
                                <label style={styles.fieldLabel}>Abstimmungsmodus</label>
                                <select style={styles.select}
                                    value={edit.sharedVotingMode ?? 'any'}
                                    onChange={e => setEdit(prev => ({ ...prev, sharedVotingMode: e.target.value as 'any' | 'majority' | 'primary' }))}>
                                    <option value="any">Beliebige Gruppe (OR)</option>
                                    <option value="majority">Gewichtete Mehrheit</option>
                                    <option value="primary">Eigentümer entscheidet</option>
                                </select>
                            </div>
                            <div>
                                <label style={styles.fieldLabel}>Hysterese (s)</label>
                                <input style={styles.input} type="number" min={0} max={600}
                                    value={edit.sharedVoteHysteresisSeconds ?? 60}
                                    onChange={e => setEdit(prev => ({ ...prev, sharedVoteHysteresisSeconds: +e.target.value }))} />
                            </div>
                        </div>

                        <div style={{ marginTop: 10 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                <span style={{ fontWeight: 600, fontSize: 12 }}>Teilnehmer-Gruppen</span>
                                <span title={
`EINFLUSS-% UND ABSTIMMUNGSMODI

Der Einfluss-% ist das Stimmgewicht der Teilnehmer-Gruppe.
Er wirkt NUR im Modus "Mehrheit" – in allen anderen Modi wird er ignoriert.

─── MODI IM ÜBERBLICK ───────────────────────────────

  Beliebige Gruppe (OR)
  → Aktor geht AN sobald EINE Gruppe EIN will.
  → Einfluss-% wird ignoriert.
  → Empfohlen für geteilte Lüfter, Befeuchter o.ä.:
    Jede Gruppe regelt nach ihrem eigenen Sollwert,
    der Aktor läuft wenn irgendwer ihn braucht.

  Mehrheit
  → Aktor geht AN wenn EIN-Gewichte > 50% aller Gewichte.
  → Einfluss-% bestimmt wie viel die Gruppe zählt.
  → Achtung: Mit max. 100% Einfluss kann eine Teilnehmer-
    Gruppe den Eigentümer NICHT alleine überstimmen.
    (100/(100+100) = 50% → nicht > 50% → bleibt AUS)
  → Sinnvoll wenn der Aktor nur bei Einigkeit laufen soll.

  Eigentümer entscheidet
  → Nur die Eigentümer-Gruppe steuert den Aktor.
  → Teilnehmer sehen den Status, beeinflussen ihn nicht.

─── DEIN FALL: ZWEI GRUPPEN MIT VERSCHIEDENEN SOLLWERTEN ──

  Beispiel: Wuchs (VPD 0.8–1.2) + Blüte (VPD 1.0–1.3)
  Richtiger Modus: "Beliebige Gruppe (OR)"
  → Wuchs VPD=1.25 → will EIN → Lüfter läuft ✓
  → Blüte VPD=1.15 → will EIN → Lüfter läuft ✓
  → Beide unter Sollwert → beide wollen AUS → Lüfter aus ✓
  Jede Gruppe behält ihren eigenen Sollwert im Dashboard.`
                                } style={{ cursor: 'help', fontSize: 13, color: '#1976d2', userSelect: 'none' }}>ⓘ</span>
                            </div>
                            {(edit.sharedParticipants ?? []).map((p, idx) => {
                                const availableGroups = allGroups.filter(g => g.id !== ownerGroupId);
                                return (
                                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                        <select style={{ ...styles.select, flex: 1, marginTop: 0 }}
                                            value={p.groupId}
                                            onChange={e => setEdit(prev => {
                                                const parts = [...(prev.sharedParticipants ?? [])];
                                                parts[idx] = { ...parts[idx], groupId: e.target.value };
                                                return { ...prev, sharedParticipants: parts };
                                            })}>
                                            <option value="">– Gruppe wählen –</option>
                                            {availableGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                                        </select>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <input type="number" min={0} max={100}
                                                style={{ ...styles.input, width: 64, marginTop: 0 }}
                                                value={p.influenceFactor}
                                                onChange={e => setEdit(prev => {
                                                    const parts = [...(prev.sharedParticipants ?? [])];
                                                    parts[idx] = { ...parts[idx], influenceFactor: +e.target.value };
                                                    return { ...prev, sharedParticipants: parts };
                                                })} />
                                            <span style={{ fontSize: 12, color: '#555' }}>%</span>
                                        </div>
                                        <button style={{ ...styles.btnSecondary, padding: '2px 8px', fontSize: 12 }}
                                            onClick={() => setEdit(prev => ({
                                                ...prev,
                                                sharedParticipants: (prev.sharedParticipants ?? []).filter((_, i) => i !== idx),
                                            }))}>✕</button>
                                    </div>
                                );
                            })}
                            <button style={{ ...styles.btnSecondary, fontSize: 12, marginTop: 4 }}
                                onClick={() => {
                                    const newParticipant: SharedParticipant = { groupId: '', influenceFactor: 100 };
                                    setEdit(prev => ({
                                        ...prev,
                                        sharedParticipants: [...(prev.sharedParticipants ?? []), newParticipant],
                                    }));
                                }}>+ Teilnehmer hinzufügen</button>
                        </div>
                    </div>
                )}

                <hr style={{ margin: '14px 0', borderColor: '#e0e0e0' }} />

                <StateIdInput
                    label="Gerätestatus (Erreichbarkeit)"
                    tip={"Prüft ob das Gerät erreichbar ist – NICHT ob es gerade an/aus ist.\nBeispiele:\n• alive (bool) → true = erreichbar\n• available (bool) → true = erreichbar\n• link_quality (Zahl) → ≥ Mindestwert = erreichbar\n\nFür Leistungsmessung stattdessen 'Power-State' verwenden."}
                    value={edit.healthStateId ?? ''}
                    onChange={v => setEdit(prev => ({ ...prev, healthStateId: v || undefined }))}
                    placeholder="z.B. sonoff.0.device.alive"
                />

                {edit.healthStateId && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
                        <div>
                            <label style={styles.fieldLabel}>Typ des Status-Werts</label>
                            <select style={styles.select}
                                value={edit.healthCheckType ?? 'boolean'}
                                onChange={e => setEdit(prev => ({ ...prev, healthCheckType: e.target.value as 'boolean' | 'number' }))}>
                                <option value="boolean">Boolean (true = ok)</option>
                                <option value="number">Zahl (≥ Mindestwert = ok)</option>
                            </select>
                        </div>
                        {(edit.healthCheckType ?? 'boolean') === 'number' && (
                            <div>
                                <label style={styles.fieldLabel}>Mindestwert (z.B. 0.1 für ENERGY_Power)</label>
                                <input style={styles.input} type="number" min={0} step="0.1"
                                    value={edit.healthCheckMin ?? 1}
                                    onChange={e => setEdit(prev => ({ ...prev, healthCheckMin: +e.target.value }))} />
                            </div>
                        )}
                    </div>
                )}

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

type GroupEditorTab = 'basis' | 'sensoren' | 'aktoren' | 'bewaesserung' | 'kamera';

interface GroupEditorProps {
    group: GroupConfig | null;
    profiles: ClimateProfile[];
    allGroups: GroupConfig[];
    onSave: (g: GroupConfig) => void;
    onCancel: () => void;
}

const GroupEditor: React.FC<GroupEditorProps> = ({ group, profiles, allGroups, onSave, onCancel }) => {
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
                <button style={tabStyle('kamera')} onClick={() => setTab('kamera')}>
                    Kamera ({edit.cameras.length})
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
                        <div>
                            <label style={styles.fieldLabel}>Sensor-Abweichungsalarm (°C)</label>
                            <input style={styles.input} type="number" min={1} value={edit.sensorDisagreementThreshold ?? 5}
                                onChange={e => setEdit(prev => ({ ...prev, sensorDisagreementThreshold: +e.target.value }))} />
                        </div>
                    </div>

                    {/* Außenluft-Vergleichssensor */}
                    <hr style={{ margin: '16px 0', borderColor: '#e0e0e0' }} />
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>Außenluft-Vergleichssensor</span>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                            <input type="checkbox"
                                checked={edit.outdoorSensor?.enabled ?? false}
                                onChange={e => setEdit(prev => ({
                                    ...prev,
                                    outdoorSensor: { ...(prev.outdoorSensor ?? defaultOutdoorSensor()), enabled: e.target.checked },
                                }))} />
                            Aktiv
                        </label>
                    </div>
                    {edit.outdoorSensor?.enabled ? (
                        <div>
                            <p style={{ fontSize: 12, color: '#666', marginBottom: 10 }}>
                                Schaltet Abluft/Zuluft-Lüfter (mit aktiviertem Außenluft-Guard) nur dann, wenn die Außenluft günstiger als die Innenluft ist.
                            </p>
                            <StateIdInput
                                label="Außentemperatur State-ID"
                                value={edit.outdoorSensor.tempStateId ?? ''}
                                onChange={v => setEdit(prev => ({ ...prev, outdoorSensor: { ...(prev.outdoorSensor ?? defaultOutdoorSensor()), tempStateId: v } }))}
                                placeholder="z.B. hm-rpc.0.NEQ1234.1.TEMPERATURE"
                                typeFilter="temperature"
                            />
                            <StateIdInput
                                label="Außenfeuchte State-ID (optional)"
                                value={edit.outdoorSensor.humidityStateId ?? ''}
                                onChange={v => setEdit(prev => ({ ...prev, outdoorSensor: { ...(prev.outdoorSensor ?? defaultOutdoorSensor()), humidityStateId: v } }))}
                                placeholder="z.B. hm-rpc.0.NEQ1234.1.HUMIDITY"
                                typeFilter="humidity"
                            />
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                <div>
                                    <label style={styles.fieldLabel}>Min. Temp-Vorteil Außen (°C)</label>
                                    <input style={styles.input} type="number" step="0.5" min={0}
                                        value={edit.outdoorSensor.minTempDeltaCelsius ?? 2}
                                        title="Außen muss mindestens X°C kühler sein als Innen, sonst kein Lüften"
                                        onChange={e => setEdit(prev => ({ ...prev, outdoorSensor: { ...(prev.outdoorSensor ?? defaultOutdoorSensor()), minTempDeltaCelsius: +e.target.value } }))} />
                                </div>
                                <div>
                                    <label style={styles.fieldLabel}>Max. Feuchte-Nachteil Außen (%)</label>
                                    <input style={styles.input} type="number" step="1" min={0}
                                        value={edit.outdoorSensor.maxHumidityDeltaPercent ?? 10}
                                        title="Außen darf maximal X% feuchter sein als Innen, sonst kein Feuchte-Lüften"
                                        onChange={e => setEdit(prev => ({ ...prev, outdoorSensor: { ...(prev.outdoorSensor ?? defaultOutdoorSensor()), maxHumidityDeltaPercent: +e.target.value } }))} />
                                </div>
                            </div>
                        </div>
                    ) : (
                        <p style={{ fontSize: 12, color: '#aaa', fontStyle: 'italic' }}>
                            Kein Außensensor – Lüfter schalten ohne Außenluft-Vergleich.
                        </p>
                    )}
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

                    {/* Geteilte Aktoren aus anderen Gruppen (Teilnehmer-Sicht) */}
                    {(() => {
                        const sharedFromOthers = allGroups
                            .filter(g => g.id !== edit.id)
                            .flatMap(g => g.actuators
                                .filter(a => a.enabled && a.shared && (a.sharedParticipants ?? []).some(p => p.groupId === edit.id))
                                .map(a => ({
                                    actuator: a,
                                    group: g,
                                    influenceFactor: (a.sharedParticipants ?? []).find(p => p.groupId === edit.id)?.influenceFactor ?? 0,
                                }))
                            );
                        if (sharedFromOthers.length === 0) return null;
                        return (
                            <div style={{ marginTop: 16, padding: '10px 14px', background: '#f0f4ff', borderRadius: 8, border: '1px solid #c5cae9' }}>
                                <div style={{ fontWeight: 600, fontSize: 13, color: '#3949ab', marginBottom: 8 }}>
                                    ⇄ Geteilte Aktoren (aus anderen Gruppen)
                                </div>
                                <div style={{ fontSize: 12, color: '#555', marginBottom: 8 }}>
                                    Diese Aktoren werden von anderen Gruppen verwaltet. Diese Gruppe beeinflusst die Abstimmung mit dem konfigurierten Einfluss-Faktor.
                                </div>
                                {sharedFromOthers.map(({ actuator: a, group: og, influenceFactor: inf }) => (
                                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid #e8eaf6' }}>
                                        <span style={{ flex: 1 }}>
                                            <span style={{ fontWeight: 600 }}>{a.name}</span>
                                            <span style={{ fontSize: 12, color: '#666', marginLeft: 8 }}>{a.type} · {a.sharedVotingMode ?? 'any'}</span>
                                        </span>
                                        <span style={{ fontSize: 12, background: '#e8eaf6', color: '#3949ab', borderRadius: 4, padding: '2px 8px' }}>
                                            aus: {og.name}
                                        </span>
                                        <span style={{ fontSize: 12, background: '#e3f2fd', color: '#1565c0', borderRadius: 4, padding: '2px 8px' }}>
                                            Einfluss: {inf}%
                                        </span>
                                    </div>
                                ))}
                            </div>
                        );
                    })()}

                    {editingActuator !== null && (
                        <ActuatorEditor
                            actuator={editingActuator === 'new' ? null : editingActuator}
                            allGroups={allGroups}
                            ownerGroupId={edit.id}
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

            {/* ---- TAB: Kamera ---- */}
            {tab === 'kamera' && (
                <div>
                    <p style={{ color: '#555', fontSize: 13, marginTop: 0 }}>
                        Snapshot-URL konfigurieren. Das Dashboard zeigt ein 128×128 Vorschaubild; beim Hover wird es vergrößert.
                        Für KI-Analyse (Plant.id) den API-Key in den globalen Einstellungen hinterlegen.
                    </p>
                    <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#666', fontSize: 13 }}>
                            {edit.cameras.length === 0
                                ? 'Keine Kamera konfiguriert.'
                                : `${edit.cameras.length} Kamera(s)`}
                        </span>
                        <button style={styles.btnPrimary} onClick={() => {
                            const newCam: import('./types').CameraConfig = {
                                id: `cam_${Date.now()}`, name: 'Kamera 1', enabled: true,
                                sourceType: 'snapshotUrl', sourceId: '',
                                captureIntervalMinutes: 5, captureOnlyWhenLightOn: false,
                                delayAfterLightOnMinutes: 0, retentionDays: 7,
                                maxStorageMB: 500, analysisMode: 'externalAI',
                                aiAnalysisIntervalHours: 24, minimumConfidence: 0.7, cpuLimitPercent: 50,
                            };
                            setEdit(prev => ({ ...prev, cameras: [...prev.cameras, newCam] }));
                        }}>+ Kamera</button>
                    </div>
                    {edit.cameras.map((cam, idx) => (
                        <div key={cam.id} style={{ ...styles.listRow, flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontWeight: 600, fontSize: 14 }}>{cam.name}</span>
                                <button style={{ ...styles.btnSecondary, color: '#d32f2f' }}
                                    onClick={() => setEdit(prev => ({ ...prev, cameras: prev.cameras.filter((_, i) => i !== idx) }))}>
                                    ✕ Entfernen
                                </button>
                            </div>
                            <label style={styles.fieldLabel}>Name</label>
                            <input style={styles.input} value={cam.name}
                                onChange={e => setEdit(prev => ({ ...prev, cameras: prev.cameras.map((c, i) => i === idx ? { ...c, name: e.target.value } : c) }))} />
                            <label style={styles.fieldLabel}>Snapshot-URL (http://...)</label>
                            <input style={styles.input} type="url" placeholder="http://192.168.1.x:port/snapshot.jpg" value={cam.sourceId}
                                onChange={e => setEdit(prev => ({ ...prev, cameras: prev.cameras.map((c, i) => i === idx ? { ...c, sourceId: e.target.value, sourceType: 'snapshotUrl' } : c) }))} />
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                                <input type="checkbox" checked={cam.enabled}
                                    onChange={e => setEdit(prev => ({ ...prev, cameras: prev.cameras.map((c, i) => i === idx ? { ...c, enabled: e.target.checked } : c) }))} />
                                Kamera aktiv
                            </label>
                        </div>
                    ))}
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

interface ObjEntry {
    id: string;
    name: string;
    type: string;
    role: string;
    unit: string;
    rooms: string[];
    funcs: string[];
}

type EnumMap = Record<string, string[]>; // stateId → [label, ...]

function emitSocket(event: string, ...args: unknown[]): Promise<unknown> {
    return new Promise(resolve => {
        type Sock = Record<string, unknown> & { emit: (...a: unknown[]) => void };
        const w = window as Window & { _growSocket?: Sock; socket?: Sock };
        const sock = w._growSocket ?? w.socket;
        if (!sock) { resolve(null); return; }
        const cb = (_err: unknown, res: unknown) => resolve(res);
        // ioBroker admin v6 sometimes wraps methods directly (sock.getState, sock.getObjectView …)
        // instead of routing through sock.emit. Try the direct method first.
        if (typeof sock[event] === 'function') {
            (sock[event] as (...a: unknown[]) => void)(...args, cb);
            return;
        }
        sock.emit(event, ...args, cb as never);
    });
}

function getName(raw: unknown): string {
    if (typeof raw === 'string') return raw;
    if (raw && typeof raw === 'object') {
        const o = raw as Record<string, string>;
        return o.de ?? o.en ?? Object.values(o)[0] ?? '';
    }
    return '';
}

async function loadAllObjects(): Promise<{ entries: ObjEntry[]; rooms: EnumMap; funcs: EnumMap; names: Record<string, string> }> {
    type Row = { id: string; value: { common?: Record<string, unknown>; members?: string[] } };
    type ViewRes = { rows?: Row[] } | null;

    const [stateRes, enumRes, channelRes, deviceRes, folderRes] = await Promise.all([
        emitSocket('getObjectView', 'system', 'state',   { startkey: '', endkey: '香' }) as Promise<ViewRes>,
        emitSocket('getObjectView', 'system', 'enum',    { startkey: 'enum.', endkey: 'enum.香' }) as Promise<ViewRes>,
        emitSocket('getObjectView', 'system', 'channel', { startkey: '', endkey: '香' }) as Promise<ViewRes>,
        emitSocket('getObjectView', 'system', 'device',  { startkey: '', endkey: '香' }) as Promise<ViewRes>,
        emitSocket('getObjectView', 'system', 'folder',  { startkey: '', endkey: '香' }) as Promise<ViewRes>,
    ]);

    const stateRows   = stateRes?.rows   ?? [];
    const enumRows    = enumRes?.rows    ?? [];
    const channelRows = channelRes?.rows ?? [];
    const deviceRows  = deviceRes?.rows  ?? [];
    const folderRows  = folderRes?.rows  ?? [];

    // Name-Map: id → friendly name (für channel/device/folder-Header)
    const names: Record<string, string> = {};
    for (const r of [...channelRows, ...deviceRows, ...folderRows]) {
        const n = getName(r.value?.common?.name);
        if (n) names[r.id] = n;
    }

    const rooms: EnumMap = {};
    const funcs: EnumMap = {};
    for (const r of enumRows) {
        const members = (r.value?.common?.members ?? []) as string[];
        const label = getName(r.value?.common?.name);
        const target = r.id.startsWith('enum.rooms') ? rooms : r.id.startsWith('enum.functions') ? funcs : null;
        if (!target) continue;
        for (const m of members) {
            if (!target[m]) target[m] = [];
            target[m].push(label);
        }
    }

    const entries: ObjEntry[] = stateRows.map(r => ({
        id: r.id,
        name: getName(r.value?.common?.name),
        type: (r.value?.common?.type as string) ?? '',
        role: (r.value?.common?.role as string) ?? '',
        unit: (r.value?.common?.unit as string) ?? '',
        rooms: rooms[r.id] ?? [],
        funcs: funcs[r.id] ?? [],
    }));

    return { entries, rooms, funcs, names };
}

const TYPE_TABS = [
    { key: '', label: 'Alle' },
    { key: 'temperature', label: 'Temperatur' },
    { key: 'humidity', label: 'Feuchte' },
    { key: 'boolean', label: 'Schalter' },
    { key: 'number', label: 'Zahl' },
];

function matchesTab(e: ObjEntry, tab: string): boolean {
    if (!tab) return true;
    if (tab === 'boolean') return e.type === 'boolean';
    if (tab === 'number') return e.type === 'number';
    if (tab === 'temperature') return e.role.includes('temperature') || e.unit === '°C';
    if (tab === 'humidity') return e.role.includes('humidity') || e.unit === '%';
    return true;
}

function matchesSearch(e: ObjEntry, q: string): boolean {
    if (!q) return true;
    const lq = q.toLowerCase();
    return e.id.toLowerCase().includes(lq) || e.name.toLowerCase().includes(lq) ||
        e.role.toLowerCase().includes(lq) || e.rooms.some(r => r.toLowerCase().includes(lq)) ||
        e.funcs.some(f => f.toLowerCase().includes(lq));
}

interface ObjectPickerProps {
    onSelect: (id: string) => void;
    onClose: () => void;
    typeFilter?: string;
}

const ObjectPicker: React.FC<ObjectPickerProps> = ({ onSelect, onClose, typeFilter }) => {
    const [allEntries, setAllEntries] = React.useState<ObjEntry[]>([]);
    const [names, setNames] = React.useState<Record<string, string>>({});
    const [search, setSearch] = React.useState('');
    const [tab, setTab] = React.useState(typeFilter ?? '');
    const [loading, setLoading] = React.useState(true);
    // collapsed keys: "inst" for L1, "inst\x00sub" for L2
    const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});

    React.useEffect(() => {
        loadAllObjects().then(({ entries, names: n }) => {
            setAllEntries(entries);
            setNames(n);
            setLoading(false);
        });
    }, []);

    // Build 2-level tree: instance (adapter.N) → subfolder (3rd segment) → entries
    // e.g. "0_userdata.0" → { "Macros": [...], "variables": [...] }
    //      "hm-rpc.0"     → { "NEQ123456": [...], "MEQ789": [...] }
    const tree = React.useMemo(() => {
        const filtered = allEntries.filter(e => matchesTab(e, tab) && matchesSearch(e, search));
        // Map: instanceKey → subfolderKey → entries[]
        const map: Record<string, Record<string, ObjEntry[]>> = {};
        for (const e of filtered) {
            const parts = e.id.split('.');
            // L1: adapter.instance (first 2 segments, or just first if only 1 exists)
            const inst = parts.length >= 2 ? `${parts[0]}.${parts[1]}` : parts[0];
            // L2: 3rd segment as subfolder (or '' if none)
            const sub = parts.length >= 3 ? parts[2] : '';
            if (!map[inst]) map[inst] = {};
            if (!map[inst][sub]) map[inst][sub] = [];
            map[inst][sub].push(e);
        }
        return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
    }, [allEntries, tab, search]);

    const totalVisible = React.useMemo(
        () => tree.reduce((s, [, subs]) => s + Object.values(subs).reduce((ss, es) => ss + es.length, 0), 0),
        [tree]
    );

    // Auto-expand all when search is active
    React.useEffect(() => {
        if (search) {
            const expanded: Record<string, boolean> = {};
            for (const [inst, subs] of tree) {
                expanded[inst] = false;
                for (const sub of Object.keys(subs)) {
                    if (sub) expanded[`${inst}\x00${sub}`] = false;
                }
            }
            setCollapsed(expanded);
        }
    }, [search, tree]);

    const toggle = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));
    const isOpen = (key: string) => collapsed[key] === false || !!search;

    const thStyle: React.CSSProperties = {
        padding: '4px 8px', textAlign: 'left', fontSize: 11, fontWeight: 600,
        color: '#555', borderBottom: '1px solid #e0e0e0', background: '#fafafa',
        whiteSpace: 'nowrap',
    };
    const tdStyle: React.CSSProperties = { padding: '4px 8px', fontSize: 12, verticalAlign: 'top' };

    const renderTable = (entries: ObjEntry[], indent = 0) => (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
                <tr>
                    <th style={{ ...thStyle, paddingLeft: 8 + indent }}>ID</th>
                    <th style={thStyle}>Name</th>
                    <th style={thStyle}>Rolle</th>
                    <th style={thStyle}>Typ</th>
                    <th style={thStyle}>Raum</th>
                    <th style={thStyle}>Funktion</th>
                </tr>
            </thead>
            <tbody>
                {entries.slice(0, 300).map(r => (
                    <tr
                        key={r.id}
                        style={{ cursor: 'pointer', borderBottom: '1px solid #f5f5f5' }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#e8f5e9')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}
                        onClick={() => { onSelect(r.id); onClose(); }}
                    >
                        <td style={{ ...tdStyle, paddingLeft: 8 + indent, fontFamily: 'monospace', fontSize: 11, color: '#1565c0', maxWidth: 300, wordBreak: 'break-all' }}>{r.id}</td>
                        <td style={{ ...tdStyle, maxWidth: 140 }}>{r.name}</td>
                        <td style={{ ...tdStyle, color: '#555', whiteSpace: 'nowrap' }}>{r.role}</td>
                        <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                            <span style={{
                                padding: '1px 6px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                                background: r.type === 'boolean' ? '#fff3e0' : r.type === 'number' ? '#e3f2fd' : '#f3e5f5',
                                color: r.type === 'boolean' ? '#e65100' : r.type === 'number' ? '#0d47a1' : '#6a1b9a',
                            }}>{r.type}{r.unit ? ` (${r.unit})` : ''}</span>
                        </td>
                        <td style={{ ...tdStyle, color: '#2e7d32', fontSize: 11 }}>{r.rooms.join(', ')}</td>
                        <td style={{ ...tdStyle, color: '#1565c0', fontSize: 11 }}>{r.funcs.join(', ')}</td>
                    </tr>
                ))}
                {entries.length > 300 && (
                    <tr><td colSpan={6} style={{ padding: '5px 8px', fontSize: 11, color: '#888' }}>… und {entries.length - 300} weitere – Suche verfeinern</td></tr>
                )}
            </tbody>
        </table>
    );

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: '#fff', borderRadius: 8, width: '90vw', maxWidth: 1000, height: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,0.3)' }}>
                {/* Header */}
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #e0e0e0', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>Objekt-ID auswählen</span>
                    <input
                        style={{ ...styles.input, flex: 1, marginBottom: 0 }}
                        autoFocus
                        placeholder="Suche nach ID, Name, Raum, Funktion, Rolle…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                    <button style={{ border: 'none', background: 'none', fontSize: 22, cursor: 'pointer', color: '#666' }} onClick={onClose}>×</button>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', gap: 4, padding: '8px 16px', borderBottom: '1px solid #e0e0e0', background: '#fafafa' }}>
                    {TYPE_TABS.map(t => (
                        <button
                            key={t.key}
                            onClick={() => setTab(t.key)}
                            style={{
                                padding: '4px 12px', borderRadius: 16, border: '1px solid',
                                fontSize: 12, cursor: 'pointer',
                                borderColor: tab === t.key ? '#2e7d32' : '#ccc',
                                background: tab === t.key ? '#2e7d32' : '#fff',
                                color: tab === t.key ? '#fff' : '#333',
                            }}
                        >{t.label}</button>
                    ))}
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: '#888', alignSelf: 'center' }}>
                        {loading ? 'Lade…' : `${totalVisible} von ${allEntries.length} Datenpunkten`}
                    </span>
                </div>

                {/* Tree content */}
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {loading ? (
                        <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>Datenpunkte werden geladen…</div>
                    ) : tree.length === 0 ? (
                        <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>Keine Datenpunkte gefunden.</div>
                    ) : tree.map(([inst, subs]) => {
                        const l1Open = isOpen(inst);
                        const subEntries = Object.entries(subs).sort(([a], [b]) => a.localeCompare(b));
                        const totalInst = subEntries.reduce((s, [, es]) => s + es.length, 0);
                        // If only one subgroup with key '' → no subfolders, show table directly
                        const flatOnly = subEntries.length === 1 && subEntries[0][0] === '';

                        return (
                            <div key={inst}>
                                {/* L1: adapter.instance header */}
                                <div
                                    onClick={() => toggle(inst)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 8,
                                        padding: '7px 16px', cursor: 'pointer',
                                        background: '#f0f4f8', borderBottom: '1px solid #dde3ea',
                                        position: 'sticky', top: 0, zIndex: 2,
                                        userSelect: 'none',
                                    }}
                                    onMouseEnter={e => (e.currentTarget.style.background = '#e4ecf4')}
                                    onMouseLeave={e => (e.currentTarget.style.background = '#f0f4f8')}
                                >
                                    <span style={{ fontSize: 11, color: '#555', width: 14 }}>{l1Open ? '▼' : '▶'}</span>
                                    <span style={{ fontWeight: 700, fontSize: 13, fontFamily: 'monospace', color: '#1565c0' }}>{inst}</span>
                                    {names[inst] && <span style={{ fontSize: 12, color: '#455a64', marginLeft: 2 }}>– {names[inst]}</span>}
                                    <span style={{ fontSize: 11, color: '#aaa', marginLeft: 'auto' }}>{totalInst} Einträge</span>
                                </div>

                                {l1Open && flatOnly && renderTable(subEntries[0][1], 16)}

                                {l1Open && !flatOnly && subEntries.map(([sub, entries]) => {
                                    if (sub === '') {
                                        // Entries directly on instance level (no subfolder)
                                        return renderTable(entries, 16);
                                    }
                                    const l2Key = `${inst}\x00${sub}`;
                                    const l2Open = isOpen(l2Key);
                                    return (
                                        <div key={sub}>
                                            {/* L2: subfolder header */}
                                            <div
                                                onClick={() => toggle(l2Key)}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: 8,
                                                    padding: '5px 16px 5px 32px', cursor: 'pointer',
                                                    background: '#fafafa', borderBottom: '1px solid #eee',
                                                    position: 'sticky', top: 35, zIndex: 1,
                                                    userSelect: 'none',
                                                }}
                                                onMouseEnter={e => (e.currentTarget.style.background = '#f0f0f0')}
                                                onMouseLeave={e => (e.currentTarget.style.background = '#fafafa')}
                                            >
                                                <span style={{ fontSize: 10, color: '#999', width: 12 }}>{l2Open ? '▼' : '▶'}</span>
                                                <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#37474f' }}>{inst}.<strong style={{ color: '#2e7d32' }}>{sub}</strong></span>
                                                {names[`${inst}.${sub}`] && <span style={{ fontSize: 11, color: '#546e7a' }}>– {names[`${inst}.${sub}`]}</span>}
                                                <span style={{ fontSize: 10, color: '#bbb', marginLeft: 'auto' }}>{entries.length}</span>
                                            </div>
                                            {l2Open && renderTable(entries, 32)}
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>

                {/* Footer */}
                <div style={{ padding: '10px 16px', borderTop: '1px solid #e0e0e0', display: 'flex', justifyContent: 'flex-end' }}>
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
    tip?: string;
}

const StateIdInput: React.FC<StateIdInputProps> = ({ value, onChange, label, placeholder, typeFilter, tip }) => {
    const [pickerOpen, setPickerOpen] = React.useState(false);

    return (
        <div>
            <FieldLabel tip={tip}>{label}</FieldLabel>
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
    // Optionale Felder bleiben undefined bis explizit gesetzt
});

const defaultProfile = (): ClimateProfile => ({
    id: `profile-${Date.now()}`,
    name: 'Neues Profil',
    phase: 'growth',
    transitionMinutes: 30,
    day: defaultSetpoint(),
    night: { ...defaultSetpoint(), temperature: 20, humidity: 55 },
});

// ---- Klimaprofil-Presets ----------------------------------------

interface ClimatePreset {
    label: string;
    description: string;
    color: string;
    day: Partial<ClimateSetpoint>;
    night: Partial<ClimateSetpoint>;
}

const CLIMATE_PRESETS: ClimatePreset[] = [
    {
        label: 'Keimling', description: 'Hohe Feuchte, moderate Wärme, niedrige VPD', color: '#66bb6a',
        day:   { temperature: 25, temperatureTolerance: 1, temperatureMin: 22, temperatureMax: 28, temperatureCritical: 32, humidity: 75, humidityTolerance: 5, humidityMin: 65, humidityMax: 85, humidityCritical: 90, condensationRiskMaxHumidity: 88, vpdMin: 0.3, vpdMax: 0.6 },
        night: { temperature: 22, temperatureTolerance: 1, temperatureMin: 20, temperatureMax: 26, temperatureCritical: 30, humidity: 70, humidityTolerance: 5, humidityMin: 60, humidityMax: 80, humidityCritical: 88, condensationRiskMaxHumidity: 85, vpdMin: 0.3, vpdMax: 0.6 },
    },
    {
        label: 'Wachstum (Veg)', description: 'Optimale Bedingungen für Blattmasse', color: '#26a69a',
        day:   { temperature: 24, temperatureTolerance: 1.5, temperatureMin: 20, temperatureMax: 28, temperatureCritical: 33, humidity: 65, humidityTolerance: 5, humidityMin: 50, humidityMax: 75, humidityCritical: 85, condensationRiskMaxHumidity: 80, vpdMin: 0.8, vpdMax: 1.2 },
        night: { temperature: 20, temperatureTolerance: 1.5, temperatureMin: 17, temperatureMax: 24, temperatureCritical: 30, humidity: 60, humidityTolerance: 5, humidityMin: 45, humidityMax: 70, humidityCritical: 82, condensationRiskMaxHumidity: 78, vpdMin: 0.7, vpdMax: 1.1 },
    },
    {
        label: 'Blüte (früh)', description: '1.–4. Blütewoche, etwas weniger Feuchte', color: '#ffa726',
        day:   { temperature: 25, temperatureTolerance: 1, temperatureMin: 20, temperatureMax: 28, temperatureCritical: 32, humidity: 55, humidityTolerance: 5, humidityMin: 40, humidityMax: 65, humidityCritical: 75, condensationRiskMaxHumidity: 72, vpdMin: 1.0, vpdMax: 1.5 },
        night: { temperature: 20, temperatureTolerance: 1, temperatureMin: 17, temperatureMax: 24, temperatureCritical: 29, humidity: 50, humidityTolerance: 5, humidityMin: 38, humidityMax: 60, humidityCritical: 72, condensationRiskMaxHumidity: 70, vpdMin: 0.9, vpdMax: 1.3 },
    },
    {
        label: 'Blüte (spät)', description: '5.+ Woche, niedrige Feuchte gegen Schimmel', color: '#ef5350',
        day:   { temperature: 24, temperatureTolerance: 1, temperatureMin: 19, temperatureMax: 27, temperatureCritical: 31, humidity: 42, humidityTolerance: 4, humidityMin: 30, humidityMax: 52, humidityCritical: 60, condensationRiskMaxHumidity: 58, vpdMin: 1.2, vpdMax: 1.7 },
        night: { temperature: 19, temperatureTolerance: 1, temperatureMin: 16, temperatureMax: 23, temperatureCritical: 28, humidity: 38, humidityTolerance: 4, humidityMin: 28, humidityMax: 48, humidityCritical: 58, condensationRiskMaxHumidity: 55, vpdMin: 1.1, vpdMax: 1.5 },
    },
    {
        label: 'Trocknung', description: 'Langsam trocknen, kühle Temperatur', color: '#8d6e63',
        day:   { temperature: 18, temperatureTolerance: 1, temperatureMin: 15, temperatureMax: 22, temperatureCritical: 26, humidity: 50, humidityTolerance: 4, humidityMin: 40, humidityMax: 58, humidityCritical: 65, condensationRiskMaxHumidity: 62, vpdMin: 0.8, vpdMax: 1.2 },
        night: { temperature: 16, temperatureTolerance: 1, temperatureMin: 13, temperatureMax: 20, temperatureCritical: 24, humidity: 48, humidityTolerance: 4, humidityMin: 38, humidityMax: 56, humidityCritical: 62, condensationRiskMaxHumidity: 60, vpdMin: 0.7, vpdMax: 1.1 },
    },
    {
        label: 'Gemüse (Tomate)', description: 'Warm und feucht, hohe CO₂', color: '#d32f2f',
        day:   { temperature: 26, temperatureTolerance: 1.5, temperatureMin: 20, temperatureMax: 30, temperatureCritical: 35, humidity: 65, humidityTolerance: 5, humidityMin: 50, humidityMax: 75, humidityCritical: 85, condensationRiskMaxHumidity: 80, vpdMin: 0.8, vpdMax: 1.3, co2Target: 1000, co2Tolerance: 150 },
        night: { temperature: 18, temperatureTolerance: 1.5, temperatureMin: 15, temperatureMax: 24, temperatureCritical: 30, humidity: 60, humidityTolerance: 5, humidityMin: 45, humidityMax: 70, humidityCritical: 82, condensationRiskMaxHumidity: 78, vpdMin: 0.7, vpdMax: 1.1 },
    },
    {
        label: 'Salat / Kräuter', description: 'Kühl, feucht, niedrige Belastung', color: '#43a047',
        day:   { temperature: 20, temperatureTolerance: 2, temperatureMin: 15, temperatureMax: 25, temperatureCritical: 30, humidity: 70, humidityTolerance: 5, humidityMin: 55, humidityMax: 80, humidityCritical: 88, condensationRiskMaxHumidity: 85, vpdMin: 0.5, vpdMax: 0.9 },
        night: { temperature: 16, temperatureTolerance: 2, temperatureMin: 12, temperatureMax: 20, temperatureCritical: 25, humidity: 65, humidityTolerance: 5, humidityMin: 50, humidityMax: 75, humidityCritical: 85, condensationRiskMaxHumidity: 82, vpdMin: 0.4, vpdMax: 0.8 },
    },
];

function SetpointForm({ label, sp, onChange, isDay }: { label: string; sp: ClimateSetpoint; onChange: (s: ClimateSetpoint) => void; isDay?: boolean }) {
    const [showPresets, setShowPresets] = React.useState(false);

    const applyPreset = (preset: ClimatePreset) => {
        const partial = isDay === false ? preset.night : preset.day;
        onChange({ ...sp, ...partial });
        setShowPresets(false);
    };

    const n = (key: keyof ClimateSetpoint) => ({
        value: sp[key] ?? '',
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...sp, [key]: e.target.value === '' ? undefined : +e.target.value }),
    });
    const row = (lbl: string, k: keyof ClimateSetpoint, step = 0.1, optional = false) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ width: 220, fontSize: 13, color: optional ? '#888' : 'inherit' }}>{lbl}{optional && ' (opt.)'}</span>
            <input style={{ ...styles.input, width: 80 }} type="number" step={step} placeholder={optional ? '–' : undefined} {...n(k)} />
        </div>
    );

    const section = (title: string, color: string) => (
        <div style={{ fontWeight: 600, fontSize: 12, color, textTransform: 'uppercase', letterSpacing: '0.5px', margin: '10px 0 4px' }}>{title}</div>
    );

    return (
        <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontWeight: 600, color: '#2e7d32' }}>{label}</span>
                <button
                    type="button"
                    onClick={() => setShowPresets(v => !v)}
                    style={{ ...styles.btnSecondary, fontSize: 11, padding: '3px 10px' }}
                >
                    {showPresets ? '▲ Presets schließen' : '▼ Preset laden'}
                </button>
            </div>

            {showPresets && (
                <div style={{ marginBottom: 12, padding: 10, background: '#f8fdf8', border: '1px solid #c8e6c9', borderRadius: 6 }}>
                    <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>
                        Preset überschreibt alle Felder dieses Sollwert-Blocks:
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6 }}>
                        {CLIMATE_PRESETS.map(p => (
                            <button
                                key={p.label}
                                type="button"
                                onClick={() => applyPreset(p)}
                                style={{
                                    textAlign: 'left', padding: '7px 10px', borderRadius: 6, cursor: 'pointer',
                                    border: `2px solid ${p.color}20`, background: `${p.color}12`,
                                    transition: 'all 0.15s',
                                }}
                                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = `${p.color}28`; (e.currentTarget as HTMLButtonElement).style.borderColor = p.color; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = `${p.color}12`; (e.currentTarget as HTMLButtonElement).style.borderColor = `${p.color}20`; }}
                            >
                                <div style={{ fontWeight: 700, fontSize: 12, color: p.color }}>{p.label}</div>
                                <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>{p.description}</div>
                                <div style={{ fontSize: 10, color: '#888', marginTop: 3, fontFamily: 'monospace' }}>
                                    {isDay === false
                                        ? `${p.night.temperature}°C · ${p.night.humidity}% · VPD ${p.night.vpdMin}–${p.night.vpdMax}`
                                        : `${p.day.temperature}°C · ${p.day.humidity}% · VPD ${p.day.vpdMin}–${p.day.vpdMax}`
                                    }
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {section('Temperatur', '#e65100')}
            {row('Ziel-Temperatur (°C)', 'temperature')}
            {row('Toleranz (±°C)', 'temperatureTolerance')}
            {row('Min (°C)', 'temperatureMin')}
            {row('Max (°C)', 'temperatureMax')}
            {row('Kritisch (°C)', 'temperatureCritical')}

            {section('Luftfeuchtigkeit', '#1565c0')}
            {row('Ziel-Feuchte (%)', 'humidity', 1)}
            {row('Toleranz (±%)', 'humidityTolerance', 1)}
            {row('Min (%)', 'humidityMin', 1)}
            {row('Max (%)', 'humidityMax', 1)}
            {row('Kritisch (%)', 'humidityCritical', 1)}
            {row('Kondens.-Schutz max. (%)', 'condensationRiskMaxHumidity', 1)}

            {section('VPD', '#6a1b9a')}
            {row('VPD Min (kPa)', 'vpdMin')}
            {row('VPD Max (kPa)', 'vpdMax')}

            {section('CO₂', '#558b2f')}
            {row('CO₂ Ziel (ppm)', 'co2Target', 50, true)}
            {row('CO₂ Toleranz (ppm)', 'co2Tolerance', 50, true)}

            {section('Bodenfeuchte', '#4527a0')}
            {row('Bodenfeuchte Ziel (%)', 'soilMoistureTarget', 1, true)}
            {row('Bodenfeuchte Toleranz (±%)', 'soilMoistureTolerance', 1, true)}
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
                    <SetpointForm label="☀️ Tag" sp={editing.day} isDay={true}
                        onChange={day => setEditing(prev => prev && ({ ...prev, day }))} />
                    <SetpointForm label="🌙 Nacht" sp={editing.night} isDay={false}
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

            <label style={styles.fieldLabel}>Dashboard-PIN (leer = kein Schutz)</label>
            <input style={styles.input} type="password" placeholder="z.B. 1234"
                value={String(config.dashboardPin ?? '')}
                onChange={e => onChange({ ...config, dashboardPin: e.target.value })} />

            <hr style={{ margin: '24px 0', borderColor: '#e0e0e0' }} />
            <h4 style={{ margin: '0 0 12px' }}>Plant.id – KI-Mangelanalyse</h4>
            <p style={{ fontSize: 12, color: '#666', margin: '0 0 8px' }}>
                API-Key von <strong>plant.id</strong> (kostenlos: 100 Anfragen/Monat).
                Wird im Dashboard für manuelle Pflanzenanalyse verwendet.
            </p>
            <label style={styles.fieldLabel}>Plant.id API-Key</label>
            <input style={styles.input} type="password" placeholder="sk-..."
                value={String(config.plantIdApiKey ?? '')}
                onChange={e => onChange({ ...config, plantIdApiKey: e.target.value })} />

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
                        iobSendTo('growmanager.0', 'exportConfig', {}, (result: unknown) => {
                            const res = result as { json?: string } | null;
                            if (res?.json) {
                                const blob = new Blob([res.json], { type: 'application/json' });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = 'growmanager-config.json';
                                a.click();
                                URL.revokeObjectURL(url);
                            } else {
                                alert('Export fehlgeschlagen – Adapter läuft?');
                            }
                        });
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
                                iobSendTo('growmanager.0', 'importConfig', { json }, (result: unknown) => {
                                    const res = result as { valid?: boolean; errors?: string[] } | null;
                                    if (res?.valid) {
                                        alert('Konfiguration erfolgreich importiert. Seite neu laden.');
                                    } else {
                                        alert(`Import fehlgeschlagen:\n${(res?.errors ?? ['Adapter läuft?']).join('\n')}`);
                                    }
                                });
                            };
                            reader.readAsText(file);
                            // Input zurücksetzen damit dieselbe Datei nochmals gewählt werden kann
                            e.target.value = '';
                        }}
                    />
                </label>
            </div>

            <hr style={{ margin: '24px 0', borderColor: '#e0e0e0' }} />
            <NotificationSettings
                value={config.notifications ?? { enabled: false, channels: [], cooldownMinutes: 30 }}
                onChange={n => onChange({ ...config, notifications: n })}
            />
        </div>
    );
};

// ---- NotificationSettings ----------------------------------

const CHANNEL_TYPE_LABELS: Record<NotificationChannelType, string> = {
    telegram: '📨 Telegram',
    whatsapp: '💬 WhatsApp',
    discord: '🟣 Discord Webhook',
    signal: '🔵 Signal',
};

function defaultChannel(type: NotificationChannelType): NotificationChannel {
    return {
        id: `ch_${Date.now()}`,
        type,
        enabled: true,
        minSeverity: 'warning',
        quietHoursEnabled: false,
        quietHoursStart: 22,
        quietHoursEnd: 7,
    };
}

const NotificationSettings: React.FC<{
    value: NotificationConfig;
    onChange: (v: NotificationConfig) => void;
}> = ({ value, onChange }) => {
    const [detected, setDetected] = useState<Array<{ type: string; instance: string }> | null>(null);
    const [testResults, setTestResults] = useState<Record<string, string>>({});
    const [editingChannel, setEditingChannel] = useState<NotificationChannel | null>(null);

    const setChannels = (channels: NotificationChannel[]) => onChange({ ...value, channels });

    const detectAdapters = () => {
        iobSendTo('growmanager.0', 'detectAdapters', {}, (result: unknown) => {
            if (result === null) {
                alert('Adapter-Erkennung nicht verfügbar – bitte Instanznummer manuell eintragen.');
                return;
            }
            const r = result as { detected: Array<{ type: string; instance: string }> };
            setDetected(r?.detected ?? []);
        });
    };

    const testChannel = (ch: NotificationChannel) => {
        setTestResults(prev => ({ ...prev, [ch.id]: '⏳ Sende…' }));
        iobSendTo('growmanager.0', 'testNotification', { channel: ch }, (result: unknown) => {
            const r = result as { ok: boolean; error?: string } | null;
            setTestResults(prev => ({
                ...prev,
                [ch.id]: r?.ok ? '✅ Gesendet' : `❌ ${r?.error ?? 'Kein Ergebnis – Adapter läuft?'}`,
            }));
        });
    };

    return (
        <div>
            <h4 style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                Push-Benachrichtigungen
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={value.enabled}
                        onChange={e => onChange({ ...value, enabled: e.target.checked })} />
                    Aktiv
                </label>
            </h4>

            {value.enabled && (
                <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                        <label style={{ fontSize: 13 }}>
                            Cooldown (Min.)
                            <InfoTip text={'Gleicher Alarm wird frühestens nach dieser Zeit erneut gesendet.\nVerhindert Alarm-Flut bei wiederkehrenden Problemen.'} />
                        </label>
                        <input type="number" min={1} max={1440} style={{ ...styles.input, width: 80, marginTop: 0 }}
                            value={value.cooldownMinutes}
                            onChange={e => onChange({ ...value, cooldownMinutes: +e.target.value })} />
                    </div>

                    <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                        <button style={styles.btnSecondary} onClick={detectAdapters}>
                            🔍 Adapter erkennen
                        </button>
                        {detected && (
                            <span style={{ fontSize: 12, color: '#555', alignSelf: 'center' }}>
                                Gefunden: {detected.filter(d => d.type !== 'discord').map(d => `${d.type}.${d.instance}`).join(', ') || 'keine ioBroker-Adapter'} · Discord immer verfügbar
                            </span>
                        )}
                    </div>

                    {value.channels.length === 0 && (
                        <div style={{ color: '#888', fontSize: 13, marginBottom: 12 }}>
                            Noch keine Kanäle konfiguriert. Kanal hinzufügen:
                        </div>
                    )}

                    {value.channels.map(ch => (
                        <div key={ch.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: '10px 14px', marginBottom: 10, background: ch.enabled ? '#fff' : '#f9f9f9' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 600, fontSize: 13 }}>{CHANNEL_TYPE_LABELS[ch.type]}</span>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
                                    <input type="checkbox" checked={ch.enabled}
                                        onChange={e => setChannels(value.channels.map(c => c.id === ch.id ? { ...c, enabled: e.target.checked } : c))} />
                                    Aktiv
                                </label>
                                <span style={{ fontSize: 12, background: '#eee', borderRadius: 4, padding: '2px 8px' }}>
                                    ab {ch.minSeverity}
                                </span>
                                {ch.quietHoursEnabled && (
                                    <span style={{ fontSize: 12, color: '#888' }}>🌙 Ruhephase {ch.quietHoursStart}–{ch.quietHoursEnd} Uhr</span>
                                )}
                                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                                    <button style={{ ...styles.btnSecondary, fontSize: 12 }} onClick={() => setEditingChannel({ ...ch })}>Bearbeiten</button>
                                    {testResults[ch.id] && (
                                        <span style={{ fontSize: 12, alignSelf: 'center' }}>{testResults[ch.id]}</span>
                                    )}
                                    <button style={{ ...styles.btnSecondary, fontSize: 12 }} onClick={() => testChannel(ch)}>Test</button>
                                    <button style={{ ...styles.btnSecondary, fontSize: 12, color: '#d32f2f' }}
                                        onClick={() => setChannels(value.channels.filter(c => c.id !== ch.id))}>✕</button>
                                </div>
                            </div>
                            <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                                {ch.type === 'telegram' && `telegram.${ch.telegramInstance ?? '0'}${ch.telegramChatId ? ` · Chat: ${ch.telegramChatId}` : ' · Broadcast'}`}
                                {ch.type === 'whatsapp' && `whatsapp-cmb.${ch.whatsappInstance ?? '0'} · ${ch.whatsappPhone ?? 'keine Nummer'}`}
                                {ch.type === 'signal' && `signal-cmb.${ch.signalInstance ?? '0'} · ${ch.signalPhone ?? 'keine Nummer'}`}
                                {ch.type === 'discord' && (ch.discordWebhookUrl ? 'Webhook konfiguriert ✓' : '⚠ Webhook-URL fehlt')}
                            </div>
                        </div>
                    ))}

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {(['telegram', 'whatsapp', 'discord', 'signal'] as NotificationChannelType[]).map(t => (
                            <button key={t} style={{ ...styles.btnSecondary, fontSize: 12 }}
                                onClick={() => setEditingChannel(defaultChannel(t))}>
                                + {CHANNEL_TYPE_LABELS[t]}
                            </button>
                        ))}
                    </div>
                </>
            )}

            {editingChannel && (
                <NotificationChannelEditor
                    channel={editingChannel}
                    onSave={ch => {
                        const exists = value.channels.some(c => c.id === ch.id);
                        setChannels(exists ? value.channels.map(c => c.id === ch.id ? ch : c) : [...value.channels, ch]);
                        setEditingChannel(null);
                    }}
                    onClose={() => setEditingChannel(null)}
                />
            )}
        </div>
    );
};

const NotificationChannelEditor: React.FC<{
    channel: NotificationChannel;
    onSave: (ch: NotificationChannel) => void;
    onClose: () => void;
}> = ({ channel, onSave, onClose }) => {
    const [ch, setCh] = useState<NotificationChannel>(channel);

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: '#fff', borderRadius: 10, padding: 24, width: 420, maxWidth: '95vw', boxShadow: '0 8px 32px rgba(0,0,0,0.2)', maxHeight: '90vh', overflowY: 'auto' }}>
                <h4 style={{ margin: '0 0 16px' }}>{CHANNEL_TYPE_LABELS[ch.type]} konfigurieren</h4>

                <FieldLabel>Mindest-Schweregrad</FieldLabel>
                <select style={styles.select} value={ch.minSeverity} onChange={e => setCh({ ...ch, minSeverity: e.target.value as NotificationChannel['minSeverity'] })}>
                    <option value="info">Info (alle Alarme)</option>
                    <option value="warning">Warnung+</option>
                    <option value="fault">Fehler+</option>
                    <option value="critical">Nur Kritisch</option>
                </select>

                {ch.type === 'telegram' && (<>
                    <FieldLabel tip="Instanznummer des Telegram-Adapters, z.B. 0 für telegram.0">Instanz-Nummer</FieldLabel>
                    <input style={styles.input} placeholder="0" value={ch.telegramInstance ?? ''}
                        onChange={e => setCh({ ...ch, telegramInstance: e.target.value })} />
                    <FieldLabel tip="Leer lassen für Broadcast an alle bekannten Chats. Oder Chat-ID / Username eintragen.">Chat-ID (optional)</FieldLabel>
                    <input style={styles.input} placeholder="Leer = Broadcast" value={ch.telegramChatId ?? ''}
                        onChange={e => setCh({ ...ch, telegramChatId: e.target.value })} />
                </>)}

                {ch.type === 'whatsapp' && (<>
                    <FieldLabel tip="Instanznummer des whatsapp-cmb Adapters">Instanz-Nummer</FieldLabel>
                    <input style={styles.input} placeholder="0" value={ch.whatsappInstance ?? ''}
                        onChange={e => setCh({ ...ch, whatsappInstance: e.target.value })} />
                    <FieldLabel tip="Telefonnummer im E.164-Format, z.B. +491234567890">Telefonnummer</FieldLabel>
                    <input style={styles.input} placeholder="+491234567890" value={ch.whatsappPhone ?? ''}
                        onChange={e => setCh({ ...ch, whatsappPhone: e.target.value })} />
                </>)}

                {ch.type === 'discord' && (<>
                    <FieldLabel tip={'Discord → Servereinstellungen → Integrationen → Webhooks → Neuen Webhook erstellen → URL kopieren'}>Webhook-URL</FieldLabel>
                    <input style={styles.input} placeholder="https://discord.com/api/webhooks/…" value={ch.discordWebhookUrl ?? ''}
                        onChange={e => setCh({ ...ch, discordWebhookUrl: e.target.value })} />
                </>)}

                {ch.type === 'signal' && (<>
                    <FieldLabel tip="Instanznummer des signal-cmb Adapters">Instanz-Nummer</FieldLabel>
                    <input style={styles.input} placeholder="0" value={ch.signalInstance ?? ''}
                        onChange={e => setCh({ ...ch, signalInstance: e.target.value })} />
                    <FieldLabel tip="Empfänger-Rufnummer im E.164-Format">Telefonnummer</FieldLabel>
                    <input style={styles.input} placeholder="+491234567890" value={ch.signalPhone ?? ''}
                        onChange={e => setCh({ ...ch, signalPhone: e.target.value })} />
                </>)}

                <FieldLabel>Ruhephase (keine Benachrichtigungen)</FieldLabel>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
                        <input type="checkbox" checked={ch.quietHoursEnabled}
                            onChange={e => setCh({ ...ch, quietHoursEnabled: e.target.checked })} />
                        Aktiv
                    </label>
                    {ch.quietHoursEnabled && (<>
                        <input type="number" min={0} max={23} style={{ ...styles.input, width: 64, marginTop: 0 }}
                            value={ch.quietHoursStart}
                            onChange={e => setCh({ ...ch, quietHoursStart: +e.target.value })} />
                        <span style={{ fontSize: 13 }}>bis</span>
                        <input type="number" min={0} max={23} style={{ ...styles.input, width: 64, marginTop: 0 }}
                            value={ch.quietHoursEnd}
                            onChange={e => setCh({ ...ch, quietHoursEnd: +e.target.value })} />
                        <span style={{ fontSize: 13 }}>Uhr</span>
                    </>)}
                </div>

                <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                    <button style={styles.btnPrimary} onClick={() => onSave(ch)}>Speichern</button>
                    <button style={styles.btnSecondary} onClick={onClose}>Abbrechen</button>
                </div>
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
        dashboardPin: '',
        groups: [],
        climateProfiles: [],
        alarmChannels: [],
        notifications: { enabled: false, channels: [], cooldownMinutes: 30 },
    });
    const [editingGroup, setEditingGroup] = useState<GroupConfig | null | 'new'>(null);
    const [alarms, setAlarms] = useState<AlarmRecord[]>([]);
    const [liveStates, setLiveStates] = useState<Record<string, GroupLiveState>>({});
    const [dirty, setDirty] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'ok' | 'err'>('idle');
    const [saveError, setSaveError] = useState('');
    // adapterReady = ioBroker-Bridge ist bereit (loadConfig wurde aufgerufen)
    const [adapterReady, setAdapterReady] = useState(false);

    // ioBroker-Anbindung: config laden sobald loadConfig verfügbar
    useEffect(() => {
        const load = () => {
            const w = window as Window & { loadConfig?: (cb: (c: GrowManagerConfig) => void) => void };
            if (typeof w.loadConfig === 'function') {
                setAdapterReady(true);
                w.loadConfig((c: GrowManagerConfig) => setConfig(prev => ({
                    ...prev,
                    ...c,
                    groups: c.groups ?? [],
                    climateProfiles: c.climateProfiles ?? [],
                    alarmChannels: c.alarmChannels ?? [],
                })));
            }
        };
        load();
        window.addEventListener('iobroker-ready', load);
        return () => window.removeEventListener('iobroker-ready', load);
    }, []);

    // Stabile Referenz der Gruppen-IDs — verhindert Neustart des Intervals bei jedem Keystroke
    const groupIds = config.groups.map(g => g.id).join(',');

    // Live-Polling via sendTo('getGroupState') — funktioniert ohne socket.io im iframe
    useEffect(() => {
        if (!adapterReady || !groupIds) return;
        const urlInstance = new URLSearchParams(window.location.search).get('instance') ?? '0';
        const instanceId = urlInstance.replace(/^growmanager\./, '');
        const instanceName = `growmanager.${instanceId}`;
        const groups = config.groups;

        type GS = {
            temperature?: number | null;
            humidity?: number | null;
            vpd?: number | null;
            sensorQuality?: number;
            degradation?: string;
            mode?: string;
            lastDecision?: { reason?: string } | null;
        } | null;

        function pollGroup(g: typeof groups[0]): Promise<void> {
            return new Promise(resolve => {
                sendTo(instanceName, 'getGroupState', { groupId: g.id }, (result: unknown) => {
                    const gs = result as GS;
                    setLiveStates(prev => ({
                        ...prev,
                        [g.id]: {
                            temperature: gs?.temperature ?? null,
                            humidity: gs?.humidity ?? null,
                            vpd: gs?.vpd ?? null,
                            sensorQuality: typeof gs?.sensorQuality === 'number' ? gs.sensorQuality : 0,
                            health: gs?.degradation ?? 'FULL',
                            mode: gs?.mode ?? g.mode,
                            phase: g.phase,
                            alarmSeverity: 'none',
                            nextChange: '',
                            actuators: {},
                            lastDecision: gs?.lastDecision?.reason ?? '',
                        },
                    }));
                    resolve();
                });
            });
        }

        async function poll() {
            await Promise.all(groups.map(pollGroup));
        }

        poll();
        const timer = setInterval(poll, 5000);
        return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [adapterReady, groupIds]);

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
                            allGroups={config.groups}
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
                    <span style={{ fontSize: 11, color: adapterReady ? '#4caf50' : '#f57c00' }}
                          title={adapterReady ? (window as Window & {_growInstanceId?: string})._growInstanceId ?? '' : 'Warte auf ioBroker-Verbindung…'}>
                        {adapterReady ? '● Verbunden' : '○ Verbinde…'}
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
