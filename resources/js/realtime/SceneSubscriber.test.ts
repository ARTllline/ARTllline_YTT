import { afterEach, describe, expect, it, vi } from 'vitest';
import { SceneSubscriber } from './SceneSubscriber';
import * as client from '../api/client';
import type { LiveEcho } from './useCampaignLive';
import { SceneStore } from '../tabletop/state/SceneStore';
import { SaveQueue } from '../tabletop/state/SaveQueue';
import { createDemoScene } from '../tabletop/state/demoScene';
import { api } from '../api/workspace';
import type { Scene } from '../tabletop/types/scene';
import type { SceneEvent } from './protocol';
import type { SpatialEvent } from '../tabletop/types/spatial';
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
});
function setup(role: 'gm' | 'player' = 'gm') {
    vi.useFakeTimers();
    let receive!: (event: SceneEvent | SpatialEvent) => void;
    let subscribed!: () => void;
    const channel = {
        listen: (_: string, fn: typeof receive) => {
            receive = fn;
            return channel;
        },
        subscribed: (fn: () => void) => {
            subscribed = fn;
            return channel;
        },
        error: () => channel,
    };
    const echo = { private: () => channel, leave: vi.fn() };
    const scene = { ...createDemoScene(), id: '1', revision: 10 };
    const store = new SceneStore(scene, role);
    const queue = new SaveQueue();
    const subscriber = new SceneSubscriber(
        echo as unknown as LiveEcho,
        'campaign.1.scene.1.gm',
        store,
        queue,
        vi.fn(),
    );
    const event = (revision: number, mutationId = 'remote'): SceneEvent => ({
        type: 'scene.revision',
        sceneId: '1',
        revision,
        mutationId,
        payload: {},
    });
    return {
        store,
        queue,
        subscriber,
        echo,
        scene,
        event,
        receive: (e: SceneEvent | SpatialEvent) => receive(e),
        subscribed: () => subscribed(),
    };
}
describe('scene subscription recovery', () => {
    it('revokes unseen entities and closes vision immediately while a WASD receipt is pending', () => {
        const s = setup('player');
        const id = s.scene.tokens[0].id;
        s.store.select(id);
        s.store.directCommandPending = true;
        s.receive({
            ...s.event(12),
            type: 'vision.updated',
            payload: {
                deletedIds: [id],
                vision: { enabled: true, polygons: [] },
            },
        });
        expect(s.store.getSnapshot().scene.tokens.some((t) => t.id === id)).toBe(false);
        expect(s.store.getSnapshot().selectedIds).toEqual([]);
        expect(s.store.getSnapshot().scene.vision).toEqual({ enabled: true, polygons: [] });
        expect(s.store.getSnapshot().scene.revision).toBe(10);
        s.store.accept(
            { revision: 11, tokens: [...s.scene.tokens], vision: { enabled: false, polygons: [] } },
            true,
        );
        expect(s.store.getSnapshot().scene.tokens.some((t) => t.id === id)).toBe(false);
        expect(s.store.getSnapshot().scene.vision?.enabled).toBe(true);
        s.subscriber.destroy();
    });

    it('restores MapWorld, cropped reference and grid through the existing reconnect snapshot', async () => {
        const s = setup();
        const world = { bounds: { x: 0, y: 0, width: 2200, height: 1400 } };
        const snapshot = {
            ...s.scene,
            revision: 12,
            width: 2200,
            height: 1400,
            mapWorld: world,
            grid: { ...s.scene.grid, size: 80 },
        };
        const read = vi.spyOn(api, 'snapshot').mockResolvedValue(snapshot);
        try {
            await s.subscriber.resync();
            expect(s.store.getSnapshot().scene).toEqual(snapshot);
            s.receive({ ...s.event(13), type: 'map-world.updated', payload: { mapWorld: null } });
            expect(s.store.getSnapshot().scene.mapWorld).toBeNull();
            read.mockResolvedValue({ ...snapshot, revision: 14 });
            s.subscribed();
            await vi.waitFor(() => expect(s.store.getSnapshot().scene.mapWorld).toEqual(world));
        } finally {
            s.subscriber.destroy();
        }
    });
    it('recovers an HTTP probe failure even when the scene revision did not change', async () => {
        const s = setup();
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockRejectedValueOnce(new Error('offline'))
                .mockResolvedValue(new Response(JSON.stringify({ revision: 10 }))),
        );
        const snapshot = vi.spyOn(api, 'snapshot').mockResolvedValue(s.scene);
        await vi.advanceTimersByTimeAsync(15000);
        expect(snapshot).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(15000);
        expect(snapshot).toHaveBeenCalledOnce();
        s.subscriber.destroy();
    });
    it('never lets a slow snapshot overwrite a mutation accepted while the fetch was in flight', async () => {
        const s = setup();
        let finish!: (scene: Scene) => void;
        const snapshot = vi
            .spyOn(api, 'snapshot')
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        finish = resolve;
                    }),
            )
            .mockResolvedValue({ ...s.scene, revision: 11 });
        s.subscribed();
        s.store.accept({ revision: 11 }, true);
        finish(s.scene);
        await Promise.resolve();
        await Promise.resolve();
        expect(s.store.getSnapshot().scene.revision).toBe(11);
        expect(snapshot).toHaveBeenCalledTimes(2);
        s.subscriber.destroy();
    });
    it('resynchronizes a gap, ignores duplicate replay, and resnapshots on subscription recovery', async () => {
        const s = setup();
        const snapshot = vi.spyOn(api, 'snapshot').mockResolvedValue({ ...s.scene, revision: 13 });
        s.receive(s.event(13));
        await Promise.resolve();
        expect(snapshot).toHaveBeenCalledTimes(1);
        expect(s.store.getSnapshot().scene.revision).toBe(13);
        s.receive(s.event(13));
        expect(snapshot).toHaveBeenCalledTimes(1);
        s.subscribed();
        await Promise.resolve();
        expect(snapshot).toHaveBeenCalledTimes(2);
        s.subscriber.destroy();
        expect(s.echo.leave).toHaveBeenCalledOnce();
    });
    it('does not hydrate after disposal even when an old fetch resolves late', async () => {
        const s = setup();
        let complete!: (scene: Scene) => void;
        vi.spyOn(api, 'snapshot').mockImplementation(
            () =>
                new Promise((resolve) => {
                    complete = resolve;
                }),
        );
        s.subscribed();
        s.subscriber.destroy();
        s.store.hydrate({ ...s.scene, id: 'new-scene', revision: 3 });
        complete({ ...s.scene, revision: 999 });
        await Promise.resolve();
        expect(s.store.getSnapshot().scene.id).toBe('new-scene');
        expect(s.store.getSnapshot().scene.revision).toBe(3);
    });
    it('buffers concurrent remote changes and repairs an HTTP acknowledgement that jumps a revision', async () => {
        const s = setup();
        const snapshot = vi.spyOn(api, 'snapshot').mockResolvedValue({ ...s.scene, revision: 12 });
        let finish!: () => void;
        s.queue.enqueue(
            'move',
            () =>
                new Promise<void>((resolve) => {
                    finish = resolve;
                }),
        );
        s.receive(s.event(11));
        s.store.accept({ revision: 12 }, true);
        expect(snapshot).not.toHaveBeenCalled();
        finish();
        await s.queue.flush();
        await Promise.resolve();
        expect(snapshot).toHaveBeenCalledOnce();
        expect(s.store.getSnapshot().scene.revision).toBe(12);
        s.subscriber.destroy();
    });
    it('does not fetch a snapshot after an ordinary acknowledged own movement or duplicate own echo', async () => {
        const s = setup();
        const snapshot = vi.spyOn(api, 'snapshot');
        s.store.trackMutation('own');
        s.queue.enqueue('move', async () => {
            s.receive(s.event(11, 'own'));
            s.store.accept({ revision: 11 }, true);
        });
        await s.queue.flush();
        s.receive(s.event(11, 'own'));
        expect(snapshot).not.toHaveBeenCalled();
        expect(s.store.getSnapshot().scene.revision).toBe(11);
        s.subscriber.destroy();
    });
});

it('ignores other spatial epochs and clears ephemeral projections on disposal', () => {
    const s = setup();
    s.store.spatial.configure({ id: '1', name: 'GM' }, true, 2);
    s.store.spatial.setConnected(true);
    const event: SpatialEvent = {
        type: 'spatial',
        sceneId: '1',
        epoch: 1,
        participant: { id: '2', name: 'Rowan' },
        kind: 'ruler',
        sessionId: 'a',
        startedAt: 1,
        sequence: 1,
        phase: 'update',
        start: { x: 0, y: 0 },
        end: { x: 60, y: 0 },
    };
    s.receive(event);
    expect(s.store.spatial.overlays.size).toBe(0);
    s.receive({ ...event, epoch: 2 });
    expect(s.store.spatial.overlays.size).toBe(1);
    expect(s.store.getSnapshot().scene.revision).toBe(10);
    s.subscriber.destroy();
    s.receive({ ...event, epoch: 2, sequence: 2 });
    expect(s.store.spatial.overlays.size).toBe(0);
});

it('orders concurrent direct-control events before an HTTP receipt without a snapshot or dropped projection', () => {
    const s = setup();
    const snapshot = vi.spyOn(api, 'snapshot');
    s.store.directCommandPending = true;
    const grid = { ...s.scene.grid, size: 123 };
    s.receive({ ...s.event(11), payload: { grid } });
    expect(s.store.getSnapshot().scene.revision).toBe(10);
    s.store.onMovementReceipt?.(12);
    s.store.accept({ revision: 12 }, true);
    s.store.directCommandPending = false;
    s.store.onMovementSettled?.();
    expect(s.store.getSnapshot().scene.revision).toBe(12);
    expect(s.store.getSnapshot().scene.grid.size).toBe(123);
    expect(snapshot).not.toHaveBeenCalled();
    s.subscriber.destroy();
    expect(s.store.onMovementReceipt).toBeUndefined();
});

it('does not turn periodic revision probes into snapshot resets during a delayed direct-control receipt', async () => {
    const s = setup();
    const read = vi.spyOn(client, 'request').mockResolvedValue({ revision: 11 });
    const snapshot = vi.spyOn(api, 'snapshot');
    s.store.directCommandPending = true;
    await vi.advanceTimersByTimeAsync(15000);
    expect(read).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
    s.store.accept({ revision: 11 }, true);
    s.store.directCommandPending = false;
    s.store.onMovementSettled?.();
    await vi.advanceTimersByTimeAsync(15000);
    expect(read).toHaveBeenCalledOnce();
    expect(snapshot).not.toHaveBeenCalled();
    s.subscriber.destroy();
});

it('orders visibility independently of receipts without cancelling valid own canonical movement', () => {
    const s = setup('player');
    const token = { ...s.scene.tokens[0], canMove: true };
    s.store.reconcile({ ...s.scene, tokens: [token] });
    s.store.directCommandPending = true;
    const closed = { enabled: true, polygons: [] };
    s.receive({ ...s.event(13), type: 'vision.updated', payload: { vision: closed } });
    s.receive({
        ...s.event(11),
        type: 'vision.updated',
        payload: {
            vision: { enabled: false, polygons: [] },
        },
    });
    expect(s.store.getSnapshot().scene.vision).toBe(closed);
    s.store.onMovementReceipt?.(12);
    s.store.accept(
        {
            revision: 12,
            token: { ...token, x: token.x + 10 },
            vision: { enabled: false, polygons: [] },
        },
        true,
    );
    expect(s.store.getSnapshot().scene.tokens[0].x).toBe(token.x + 10);
    expect(s.store.getSnapshot().scene.vision).toBe(closed);
    s.store.directCommandPending = false;
    s.store.onMovementSettled?.();
    expect(s.store.getSnapshot().scene.revision).toBe(13);
    expect(s.store.getSnapshot().scene.vision).toBe(closed);
    s.store.hydrate({ ...s.scene, id: 'other', revision: 1 });
    s.store.accept({ revision: 2, vision: { enabled: false, polygons: [] } }, true);
    expect(s.store.getSnapshot().scene.vision?.enabled).toBe(false);
    s.subscriber.destroy();
});

it('stops control on a real obstacle edit even while an own receipt is pending and the mask is unchanged', () => {
    const s = setup('player');
    s.store.stopDirectControl = vi.fn();
    s.store.directCommandPending = true;
    s.receive({ ...s.event(11), payload: { movementGeometryChanged: true } });
    expect(s.store.stopDirectControl).toHaveBeenCalledOnce();
    s.subscriber.destroy();
});

it('merges ordinary queued movement with earlier/later Reverb deltas without a snapshot', async () => {
    const s = setup('player');
    const token = { ...s.scene.tokens[0], canMove: true };
    s.store.reconcile({ ...s.scene, tokens: [token, ...s.scene.tokens.slice(1)] });
    const snapshot = vi.spyOn(api, 'snapshot');
    let finish!: () => void;
    const waiting = new Promise<void>((resolve) => {
        finish = resolve;
    });
    s.queue.enqueue('move', async () => {
        s.store.queuedMovementPending = true;
        await waiting;
        s.store.onMovementReceipt?.(12);
        s.store.accept(
            { revision: 12, token: { ...token, x: token.x + 10 }, movementGeometryChanged: false },
            true,
        );
        s.store.queuedMovementPending = false;
    });
    const other = { ...s.scene.tokens[1], rotation: 37 };
    s.receive({ ...s.event(11), payload: { token: other, movementGeometryChanged: false } });
    const closed = { enabled: true, polygons: [] };
    s.receive({ ...s.event(13), payload: { vision: closed, movementGeometryChanged: false } });
    finish();
    await s.queue.flush();
    expect(s.store.getSnapshot().scene.revision).toBe(13);
    expect(s.store.getSnapshot().scene.tokens.find((t) => t.id === other.id)?.rotation).toBe(37);
    expect(s.store.getSnapshot().scene.tokens.find((t) => t.id === token.id)?.x).toBe(token.x + 10);
    expect(s.store.getSnapshot().scene.vision).toBe(closed);
    expect(snapshot).not.toHaveBeenCalled();
    s.subscriber.destroy();
});
