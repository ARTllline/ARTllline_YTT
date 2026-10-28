import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, type Mutation } from '../../api/workspace';
import { SceneStore } from './SceneStore';
import { ScenePersistence } from './ScenePersistence';
import { SaveQueue } from './SaveQueue';
import { createDemoScene } from './demoScene';
import { ApiError } from '../../api/client';

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('persistent scene commands', () => {
    it('does not replace a queued movement with a debounced note draft sharing its key', async () => {
        const queue = new SaveQueue();
        let release!: () => void;
        const calls: string[] = [];
        queue.enqueue(
            'block',
            () =>
                new Promise<void>((resolve) => {
                    release = resolve;
                }),
        );
        queue.enqueue('note:1', async () => {
            calls.push('move');
        });
        queue.enqueue(
            'note:1',
            async () => {
                calls.push('old text');
            },
            250,
        );
        queue.enqueue(
            'note:1',
            async () => {
                calls.push('latest text');
            },
            250,
        );
        release();
        await queue.flush();
        expect(calls).toEqual(['move', 'latest text']);
    });
    it('resynchronizes a rejected player movement and keeps an understandable error', async () => {
        const scene = { ...createDemoScene(), id: '1', revision: 5 };
        const store = new SceneStore(scene, 'player');
        const persistence = new ScenePersistence(store, '1');
        vi.spyOn(api, 'move').mockRejectedValue(new ApiError('Permission changed', 403));
        vi.spyOn(api, 'snapshot').mockResolvedValue(scene);
        store.moveToken('kern', { x: 999, y: 999 });
        await expect(persistence.queue.flush()).rejects.toThrow('Permission changed');
        expect(store.getSnapshot().scene).toEqual(scene);
    });
    it('reuses the mutation ID on an ambiguous failure instead of creating a second command', async () => {
        const store = new SceneStore(createDemoScene());
        const persistence = new ScenePersistence(store, '1');
        const move = vi
            .spyOn(api, 'move')
            .mockRejectedValueOnce(new Error('Lost response'))
            .mockResolvedValueOnce({ revision: 11 });
        store.moveToken('kern', { x: 90, y: 120 });
        await expect(persistence.queue.flush()).rejects.toThrow('Lost response');
        persistence.queue.retry();
        await persistence.queue.flush();
        expect(move).toHaveBeenCalledTimes(2);
        expect(move.mock.calls[0][2]).toBe(move.mock.calls[1][2]);
    });
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
        expect(move).toHaveBeenCalledExactlyOnceWith(
            'kern',
            { x: 120.25, y: 44.75 },
            expect.any(String),
            undefined,
        );
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
