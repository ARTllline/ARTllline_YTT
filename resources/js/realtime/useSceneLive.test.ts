import { afterEach, expect, it, vi } from 'vitest';
import { useSceneLive } from './useSceneLive';
import type { LiveEcho } from './useCampaignLive';
import { SceneStore } from '../tabletop/state/SceneStore';
import type { SaveQueue } from '../tabletop/state/SaveQueue';
import { createDemoScene } from '../tabletop/state/demoScene';

const lifecycle = vi.hoisted(() => ({ cleanups: [] as (() => void)[] }));
vi.mock('react', () => ({
    useState: () => ['', vi.fn()],
    useEffect: (effect: () => void | (() => void)) => {
        const cleanup = effect();
        if (cleanup) lifecycle.cleanups.push(cleanup);
    },
}));
afterEach(() => {
    lifecycle.cleanups.splice(0).forEach((cleanup) => cleanup());
});

it('stops immediately during the Pusher retry delay and releases both transport listeners', () => {
    const listeners = new Map<string, (event: { current: string }) => void>();
    const transport = {
        state: 'connected',
        bind: (name: string, listener: (event: { current: string }) => void) =>
            listeners.set(name, listener),
        unbind: (name: string) => listeners.delete(name),
    };
    const store = new SceneStore(createDemoScene(), 'player');
    store.setDirectControl({ tokenId: 'kern', follow: false });
    store.stopDirectControl = vi.fn(() => store.setDirectControl(undefined));
    const queue = {
        getSnapshot: () => ({ status: 'saved' }),
        subscribe: () => () => {},
    } as unknown as SaveQueue;
    useSceneLive(
        { connector: { pusher: { connection: transport } } } as unknown as LiveEcho,
        null,
        store,
        queue,
        'connected',
    );
    expect(store.spatial.connected).toBe(true);
    listeners.get('connecting_in')!({ current: 'connected' });
    expect(transport.state).toBe('connected'); // The SDK has not emitted state_change yet.
    expect(store.spatial.connected).toBe(false);
    expect(store.movementEnabled).toBe(false);
    expect(store.stopDirectControl).toHaveBeenCalledOnce();
    expect(store.getSnapshot().directControl).toBeUndefined();
    lifecycle.cleanups.splice(0).forEach((cleanup) => cleanup());
    expect(listeners.size).toBe(0);
});
