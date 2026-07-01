// ============================================================
// Tests für SharedActorManager
// ============================================================

import { SharedActorManager } from '../../src/services/SharedActorManager';
import type { SharedActorRequest } from '../../src/services/SharedActorManager';

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
