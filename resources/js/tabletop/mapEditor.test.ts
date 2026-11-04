import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/workspace';
import { ApiError } from '../api/client';
import { objects } from '../api/objects';
import { ScenePersistence } from './state/ScenePersistence';
import { SceneStore } from './state/SceneStore';
import { initialEditorView, editorInteractionScene } from './mapEditor';
import { historyEntry } from './state/SceneHistory';
import { materialBody, repeatPixels } from '../workspace/maps/materials';
import { createDemoScene } from './state/demoScene';

const prop = {
    id: '9',
    name: 'Tree',
    image: { id: '4', url: '/api/assets/4', width: 100, height: 50 },
    x: 100,
    y: 200,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    zIndex: 0,
    isHidden: false,
    isLocked: false,
};
afterEach(() => vi.restoreAllMocks());
describe('map editor local interaction boundary', () => {
    it('reconciles rejected Inspector edits, explains the error and releases the editor queue', async () => {
        const scene = { ...createDemoScene(), id: '1', revision: 1, props: [prop] },
            store = new SceneStore(scene);
        const { queue } = new ScenePersistence(store, '1');
        store.setMapEditor(initialEditorView);
        const send = vi
            .spyOn(objects, 'command')
            .mockRejectedValueOnce(new ApiError('Некорректный масштаб', 422))
            .mockResolvedValueOnce({ revision: 2, props: [{ ...prop, rotation: 45 }] });
        vi.spyOn(api, 'snapshot').mockResolvedValue(scene);
        store.objectCommand({
            endpoint: 'props',
            data: { action: 'update', id: prop.id, patch: { scale_x: -1 } },
        });
        await queue.flush();
        expect(store.getSnapshot().scene).toEqual(scene);
        expect(store.getSnapshot().editorNotice).toBe('Некорректный масштаб');
        expect(queue.getSnapshot().status).toBe('saved');
        store.objectCommand({
            endpoint: 'props',
            data: { action: 'update', id: prop.id, patch: { rotation: 45 } },
        });
        await queue.flush();
        expect(send).toHaveBeenCalledTimes(2);
        expect(store.getSnapshot().editorNotice).toBeUndefined();
        expect(store.getSnapshot().scene.props?.[0].rotation).toBe(45);
    });
    it('hiding/locking objects never changes canonical gameplay or persists settings; reconnect retains the local view', () => {
        const scene = { ...createDemoScene(), props: [prop] },
            store = new SceneStore(scene);
        const command = vi.fn();
        store.bindCommands(command);
        store.setMapEditor({ ...initialEditorView, objectsVisible: false });
        store.selectObjects({ tokenIds: [scene.tokens[0].id], propIds: ['9'] });
        expect(store.selection()).toEqual({ tokenIds: [], propIds: [] });
        expect(editorInteractionScene(scene, store.getSnapshot().mapEditor).props).toEqual([]);
        store.objectCommand({
            endpoint: 'selection',
            data: { action: 'delete', tokenIds: [], propIds: ['9'] },
        });
        expect(command).not.toHaveBeenCalled();
        expect(store.getSnapshot().scene).toBe(scene);
        store.reconcile({ ...scene, revision: 2 });
        expect(store.getSnapshot().mapEditor?.objectsVisible).toBe(false);
        store.setMapEditor({ ...initialEditorView, objectsLocked: true });
        expect(editorInteractionScene(scene, store.getSnapshot().mapEditor).props).toEqual([]);
        store.setMapEditor(null);
        expect(editorInteractionScene(scene)).toBe(scene);
        expect(store.getSnapshot().scene.props?.[0]).toEqual(prop);
    });
    it('players cannot enable editor and selection in editor excludes tokens', () => {
        const scene = { ...createDemoScene(), props: [prop] };
        const player = new SceneStore(scene, 'player');
        player.setMapEditor(initialEditorView);
        expect(player.getSnapshot().mapEditor).toBeUndefined();
        const gm = new SceneStore(scene);
        gm.setMapEditor(initialEditorView);
        gm.selectObjects({ tokenIds: [scene.tokens[0].id], propIds: ['9'] });
        expect(gm.selection()).toEqual({ tokenIds: [], propIds: ['9'] });
    });
    it('uses signed server presence snapshots and records every changed inspector/order field', () => {
        const scene = { ...createDemoScene(), props: [prop] };
        const entry = historyEntry(
            {
                type: 'objects',
                command: {
                    endpoint: 'props',
                    data: { action: 'create', assetId: '4', x: 100, y: 200 },
                },
            },
            scene,
            {
                revision: 1,
                props: [prop],
                propEdits: [{ id: '9', snapshot: 'signed', present: true }],
            },
        );
        expect(entry?.changes[0]).toEqual({
            kind: 'propPresence',
            id: '9',
            expected: { present: true, snapshot: 'signed' },
            value: { present: false, snapshot: 'signed' },
        });
        const update = historyEntry(
            {
                type: 'objects',
                command: { endpoint: 'props', data: { action: 'update', id: '9', order: 'front' } },
            },
            scene,
            {
                revision: 1,
                props: [{ ...prop, zIndex: 5, name: 'Oak', isHidden: true, rotation: -45 }],
            },
        );
        expect(update?.changes[0].value).toEqual({
            name: 'Tree',
            rotation: 0,
            zIndex: 0,
            isHidden: false,
        });
    });
    it('keeps material repeat aspect ratio and sends definition fields with expected version', () => {
        const m = {
            name: 'Stone',
            type: 'terrain' as const,
            asset: prop.image,
            repeatSize: 120,
            rotation: 30,
            variation: { offset: true, quarterTurns: false },
            version: 2,
        };
        expect(repeatPixels(m, 0.5)).toEqual({ width: 60, height: 30 });
        expect(materialBody(m)).toEqual({
            name: 'Stone',
            type: 'terrain',
            assetId: '4',
            repeatSize: 120,
            rotation: 30,
            variation: m.variation,
            version: 2,
        });
    });
});
