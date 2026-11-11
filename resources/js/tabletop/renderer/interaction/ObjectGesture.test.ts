import { expect, it, vi } from 'vitest';
import { ObjectGesture } from './ObjectGesture';
import { SceneStore } from '../../state/SceneStore';
import { createDemoScene } from '../../state/demoScene';
import type { SceneProp } from '../../types/scene';
import type { TokenLayer } from '../../layers/TokenLayer';
import type { ScenePropLayer } from '../../layers/ScenePropLayer';
import type { InteractionLayer } from '../../layers/InteractionLayer';

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
    const tokens = {
        hit: vi.fn<() => string | null>(() => null),
        finishMovement: vi.fn(),
        preview: vi.fn(),
    };
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
        {
            showMovement: vi.fn(),
            showSelectionTransform: vi.fn(),
            clear: vi.fn(),
        } as unknown as InteractionLayer,
    );
    const command = vi.fn();
    store.bindCommands(command);
    return { store, props, tokens, gesture, command };
}
it('previews mixed movement without commands and commits one snapped anchor on release', () => {
    const { store, props, gesture, command } = fixture();
    store.selectObjects({ tokenIds: ['kern'], propIds: ['p'] });
    gesture.down({ x: 100, y: 200 }, false, 1);
    gesture.move({ x: 180, y: 250 }, 1);
    expect(command).not.toHaveBeenCalled();
    expect(props.preview).toHaveBeenLastCalledWith('p', { x: 210, y: 270 });
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
    expect(props.preview).toHaveBeenCalledTimes(1); // The unchanged final sample reuses the preview.
    expect(store.getSnapshot().scene.props?.[0]).toMatchObject({ x: 100, y: 200 });
});
it('resizes in rotated local coordinates and restores preview on cancellation', () => {
    const { props, gesture, command } = fixture(true);
    gesture.down({ x: 0, y: 0 }, false, 1);
    gesture.move({ x: 0, y: 40 }, 1);
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
    gesture.move({ x: 500, y: 500 }, 1);
    gesture.up({ x: 500, y: 500 });
    expect(command).not.toHaveBeenCalled();
});

it('Preparation uses one authoring command and previews actual mixed members, independent of movement range', () => {
    const { store, tokens, props, gesture, command } = fixture();
    store.setEntityAuthoring(true);
    store.selectObjects({ tokenIds: ['kern'], propIds: ['p'] });
    gesture.down({ x: 100, y: 200 }, false, 1);
    gesture.move({ x: 180, y: 250 }, 1);
    expect(props.preview).toHaveBeenLastCalledWith('p', { x: 210, y: 270 });
    const token = store.getSnapshot().scene.tokens.find((t) => t.id === 'kern')!;
    expect(tokens.preview).toHaveBeenLastCalledWith('kern', { x: token.x + 110, y: token.y + 70 });
    expect(command).not.toHaveBeenCalled();
    gesture.up({ x: 180, y: 250 });
    expect(command).toHaveBeenCalledTimes(1);
    expect(command.mock.calls[0][0].command.data).toMatchObject({
        action: 'translate',
        expected: [
            { kind: 'token', id: 'kern', x: token.x, y: token.y },
            { kind: 'prop', id: 'p', x: 100, y: 200 },
        ],
    });
    expect(store.selection()).toEqual({ tokenIds: ['kern'], propIds: ['p'] });
});
it('Preparation handles a single token through authoring and collapses a group on click only', () => {
    const { store, tokens, props, gesture, command } = fixture();
    store.setEntityAuthoring(true);
    tokens.hit.mockReturnValue('kern');
    expect(gesture.down({ x: 20, y: 20 }, false, 0.2)).toBe(true);
    expect(tokens.hit).toHaveBeenCalledWith({ x: 20, y: 20 }, 30);
    gesture.up({ x: 20, y: 20 });
    expect(command).not.toHaveBeenCalled();
    store.selectObjects({ tokenIds: ['kern'], propIds: ['p'] });
    gesture.down({ x: 20, y: 20 }, false, 1);
    gesture.up({ x: 20, y: 20 });
    expect(store.selection()).toEqual({ tokenIds: ['kern'], propIds: [] });
    expect(props.resize).not.toHaveBeenCalled();
});
it('Preparation cancellation restores all previews and remote position edits cancel the gesture', () => {
    const { store, tokens, props, gesture, command } = fixture();
    store.setEntityAuthoring(true);
    store.selectObjects({ tokenIds: ['kern'], propIds: ['p'] });
    gesture.down({ x: 100, y: 200 }, false, 1);
    gesture.move({ x: 180, y: 250 }, 1);
    gesture.cancel();
    expect(tokens.preview).toHaveBeenLastCalledWith(
        'kern',
        expect.objectContaining({ id: 'kern' }),
    );
    expect(props.preview).toHaveBeenLastCalledWith(
        'p',
        expect.objectContaining({ x: 100, y: 200 }),
    );
    gesture.down({ x: 100, y: 200 }, false, 1);
    gesture.move({ x: 180, y: 250 }, 1);
    const scene = store.getSnapshot().scene;
    store.reconcile({ ...scene, props: scene.props!.map((p) => ({ ...p, x: 101 })) });
    gesture.preview();
    gesture.up({ x: 180, y: 250 });
    expect(command).not.toHaveBeenCalled();
    expect(store.getSnapshot().editorNotice).toContain('Группа изменилась');
});

it('a blocked authoring group cannot move but a click can still select just one member', () => {
    const { store, gesture, command } = fixture(false, true);
    store.setEntityAuthoring(true);
    store.selectObjects({ tokenIds: ['kern'], propIds: ['p'] });
    gesture.down({ x: 100, y: 200 }, false, 1);
    gesture.move({ x: 300, y: 300 }, 1);
    gesture.up({ x: 300, y: 300 });
    expect(command).not.toHaveBeenCalled();
    expect(store.selection()).toEqual({ tokenIds: ['kern'], propIds: ['p'] });
    gesture.down({ x: 100, y: 200 }, false, 1);
    gesture.up({ x: 100, y: 200 });
    expect(store.selection()).toEqual({ tokenIds: [], propIds: ['p'] });
    expect(store.getSnapshot().editorNotice).toContain('разблокируйте');
});

it('does not persist a Preparation drag that snaps back to the original anchor', () => {
    const { store, gesture, command } = fixture();
    store.setEntityAuthoring(true);
    store.reconcile({
        ...store.getSnapshot().scene,
        props: store.getSnapshot().scene.props!.map((p) => ({ ...p, x: 90, y: 210 })),
    });
    gesture.down({ x: 90, y: 210 }, false, 1);
    gesture.move({ x: 95, y: 215 }, 1);
    gesture.up({ x: 95, y: 215 });
    expect(command).not.toHaveBeenCalled();
});
