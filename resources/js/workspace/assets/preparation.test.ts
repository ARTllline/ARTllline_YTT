import { afterEach, expect, it, vi } from 'vitest';
import { libraryQuery } from '../../api/preparation';
import { readAssetDrag, uploadBatch } from './assetDrag';
import { screenToWorld } from '../../tabletop/utils/coordinates';
import { SceneStore } from '../../tabletop/state/SceneStore';
import { ScenePersistence } from '../../tabletop/state/ScenePersistence';
import { api } from '../../api/workspace';
import { reduceEvent } from '../../realtime/protocol';
import { presentationReducer, type PresentationState } from '../../realtime/handoutPresentation';
import type { Scene, SceneNote } from '../../tabletop/types/scene';
const note: SceneNote = { id: '1', title: 'Secret', body: 'DC 15', icon: 'note', x: 150, y: 200 };
const scene: Scene = {
    id: '1',
    revision: 0,
    width: 1000,
    height: 1000,
    grid: { size: 60, offset: { x: 0, y: 0 }, visible: true, snap: true },
    tokens: [],
    notes: [note],
};
afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});
it('keeps discovery presentation separate from closing, duplicate delivery and other campaigns', () => {
    const handout = {
        id: '1',
        title: 'Letter',
        description: null,
        asset: { id: '2', url: '/api/assets/2', width: 100, height: 100 },
        thumbnailUrl: '/api/assets/2/thumbnail',
    };
    const event = { type: 'handout.shown', campaignId: '6', presentationId: 'first', handout };
    let state: PresentationState = { selected: null, seen: [] };
    state = presentationReducer(state, { type: 'receive', campaignId: '6', event });
    expect(state.selected).toEqual(handout);
    state = presentationReducer(state, { type: 'close' });
    expect(presentationReducer(state, { type: 'receive', campaignId: '6', event })).toBe(state);
    expect(presentationReducer(state, { type: 'receive', campaignId: '7', event })).toBe(state);
    expect(
        presentationReducer(state, {
            type: 'receive',
            campaignId: '6',
            event: { ...event, presentationId: 'again' },
        }).selected,
    ).toEqual(handout);
    expect(presentationReducer(state, { type: 'open', handout }).selected).toEqual(handout);
});
it('combines server filters and escapes search text without losing page and sort', () => {
    const query = new URLSearchParams(
        libraryQuery({
            kind: 'token',
            search: 'goblin & archer',
            tag: '2',
            collection: '3',
            sort: 'name',
            page: 2,
        }),
    );
    expect(Object.fromEntries(query)).toEqual({
        kind: 'token',
        search: 'goblin & archer',
        tag: '2',
        collection: '3',
        sort: 'name',
        page: '2',
    });
});
it('continues a batch after a bad file and reports each independent outcome', async () => {
    const progress = vi.fn();
    const files = [{ name: 'map.png' }, { name: 'bad.svg' }, { name: 'token.webp' }] as File[];
    const upload = vi
        .fn()
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('Use PNG'))
        .mockResolvedValueOnce({});
    await uploadBatch(files, upload, progress);
    expect(upload).toHaveBeenCalledTimes(3);
    expect(progress.mock.calls.filter((c) => c[1] !== 'uploading')).toEqual([
        [0, 'saved'],
        [1, 'failed', 'Use PNG'],
        [2, 'saved'],
    ]);
});
it('distinguishes library payloads from native files and malformed data', () => {
    expect(readAssetDrag('')).toBeNull();
    expect(readAssetDrag('{')).toBeNull();
    expect(readAssetDrag(JSON.stringify({ id: '../secret', kind: 'map' }))).toBeNull();
    const asset = { id: '3', kind: 'token', name: 'Goblin', width: 800, height: 600 };
    expect(readAssetDrag(JSON.stringify(asset))).toEqual(asset);
});
it.each([0.5, 1, 2])('converts viewport drops through camera pan and zoom %s', (zoom) => {
    const camera = { x: -130, y: 42, zoom };
    expect(screenToWorld({ x: 410 * zoom + camera.x, y: 360 * zoom + camera.y }, camera)).toEqual({
        x: 410,
        y: 360,
    });
});
it('hydrates notes and clears private selection on scene replacement', () => {
    const store = new SceneStore(scene);
    store.selectNote('1');
    store.hydrate({ ...scene, id: '2', notes: [] });
    expect(store.getSnapshot().selectedNoteId).toBeUndefined();
    expect(store.getSnapshot().scene.notes).toEqual([]);
    const player = new SceneStore({ ...scene, notes: undefined }, 'player');
    const send = vi.fn();
    player.bindCommands(send);
    player.noteCommand({ action: 'create', x: 1, y: 2 });
    expect(send).not.toHaveBeenCalled();
});
it('applies note events through normal revision ordering, deletion and gap repair', () => {
    const event = {
        sceneId: '1',
        revision: 1,
        mutationId: 'a',
        type: 'note.changed',
        payload: { note: { ...note, body: 'Changed' } },
    };
    const next = reduceEvent(scene, event);
    if (next === 'gap') throw Error('gap');
    expect(next.notes?.[0].body).toBe('Changed');
    expect(reduceEvent(next, event)).toBe(next);
    expect(reduceEvent(next, { ...event, revision: 3 })).toBe('gap');
    const removed = reduceEvent(next, { ...event, revision: 2, payload: { deletedNoteId: '1' } });
    if (removed === 'gap') throw Error('gap');
    expect(removed.notes).toEqual([]);
});
it('coalesces note body drafts, retains them after closing, retries the same command UUID', async () => {
    vi.useFakeTimers();
    const store = new SceneStore(scene),
        persistence = new ScenePersistence(store, '1');
    const send = vi
        .spyOn(api, 'note')
        .mockRejectedValueOnce(new Error('Lost response'))
        .mockResolvedValue({ revision: 1, note: { ...note, body: 'Final' } });
    store.updateNote('1', { body: 'Draft' }, true);
    store.updateNote('1', { body: 'Final' }, true);
    store.selectNote();
    await expect(persistence.queue.flush()).rejects.toThrow('Lost response');
    expect(store.getSnapshot().scene.notes?.[0].body).toBe('Final');
    persistence.queue.retry();
    await persistence.queue.flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][2]).toBe(send.mock.calls[1][2]);
    expect(store.getSnapshot().scene.notes?.[0].body).toBe('Final');
});
