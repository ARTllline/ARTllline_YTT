import { afterEach, expect, it, vi } from 'vitest';
import { SceneStore } from '../tabletop/state/SceneStore';
import { createDemoScene } from '../tabletop/state/demoScene';
import { watchWorkspaceSelection } from './useWorkspaceSelection';

class Canvas {}
afterEach(() => vi.unstubAllGlobals());
function fixture() {
    vi.stubGlobal('HTMLCanvasElement', Canvas);
    const events = new EventTarget();
    const store = new SceneStore(createDemoScene());
    const change = vi.fn();
    const stop = watchWorkspaceSelection(store, change, events as Window);
    const pointer = (type: string, id = 1) => {
        const event = new Event(type);
        Object.defineProperties(event, {
            pointerId: { value: id },
            target: { value: new Canvas() },
        });
        events.dispatchEvent(event);
    };
    return { store, change, stop, pointer };
}
it('does not open or close panels during a first token drag or multi-selection', async () => {
    const { store, change, stop, pointer } = fixture();
    pointer('pointerdown');
    store.select('kern');
    store.previewMove('kern', { x: 700, y: 500 });
    expect(change).not.toHaveBeenCalled();
    pointer('pointerup', 2);
    await Promise.resolve();
    expect(change).not.toHaveBeenCalled();
    pointer('pointerup');
    expect(change).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(change).toHaveBeenLastCalledWith('kern');
    stop();
});
it('publishes keyboard selection immediately and releases cancelled gestures', async () => {
    const { store, change, stop, pointer } = fixture();
    store.select('mira');
    expect(change).toHaveBeenLastCalledWith('mira');
    pointer('pointerdown');
    store.select(null);
    expect(change).toHaveBeenCalledTimes(1);
    pointer('pointercancel');
    await Promise.resolve();
    expect(change).toHaveBeenLastCalledWith('');
    stop();
});
it('does not update an unmounted workspace after pointer capture is lost', async () => {
    const { store, change, stop, pointer } = fixture();
    pointer('pointerdown');
    store.select('kern');
    pointer('lostpointercapture');
    stop();
    await Promise.resolve();
    store.select('mira');
    expect(change).not.toHaveBeenCalled();
});
