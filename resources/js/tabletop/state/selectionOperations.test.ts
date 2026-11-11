import { afterEach, expect, it, vi } from 'vitest';
import { SceneStore } from './SceneStore';
import { ScenePersistence } from './ScenePersistence';
import { historyEntry } from './SceneHistory';
import { createDemoScene } from './demoScene';
import { objects } from '../../api/objects';
import { api } from '../../api/workspace';
import { ApiError } from '../../api/client';

afterEach(() => vi.restoreAllMocks());
function fixture() {
    const demo = createDemoScene();
    const scene = {
        ...demo,
        id: '7',
        revision: 1,
        tokens: demo.tokens
            .slice(0, 2)
            .map((t) => ({ ...t, kind: 'npc' as const, ownerUserId: null, isLocked: false })),
    };
    const store = new SceneStore(scene);
    const { queue } = new ScenePersistence(store, '7');
    store.setEntityAuthoring(true);
    store.selectObjects({ tokenIds: scene.tokens.map((t) => t.id), propIds: [] });
    return { scene, store, queue };
}
it('duplicate preview is local, cancellable, and rejects Player Characters', () => {
    const { store, scene } = fixture();
    const send = vi.fn();
    store.bindCommands(send);
    store.spatial.setTool('ruler');
    store.beginDuplicate();
    expect(store.spatial.getTool()).toBe('select');
    expect(store.getSnapshot().duplicatePlacement?.members).toHaveLength(2);
    expect(store.getSnapshot().scene).toBe(scene);
    store.cancelDuplicate();
    expect(store.getSnapshot().duplicatePlacement).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
    store.reconcile({
        ...scene,
        tokens: [{ ...scene.tokens[0], kind: 'player_character' }, scene.tokens[1]],
    });
    store.beginDuplicate();
    expect(store.getSnapshot().duplicatePlacement).toBeUndefined();
    expect(store.getSnapshot().editorNotice).toContain('Player Characters');
});
it('duplicate is one queued operation, keeps its UUID on retry, and creates one history step', async () => {
    const { store, scene, queue } = fixture();
    const copies = scene.tokens.map((t, i) => ({ ...t, id: `copy${i}`, x: t.x + 50 }));
    const send = vi
        .spyOn(objects, 'command')
        .mockRejectedValueOnce(new ApiError('Нет связи', 0))
        .mockResolvedValue({
            revision: 2,
            tokens: copies,
            selectionEdit: { present: true, snapshot: 'encrypted' },
        });
    store.beginDuplicate();
    store.placeDuplicate({ x: scene.tokens[0].x + 50, y: scene.tokens[0].y });
    await expect(queue.flush()).rejects.toThrow('Нет связи');
    queue.retry();
    await queue.flush();
    expect(send.mock.calls[0][2]).toBe(send.mock.calls[1][2]);
    expect(store.selection().tokenIds).toEqual(copies.map((t) => t.id));
    expect(store.history!.getSnapshot().undo).toBe('Дублирование группы');
    expect(
        historyEntry({ type: 'objects', command: send.mock.calls[0][1] }, scene, {
            revision: 2,
            selectionEdit: { present: true, snapshot: 'encrypted' },
        })?.changes,
    ).toEqual([
        {
            kind: 'selectionPresence',
            id: '7',
            expected: { present: true, snapshot: 'encrypted' },
            value: { present: false, snapshot: 'encrypted' },
        },
    ]);
});
it('remote edits cancel placement safely; a selection change discards the preview', () => {
    const { store, scene } = fixture();
    const send = vi.fn();
    store.bindCommands(send);
    store.beginDuplicate();
    store.reconcile({
        ...scene,
        revision: 2,
        tokens: [{ ...scene.tokens[0], x: 1234 }, scene.tokens[1]],
    });
    store.placeDuplicate({ x: 600, y: 700 });
    expect(send).not.toHaveBeenCalled();
    expect(store.getSnapshot().editorNotice).toContain('Группа изменилась');
    store.beginDuplicate();
    store.select(null);
    expect(store.getSnapshot().duplicatePlacement).toBeUndefined();
});
it('mixed visibility records only changed members using authoritative originals', () => {
    const { scene } = fixture();
    const result = {
        revision: 3,
        tokens: scene.tokens.map((t) => ({ ...t, isHidden: true })),
        selectionVisibilityBefore: {
            tokens: [
                { id: scene.tokens[0].id, isHidden: true },
                { id: scene.tokens[1].id, isHidden: false },
            ],
            props: [],
        },
    };
    const entry = historyEntry(
        {
            type: 'objects',
            command: {
                endpoint: 'selection',
                data: { action: 'hide', tokenIds: scene.tokens.map((t) => t.id), propIds: [] },
            },
        },
        scene,
        result,
    );
    expect(entry?.changes).toEqual([
        {
            kind: 'token',
            id: scene.tokens[1].id,
            expected: { isHidden: true },
            value: { isHidden: false },
        },
    ]);
});
it.each(['duplicate', 'delete', 'hide', 'show'] as const)(
    'terminal %s refusal reconciles without trapping SaveQueue',
    async (action) => {
        const { scene, store, queue } = fixture();
        vi.spyOn(objects, 'command').mockRejectedValue(new ApiError('Объект заблокирован', 409));
        vi.spyOn(api, 'snapshot').mockResolvedValue(scene);
        store.objectCommand({ endpoint: 'selection', data: { action, ...store.selection() } });
        await queue.flush();
        expect(queue.getSnapshot().status).toBe('saved');
        expect(store.getSnapshot().editorNotice).toBe('Объект заблокирован');
        expect(store.selection().tokenIds).toHaveLength(2);
        expect(store.history!.getSnapshot().undo).toBe('');
    },
);
