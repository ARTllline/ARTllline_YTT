import { describe, expect, it, vi } from 'vitest';
import { interactions } from './model';
import { request } from '../../api/client';
vi.mock('../../api/client', () => ({ request: vi.fn().mockResolvedValue({ accepted: true }) }));

describe('object interaction commands', () => {
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
