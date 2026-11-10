import { afterEach, expect, it, vi } from 'vitest';
import { api, type Mutation } from '../../api/workspace';
import { ApiError } from '../../api/client';
import { openingOn, type Graph } from '../structure/model';
import { SceneStore } from './SceneStore';
import { ScenePersistence } from './ScenePersistence';
import { createDemoScene } from './demoScene';

afterEach(() => vi.restoreAllMocks());
function setup() {
    const demo = createDemoScene();
    const graph: Graph = {
        vertices: [
            { id: 'a', x: 0, y: 100 },
            { id: 'b', x: 1400, y: 100 },
        ],
        edges: [{ id: 'wall', a: 'a', b: 'b', thickness: 14, materialVersionId: null }],
        rooms: [],
    };
    const scene = {
        ...demo,
        id: '1',
        revision: 0,
        mapWorld: { bounds: { x: 0, y: 0, width: demo.width, height: demo.height } },
        structure: { graph, hash: 'h0', materials: [] },
    };
    const store = new SceneStore(scene, 'gm');
    store.setMapEditor({ backgroundVisible: true, objectsVisible: true, objectsLocked: true });
    store.spatial.setTool('build');
    const persistence = new ScenePersistence(store, '1');
    const opening = (i: number) =>
        openingOn(graph.edges[0], i % 2 ? 'window' : 'door', (60 + i * 80) / 1400, 32);
    let revision = 0;
    const accept = (value: Graph): Mutation => {
        const before = store.getSnapshot().scene.structure!.hash;
        const hash = `h${++revision}`;
        return {
            revision,
            // MySQL/validation serialize object properties in a different order from snapshots.
            structure: {
                graph: {
                    ...value,
                    vertices: value.vertices.map(({ id, x, y }) => ({ y, id, x })),
                    edges: value.edges.map(
                        (e) => Object.fromEntries(Object.entries(e).reverse()) as typeof e,
                    ),
                },
                hash,
                materials: [],
            },
            structureEdit: {
                before: { hash: before, snapshot: before },
                after: { hash, snapshot: hash },
            },
        };
    };
    return { store, persistence, scene, opening, accept };
}

it('serializes twelve delayed clicks against each confirmed graph and records twelve separate history entries', async () => {
    const { store, persistence, opening, accept } = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    const write = vi.spyOn(api, 'structure').mockImplementation(async (_id, data, expected) => {
        await gate;
        expect(expected).toBe(store.getSnapshot().scene.structure!.hash);
        if (!('value' in data)) throw new Error('Expected graph');
        return accept(data.value);
    });
    for (let i = 0; i < 12; i++) store.placeOpening(opening(i));
    expect(write).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().scene.structure!.graph.openings).toBeUndefined();
    expect(store.getSnapshot().openingPlacements?.every((p) => p.status === 'pending')).toBe(true);
    store.configureBuild({ mode: 'edit' });
    release();
    await persistence.queue.flush();
    expect(write).toHaveBeenCalledTimes(12);
    expect(
        write.mock.calls.map((c) => ('value' in c[1] ? c[1].value.openings?.length : 0)),
    ).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(store.getSnapshot().openingPlacements?.every((p) => p.status === 'confirmed')).toBe(
        true,
    );
    expect(store.history!.getSnapshot()).toMatchObject({
        undo: 'Правка структуры',
        notice: '',
        saving: false,
    });
});

it('Escape removes unsent jobs but preserves the active write; new clicks after cancellation work', async () => {
    const { store, persistence, opening, accept } = setup();
    let release!: () => void;
    const write = vi
        .spyOn(api, 'structure')
        .mockImplementationOnce(
            (_id, data) =>
                new Promise((resolve) => {
                    release = () => resolve(accept(('value' in data && data.value) as Graph));
                }),
        )
        .mockImplementation(async (_id, data) => accept(('value' in data && data.value) as Graph));
    for (let i = 0; i < 12; i++) store.placeOpening(opening(i));
    store.cancelOpeningPlacements();
    store.placeOpening(opening(13));
    release();
    await persistence.queue.flush();
    expect(write).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().scene.structure!.graph.openings).toHaveLength(2);
});

it('rejects duplicate placement and changed supporting geometry without overwriting the current graph', async () => {
    const { store, persistence, opening, accept } = setup();
    let release!: () => void;
    const write = vi.spyOn(api, 'structure').mockImplementationOnce(
        (_id, data) =>
            new Promise((resolve) => {
                release = () => resolve(accept(('value' in data && data.value) as Graph));
            }),
    );
    const same = opening(0);
    store.placeOpening(same);
    store.placeOpening(same);
    release();
    await persistence.queue.flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().openingPlacements?.map((p) => p.status)).toEqual([
        'confirmed',
        'rejected',
    ]);
    persistence.queue.enqueue(
        'block',
        () =>
            new Promise<void>((resolve) => {
                release = resolve;
            }),
    );
    store.placeOpening(opening(2));
    const scene = store.getSnapshot().scene;
    store.reconcile({
        ...scene,
        structure: { ...scene.structure!, graph: { ...scene.structure!.graph, vertices: [] } },
    });
    release();
    await persistence.queue.flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().openingPlacements?.at(-1)?.error).toContain('Стена изменилась');
});

it('a definitive rejection is not confirmed and later clicks continue from the reconciled snapshot', async () => {
    const { store, persistence, scene, opening, accept } = setup();
    const write = vi
        .spyOn(api, 'structure')
        .mockRejectedValueOnce(new ApiError('Conflict', 409))
        .mockImplementation(async (_id, data) => accept(('value' in data && data.value) as Graph));
    vi.spyOn(api, 'snapshot').mockResolvedValue(scene);
    store.placeOpening(opening(0));
    store.placeOpening(opening(1));
    await persistence.queue.flush();
    expect(write).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().openingPlacements?.map((p) => p.status)).toEqual([
        'rejected',
        'confirmed',
    ]);
    expect(store.getSnapshot().scene.structure!.graph.openings).toHaveLength(1);
});

it('bounds the queue and retries an ambiguous request with the same payload and mutation ID', async () => {
    const { store, persistence, opening, accept } = setup();
    const write = vi
        .spyOn(api, 'structure')
        .mockRejectedValueOnce(new Error('Connection lost'))
        .mockImplementation(async (_id, data) => accept(('value' in data && data.value) as Graph));
    for (let i = 0; i < 18; i++) store.placeOpening(opening(i));
    expect(store.getSnapshot().openingPlacements).toHaveLength(16);
    expect(store.getSnapshot().editorNotice).toContain('16');
    await expect(persistence.queue.flush()).rejects.toThrow('Connection lost');
    store.cancelOpeningPlacements();
    persistence.queue.retry();
    await persistence.queue.flush();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]).toEqual(write.mock.calls[0]);
    expect(store.getSnapshot().openingPlacements?.[0].status).toBe('confirmed');
});
