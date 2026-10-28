import { expect, it, vi, afterEach } from 'vitest';
import { SpatialState } from './SpatialState';
import { SceneStore } from './SceneStore';
import { ScenePersistence } from './ScenePersistence';
import { createDemoScene } from './demoScene';
import { api } from '../../api/workspace';
import { reduceEvent } from '../../realtime/protocol';
import type { SpatialEvent, FogStroke } from '../types/spatial';
const event: SpatialEvent = {
    type: 'spatial',
    sceneId: '1',
    epoch: 1,
    participant: { id: '2', name: 'Rowan' },
    kind: 'ruler',
    sessionId: 'a',
    startedAt: 10,
    sequence: 1,
    phase: 'update',
    start: { x: 0, y: 0 },
    end: { x: 360, y: 0 },
};
afterEach(() => vi.restoreAllMocks());
it('rejects duplicates/out of order/late old sessions and cleans up with terminal state and TTL', () => {
    const state = new SpatialState();
    expect(state.accept(event, 0)).toBe(true);
    expect(state.accept(event, 1)).toBe(false);
    expect(state.accept({ ...event, sequence: 3, phase: 'end' }, 2)).toBe(true);
    expect(state.accept({ ...event, sequence: 4 }, 3)).toBe(false);
    state.expire(5003);
    expect(state.overlays.size).toBe(0);
    state.accept({ ...event, sessionId: 'b', startedAt: 20 }, 6000);
    expect(state.accept({ ...event, sequence: 99 }, 6001)).toBe(false);
    state.accept({ ...event, sessionId: 'b', startedAt: 20, sequence: 2, phase: 'cancel' }, 6002);
    expect(state.overlays.size).toBe(0);
    state.accept({ ...event, sessionId: 'c', startedAt: 30, kind: 'ping' }, 7000);
    state.expire(9201);
    expect(state.overlays.size).toBe(0);
});
it('keeps prepared or offline overlays local and clears on disposal', () => {
    const state = new SpatialState();
    state.onSend = vi.fn();
    state.send(event);
    expect(state.onSend).not.toHaveBeenCalled();
    state.connected = true;
    state.shareActive = true;
    state.send({ ...event, sequence: 2 });
    expect(state.onSend).toHaveBeenCalledOnce();
    state.clear();
    expect(state.overlays.size).toBe(0);
});
const stroke: FogStroke = {
    operation: 'reveal',
    shape: 'brush',
    geometry: { points: [{ x: 10, y: 20 }], radius: 60 },
};
it('applies fog deltas/reset through revision ordering and repairs gaps', () => {
    const scene = { ...createDemoScene(), id: '1', revision: 0 };
    const change = {
        type: 'fog.action',
        sceneId: '1',
        revision: 1,
        mutationId: 'm',
        payload: { fogAction: { ...stroke, id: 'f', sequence: 1 } },
    };
    const next = reduceEvent(scene, change);
    expect(next).not.toBe('gap');
    if (next === 'gap') return;
    expect(next.fog?.actions).toHaveLength(1);
    expect(reduceEvent(next, change)).toBe(next);
    expect(reduceEvent(next, { ...change, revision: 3 })).toBe('gap');
    expect(
        reduceEvent(next, {
            ...change,
            revision: 2,
            payload: { fog: { base: 'covered', actions: [] } },
        }),
    ).toMatchObject({ fog: { base: 'covered', actions: [] } });
});
it('retries one stroke with the same UUID and never replaces later optimistic strokes/reset', async () => {
    const store = new SceneStore({ ...createDemoScene(), id: '1', revision: 0 });
    const persistence = new ScenePersistence(store, '1');
    const send = vi
        .spyOn(api, 'fog')
        .mockRejectedValueOnce(new Error('lost response'))
        .mockResolvedValueOnce({ revision: 1, fogAction: { ...stroke, id: 'f', sequence: 1 } })
        .mockResolvedValueOnce({ revision: 2, fogAction: { ...stroke, id: 'g', sequence: 2 } });
    vi.spyOn(api, 'resetFog').mockResolvedValue({
        revision: 3,
        fog: { base: 'covered', actions: [] },
    });
    store.applyFog(stroke);
    await expect(persistence.queue.flush()).rejects.toThrow('lost response');
    store.applyFog(stroke);
    store.resetFog('covered');
    persistence.queue.retry();
    await persistence.queue.flush();
    expect(send.mock.calls[0][2]).toBe(send.mock.calls[1][2]);
    expect(store.getSnapshot().scene).toMatchObject({
        revision: 3,
        fog: { base: 'covered', actions: [] },
    });
});
