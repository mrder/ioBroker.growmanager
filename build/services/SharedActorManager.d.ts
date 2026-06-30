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
export declare class SharedActorManager {
    private readonly requests;
    /**
     * Registriert eine Anforderung für einen Aktor in diesem Zyklus.
     */
    submitRequest(req: SharedActorRequest): void;
    /**
     * Löst die Anforderungen für einen einzelnen Aktor auf.
     * Gibt null zurück wenn keine Anforderungen vorhanden.
     */
    resolve(actuatorId: string): SharedActorResult | null;
    /**
     * Löst alle ausstehenden Anforderungen auf.
     */
    resolveAll(): Map<string, SharedActorResult>;
    /**
     * Leert alle Anforderungen nach dem Regelzyklus.
     */
    clearCycle(): void;
    private pickHighestCommand;
}
//# sourceMappingURL=SharedActorManager.d.ts.map