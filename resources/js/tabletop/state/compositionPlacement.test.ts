import { afterEach, expect, it, vi } from 'vitest';
import { SceneStore } from './SceneStore';
import { ScenePersistence } from './ScenePersistence';
import { createDemoScene } from './demoScene';
import { objects } from '../../api/objects';
import { api } from '../../api/workspace';
import { ApiError } from '../../api/client';
import * as client from '../../api/client';
import { compositionIssue, type CompositionMember } from '../../api/compositions';

afterEach(() => vi.restoreAllMocks());
function fixture() {
    const scene = { ...createDemoScene(), id: '7', revision: 1 };
    const store = new SceneStore(scene);
    const { queue } = new ScenePersistence(store, '7');
    store.setEntityAuthoring(true);
    return { scene, store, queue };
}
const command = {
    endpoint: 'composition-placement',
    data: { presetId: '12', expectedRevision: 2, x: 500, y: 600 },
} as const;

it('retries a lost composition receipt with one UUID, selects copies and records one complete presence inverse', async () => {
    const { scene, store, queue } = fixture();
    const token = { ...scene.tokens[0], id: 'new-npc', kind: 'npc' as const };
    const send = vi
        .spyOn(objects, 'command')
        .mockRejectedValueOnce(new ApiError('Нет связи', 0))
        .mockResolvedValueOnce({
            revision: 2,
            tokens: [token],
            selectionEdit: { present: true, snapshot: 'server-sealed-graph' },
        });
    store.objectCommand(command);
    await expect(queue.flush()).rejects.toThrow('Нет связи');
    expect(store.getSnapshot().scene.tokens.some((t) => t.id === token.id)).toBe(false);
    queue.retry();
    await queue.flush();
    expect(send.mock.calls[0][2]).toBe(send.mock.calls[1][2]);
    expect(store.selection()).toEqual({ tokenIds: ['new-npc'], propIds: [] });
    expect(store.history!.getSnapshot().undo).toBe('Размещение пресета');
    const history = vi
        .spyOn(client, 'request')
        .mockResolvedValue({ revision: 3, deletedIds: ['new-npc'] });
    store.history!.run();
    await queue.flush();
    expect(history).toHaveBeenCalledTimes(1);
    expect(history.mock.calls[0][2]).toMatchObject({
        changes: [
            {
                kind: 'selectionPresence',
                id: '7',
                expected: { present: true, snapshot: 'server-sealed-graph' },
                value: { present: false, snapshot: 'server-sealed-graph' },
            },
        ],
    });
});

it('reconciles an outdated preset without trapping subsequent placements or adding a history entry', async () => {
    const { scene, store, queue } = fixture();
    const send = vi
        .spyOn(objects, 'command')
        .mockRejectedValueOnce(new ApiError('Пресет изменился', 409))
        .mockResolvedValueOnce({
            revision: 2,
            selectionEdit: { present: true, snapshot: 'next-graph' },
        });
    vi.spyOn(api, 'snapshot').mockResolvedValue(scene);
    store.objectCommand(command);
    await queue.flush();
    expect(queue.getSnapshot().status).toBe('saved');
    expect(store.getSnapshot().editorNotice).toBe('Пресет изменился');
    expect(store.history!.getSnapshot().undo).toBe('');
    store.objectCommand({ ...command, data: { ...command.data, expectedRevision: 3 } });
    await queue.flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][2]).not.toBe(send.mock.calls[1][2]);
    expect(store.history!.getSnapshot().undo).toBe('Размещение пресета');
});

it('validates every relative anchor against coordinate bounds for preview and commit', () => {
    const members = [
        { x: 0, y: 0 },
        { x: 150, y: -250 },
    ] as CompositionMember[];
    expect(compositionIssue(members, 999900, 0)).toContain('границы');
    expect(compositionIssue(members, 0, -999900)).toContain('границы');
    expect(compositionIssue(members, 500, 600)).toBeNull();
    expect(compositionIssue(members, NaN, 0)).toContain('границы');
});
