import { expect, it } from 'vitest';
import { reduceEvent, type SceneEvent } from '../../realtime/protocol';
import { SceneStore } from '../state/SceneStore';
import { createDemoScene } from '../state/demoScene';
import type { Scene } from '../types/scene';

it('applies visibility, reveals and removals atomically and rejects stale/gapped updates', () => {
    const scene: Scene = {
        ...createDemoScene(),
        id: '7',
        revision: 1,
        vision: { enabled: true, polygons: [] },
    };
    const revealed = { ...scene.tokens[0], id: 'new' };
    const vision = {
        enabled: true,
        polygons: [
            [
                { x: 10, y: 10 },
                { x: 50, y: 10 },
                { x: 10, y: 50 },
            ],
        ],
    };
    const event: SceneEvent = {
        type: 'vision.updated',
        sceneId: '7',
        revision: 2,
        mutationId: 'a',
        payload: { vision, tokens: [revealed], deletedIds: scene.tokens.map((t) => t.id) },
    };
    const result = reduceEvent(scene, event);
    expect(result).not.toBe('gap');
    if (result === 'gap') return;
    expect(result.tokens).toEqual([revealed]);
    expect(result.vision).toBe(vision);
    expect(reduceEvent(result, event)).toBe(result);
    expect(reduceEvent(scene, { ...event, revision: 3 })).toBe('gap');
    const store = new SceneStore(scene, 'player');
    store.select(scene.tokens[0].id);
    store.accept({ ...event.payload, revision: 2 }, true);
    expect(store.getSnapshot().scene.vision).toBe(vision);
    expect(store.getSnapshot().scene.tokens).toEqual([revealed]);
    expect(store.getSnapshot().selectedIds).toEqual([]);
    store.reconcile(result);
    expect(store.getSnapshot().scene.vision).toBe(vision);
});
