"use strict";
// ============================================================
// GrowManager – SharedActorManager
// Verwaltet Aktoren die mehreren Gruppen gemeinsam dienen.
// Eine "EIN"-Anforderung wird für alle betroffenen Gruppen
// erfüllt; Konflikte werden nach Priorität oder Abstimmung
// aufgelöst.
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.SharedActorManager = void 0;
class SharedActorManager {
    constructor() {
        // Pro Aktor: alle Anforderungen im aktuellen Zyklus (Legacy)
        this.requests = new Map();
        // Pro Aktor: alle Abstimmungen im aktuellen Zyklus
        this.votes = new Map();
        // Pro Aktor: bestätigter Zustand (nach Hysterese)
        this.resolvedState = new Map();
        // Pro Aktor: ausstehende Änderung (noch innerhalb Hysterese)
        this.pendingChange = new Map();
    }
    // ---- Legacy-Methoden (Rückwärtskompatibilität) ----
    /**
     * Registriert eine Anforderung für einen Aktor in diesem Zyklus.
     * @internal Rückwärtskompatibel – für Aktoren ohne sharedParticipants
     */
    submitRequest(req) {
        const list = this.requests.get(req.actuatorId) ?? [];
        list.push(req);
        this.requests.set(req.actuatorId, list);
    }
    /**
     * Löst die Anforderungen für einen einzelnen Aktor auf.
     * Gibt null zurück wenn keine Anforderungen vorhanden.
     * @internal Rückwärtskompatibel
     */
    resolve(actuatorId) {
        const list = this.requests.get(actuatorId);
        if (!list || list.length === 0)
            return null;
        // Kritische Anforderungen immer zuerst
        const critical = list.filter(r => r.isCritical);
        if (critical.length > 0) {
            // Kritisch: wenn jemand OFF will → alle abschalten (NotAus)
            const wantsOff = critical.find(r => r.requested === false || r.requested === 0);
            if (wantsOff) {
                return {
                    actuatorId,
                    finalCommand: typeof wantsOff.requested === 'number' ? 0 : false,
                    winningGroupId: wantsOff.groupId,
                    reason: `Kritisch (${wantsOff.reason})`,
                    allRequests: list,
                };
            }
            // Sonst Maximum aus kritischen nehmen
            const winner = this.pickHighestCommand(critical);
            return {
                actuatorId,
                finalCommand: winner.requested,
                winningGroupId: winner.groupId,
                reason: `Kritisch (${winner.reason})`,
                allRequests: list,
            };
        }
        // Nicht-kritisch: Gruppe mit höchster Priorität (niedrigste Zahl) gewinnt
        // Bei gleicher Priorität: Maximum nehmen
        const sorted = [...list].sort((a, b) => a.groupPriority - b.groupPriority);
        const topPriority = sorted[0].groupPriority;
        const topGroup = sorted.filter(r => r.groupPriority === topPriority);
        // Wenn jemand mit höchster Priorität EIN will → EIN gilt für alle
        const anyOn = topGroup.find(r => r.requested === true || (typeof r.requested === 'number' && r.requested > 0));
        if (anyOn) {
            // EIN: Prozentwert-Maximum aus allen Gruppen (höherer Bedarf dominiert)
            const winner = this.pickHighestCommand(list);
            return {
                actuatorId,
                finalCommand: winner.requested,
                winningGroupId: winner.groupId,
                reason: winner.reason,
                allRequests: list,
            };
        }
        // Alle wollen AUS → höchste Priorität entscheidet
        const top = topGroup[0];
        return {
            actuatorId,
            finalCommand: top.requested,
            winningGroupId: top.groupId,
            reason: top.reason,
            allRequests: list,
        };
    }
    /**
     * Löst alle ausstehenden Legacy-Anforderungen auf.
     * @internal Rückwärtskompatibel
     */
    resolveAll() {
        const results = new Map();
        for (const actuatorId of this.requests.keys()) {
            const result = this.resolve(actuatorId);
            if (result)
                results.set(actuatorId, result);
        }
        return results;
    }
    // ---- Abstimmungs-Methoden ----
    /**
     * Registriert eine Abstimmung eines Teilnehmers für einen Aktor.
     */
    submitVote(actuatorId, vote) {
        const list = this.votes.get(actuatorId) ?? [];
        list.push(vote);
        this.votes.set(actuatorId, list);
    }
    /**
     * Löst die Abstimmung für einen Aktor auf und wendet Hysterese an.
     *
     * @param actuatorId        - ID des Aktors
     * @param mode              - Abstimmungsmodus: 'any' | 'majority' | 'primary'
     * @param hysteresisSeconds - Wie lange der neue Zustand stabil sein muss bevor er angenommen wird
     * @param ownerId           - GroupId der Eigentümer-Gruppe (für 'primary'-Modus)
     * @param currentCommand    - Aktuell gesetzter Befehl (für Hysterese-Vergleich)
     * @returns Den anzuwendenden Befehl
     */
    resolveWithVoting(actuatorId, mode, hysteresisSeconds, ownerId, currentCommand) {
        // Alle Stimmen: Eigentümer (weight=1.0) + Teilnehmer
        const voteList = this.votes.get(actuatorId) ?? [];
        // Eigentümer-Stimme identifizieren (immer weight=1.0, eingereicht von main.ts)
        const ownerVote = voteList.find(v => v.groupId === ownerId);
        const ownerWantsOn = ownerVote?.wantsOn ?? false;
        // Rohen Beschluss berechnen
        let rawCommand;
        switch (mode) {
            case 'any': {
                // EIN wenn Eigentümer ODER irgendein Teilnehmer EIN will.
                // Owner-AUS ist ein weiches Veto — kann von kritisch dringendem
                // Teilnehmer (urgency >= 0.7) überstimmt werden.
                const criticalParticipant = voteList.some(v => v.groupId !== ownerId && v.wantsOn && v.urgency >= 0.7);
                if (ownerVote && !ownerWantsOn && !criticalParticipant) {
                    rawCommand = false;
                }
                else {
                    rawCommand = voteList.some(v => v.wantsOn);
                }
                break;
            }
            case 'majority': {
                // Gewichtete Mehrheit mit Dringlichkeits-Bonus:
                // Wer klar außerhalb des Sollbereichs ist (urgency > 0) bekommt mehr Gewicht.
                // Effektives Gewicht = konfiguriertes Gewicht × (1 + urgency)
                // → am Rand (urgency≈0): Basis-Gewicht; weit außerhalb (urgency=1): doppeltes Gewicht
                let onWeight = 0;
                let offWeight = 0;
                for (const v of voteList) {
                    const eff = v.weight * (1 + v.urgency);
                    if (v.wantsOn)
                        onWeight += eff;
                    else
                        offWeight += eff;
                }
                rawCommand = onWeight > offWeight;
                break;
            }
            case 'primary': {
                // Eigentümer entscheidet; aber Teilnehmer mit hohem Einfluss (>=0.8) kann überstimmen
                if (ownerWantsOn) {
                    rawCommand = true;
                }
                else {
                    const highInfluenceOn = voteList.some(v => v.groupId !== ownerId && v.wantsOn && v.weight >= 0.8);
                    rawCommand = highInfluenceOn;
                }
                break;
            }
            default:
                rawCommand = ownerWantsOn;
        }
        // Hysterese anwenden
        const now = Date.now();
        const hysteresisMs = hysteresisSeconds * 1000;
        // Aktuell bestätigter Zustand
        const confirmed = this.resolvedState.get(actuatorId);
        const confirmedCommand = confirmed?.command ?? currentCommand;
        // Ist der neue Beschluss anders als der bestätigte?
        const isChange = rawCommand !== confirmedCommand;
        if (!isChange) {
            // Kein Wechsel: bestätigten Zustand beibehalten, pendingChange löschen
            this.pendingChange.delete(actuatorId);
            // Bestätigten Zustand setzen falls noch nicht vorhanden
            if (!confirmed) {
                this.resolvedState.set(actuatorId, { command: rawCommand, since: now });
            }
            return confirmedCommand;
        }
        // Hysterese = 0: sofort übernehmen
        if (hysteresisMs === 0) {
            this.resolvedState.set(actuatorId, { command: rawCommand, since: now });
            this.pendingChange.delete(actuatorId);
            return rawCommand;
        }
        // Es gibt eine gewünschte Änderung — Hysterese prüfen
        const pending = this.pendingChange.get(actuatorId);
        if (!pending || pending.command !== rawCommand) {
            // Neue Änderungsrichtung: Zeitstempel setzen
            this.pendingChange.set(actuatorId, { command: rawCommand, since: now });
            // Bestätigten Zustand noch beibehalten
            return confirmedCommand;
        }
        // Änderung ist schon eine Weile stabil — Hysterese erfüllt?
        if (now - pending.since >= hysteresisMs) {
            // Neue Richtung annehmen
            this.resolvedState.set(actuatorId, { command: rawCommand, since: now });
            this.pendingChange.delete(actuatorId);
            return rawCommand;
        }
        // Noch innerhalb der Hysterese: alten Zustand beibehalten
        return confirmedCommand;
    }
    /**
     * Gibt alle Stimmen für einen Aktor zurück (für Dashboard-Tooltip).
     */
    getVotes(actuatorId) {
        return this.votes.get(actuatorId) ?? [];
    }
    /**
     * Leert alle Anforderungen und Stimmen nach dem Regelzyklus.
     */
    clearCycle() {
        this.requests.clear();
        this.votes.clear();
    }
    // Wählt den Befehl mit dem höchsten Prozentwert / true aus einer Liste
    pickHighestCommand(list) {
        return list.reduce((best, cur) => {
            const bestVal = typeof best.requested === 'number' ? best.requested : (best.requested ? 1 : 0);
            const curVal = typeof cur.requested === 'number' ? cur.requested : (cur.requested ? 1 : 0);
            return curVal > bestVal ? cur : best;
        });
    }
}
exports.SharedActorManager = SharedActorManager;
//# sourceMappingURL=SharedActorManager.js.map