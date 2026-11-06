import { afterEach, expect, it, vi } from 'vitest';
import { PointerController } from './PointerController';
import { ClickToMove } from '../../navigation/ClickToMove';
import { SceneStore } from '../../state/SceneStore';
import { createDemoScene } from '../../state/demoScene';
import type { Camera } from '../camera/Camera';
import type { TokenLayer } from '../../layers/TokenLayer';
import type { InteractionLayer } from '../../layers/InteractionLayer';

vi.hoisted(() => vi.stubGlobal('navigator', { userAgent: '' }));

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function fixture() {
    const canvas = Object.assign(new EventTarget(), {
        style: {},
        clientWidth: 800,
        clientHeight: 600,
        focus: vi.fn(),
        getBoundingClientRect: () => ({ left: 0, top: 0 }),
        setPointerCapture: vi.fn(),
        hasPointerCapture: () => true,
        releasePointerCapture: vi.fn(),
    });
    vi.stubGlobal('window', new EventTarget());
    const store = new SceneStore(createDemoScene(), 'gm');
    const camera = {
        state: { x: 0, y: 0, zoom: 1 },
        stop: vi.fn(),
        pan: vi.fn(),
    };
    const tokens = { selection: vi.fn(), hit: () => null, finishMovement: vi.fn() };
    const overlay = { clear: vi.fn() };
    const controller = new PointerController(
        canvas as unknown as HTMLCanvasElement,
        camera as unknown as Camera,
        store,
        tokens as unknown as TokenLayer,
        overlay as unknown as InteractionLayer,
    );
    const cancel = vi.spyOn(
        (controller as unknown as { clickMove: ClickToMove }).clickMove,
        'cancel',
    );
    const pointer = (type: string, button: number, x = 100, y = 100) =>
        canvas.dispatchEvent(
            Object.assign(new Event(type, { cancelable: true }), {
                button,
                pointerId: 1,
                isPrimary: true,
                clientX: x,
                clientY: y,
            }),
        );
    return { controller, store, camera, tokens, cancel, pointer };
}

it.each(['middle', 'pan'] as const)(
    'keeps click-to-move active throughout a %s camera drag',
    (mode) => {
        const { controller, store, camera, tokens, cancel, pointer } = fixture();
        if (mode === 'pan') store.spatial.setTool('pan');
        const button = mode === 'middle' ? 1 : 0;
        try {
            pointer('pointerdown', button);
            pointer('pointermove', button, 140, 125);
            controller.reapplyPreview();
            pointer('pointerup', button, 140, 125);
            pointer('lostpointercapture', button);
            expect(camera.pan).toHaveBeenCalledWith(40, 25);
            expect(cancel).not.toHaveBeenCalled();
            expect(tokens.finishMovement).not.toHaveBeenCalled();
        } finally {
            controller.destroy();
        }
    },
);

it('still cancels click-to-move when starting a new primary-button selection', () => {
    const { controller, cancel, pointer } = fixture();
    try {
        pointer('pointerdown', 0);
        expect(cancel).toHaveBeenCalledOnce();
    } finally {
        controller.destroy();
    }
});
