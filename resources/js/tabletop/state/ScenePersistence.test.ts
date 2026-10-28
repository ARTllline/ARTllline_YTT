import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, type Mutation } from '../../api/workspace';
import { SceneStore } from './SceneStore';
import { ScenePersistence } from './ScenePersistence';
import { SaveQueue } from './SaveQueue';
import { createDemoScene } from './demoScene';

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('persistent scene commands', () => {
    it('hydrates a different snapshot without selection or preview from the previous scene', () => {
        const store = new SceneStore(createDemoScene());
        store.select('kern');
        store.previewMove('kern', { x: 1, y: 2 });
        const snapshot = { ...createDemoScene(), id: '2', revision: 17, map: null, tokens: [] };
        store.hydrate(snapshot);
        expect(store.getSnapshot()).toEqual({ scene: snapshot, selectedIds: [], preview: null });
    });
    it('sends no requests for previews and one move command for the committed drop', async () => {
        const store = new SceneStore(createDemoScene());
        const persistence = new ScenePersistence(store, '1');
        const move = vi.spyOn(api, 'move').mockResolvedValue({ revision: 1 });
        const patch = vi.spyOn(api, 'token');
        for (let x = 0; x < 20; x++) store.previewMove('kern', { x, y: 50 });
        expect(move).not.toHaveBeenCalled();
        store.moveToken('kern', { x: 120.25, y: 44.75 });
        await persistence.queue.flush();
        expect(move).toHaveBeenCalledExactlyOnceWith('kern', { x: 120.25, y: 44.75 });
        expect(patch).not.toHaveBeenCalled();
        expect(store.getSnapshot().scene.revision).toBe(1);
    });
    it('coalesces grid edits and flushes them before navigation', async () => {
        vi.useFakeTimers();
        const store = new SceneStore(createDemoScene());
        const persistence = new ScenePersistence(store, '1');
        const grid = vi.spyOn(api, 'grid').mockResolvedValue({ revision: 2 });
        store.updateGrid({ size: 75 });
        store.updateGrid({ size: 80 });
        store.updateGrid({ snap: false });
        expect(grid).not.toHaveBeenCalled();
        await persistence.queue.flush();
        expect(grid).toHaveBeenCalledTimes(1);
        expect(grid.mock.calls[0][1]).toMatchObject({ size: 80, snap: false });
        expect(persistence.queue.getSnapshot().status).toBe('saved');
    });
    it('does not overwrite a newer optimistic edit with an older accepted response', async () => {
        const scene = createDemoScene();
        const token = scene.tokens[0];
        const store = new SceneStore(scene);
        const persistence = new ScenePersistence(store, '1');
        let first!: (value: Mutation) => void;
        let second!: (value: Mutation) => void;
        vi.spyOn(api, 'token')
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        first = resolve;
                    }),
            )
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        second = resolve;
                    }),
            );
        store.updateToken(token.id, { x: 100 });
        store.updateToken(token.id, { x: 200 });
        first({ revision: 1, token: { ...token, x: 100 } });
        await Promise.resolve();
        await Promise.resolve();
        expect(store.getSnapshot().scene.tokens[0].x).toBe(200);
        second({ revision: 2, token: { ...token, x: 200 } });
        await persistence.queue.flush();
        expect(store.getSnapshot().scene.revision).toBe(2);
        expect(store.getSnapshot().scene.tokens[0].x).toBe(200);
    });
    it('keeps failed commands and later edits until an explicit successful retry', async () => {
        const queue = new SaveQueue();
        const order: string[] = [];
        const first = vi
            .fn()
            .mockRejectedValueOnce(new Error('Connection lost'))
            .mockImplementationOnce(async () => {
                order.push('first');
            });
        queue.enqueue('token', first);
        await expect(queue.flush()).rejects.toThrow('Connection lost');
        queue.enqueue('map', async () => {
            order.push('second');
        });
        expect(queue.getSnapshot()).toEqual({ status: 'failed', error: 'Connection lost' });
        expect(order).toEqual([]);
        queue.retry();
        await queue.flush();
        expect(order).toEqual(['first', 'second']);
        expect(queue.getSnapshot()).toEqual({ status: 'saved', error: null });
    });
});
