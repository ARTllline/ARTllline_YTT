import { afterEach, expect, it, vi } from 'vitest';
import { Application, EventSystem } from 'pixi.js';
import { TabletopRenderer } from './TabletopRenderer';
import { SceneStore } from '../state/SceneStore';
import { createDemoScene } from '../state/demoScene';

vi.hoisted(() => vi.stubGlobal('navigator', { userAgent: '' }));

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

it('releases the store lighting callback when the renderer is destroyed', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    const store = new SceneStore(createDemoScene(), 'player');
    const renderer = new TabletopRenderer({} as HTMLDivElement, store, vi.fn(), vi.fn());
    store.onLightingFrame = vi.fn();
    store.onLightingReset = vi.fn();
    renderer.destroy();
    expect(store.onLightingFrame).toBeUndefined();
    expect(store.onLightingReset).toBeUndefined();
});

it('leaves pointer ownership with PointerController without retaining HUD events in Pixi', async () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const stop = new Error('renderer options captured before WebGL startup');
    const init = vi.spyOn(Application.prototype, 'init').mockRejectedValue(stop);
    const renderer = new TabletopRenderer(
        {} as HTMLDivElement,
        new SceneStore(createDemoScene(), 'player'),
        vi.fn(),
        vi.fn(),
    );
    await expect(renderer.init()).rejects.toBe(stop);
    const options = init.mock.calls[0][0]!;
    const page = new EventTarget();
    const canvas = Object.assign(new EventTarget(), {
        style: {},
        width: 100,
        height: 100,
        getBoundingClientRect: () => ({ x: 0, y: 0, left: 0, top: 0, width: 100, height: 100 }),
    });
    vi.stubGlobal('document', page);
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('addEventListener', page.addEventListener.bind(page));
    vi.stubGlobal('removeEventListener', page.removeEventListener.bind(page));
    vi.stubGlobal('PointerEvent', Event);
    const events = new EventSystem({ canvas, resolution: 1 } as never);
    const map = vi.spyOn(events.rootBoundary, 'mapEvent').mockImplementation(() => {});
    const input = vi.fn();
    // The actual DOM controller can still receive canvas input independently.
    canvas.addEventListener('pointerdown', input);
    events.init(options);
    try {
        for (let cycle = 0; cycle < 10; cycle++) {
            canvas.dispatchEvent(new Event('pointerdown'));
            page.dispatchEvent(new Event('pointermove'));
            page.dispatchEvent(new Event('pointerup'));
            canvas.dispatchEvent(new Event('wheel'));
        }
        expect(input).toHaveBeenCalledTimes(10);
        expect(map.mock.calls.length).toBe(0);
        expect(events.pointer.nativeEvent).toBeFalsy();
    } finally {
        events.destroy();
    }
});
