import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DiceRuntime } from './DiceRuntime';

const probe = vi.hoisted(() => ({
    constructed: 0,
    initialized: 0,
    disposed: 0,
    dimensions: [] as { x: number; y: number }[],
    finishes: [] as ((values: number[]) => void)[],
    resize: [] as (() => void)[],
}));
vi.mock('@3d-dice/dice-box-threejs', () => ({
    default: class {
        diceList = [];
        world = { solver: { iterations: 14 }, removeBody: vi.fn() };
        camera = { position: { x: 0, y: 0, z: 3000, set: vi.fn() }, lookAt: vi.fn() };
        DiceFactory = { create: () => null, geometries: {} };
        scene = { add: vi.fn(), remove: vi.fn(), traverse: vi.fn(), clear: vi.fn() };
        renderer = {
            render: vi.fn(),
            compile: vi.fn(),
            setPixelRatio: vi.fn(),
            dispose: () => probe.disposed++,
            forceContextLoss: vi.fn(),
        };
        constructor() {
            probe.constructed++;
        }
        async initialize() {
            probe.initialized++;
        }
        setDimensions(size: { x: number; y: number }) {
            probe.dimensions.push(size);
        }
        disableShadows() {}
        roll() {
            return new Promise((resolve) =>
                probe.finishes.push((values) =>
                    resolve({ sets: [{ rolls: values.map((value) => ({ value })) }] }),
                ),
            );
        }
    },
}));

class Surface {
    clientWidth = 1200;
    clientHeight = 590;
    dataset: Record<string, string> = {};
    parentNode: Surface | null = null;
    isConnected = true;
    id = '';
    className = '';
    append(surface: Surface) {
        surface.parentNode = this;
    }
    replaceChildren() {}
    remove() {
        this.parentNode = null;
    }
}
const element = () => new Surface() as unknown as HTMLElement;
beforeEach(() => {
    probe.constructed = probe.initialized = probe.disposed = 0;
    probe.dimensions.length = probe.finishes.length = probe.resize.length = 0;
    vi.stubGlobal('document', { createElement: () => new Surface() });
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
    vi.stubGlobal('innerWidth', 1440);
    vi.stubGlobal('devicePixelRatio', 1);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        queueMicrotask(() => callback(performance.now()));
        return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal(
        'ResizeObserver',
        class {
            constructor(callback: () => void) {
                probe.resize.push(callback);
            }
            observe() {}
            disconnect() {}
        },
    );
});

describe('Player dice graphics ownership', () => {
    it('reuses one context across dialogs and rolls, disposing only with the view', async () => {
        const runtime = new DiceRuntime(),
            park = element(),
            first = element(),
            second = element();
        runtime.mount(park);
        runtime.attach(first);
        await runtime.prepare();
        runtime.release(first);
        expect(probe.disposed).toBe(0);
        runtime.attach(second);
        await runtime.prepare();
        const rolling = runtime.roll([17, 6], 20);
        await vi.waitFor(() => expect(probe.finishes).toHaveLength(1));
        probe.finishes.shift()!([17, 6]);
        expect(await rolling).toBe('settled');
        expect(probe.constructed).toBe(1);
        expect(probe.initialized).toBe(1);
        runtime.release(second);
        expect(probe.disposed).toBe(0);
        runtime.dispose();
        expect(probe.disposed).toBe(1);
    });
    it('defers a viewport resize until a live throw completes', async () => {
        const runtime = new DiceRuntime(),
            host = element();
        runtime.mount(element());
        runtime.attach(host);
        await runtime.prepare();
        const before = probe.dimensions.length;
        const rolling = runtime.roll([20], 20);
        await vi.waitFor(() => expect(probe.finishes).toHaveLength(1));
        Object.assign(host, { clientWidth: 900 });
        probe.resize[0]();
        expect(probe.dimensions).toHaveLength(before);
        probe.finishes.shift()!([20]);
        expect(await rolling).toBe('settled');
        expect(probe.dimensions.at(-1)?.x).toBe(900);
        expect(probe.dimensions).toHaveLength(before + 1);
        runtime.dispose();
    });
    it('cancels an unmounted presentation without destroying its reusable renderer', async () => {
        const runtime = new DiceRuntime(),
            host = element();
        runtime.mount(element());
        runtime.attach(host);
        await runtime.prepare();
        const rolling = runtime.roll([1], 20);
        await vi.waitFor(() => expect(probe.finishes).toHaveLength(1));
        runtime.release(host);
        expect(await rolling).toBe('static');
        expect(probe.disposed).toBe(0);
        runtime.dispose();
        expect(probe.disposed).toBe(1);
    });
});
