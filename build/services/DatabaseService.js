"use strict";
// ============================================================
// GrowManager – DatabaseService
// Persistente Ablage von Tages-Statistiken, Energiedaten und
// Bewässerungsprotokoll als JSON-States im ioBroker-Objektbaum.
// Pfad: growmanager.0.database.{groupId}.{stats|energy|irrigation}
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseService = void 0;
// Maximale Einträge pro Typ
const MAX_DAYS = 30;
const MAX_IRRIGATION = 200;
class DatabaseService {
    constructor(log, setState, getState) {
        this.log = log;
        this.setState = setState;
        this.getState = getState;
        // In-memory Caches; beim Start aus ioBroker-States befüllt
        this.statsCache = new Map();
        this.energyCache = new Map();
        this.irrCache = new Map();
        // Akkumulator für laufende Sensorwerte pro Gruppe/Sensor
        this.sensorAcc = new Map();
        // Akkumulator für laufende Energiewerte pro Gruppe/Aktor
        this.energyAcc = new Map();
        this.lastMidnightFlush = new Map();
    }
    // ---- Initialisierung: Caches aus States laden -------------
    async loadGroup(groupId) {
        this.statsCache.set(groupId, await this.readJson(`database.${groupId}.stats`, []));
        this.energyCache.set(groupId, await this.readJson(`database.${groupId}.energy`, []));
        this.irrCache.set(groupId, await this.readJson(`database.${groupId}.irrigation`, []));
        this.sensorAcc.set(groupId, new Map());
        this.energyAcc.set(groupId, new Map());
        // Heutigen Tag vormerken – verhindert dass der erste Watchdog-Tick
        // tickMidnight() feuert und die leeren Akkumulatoren flusht.
        this.lastMidnightFlush.set(groupId, new Date().toDateString());
    }
    // ---- Sensordaten akkumulieren -----------------------------
    trackSensorValue(groupId, sensorId, value, name) {
        const group = this.sensorAcc.get(groupId);
        if (!group)
            return;
        if (!isFinite(value))
            return; // NaN/Infinity würde Akkumulator dauerhaft korrupieren
        const cur = group.get(sensorId);
        if (!cur) {
            group.set(sensorId, { sum: value, min: value, max: value, n: 1, name: name ?? sensorId });
        }
        else {
            cur.sum += value;
            cur.n++;
            if (value < cur.min)
                cur.min = value;
            if (value > cur.max)
                cur.max = value;
            if (name)
                cur.name = name;
        }
    }
    // ---- Energiedaten akkumulieren ----------------------------
    trackActuatorOn(groupId, actuatorId, name, ratedWatts = 0) {
        const group = this.energyAcc.get(groupId);
        if (!group)
            return;
        const cur = group.get(actuatorId);
        if (cur && cur.lastOnTs === 0) {
            cur.lastOnTs = Date.now();
            cur.name = name;
            if (ratedWatts > 0)
                cur.ratedWatts = ratedWatts;
        }
        else if (!cur) {
            group.set(actuatorId, { wh: 0, runtimeMin: 0, name, lastOnTs: Date.now(), ratedWatts });
        }
    }
    trackActuatorOff(groupId, actuatorId, ratedWatts) {
        const group = this.energyAcc.get(groupId);
        if (!group)
            return;
        const cur = group.get(actuatorId);
        if (!cur || cur.lastOnTs === 0)
            return;
        const durationMin = (Date.now() - cur.lastOnTs) / 60000;
        // Tail-Segment: Zeit seit letztem Power-Sample (oder AN-Zeitpunkt) bis AUS.
        // Nennleistung als Schätzwert; bevorzuge Parameter, Fallback auf gespeicherten Wert.
        const wTail = ratedWatts > 0 ? ratedWatts : cur.ratedWatts;
        if (wTail > 0)
            cur.wh += (wTail * durationMin) / 60;
        cur.runtimeMin += durationMin;
        cur.lastOnTs = 0;
    }
    /**
     * Wird bei jedem Live-W-Wert aufgerufen (energyStateUnit='W').
     * Akkumuliert Wh seit dem letzten Sample-Zeitpunkt.
     */
    updateActuatorPowerSample(groupId, actuatorId, watts) {
        const group = this.energyAcc.get(groupId);
        if (!group)
            return;
        const cur = group.get(actuatorId);
        if (!cur || cur.lastOnTs === 0)
            return; // Gerät ist nicht als AN bekannt
        const now = Date.now();
        const durationMin = (now - cur.lastOnTs) / 60000;
        if (durationMin < 0.001)
            return; // Zu kurzes Intervall ignorieren
        if (!isFinite(watts) || watts < 0)
            return; // Ungültiger Sensorwert → Akkumulator schützen
        cur.wh += (watts * durationMin) / 60;
        cur.runtimeMin += durationMin;
        if (watts > 0)
            cur.ratedWatts = watts; // zuletzt bekannte Leistung als Fallback aktualisieren
        cur.lastOnTs = now;
    }
    /**
     * Speichert den zuletzt bekannten W-Wert eines Aktors als Schätzwert.
     * Wird aufgerufen wenn ein W-State-Update eintrifft (unabhängig vom AN/AUS-Status).
     * Sichert so den Fallback-Wert für getEnergy() auch wenn keine Zyklen akkumuliert wurden.
     */
    updateLastKnownWatts(groupId, actuatorId, name, watts) {
        if (watts <= 0 || !isFinite(watts))
            return;
        const group = this.energyAcc.get(groupId);
        if (!group)
            return;
        const cur = group.get(actuatorId);
        if (cur) {
            cur.ratedWatts = watts;
        }
        else {
            group.set(actuatorId, { wh: 0, runtimeMin: 0, name, lastOnTs: 0, ratedWatts: watts });
        }
    }
    trackActuatorWh(groupId, actuatorId, name, deltaWh, durationMin) {
        const group = this.energyAcc.get(groupId);
        if (!group)
            return;
        const cur = group.get(actuatorId);
        if (!cur) {
            group.set(actuatorId, { wh: deltaWh, runtimeMin: durationMin, name, lastOnTs: 0, ratedWatts: 0 });
        }
        else {
            cur.wh += deltaWh;
            cur.runtimeMin += durationMin;
            cur.name = name;
        }
    }
    // ---- Bewässerungsereignis speichern ----------------------
    async addIrrigationEvent(groupId, event) {
        const list = this.irrCache.get(groupId) ?? [];
        list.unshift(event);
        if (list.length > MAX_IRRIGATION)
            list.length = MAX_IRRIGATION;
        this.irrCache.set(groupId, list);
        await this.flush(`database.${groupId}.irrigation`, list);
    }
    // ---- Tagesabschluss: Acc → DB schreiben ------------------
    async tickMidnight(groupId) {
        const today = new Date().toDateString();
        if (today === this.lastMidnightFlush.get(groupId))
            return;
        this.lastMidnightFlush.set(groupId, today);
        await this.flushDay(groupId);
    }
    async flushDay(groupId) {
        // tickMidnight() wird nach Mitternacht aufgerufen — zu diesem Zeitpunkt ist new Date()
        // bereits der neue Tag. Die akkumulierten Daten gehören aber zum gestrigen Tag.
        const dateStr = this.yesterdayStr();
        // Sensor-Stats
        const sGroup = this.sensorAcc.get(groupId);
        if (sGroup && sGroup.size > 0) {
            const entry = { date: dateStr, sensors: {} };
            for (const [sid, acc] of sGroup) {
                entry.sensors[sid] = { name: acc.name, min: +acc.min.toFixed(2), max: +acc.max.toFixed(2), avg: +(acc.sum / acc.n).toFixed(2), samples: acc.n };
            }
            const list = this.statsCache.get(groupId) ?? [];
            const idx = list.findIndex(d => d.date === dateStr);
            if (idx >= 0)
                list[idx] = entry;
            else
                list.unshift(entry);
            if (list.length > MAX_DAYS)
                list.length = MAX_DAYS;
            this.statsCache.set(groupId, list);
            await this.flush(`database.${groupId}.stats`, list);
            sGroup.clear();
        }
        // Energie-Stats
        const eGroup = this.energyAcc.get(groupId);
        if (eGroup && eGroup.size > 0) {
            const entry = { date: dateStr, actuators: {} };
            for (const [aid, acc] of eGroup) {
                // Noch-laufende Aktoren: Laufzeit bis jetzt anrechnen
                let extra = 0;
                if (acc.lastOnTs > 0)
                    extra = (Date.now() - acc.lastOnTs) / 60000;
                // Wh: Ø-Watt aus abgeschlossenen Perioden; falls keine → Nennleistung
                const avgWFlush = acc.runtimeMin > 0 ? (acc.wh / acc.runtimeMin) * 60 : acc.ratedWatts;
                const whTotal = acc.wh + (extra > 0 && avgWFlush > 0 ? (avgWFlush * extra / 60) : 0);
                entry.actuators[aid] = {
                    name: acc.name,
                    wh: +whTotal.toFixed(1),
                    runtimeMin: +(acc.runtimeMin + extra).toFixed(1),
                };
            }
            const list = this.energyCache.get(groupId) ?? [];
            const idx = list.findIndex(d => d.date === dateStr);
            if (idx >= 0)
                list[idx] = entry;
            else
                list.unshift(entry);
            if (list.length > MAX_DAYS)
                list.length = MAX_DAYS;
            this.energyCache.set(groupId, list);
            await this.flush(`database.${groupId}.energy`, list);
            // Energie-Acc zurücksetzen (Laufzeiten/Wh von vorne)
            for (const acc of eGroup.values()) {
                acc.wh = 0;
                acc.runtimeMin = 0;
                if (acc.lastOnTs > 0)
                    acc.lastOnTs = Date.now();
            }
        }
    }
    // ---- Getter für Dashboard-API ----------------------------
    getStats(groupId) {
        const dateStr = this.todayStr();
        const historical = this.statsCache.get(groupId) ?? [];
        // Heutigen Akkumulator einbauen (live, noch nicht geflusht)
        const sGroup = this.sensorAcc.get(groupId);
        if (!sGroup || sGroup.size === 0)
            return historical;
        const todayEntry = { date: dateStr + ' (heute)', sensors: {} };
        for (const [sid, acc] of sGroup) {
            todayEntry.sensors[sid] = {
                name: acc.name,
                min: +acc.min.toFixed(2),
                max: +acc.max.toFixed(2),
                avg: +(acc.sum / acc.n).toFixed(2),
                samples: acc.n,
            };
        }
        // Nicht doppelt einfügen wenn bereits geflusht
        const filtered = historical.filter(d => d.date !== dateStr && d.date !== todayEntry.date);
        return [todayEntry, ...filtered];
    }
    getEnergy(groupId) {
        const dateStr = this.todayStr();
        const historical = this.energyCache.get(groupId) ?? [];
        // Heutigen Akkumulator einbauen (live, noch nicht geflusht)
        const eGroup = this.energyAcc.get(groupId);
        if (!eGroup || eGroup.size === 0)
            return historical;
        const now = Date.now();
        const todayEntry = { date: dateStr + ' (heute)', actuators: {} };
        for (const [aid, acc] of eGroup) {
            const extra = acc.lastOnTs > 0 ? (now - acc.lastOnTs) / 60000 : 0;
            const runtimeMin = acc.runtimeMin + extra;
            // Ø-Watt: aus tatsächlich akkumulierten W-Samples wenn vorhanden,
            // sonst ratedWatts als Fallback (auch wenn runtimeMin>0 aber wh=0 wegen fehlender W-Events).
            const avgW = (acc.runtimeMin > 0 && acc.wh > 0) ? (acc.wh / acc.runtimeMin) * 60 : acc.ratedWatts;
            const wh = acc.wh + (extra > 0 && avgW > 0 ? (avgW * extra / 60) : 0);
            todayEntry.actuators[aid] = {
                name: acc.name,
                wh: +wh.toFixed(1),
                runtimeMin: +runtimeMin.toFixed(1),
            };
        }
        const filtered = historical.filter(d => d.date !== dateStr && d.date !== todayEntry.date);
        return [todayEntry, ...filtered];
    }
    getIrrigation(groupId) {
        return this.irrCache.get(groupId) ?? [];
    }
    // ---- Interne Helfer ---------------------------------------
    async readJson(id, fallback) {
        try {
            const raw = await this.getState(id);
            if (raw)
                return JSON.parse(raw);
        }
        catch { /* leer oder ungültig */ }
        return fallback;
    }
    async flush(id, data) {
        try {
            await this.setState(id, JSON.stringify(data));
        }
        catch (e) {
            this.log.error(`DatabaseService: Schreibfehler ${id}: ${e}`);
        }
    }
    todayStr() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    yesterdayStr() {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
}
exports.DatabaseService = DatabaseService;
//# sourceMappingURL=DatabaseService.js.map