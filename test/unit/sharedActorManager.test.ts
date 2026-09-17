// ============================================================
// Tests für SharedActorManager
// ============================================================

import { SharedActorManager } from '../../src/services/SharedActorManager';
import type { SharedActorRequest, VoteEntry } from '../../src/services/SharedActorManager';

describe('SharedActorManager', () => {
    let manager: SharedActorManager;

    beforeEach(() => {
        manager = new SharedActorManager();
    });

    it('gibt null zurück wenn keine Anforderungen', () => {
        expect(manager.resolve('act-1')).toBeNull();
    });

    it('eine einzige Anforderung wird direkt übernommen', () => {
        manager.submitRequest({ groupId: 'g1', groupPriority: 1, actuatorId: 'act-1', requested: true, reason: 'Test', isCritical: false });
        const result = manager.resolve('act-1');
        expect(result).not.toBeNull();
        expect(result!.finalCommand).toBe(true);
        expect(result!.winningGroupId).toBe('g1');
    });

    it('EIN-Anforderung gewinnt gegen AUS (eine will an, eine will aus)', () => {
        manager.submitRequest({ groupId: 'g1', groupPriority: 2, actuatorId: 'act-1', requested: false, reason: 'Kalt', isCritical: false });
        manager.submitRequest({ groupId: 'g2', groupPriority: 1, actuatorId: 'act-1', requested: true, reason: 'Warm', isCritical: false });
        const result = manager.resolve('act-1');
        expect(result!.finalCommand).toBe(true);
    });

    it('Prozent-Anforderungen: Maximum gewinnt', () => {
        manager.submitRequest({ groupId: 'g1', groupPriority: 1, actuatorId: 'act-1', requested: 40, reason: 'Niedrig', isCritical: false });
        manager.submitRequest({ groupId: 'g2', groupPriority: 2, actuatorId: 'act-1', requested: 80, reason: 'Hoch', isCritical: false });
        const result = manager.resolve('act-1');
        expect(result!.finalCommand).toBe(80);
    });

    it('kritische Anforderung hat Priorität über normale', () => {
        manager.submitRequest({ groupId: 'g1', groupPriority: 1, actuatorId: 'act-1', requested: true, reason: 'Heiß', isCritical: false });
        manager.submitRequest({ groupId: 'g2', groupPriority: 5, actuatorId: 'act-1', requested: false, reason: 'NotAus', isCritical: true });
        const result = manager.resolve('act-1');
        expect(result!.finalCommand).toBe(false);
        expect(result!.reason).toContain('Kritisch');
    });

    it('resolveAll liefert Ergebnisse für alle Aktoren', () => {
        manager.submitRequest({ groupId: 'g1', groupPriority: 1, actuatorId: 'act-1', requested: true, reason: '', isCritical: false });
        manager.submitRequest({ groupId: 'g2', groupPriority: 1, actuatorId: 'act-2', requested: 60, reason: '', isCritical: false });
        const all = manager.resolveAll();
        expect(all.size).toBe(2);
        expect(all.get('act-1')!.finalCommand).toBe(true);
        expect(all.get('act-2')!.finalCommand).toBe(60);
    });

    it('clearCycle leert alle Anforderungen', () => {
        manager.submitRequest({ groupId: 'g1', groupPriority: 1, actuatorId: 'act-1', requested: true, reason: '', isCritical: false });
        manager.clearCycle();
        expect(manager.resolve('act-1')).toBeNull();
    });

    it('allRequests enthält alle Anforderungen', () => {
        manager.submitRequest({ groupId: 'g1', groupPriority: 1, actuatorId: 'act-1', requested: true, reason: 'R1', isCritical: false });
        manager.submitRequest({ groupId: 'g2', groupPriority: 2, actuatorId: 'act-1', requested: false, reason: 'R2', isCritical: false });
        const result = manager.resolve('act-1');
        expect(result!.allRequests).toHaveLength(2);
    });
});

// ---- Abstimmungs-Tests ----

describe('SharedActorManager – Abstimmung (resolveWithVoting)', () => {
    let manager: SharedActorManager;

    beforeEach(() => {
        manager = new SharedActorManager();
    });

    // Eigentümer-Stimme: weight=1.0. EIN-Stimmen haben urgency=1.0, AUS-Stimmen (in Sollbereich) urgency=0.
    function ownerVote(actuatorId: string, groupId: string, wantsOn: boolean): void {
        manager.submitVote(actuatorId, { groupId, wantsOn, weight: 1.0, urgency: wantsOn ? 1.0 : 0, reason: 'Eigentümer' });
    }

    // Teilnehmer-Stimme. urgency optional: EIN-Standard 0.5, AUS-Standard 0 (in Sollbereich).
    // Für Überschreitungs-Veto urgency explizit > 0 übergeben.
    function vote(actuatorId: string, groupId: string, wantsOn: boolean, weight: number, urgency?: number): void {
        manager.submitVote(actuatorId, { groupId, wantsOn, weight, urgency: urgency ?? (wantsOn ? 0.5 : 0), reason: 'Test' });
    }

    it('Modus "any": EIN wenn Eigentümer EIN will', () => {
        ownerVote('act-1', 'owner', true);
        const cmd = manager.resolveWithVoting('act-1', 'any', 0, 'owner', false);
        expect(cmd).toBe(true);
    });

    it('Modus "any": AUS wenn Teilnehmer EIN will (urgency 0.5) aber Eigentümer AUS — kein kritischer Bedarf', () => {
        ownerVote('act-1', 'owner', false);
        vote('act-1', 'p1', true, 0.5);
        const cmd = manager.resolveWithVoting('act-1', 'any', 0, 'owner', false);
        expect(cmd).toBe(false);
    });

    it('Modus "any": EIN wenn Teilnehmer kritischen Bedarf hat (urgency >= 0.7), auch wenn Eigentümer AUS', () => {
        ownerVote('act-1', 'owner', false);
        manager.submitVote('act-1', { groupId: 'p1', wantsOn: true, weight: 1.0, urgency: 0.7, reason: 'kritisch' });
        const cmd = manager.resolveWithVoting('act-1', 'any', 0, 'owner', false);
        expect(cmd).toBe(true);
    });

    it('Modus "any": AUS wenn alle AUS wollen', () => {
        ownerVote('act-1', 'owner', false);
        vote('act-1', 'p1', false, 0.8);
        const cmd = manager.resolveWithVoting('act-1', 'any', 0, 'owner', false);
        expect(cmd).toBe(false);
    });

    it('Modus "majority": EIN wenn Gewichte für EIN überwiegen', () => {
        ownerVote('act-1', 'owner', false);  // Eigentümer AUS (weight=1.0 → AUS: 1.0)
        vote('act-1', 'p1', true, 0.8);     // Teilnehmer EIN (weight=0.8)
        vote('act-1', 'p2', true, 0.8);     // Teilnehmer EIN (weight=0.8) → EIN: 1.6 > AUS: 1.0
        const cmd = manager.resolveWithVoting('act-1', 'majority', 0, 'owner', false);
        expect(cmd).toBe(true);
    });

    it('Modus "majority": AUS wenn Gewichte für AUS überwiegen', () => {
        ownerVote('act-1', 'owner', false);  // Eigentümer AUS (weight=1.0 → AUS: 1.0)
        vote('act-1', 'p1', true, 0.4);     // Teilnehmer EIN (weight=0.4) → EIN: 0.4 < AUS: 1.0
        const cmd = manager.resolveWithVoting('act-1', 'majority', 0, 'owner', false);
        expect(cmd).toBe(false);
    });

    it('Modus "primary": Eigentümer EIN → EIN', () => {
        ownerVote('act-1', 'owner', true);
        vote('act-1', 'p1', false, 1.0);
        const cmd = manager.resolveWithVoting('act-1', 'primary', 0, 'owner', false);
        expect(cmd).toBe(true);
    });

    it('Modus "primary": Eigentümer AUS, Teilnehmer Hochgewicht EIN → EIN', () => {
        ownerVote('act-1', 'owner', false);
        vote('act-1', 'p1', true, 0.8);  // weight >= 0.8 → Hochgewicht
        const cmd = manager.resolveWithVoting('act-1', 'primary', 0, 'owner', false);
        expect(cmd).toBe(true);
    });

    it('Modus "primary": Eigentümer AUS, Teilnehmer Niedriggewicht EIN → AUS', () => {
        ownerVote('act-1', 'owner', false);
        vote('act-1', 'p1', true, 0.5);  // weight < 0.8 → kein Override
        const cmd = manager.resolveWithVoting('act-1', 'primary', 0, 'owner', false);
        expect(cmd).toBe(false);
    });

    it('any: Teilnehmer-VPD-Überschreitung (urgency>0) → hartes AUS-Veto auch wenn Owner EIN', () => {
        ownerVote('act-1', 'owner', true);           // Owner braucht Entfeuchter
        vote('act-1', 'p1', false, 1.0, 0.8);       // Teilnehmer VPD > vpdMax (urgency=0.8)
        const cmd = manager.resolveWithVoting('act-1', 'any', 0, 'owner', false);
        expect(cmd).toBe(false);
    });

    it('majority: kleiner Überschuss kann von großem Restbedarf überstimmt werden', () => {
        ownerVote('act-1', 'owner', true);                   // Owner EIN (urgency=1.0)
        vote('act-1', 'p1', false, 1.0, 0.1);               // Teilnehmer: VPD leicht über Max (urgency=0.1)
        // onWeight = 1×(1+1.0)=2.0, offWeight = 1×(1+0.1)=1.1 → EIN gewinnt
        const cmd = manager.resolveWithVoting('act-1', 'majority', 0, 'owner', false);
        expect(cmd).toBe(true);
    });

    it('majority: großer Überschuss schlägt kleinen Restbedarf', () => {
        ownerVote('act-1', 'owner', true);                   // Owner EIN (urgency=1.0)
        vote('act-1', 'p1', false, 1.0, 0.8);               // Teilnehmer: VPD weit über Max (urgency=0.8)
        // onWeight = 1×2.0=2.0, offWeight = 1×(1+0.8)=1.8 → EIN gewinnt knapp
        const cmd1 = manager.resolveWithVoting('act-1', 'majority', 0, 'owner', false);
        expect(cmd1).toBe(true);  // Knapp, aber Owner-Urgency überwiegt noch

        manager.clearCycle();
        // Mit zwei Teilnehmern die blockieren: offWeight = 2×1.8 = 3.6 > onWeight 2.0 → AUS
        vote('act-1', 'p1', false, 1.0, 0.8);
        vote('act-1', 'p2', false, 0.8, 0.8);
        ownerVote('act-1', 'owner', true);
        const cmd2 = manager.resolveWithVoting('act-1', 'majority', 0, 'owner', false);
        expect(cmd2).toBe(false);
    });

    it('Hysterese: Zustandswechsel wird erst nach Ablauf übernommen', () => {
        // Aktuell: false, neuer Beschluss: true
        ownerVote('act-1', 'owner', true);
        // hysteresis = 60s → Änderung noch nicht übernehmen
        const cmd1 = manager.resolveWithVoting('act-1', 'any', 60, 'owner', false);
        expect(cmd1).toBe(false);  // Noch alter Zustand

        // Zweiter Zyklus: gleiche Richtung, aber clearCycle hat pendingChange nicht gelöscht
        // (resolvedState und pendingChange bleiben über clearCycle hinaus erhalten)
        manager.clearCycle();
        ownerVote('act-1', 'owner', true);
        // Immer noch innerhalb der 60s Hysterese
        const cmd2 = manager.resolveWithVoting('act-1', 'any', 60, 'owner', false);
        expect(cmd2).toBe(false);
    });

    it('Hysterese = 0: Zustandswechsel sofort', () => {
        ownerVote('act-1', 'owner', true);
        const cmd = manager.resolveWithVoting('act-1', 'any', 0, 'owner', false);
        expect(cmd).toBe(true);
    });

    it('clearCycle löscht votes und requests für nächsten Zyklus', () => {
        // Erster Zyklus: Eigentümer will EIN → resolvedState = true
        ownerVote('act-1', 'owner', true);
        const cmd1 = manager.resolveWithVoting('act-1', 'any', 0, 'owner', false);
        expect(cmd1).toBe(true);

        // Nach clearCycle: Kein neuer Request → keine Anforderung
        manager.clearCycle();

        // Zweiter Zyklus: Eigentümer will wieder EIN
        ownerVote('act-1', 'owner', true);
        const cmd2 = manager.resolveWithVoting('act-1', 'any', 0, 'owner', false);
        // resolvedState ist true, rawCommand ist true → kein Wechsel → true
        expect(cmd2).toBe(true);
    });
});

