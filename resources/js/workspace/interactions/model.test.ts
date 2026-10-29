import { describe, expect, it, vi } from 'vitest';
import { interactions, normalizeCheckResult, type CheckResult } from './model';
import { request } from '../../api/client';
vi.mock('../../api/client', () => ({ request: vi.fn().mockResolvedValue({ accepted: true }) }));

describe('object interaction commands', () => {
    it('includes actor and roll mode without accepting submitted modifiers', async () => {
        await interactions.run(
            'scene',
            'prop',
            'object',
            'action',
            3,
            'retry',
            'kern',
            'advantage',
        );
        expect(request).toHaveBeenLastCalledWith('/scenes/scene/interact', 'POST', {
            kind: 'prop',
            id: 'object',
            actionId: 'action',
            epoch: 3,
            clientMutationId: 'retry',
            actorTokenId: 'kern',
            rollMode: 'advantage',
        });
    });
    it('renders old Task 16B receipts without changing their arithmetic', () => {
        const check = normalizeCheckResult({
            natural: 12,
            modifier: 3,
            total: 15,
            label: 'Внимательность',
            tokenId: 'kern',
        } as CheckResult);
        expect(check.rawDice).toEqual([12]);
        expect(check.rollMode).toBe('normal');
        expect(check.provenance.source).toBe('legacy_interaction');
        expect(check.provenance.finalModifier).toBe(3);
        expect(check.total).toBe(15);
    });
    it('sends only object, action, epoch and retry identity; never target configuration', async () => {
        await interactions.run('scene', 'prop', 'object', 'action', 3, 'retry-id');
        expect(request).toHaveBeenCalledWith('/scenes/scene/interact', 'POST', {
            kind: 'prop',
            id: 'object',
            actionId: 'action',
            epoch: 3,
            clientMutationId: 'retry-id',
        });
    });
});
