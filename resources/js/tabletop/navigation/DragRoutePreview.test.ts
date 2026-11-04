import { afterEach, expect, it, vi } from 'vitest';
import { DragRoutePreview } from './DragRoutePreview';
import { createDemoScene } from '../state/demoScene';
import type { InteractionLayer } from '../layers/InteractionLayer';
import type { RouteResult } from './pathfinding';
import type { Scene } from '../types/scene';

class FakeWorker {
    static instances: FakeWorker[] = [];
    onmessage?: (event: { data: RouteResult }) => void;
    onerror?: () => void;
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() {
        FakeWorker.instances.push(this);
    }
    deliver(
        path = [
            { x: 100, y: 100 },
            { x: 100, y: 200 },
            { x: 300, y: 200 },
            { x: 300, y: 100 },
        ],
    ) {
        this.onmessage?.({ data: { status: 'found', path, length: 400, expanded: 0, elapsed: 0 } });
    }
}
function fixture() {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', FakeWorker);
    const scene = { ...createDemoScene(), props: [], combat: null };
    const token = { ...scene.tokens[0], x: 100, y: 100 };
    const overlay = { showMovement: vi.fn(), showDestination: vi.fn() };
    const preview = new DragRoutePreview(overlay as unknown as InteractionLayer);
    return { scene, token, overlay, preview, target: { x: 300, y: 100 } };
}
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    FakeWorker.instances = [];
});

it('draws the actual detour, not the straight line, at the current zoom', () => {
    const f = fixture();
    f.preview.preview(f.scene, f.token, f.target, 0.29);
    expect(f.overlay.showDestination).toHaveBeenLastCalledWith(
        f.target,
        (f.token.size * f.token.scale) / 2,
        0.29,
        false,
    );
    vi.advanceTimersByTime(0);
    FakeWorker.instances[0].deliver();
    f.preview.preview(f.scene, f.token, f.target, 0.5);
    expect(f.overlay.showMovement.mock.calls[0].at(-1)).toEqual([
        { x: 100, y: 100 },
        { x: 100, y: 200 },
        { x: 300, y: 200 },
        { x: 300, y: 100 },
    ]);
    expect(FakeWorker.instances[0].postMessage).toHaveBeenCalledTimes(1);
    f.preview.cancel();
});

it('coalesces rapid pointer targets and ignores stale paths without creating extra Workers', () => {
    const f = fixture();
    f.preview.preview(f.scene, f.token, f.target, 1);
    vi.advanceTimersByTime(0);
    const worker = FakeWorker.instances[0];
    for (let x = 310; x < 400; x++) f.preview.preview(f.scene, f.token, { x, y: 100 }, 1);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    worker.deliver();
    f.preview.preview(f.scene, f.token, { x: 399, y: 100 }, 1);
    expect(f.overlay.showMovement).not.toHaveBeenCalled();
    vi.advanceTimersByTime(80);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    expect(worker.postMessage.mock.calls[1][0].target).toEqual({ x: 399, y: 100 });
    f.preview.cancel();
});

it('invalidates results on geometry/budget changes and disposes timers and late replies on cancellation', () => {
    const f = fixture();
    f.preview.preview(f.scene, f.token, f.target, 1);
    vi.advanceTimersByTime(0);
    const old = FakeWorker.instances[0];
    const next = { ...f.scene };
    f.preview.preview(next, f.token, f.target, 1);
    expect(old.terminate).toHaveBeenCalledTimes(1);
    old.deliver();
    vi.advanceTimersByTime(0);
    const worker = FakeWorker.instances[1];
    f.preview.cancel();
    worker.deliver();
    vi.advanceTimersByTime(5000);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(f.overlay.showMovement).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
});

it('marks an unreachable target and an over-budget detour without sending commands', () => {
    const f = fixture();
    const scene = {
        ...f.scene,
        grid: { ...f.scene.grid, size: 60, distancePerCell: 5 },
        combat: {
            status: 'active',
            combatants: [{ tokenId: f.token.id, budget: { ownTurn: true, movementRemaining: 20 } }],
        },
    } as unknown as Scene;
    f.preview.preview(scene, f.token, f.target, 1);
    vi.advanceTimersByTime(0);
    FakeWorker.instances[0].deliver();
    f.preview.preview(scene, f.token, f.target, 1);
    expect(f.overlay.showMovement.mock.calls[0][4]).toBe(true); // 33.33 ft detour, not 16.67 ft chord.
    f.preview.preview(scene, f.token, { x: 301, y: 100 }, 1);
    vi.advanceTimersByTime(80);
    FakeWorker.instances[0].onmessage?.({
        data: { status: 'unreachable', path: [], length: 0, expanded: 0, elapsed: 0 },
    });
    f.preview.preview(scene, f.token, { x: 301, y: 100 }, 1);
    expect(f.overlay.showDestination).toHaveBeenLastCalledWith(
        { x: 301, y: 100 },
        (f.token.size * f.token.scale) / 2,
        1,
        true,
    );
    f.preview.cancel();
});
