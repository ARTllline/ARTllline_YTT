import { afterEach, expect, it, vi } from 'vitest';
import { calibrateGrid, displayScene, mapSettings, mapState } from './mapWorld';
import { createDemoScene } from './state/demoScene';
import { SceneStore } from './state/SceneStore';
import { ScenePersistence } from './state/ScenePersistence';
import { api } from '../api/workspace';
import * as client from '../api/client';
import { ApiError } from '../api/client';
import { reduceEvent } from '../realtime/protocol';

afterEach(() => vi.restoreAllMocks());
const original = () => ({ ...createDemoScene(), id: '1', revision: 0, mapWorld: null });
it('calibrates world distances and offsets without rescaling the reference or entities', () => {
    const scene = original();
    const settings = mapSettings(scene);
    const calibration = calibrateGrid({ x: 12, y: 18 }, { x: 312, y: 18 }, 5);
    const preview = displayScene(scene, {
        ...settings,
        grid: { ...settings.grid, ...calibration },
    });
    expect(preview.grid).toMatchObject({ size: 60, offset: { x: 12, y: 18 } });
    expect(preview.tokens).toBe(scene.tokens);
    expect(preview.map).toEqual(scene.map ?? null);
    expect(preview.width).toBe(scene.width);
    expect(scene.grid.offset).not.toEqual(calibration.offset);
    expect(() => calibrateGrid({ x: 0, y: 0 }, { x: 0, y: 0 }, 5)).toThrow();
    expect(() => calibrateGrid({ x: 0, y: 0 }, { x: 500, y: 0 }, 0)).toThrow();
});
it('keeps invalid numeric drafts out of grid loops and texture dimensions without changing domain state', () => {
    const scene = original();
    const draft = {
        ...mapSettings(scene),
        width: -10,
        height: Number.NaN,
        grid: { ...scene.grid, size: 0 },
    };
    const preview = displayScene(scene, draft);
    expect(preview.width).toBe(120);
    expect(preview.height).toBe(scene.height);
    expect(preview.grid.size).toBe(20);
    expect(draft.grid.size).toBe(0);
    expect(scene.width).not.toBe(-10);
});
it('keeps draft local and saves a whole setup in one queued command, with safe Undo/Redo', async () => {
    const scene = original();
    const store = new SceneStore(scene);
    const { queue } = new ScenePersistence(store, '1');
    const draft = { ...mapSettings(scene), width: 2400 };
    const expected = mapState(mapSettings(scene), false);
    const world = { schemaVersion: 1, bounds: { x: 0, y: 0, width: 2400, height: scene.height } };
    const result = {
        revision: 1,
        scene: { width: 2400, height: scene.height },
        mapWorld: world,
        map: scene.map,
        grid: scene.grid,
    };
    const save = vi.spyOn(api, 'mapWorld').mockResolvedValue(result);
    store.previewMap(draft);
    expect(store.getSnapshot().scene).toBe(scene);
    expect(save).not.toHaveBeenCalled();
    await store.saveMapWorld(draft, expected);
    await queue.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1].width).toBe(2400);
    expect(save.mock.calls[0][2]).toEqual(expected);
    expect(store.getSnapshot().scene.mapWorld).toEqual(world);
    expect(store.getSnapshot().scene.tokens).toBe(scene.tokens);
    const undo = vi.spyOn(client, 'request').mockResolvedValue({
        revision: 2,
        mapWorld: null,
        scene: { width: scene.width, height: scene.height },
        map: scene.map,
        grid: scene.grid,
    });
    store.previewMap(null);
    store.history!.run();
    await queue.flush();
    expect(undo.mock.calls[0][2]).toMatchObject({
        changes: [{ kind: 'mapWorld', value: { enabled: false } }],
    });
    expect(store.getSnapshot().scene.mapWorld).toBeNull();
    expect(store.getSnapshot().scene.width).toBe(scene.width);
    undo.mockResolvedValue({ ...result, revision: 3 });
    store.history!.run(true);
    await queue.flush();
    expect(store.getSnapshot().scene.mapWorld).toEqual(world);
});
it('recovers a rejected bounds edit without blocking later saves or discarding the draft', async () => {
    const scene = original();
    const store = new SceneStore(scene);
    const { queue } = new ScenePersistence(store, '1');
    const draft = { ...mapSettings(scene), width: 120 };
    store.previewMap(draft);
    vi.spyOn(api, 'mapWorld').mockRejectedValue(new ApiError('Токены за границами', 422));
    vi.spyOn(api, 'snapshot').mockResolvedValue(scene);
    await expect(store.saveMapWorld(draft, mapState(mapSettings(scene), false))).rejects.toThrow(
        'Токены',
    );
    await queue.flush();
    expect(queue.getSnapshot().status).toBe('saved');
    expect(store.getSnapshot().scene).toEqual(scene);
    expect(store.getSnapshot().mapDraft).toBe(draft);
    const player = new SceneStore(scene, 'player');
    new ScenePersistence(player, '1');
    await expect(player.saveMapWorld(draft, mapState(mapSettings(scene), false))).rejects.toThrow(
        'мастер',
    );
});
it('applies and removes MapWorld with the normal ordered scene patches and gap detection', () => {
    const scene = original();
    const event = {
        type: 'map-world.updated',
        sceneId: '1',
        revision: 1,
        mutationId: 'm',
        payload: {
            scene: { width: 2000 },
            mapWorld: { bounds: { x: 0, y: 0, width: 2000, height: 1080 } },
        },
    };
    const next = reduceEvent(scene, event);
    expect(next).toMatchObject({ width: 2000, mapWorld: event.payload.mapWorld });
    if (next === 'gap') throw new Error('unexpected gap');
    expect(reduceEvent(next, event)).toBe(next);
    expect(reduceEvent(scene, { ...event, revision: 3 })).toBe('gap');
    expect(reduceEvent(next, { ...event, revision: 2, payload: { mapWorld: null } })).toMatchObject(
        { mapWorld: null },
    );
});
it('settles a denied edit even when permission loss also prevents resnapshot', async () => {
    const scene = original();
    const store = new SceneStore(scene);
    const { queue } = new ScenePersistence(store, '1');
    vi.spyOn(api, 'mapWorld').mockRejectedValue(new ApiError('Access changed', 403));
    vi.spyOn(api, 'snapshot').mockRejectedValue(new ApiError('Access changed', 403));
    await expect(
        store.saveMapWorld(mapSettings(scene), mapState(mapSettings(scene), false)),
    ).rejects.toThrow('Access changed');
    await queue.flush();
    expect(queue.getSnapshot().status).toBe('saved');
    expect(store.getSnapshot().scene).toBe(scene);
});
