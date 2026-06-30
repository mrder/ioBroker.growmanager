// ============================================================
// GrowManager – SharedActorManager
// Verwaltet Aktoren die mehreren Gruppen gemeinsam dienen.
// Eine "EIN"-Anforderung wird für alle betroffenen Gruppen
// erfüllt; Konflikte werden nach Priorität aufgelöst.
// ============================================================

export interface SharedActorRequest {
    groupId: string;
    groupPriority: number;  // aus GroupConfig.priority; niedrigere Zahl = höhere Priorität
    actuatorId: string;
    requested: boolean | number;
    reason: string;
    isCritical: boolean;
}

export interface SharedActorResult {
    actuatorId: string;
    finalCommand: boolean | number;
    winningGroupId: string;
    reason: string;
    allRequests: SharedActorRequest[];
}

export class SharedActorManager {
    // Pro Aktor: alle Anforderungen im aktuellen Zyklus
    private readonly requests = new Map<string, SharedActorRequest[]>();

    /**
     * Registriert eine Anforderung für einen Aktor in diesem Zyklus.
     */
    submitRequest(req: SharedActorRequest): void {
        const list = this.requests.get(req.actuatorId) ?? [];
        list.push(req);
        this.requests.set(req.actuatorId, list);
    }

    /**
     * Löst die Anforderungen für einen einzelnen Aktor auf.
     * Gibt null zurück wenn keine Anforderungen vorhanden.
     */
    resolve(actuatorId: string): SharedActorResult | null {
        const list = this.requests.get(actuatorId);
        if (!list || list.length === 0) return null;

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
        const anyOn = list.find(r => r.requested === true || (typeof r.requested === 'number' && r.requested > 0));
        if (anyOn) {
            // EIN-Anforderungen erfüllen mehrere Gruppen → Maximum der Prozentwerte
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
     * Löst alle ausstehenden Anforderungen auf.
     */
    resolveAll(): Map<string, SharedActorResult> {
        const results = new Map<string, SharedActorResult>();
        for (const actuatorId of this.requests.keys()) {
            const result = this.resolve(actuatorId);
            if (result) results.set(actuatorId, result);
        }
        return results;
    }

    /**
     * Leert alle Anforderungen nach dem Regelzyklus.
     */
    clearCycle(): void {
        this.requests.clear();
    }

    // Wählt den Befehl mit dem höchsten Prozentwert / true aus einer Liste
    private pickHighestCommand(list: SharedActorRequest[]): SharedActorRequest {
        return list.reduce((best, cur) => {
            const bestVal = typeof best.requested === 'number' ? best.requested : (best.requested ? 1 : 0);
            const curVal = typeof cur.requested === 'number' ? cur.requested : (cur.requested ? 1 : 0);
            return curVal > bestVal ? cur : best;
        });
    }
}
