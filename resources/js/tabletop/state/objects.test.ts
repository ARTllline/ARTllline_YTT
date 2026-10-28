import { afterEach, expect, it, vi } from 'vitest';
import { createDemoScene } from './demoScene';
import { SceneStore } from './SceneStore';
import { ScenePersistence } from './ScenePersistence';
import { objects } from '../../api/objects';
import { reduceEvent, type SceneEvent } from '../../realtime/protocol';
import type { Scene, SceneProp } from '../types/scene';

const prop: SceneProp = {
    id: 'prop1',
    name: 'Table',
    x: 100,
    y: 200,
    rotation: 45,
    scaleX: 1,
    scaleY: 0.5,
    zIndex: 0,
    image: { id: 'asset1', url: '/image', width: 400, height: 200 },
};
const scene = (): Scene => ({ ...createDemoScene(), id: '1', revision: 1, props: [prop] });
afterEach(() => vi.restoreAllMocks());

it('toggles mixed selection, preserves relative layout and removes stale selection after resync', () => {
    const store = new SceneStore(scene());
    store.selectObject('token', 'kern');
    store.selectObject('prop', prop.id, true);
    expect(store.selection()).toEqual({ tokenIds: ['kern'], propIds: [prop.id] });
    const original = store.getSnapshot().scene.tokens.find((t) => t.id === 'kern')!;
    store.objectCommand({
        endpoint: 'selection',
        data: {
            action: 'move',
            ...store.selection(),
            anchorId: prop.id,
            anchorKind: 'prop',
            x: 300,
            y: 500,
        },
    });
    expect(store.getSnapshot().scene.tokens.find((t) => t.id === 'kern')).toMatchObject({
        x: original.x + 200,
        y: original.y + 300,
    });
    store.selectObject('token', 'kern', true);
    expect(store.selection().tokenIds).toEqual([]);
    store.reconcile({ ...scene(), props: [] });
    expect(store.selection().propIds).toEqual([]);
});
it('applies mixed realtime spawn/removal atomically and rejects revision gaps', () => {
    const initial = scene(),
        token = { ...initial.tokens[0], id: 'spawned' };
    const event: SceneEvent = {
        type: 'objects.changed',
        sceneId: '1',
        revision: 2,
        mutationId: 'batch',
        payload: {
            tokens: [token],
            props: [{ ...prop, id: 'newprop' }],
            deletedIds: [initial.tokens[0].id],
            deletedPropIds: [prop.id],
        },
    };
    const result = reduceEvent(initial, event) as Scene;
    expect(result.tokens.some((t) => t.id === 'spawned')).toBe(true);
    expect(result.tokens.some((t) => t.id === initial.tokens[0].id)).toBe(false);
    expect(result.props?.map((p) => p.id)).toEqual(['newprop']);
    expect(result.revision).toBe(2);
    expect(reduceEvent(result, event)).toBe(result);
    expect(reduceEvent(initial, { ...event, revision: 3 })).toBe('gap');
});
it.each(['prefab', 'encounter', 'duplicate'] as const)(
    'retries lost %s responses with the same UUID and accepts a single batch',
    async (kind) => {
        const store = new SceneStore(scene()),
            persistence = new ScenePersistence(store, '1');
        const command = vi
            .spyOn(objects, 'command')
            .mockRejectedValueOnce(new Error('Lost response'))
            .mockResolvedValueOnce({
                revision: 2,
                tokens: [{ ...scene().tokens[0], id: 'newtoken' }],
                props: [{ ...prop, id: 'newprop' }],
            });
        store.objectCommand(
            kind === 'duplicate'
                ? {
                      endpoint: 'selection',
                      data: { action: 'duplicate', tokenIds: ['kern'], propIds: [prop.id] },
                  }
                : {
                      endpoint: 'spawn',
                      data: { templateId: '7', x: 300, y: 400 },
                      encounter: kind === 'encounter' ? 'Patrol' : undefined,
                  },
        );
        await expect(persistence.queue.flush()).rejects.toThrow('Lost response');
        expect(store.objectEditingEnabled).toBe(false);
        persistence.queue.retry();
        await persistence.queue.flush();
        expect(command.mock.calls[0][2]).toBe(command.mock.calls[1][2]);
        expect(store.getSnapshot().scene.props?.filter((p) => p.id === 'newprop')).toHaveLength(1);
        expect(store.selection()).toEqual({ tokenIds: ['newtoken'], propIds: ['newprop'] });
        expect(store.objectEditingEnabled).toBe(true);
        expect(store.getSnapshot().spawnedEncounter?.name).toBe(
            kind === 'encounter' ? 'Patrol' : undefined,
        );
    },
);
