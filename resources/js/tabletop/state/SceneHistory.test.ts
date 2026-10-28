import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, type Mutation } from '../../api/workspace';
import * as client from '../../api/client';
import { SceneStore } from './SceneStore';
import { ScenePersistence } from './ScenePersistence';
import { createDemoScene } from './demoScene';
import { historyEntry } from './SceneHistory';
afterEach(() => vi.restoreAllMocks());
describe('bounded confirmed edit history', () => {
    it('drops stale prior values when another accepted edit interleaved', async () => {
        const scene = { ...createDemoScene(), id: '1', revision: 4 };
        const store = new SceneStore(scene),
            { queue } = new ScenePersistence(store, '1');
        vi.spyOn(api, 'move').mockResolvedValue({
            revision: 6,
            token: { ...scene.tokens[0], x: 500, y: 500 },
        });
        store.moveToken(scene.tokens[0].id, { x: 500, y: 500 });
        await queue.flush();
        expect(store.history!.getSnapshot()).toMatchObject({
            undo: '',
            notice: expect.stringContaining('параллельно'),
        });
    });
    it('records only after acknowledgement, undoes/redoes and clears on hydration', async () => {
        const scene = { ...createDemoScene(), id: '1', revision: 0 },
            token = scene.tokens[0];
        const store = new SceneStore(scene),
            { queue } = new ScenePersistence(store, '1');
        let resolve!: (v: Mutation) => void;
        vi.spyOn(api, 'move').mockImplementation(
            () =>
                new Promise((r) => {
                    resolve = r;
                }),
        );
        store.moveToken(token.id, { x: 500, y: 500 });
        expect(store.history!.getSnapshot().undo).toBe('');
        resolve({ revision: 1, token: { ...token, x: 500, y: 500 } });
        await queue.flush();
        expect(store.history!.getSnapshot().undo).toBe('Перемещение');
        const send = vi
            .spyOn(client, 'request')
            .mockResolvedValueOnce({ revision: 2, tokens: [token] })
            .mockResolvedValueOnce({ revision: 3, tokens: [{ ...token, x: 500, y: 500 }] });
        store.history!.run();
        await queue.flush();
        expect(store.getSnapshot().scene.tokens.find((t) => t.id === token.id)!.x).toBe(token.x);
        store.history!.run(true);
        await queue.flush();
        expect(send.mock.calls[1][2]).toMatchObject({
            changes: [{ expected: { x: token.x, y: token.y }, value: { x: 500, y: 500 } }],
        });
        store.hydrate(scene);
        expect(store.history!.getSnapshot().undo).toBe('');
    });
    it('retains the inverse UUID after response loss and resyncs a terminal conflict', async () => {
        const scene = { ...createDemoScene(), id: '1', revision: 0 },
            token = scene.tokens[0];
        const store = new SceneStore(scene),
            { queue } = new ScenePersistence(store, '1');
        vi.spyOn(api, 'move').mockResolvedValue({
            revision: 1,
            token: { ...token, x: 500, y: 500 },
        });
        store.moveToken(token.id, { x: 500, y: 500 });
        await queue.flush();
        const send = vi
            .spyOn(client, 'request')
            .mockRejectedValueOnce(new client.ApiError('Нет связи', 0))
            .mockResolvedValueOnce({ revision: 2, tokens: [token] });
        store.history!.run();
        await expect(queue.flush()).rejects.toThrow();
        queue.retry();
        await queue.flush();
        expect(send.mock.calls[0][2]).toEqual(send.mock.calls[1][2]);
        send.mockRejectedValueOnce(new client.ApiError('Conflict', 409));
        vi.spyOn(api, 'snapshot').mockResolvedValue(scene);
        store.history!.run(true);
        await queue.flush();
        expect(store.history!.getSnapshot()).toMatchObject({
            undo: '',
            redo: '',
            busy: false,
            notice: expect.stringContaining('сцена изменилась'),
        });
    });
    it('does not record HP, combat, creation or a failed mutation', () => {
        const scene = createDemoScene(),
            token = scene.tokens[0];
        expect(
            historyEntry({ type: 'token', id: token.id, patch: { hp: 1 } }, scene, {
                revision: 1,
                token: { ...token, hp: 1 },
            }),
        ).toBeUndefined();
        expect(
            historyEntry({ type: 'move', id: token.id, position: { x: 1, y: 1 } }, scene, {
                revision: 1,
            }),
        ).toBeUndefined();
    });
});
