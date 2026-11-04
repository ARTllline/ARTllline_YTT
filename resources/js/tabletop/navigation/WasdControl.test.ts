import { afterEach, expect, it, vi } from 'vitest';
import { request } from '../../api/client';
import { SceneStore } from '../state/SceneStore';
import { createDemoScene } from '../state/demoScene';
import { WasdControl, directStep, inputDirection } from './WasdControl';
import { movementBlocked } from '../utils/movement';

vi.mock('../../api/client', () => ({ request: vi.fn() }));
afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

function fixture() {
    const events = new EventTarget();
    const canvas = Object.assign(new EventTarget(), { focus: vi.fn() });
    vi.stubGlobal('window', events);
    vi.stubGlobal(
        'document',
        Object.assign(new EventTarget(), {
            querySelector: vi.fn(() => null),
            activeElement: { closest: () => null },
            hidden: false,
        }),
    );
    let now = 0;
    vi.stubGlobal('performance', { now: () => now });
    const scene = createDemoScene();
    const token = {
        ...scene.tokens[0],
        kind: 'player_character' as const,
        x: 100,
        y: 100,
        isLocked: false,
    };
    const store = new SceneStore(
        {
            ...scene,
            id: '5',
            revision: 0,
            tokens: [token],
            props: [],
            mapWorld: null,
            combat: null,
        },
        'gm',
    );
    store.spatial.setConnected(true);
    store.select(token.id);
    const control = new WasdControl(canvas as unknown as HTMLCanvasElement, store, vi.fn());
    const key = (type: string, code: string) =>
        events.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { code }));
    const tick = () => {
        now += 16;
        return control.tick(16, now);
    };
    return { events, token, store, control, key, tick };
}

it('normalizes diagonal input and cancels opposing keys', () => {
    const direction = inputDirection(new Set(['KeyD', 'KeyW']));
    expect(Math.hypot(direction.x, direction.y)).toBeCloseTo(1);
    expect(inputDirection(new Set(['KeyD', 'KeyA']))).toEqual({ x: 0, y: 0 });
});

it('slides along walls, approaches them precisely, and never tunnels through a corner', () => {
    const walls = [
        {
            points: [
                { x: 120, y: 0 },
                { x: 120, y: 200 },
            ],
            padding: 2,
        },
    ];
    let current = { x: 107.98, y: 80 };
    const next = directStep(current, { x: 2, y: 2 }, 10, walls);
    expect(next.x).toBe(current.x);
    expect(next.y).toBe(82);
    expect(movementBlocked(current, next, 10.01, walls)).toBe(false);
    current = { x: 105, y: 80 };
    const near = directStep(current, { x: 10, y: 0 }, 10, walls);
    expect(near.x).toBeGreaterThan(107.9);
    expect(near.x).toBeLessThan(107.99);
    expect(movementBlocked(current, near, 10.01, walls)).toBe(false);
    const bounds = directStep({ x: 10, y: 20 }, { x: -3, y: -3 }, 10, [], {
        width: 100,
        height: 100,
    });
    expect(bounds).toEqual({ x: 10, y: 17 });
});

it('starts immediately, eases a direction change at normalized speed, and stops on keyup', () => {
    const f = fixture();
    vi.mocked(request).mockReturnValue(new Promise(() => {}));
    f.control.toggle();
    f.key('keydown', 'KeyD');
    const a = f.tick()!.position;
    expect(a.x).toBeGreaterThan(100);
    f.key('keyup', 'KeyD');
    f.key('keydown', 'KeyS');
    const b = f.tick()!.position;
    expect(b.x).toBeGreaterThan(a.x);
    expect(b.y).toBeGreaterThan(a.y);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(2.88, 2);
    f.key('keyup', 'KeyS');
    expect(f.tick()!.position).toEqual(b);
    f.key('keydown', 'KeyW');
    const c = f.tick()!.position;
    expect(c.y).toBeLessThan(b.y);
    expect(c.x).toBe(b.x);
    f.control.destroy();
});

it('bounds prediction, never queues requests behind a slow receipt, and stops on blur', async () => {
    const f = fixture();
    let deliver!: (value: unknown) => void;
    vi.mocked(request)
        .mockResolvedValueOnce({ streamId: 'stream', position: f.token })
        .mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    deliver = resolve;
                }),
        );
    f.control.toggle();
    f.key('keydown', 'KeyD');
    f.tick();
    await Promise.resolve();
    for (let i = 0; i < 60; i++) f.tick();
    expect(request).toHaveBeenCalledTimes(2);
    expect(f.tick()!.position.x).toBeLessThanOrEqual(171.802);
    expect(f.store.getSnapshot().scene.tokens[0].x).toBe(100);
    f.events.dispatchEvent(new Event('blur'));
    expect(f.tick()).toBeUndefined();
    expect(f.store.getSnapshot().directControl).toBeUndefined();
    deliver({ revision: 1, token: { ...f.token, x: 135.9 }, tokenMovements: [] });
    await Promise.resolve();
    await Promise.resolve();
    for (let i = 0; i < 60; i++) f.tick();
    expect(request).toHaveBeenCalledTimes(2);
    expect(f.store.directCommandPending).toBe(false);
    f.control.destroy();
});

it('rejects combat and abandons keys on snapshot, deletion, connection loss and selection change', () => {
    const f = fixture();
    f.control.toggle();
    f.store.reconcile({ ...f.store.getSnapshot().scene });
    expect(f.tick()).toBeUndefined();
    f.control.toggle();
    f.store.spatial.setConnected(false);
    expect(f.tick()).toBeUndefined();
    f.store.spatial.setConnected(true);
    f.control.toggle();
    f.store.select(null);
    expect(f.tick()).toBeUndefined();
    f.store.select(f.token.id);
    f.store.reconcile({ ...f.store.getSnapshot().scene, combat: { status: 'active' } as never });
    f.control.toggle();
    expect(f.store.getSnapshot().directControl).toBeUndefined();
    f.control.destroy();
});

it('stops on rejection and requests authoritative recovery without retrying', async () => {
    const f = fixture();
    vi.mocked(request)
        .mockResolvedValueOnce({ streamId: 'stream', position: f.token })
        .mockRejectedValueOnce(Error('Blocked'));
    f.store.onRevisionGap = vi.fn();
    f.control.toggle();
    f.key('keydown', 'KeyW');
    f.tick();
    await Promise.resolve();
    for (let i = 0; i < 20; i++) f.tick();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.store.getSnapshot().directControl).toBeUndefined();
    expect(f.store.onRevisionGap).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(2);
    f.control.destroy();
});

it('reconciles successive receipts using only canonical x/y origins and drains on keyup', async () => {
    const f = fixture();
    let revision = 0;
    vi.mocked(request).mockImplementation(async (url, _method, body) => {
        if (url.endsWith('/start')) return { streamId: 'stream', position: f.token } as never;
        const data = body as { x: number; y: number; origin: unknown };
        expect(Object.keys(data.origin as object).sort()).toEqual(['x', 'y']);
        return { revision: ++revision, token: { ...f.token, x: data.x, y: data.y } } as never;
    });
    f.control.toggle();
    f.key('keydown', 'KeyD');
    for (let i = 0; i < 100; i++) {
        f.tick();
        await Promise.resolve();
    }
    expect(revision).toBeGreaterThan(4);
    const released = f.tick()!.position;
    f.key('keyup', 'KeyD');
    for (let i = 0; i < 80; i++) {
        f.tick();
        await Promise.resolve();
    }
    expect(f.tick()!.position).toEqual(released);
    expect(f.store.getSnapshot().scene.tokens[0].x).toBeCloseTo(released.x, 2);
    expect(f.store.getSnapshot().directControl).toBeDefined();
    f.control.destroy();
});

it('does not consume typing keys and disposes listeners on renderer teardown', () => {
    const f = fixture();
    f.control.toggle();
    vi.stubGlobal('document', {
        querySelector: () => null,
        activeElement: { closest: () => ({}) },
    });
    expect(f.key('keydown', 'KeyW')).toBe(true); // preventDefault was not called.
    expect(f.store.getSnapshot().directControl).toBeUndefined();
    f.control.destroy();
    expect(f.store.toggleDirectControl).toBeUndefined();
    expect(f.key('keydown', 'KeyW')).toBe(true);
});
