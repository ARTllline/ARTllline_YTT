import { expect, it, vi } from 'vitest';
import { ObjectGesture } from './ObjectGesture';
import { SceneStore } from '../../state/SceneStore';
import { createDemoScene } from '../../state/demoScene';
import type { SceneProp } from '../../types/scene';
import type { TokenLayer } from '../../layers/TokenLayer';
import type { ScenePropLayer } from '../../layers/ScenePropLayer';

function fixture(resize = false, locked = false) {
    const prop: SceneProp = {
        id: 'p',
        name: 'Table',
        x: 100,
        y: 200,
        rotation: 90,
        scaleX: 1,
        scaleY: 1,
        zIndex: 0,
        isLocked: locked,
        image: { id: 'a', url: '/a', width: 400, height: 200 },
    };
    const scene = createDemoScene();
    const store = new SceneStore({
        ...scene,
        grid: { ...scene.grid, size: 60, offset: { x: 0, y: 0 }, snap: true },
        props: [prop],
    });
    const tokens = { hit: vi.fn(() => null), preview: vi.fn() };
    const props = {
        hit: vi.fn(() => 'p'),
        resizeHit: vi.fn(() => (resize ? 'p' : null)),
        preview: vi.fn(),
        resize: vi.fn(),
    };
    const gesture = new ObjectGesture(
        store,
        tokens as unknown as TokenLayer,
        props as unknown as ScenePropLayer,
    );
    const command = vi.fn();
    store.bindCommands(command);
    return { store, props, tokens, gesture, command };
}
it('previews mixed movement without commands and commits one snapped anchor on release', () => {
    const { store, props, gesture, command } = fixture();
    store.selectObjects({ tokenIds: ['kern'], propIds: ['p'] });
    gesture.down({ x: 100, y: 200 }, false, 1);
    gesture.move({ x: 180, y: 250 });
    expect(command).not.toHaveBeenCalled();
    expect(props.preview).toHaveBeenLastCalledWith('p', { x: 180, y: 250 });
    store.subscribe(() => gesture.preview());
    props.preview.mockClear();
    gesture.up({ x: 180, y: 250 });
    expect(command).toHaveBeenCalledTimes(1);
    expect(command.mock.calls[0][0].command.data).toMatchObject({
        tokenIds: ['kern'],
        propIds: ['p'],
        anchorKind: 'prop',
        anchorId: 'p',
        x: 210,
        y: 270,
    });
    expect(props.preview).toHaveBeenCalledTimes(1); // final pointer sample only, no stale preview after optimistic emit
    expect(store.getSnapshot().scene.props?.[0]).toMatchObject({ x: 210, y: 270 });
});
it('resizes in rotated local coordinates and restores preview on cancellation', () => {
    const { props, gesture, command } = fixture(true);
    gesture.down({ x: 0, y: 0 }, false, 1);
    gesture.move({ x: 0, y: 40 });
    expect(props.resize).toHaveBeenLastCalledWith('p', 1.2, 1);
    gesture.cancel();
    expect(props.resize).toHaveBeenLastCalledWith('p', 1, 1);
    expect(command).not.toHaveBeenCalled();
});
it('Shift toggles selection without drag and a locked group never emits movement', () => {
    const { store, gesture, command } = fixture(false, true);
    store.select('kern');
    gesture.down({ x: 100, y: 200 }, true, 1);
    expect(store.selection()).toEqual({ tokenIds: ['kern'], propIds: ['p'] });
    gesture.down({ x: 100, y: 200 }, false, 1);
    gesture.move({ x: 500, y: 500 });
    gesture.up({ x: 500, y: 500 });
    expect(command).not.toHaveBeenCalled();
});
