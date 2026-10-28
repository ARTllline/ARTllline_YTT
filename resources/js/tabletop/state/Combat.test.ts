import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../api/workspace';
import { ApiError } from '../../api/client';
import { reduceEvent } from '../../realtime/protocol';
import { currentTokenId, type Combat } from '../types/combat';
import { SceneStore } from './SceneStore';
import { ScenePersistence } from './ScenePersistence';
import { createDemoScene } from './demoScene';
import type { Token } from '../types/scene';

const combat: Combat = {
    id: '1',
    status: 'active',
    round: 1,
    currentTurn: { combatantId: '10' },
    combatants: [
        { id: '10', tokenId: 'kern', initiative: 20 },
        { id: '11', tokenId: 'mira', initiative: 10 },
    ],
};
const scene = () => ({ ...createDemoScene(), id: '1', revision: 5, combat });
afterEach(() => vi.restoreAllMocks());

it('hydrates and replaces combat together with canonical tokens, clearing turn on end or scene switch', () => {
    const store = new SceneStore(scene());
    expect(currentTokenId(store.getSnapshot().scene.combat)).toBe('kern');
    store.reconcile({
        ...scene(),
        combat: { ...combat, round: 2, currentTurn: { gmHiddenTurn: true }, combatants: [] },
    });
    expect(currentTokenId(store.getSnapshot().scene.combat)).toBeUndefined();
    expect(store.getSnapshot().scene.combat?.round).toBe(2);
    store.hydrate({ ...scene(), id: '2', combat: null, tokens: [] });
    expect(currentTokenId(store.getSnapshot().scene.combat)).toBeUndefined();
});

it('applies deletion and corrected combat in one revision, ignoring duplicates and repairing gaps', () => {
    const next = { ...combat, currentTurn: { gmHiddenTurn: true } as const, combatants: [] };
    const event = {
        type: 'token.removed',
        sceneId: '1',
        revision: 6,
        mutationId: 'a',
        payload: { deletedId: 'kern', combat: next },
    };
    const reduced = reduceEvent(scene(), event);
    expect(reduced).not.toBe('gap');
    if (reduced === 'gap') return;
    expect(reduced.tokens.some((t) => t.id === 'kern')).toBe(false);
    expect(reduced.combat).toEqual(next);
    expect(currentTokenId(reduced.combat)).toBeUndefined();
    expect(reduceEvent(reduced, event)).toBe(reduced);
    expect(reduceEvent(reduced, { ...event, revision: 8 })).toBe('gap');
    const store = new SceneStore(scene());
    store.select('kern');
    store.accept({ revision: 6, ...event.payload }, true);
    expect(store.getSnapshot().selectedIds).toEqual([]);
    expect(store.getSnapshot().scene.combat).toEqual(next);
});

it('replaces token DTO on ownership loss, removing private HP and conditions', () => {
    const initial = scene();
    const owned = {
        ...initial.tokens[0],
        hp: 20,
        maxHp: 30,
        conditions: [{ id: 'c', label: 'Poisoned', key: 'poisoned' }],
        isOwner: true,
    };
    const safe: Token = { ...owned };
    delete safe.hp;
    delete safe.maxHp;
    const reduced = reduceEvent(
        { ...initial, tokens: [owned] },
        {
            type: 'token.updated',
            sceneId: '1',
            revision: 6,
            mutationId: 'a',
            payload: { token: { ...safe, isOwner: false, conditions: [] } },
        },
    );
    if (reduced === 'gap') throw Error('unexpected gap');
    expect(reduced.tokens[0]).not.toHaveProperty('hp');
    expect(reduced.tokens[0]).not.toHaveProperty('maxHp');
    expect(reduced.tokens[0].conditions).toEqual([]);
});

it('resyncs a stale turn conflict and finishes that rejected command without retrying against the new turn', async () => {
    const store = new SceneStore(scene());
    const persistence = new ScenePersistence(store, '1');
    const send = vi
        .spyOn(api, 'combat')
        .mockRejectedValueOnce(new ApiError('Turn already changed', 409))
        .mockResolvedValueOnce({ revision: 7, combat: { ...combat, round: 2 } });
    vi.spyOn(api, 'snapshot').mockResolvedValue({
        ...scene(),
        revision: 6,
        combat: { ...combat, currentTurn: { combatantId: '11' } },
    });
    store.combatCommand({
        action: 'next',
        combatId: '1',
        expectedRound: 1,
        expectedCurrentCombatantId: '10',
    });
    await persistence.queue.flush();
    expect(store.getSnapshot().combatNotice).toContain('Turn already changed');
    store.reconcile({ ...store.getSnapshot().scene });
    expect(store.getSnapshot().combatNotice).toContain('Turn already changed');
    expect(store.getSnapshot().scene.combat?.currentTurn).toEqual({ combatantId: '11' });
    expect(persistence.queue.getSnapshot().status).toBe('saved');
    persistence.queue.retry();
    await persistence.queue.flush();
    expect(send).toHaveBeenCalledTimes(1);
    store.combatCommand({
        action: 'next',
        combatId: '1',
        expectedRound: 1,
        expectedCurrentCombatantId: '11',
    });
    await persistence.queue.flush();
    expect(store.getSnapshot().scene.combat?.round).toBe(2);
});

it.each(['hp', 'next'] as const)(
    'retries lost %s response with the same UUID and no optimistic double application',
    async (action) => {
        const store = new SceneStore(scene());
        const persistence = new ScenePersistence(store, '1');
        const token = { ...scene().tokens[0], hp: 15 };
        const send = action === 'hp' ? vi.spyOn(api, 'tokenCombat') : vi.spyOn(api, 'combat');
        send.mockRejectedValueOnce(new Error('Lost response')).mockResolvedValueOnce({
            revision: 6,
            token,
            combat: { ...combat, currentTurn: { combatantId: '11' } },
        });
        if (action === 'hp') store.tokenCombat(token.id, { action: 'hp', delta: -5 });
        else
            store.combatCommand({
                action: 'next',
                combatId: '1',
                expectedRound: 1,
                expectedCurrentCombatantId: '10',
            });
        await expect(persistence.queue.flush()).rejects.toThrow('Lost response');
        expect(store.getSnapshot().scene.revision).toBe(5);
        persistence.queue.retry();
        await persistence.queue.flush();
        expect(send.mock.calls[0][2]).toBe(send.mock.calls[1][2]);
        expect(store.getSnapshot().scene.revision).toBe(6);
        expect(store.getSnapshot().scene.tokens[0].hp).toBe(15);
    },
);
