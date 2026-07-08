export interface SharedActorRequest {
    groupId: string;
    groupPriority: number;
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
export interface VoteEntry {
    groupId: string;
    wantsOn: boolean;
    weight: number;
    urgency: number;
    reason: string;
}
export declare class SharedActorManager {
    private readonly requests;
    private readonly votes;
    private readonly resolvedState;
    private readonly pendingChange;
    /**
     * Registriert eine Anforderung für einen Aktor in diesem Zyklus.
     * @internal Rückwärtskompatibel – für Aktoren ohne sharedParticipants
     */
    submitRequest(req: SharedActorRequest): void;
    /**
     * Löst die Anforderungen für einen einzelnen Aktor auf.
     * Gibt null zurück wenn keine Anforderungen vorhanden.
     * @internal Rückwärtskompatibel
     */
    resolve(actuatorId: string): SharedActorResult | null;
    /**
     * Löst alle ausstehenden Legacy-Anforderungen auf.
     * @internal Rückwärtskompatibel
     */
    resolveAll(): Map<string, SharedActorResult>;
    /**
     * Registriert eine Abstimmung eines Teilnehmers für einen Aktor.
     */
    submitVote(actuatorId: string, vote: VoteEntry): void;
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
    resolveWithVoting(actuatorId: string, mode: 'any' | 'majority' | 'primary', hysteresisSeconds: number, ownerId: string, currentCommand: boolean | number): boolean | number;
    /**
     * Gibt alle Stimmen für einen Aktor zurück (für Dashboard-Tooltip).
     */
    getVotes(actuatorId: string): VoteEntry[];
    /**
     * Leert alle Anforderungen und Stimmen nach dem Regelzyklus.
     */
    clearCycle(): void;
    private pickHighestCommand;
}
//# sourceMappingURL=SharedActorManager.d.ts.map