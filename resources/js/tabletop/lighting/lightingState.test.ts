import { expect, it, vi } from 'vitest';
import { SceneStore } from '../state/SceneStore';
import { createDemoScene } from '../state/demoScene';
import type { LightingFrame } from './model';

const frame = (revision: number, sceneId = '7'): LightingFrame => ({
    type: 'lighting.frame',
    sceneId,
    revision,
    render: null,
});
it('lighting frames never advance canonical revisions, notify React, or interrupt pending movement', () => {
    const store = new SceneStore({ ...createDemoScene(), id: '7', revision: 10 }, 'player');
    const initial = store.getSnapshot(),
        notify = vi.fn(),
        receive = vi.fn();
    store.subscribe(notify);
    store.onLightingFrame = receive;
    store.directCommandPending = true;
    store.queuedMovementPending = true;
    const update = frame(10);
    store.acceptLighting(update);
    expect(receive).toHaveBeenCalledWith(update);
    expect(store.getSnapshot()).toBe(initial);
    expect(store.directCommandPending && store.queuedMovementPending).toBe(true);
    expect(notify).not.toHaveBeenCalled();
});
it('rejects stale/other-scene frames and resets the visual stream on snapshot hydration', () => {
    const store = new SceneStore({ ...createDemoScene(), id: '7', revision: 10 }, 'player');
    const receive = vi.fn(),
        reset = vi.fn();
    store.onLightingFrame = receive;
    store.onLightingReset = reset;
    store.acceptLighting(frame(9));
    store.acceptLighting(frame(10, '8'));
    expect(receive).not.toHaveBeenCalled();
    store.acceptLighting(frame(11));
    store.acceptLighting(frame(10));
    expect(receive).toHaveBeenCalledTimes(1);
    store.hydrate({ ...store.getSnapshot().scene, revision: 12 });
    expect(reset).toHaveBeenCalledOnce();
    expect(store.getLightingFrame()).toBeUndefined();
    store.acceptLighting(frame(11));
    expect(receive).toHaveBeenCalledTimes(1);
});
