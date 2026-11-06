import { expect, it, vi } from 'vitest';
import type { Renderer } from 'pixi.js';
import { PlayerVisionLayer } from './PlayerVisionLayer';
import type { Scene } from '../types/scene';

vi.hoisted(() => vi.stubGlobal('navigator', { userAgent: '' }));
vi.mock('./composite', async () => {
    const { Container } = await import('pixi.js');
    return {
        visionComposite: () => ({
            display: new Container(),
            shader: { resources: {}, destroy: vi.fn() },
            geometry: { destroy: vi.fn() },
            uniforms: {
                uniforms: { uProgress: 1, uBase: 0.94, uMemoryScale: new Float32Array([1, 1]) },
            },
        }),
    };
});
const vision = (x = 0, bits = 'AQ=='): NonNullable<Scene['vision']> => ({
    enabled: true,
    polygons: [
        [
            { x, y: 0 },
            { x: x + 50, y: 0 },
            { x, y: 50 },
        ],
    ],
    explored: { policy: 'player', width: 2, height: 2, cellSize: 50, bits },
});
it('keeps two mask surfaces and one memory source through movement, and does no per-frame raster work', () => {
    const layer = new PlayerVisionLayer();
    const render = vi.fn(),
        renderer = { render } as unknown as Renderer;
    layer.sync(renderer, vision(), 100, 100);
    const initial = layer.currentMask.texture;
    layer.sync(renderer, vision(1), 100, 100);
    const alternate = layer.currentMask.texture;
    expect(alternate).not.toBe(initial);
    const source = (layer as unknown as { memoryTexture: { source: unknown } }).memoryTexture
        .source;
    for (let i = 2; i < 100; i++)
        layer.sync(renderer, vision(i, i % 2 ? 'AQ==' : 'Ag=='), 100, 100);
    expect([initial, alternate]).toContain(layer.currentMask.texture);
    expect((layer as unknown as { memoryTexture: { source: unknown } }).memoryTexture.source).toBe(
        source,
    );
    const calls = render.mock.calls.length;
    // Unrelated revisions/React notifications with identical mask content do no GPU work.
    for (let i = 0; i < 100; i++) {
        layer.sync(renderer, vision(99, 'AQ=='), 100, 100);
        layer.tick(16, false);
    }
    expect(render).toHaveBeenCalledTimes(calls);
    layer.destroy();
    expect(initial.destroyed).toBe(true);
    expect(alternate.destroyed).toBe(true);
});

it('holds a newer projection until its pending receipt and attaches playback without rasterizing twice', () => {
    const layer = new PlayerVisionLayer(),
        render = vi.fn(),
        renderer = { render } as unknown as Renderer;
    layer.sync(renderer, vision(), 100, 100);
    const next = vision(1);
    layer.sync(renderer, next, 100, 100, undefined, true);
    layer.tick(200, false, undefined, true);
    const progress = () =>
        (layer as unknown as { composite: { uniforms: { uniforms: { uProgress: number } } } })
            .composite.uniforms.uniforms.uProgress;
    expect(progress()).toBe(0);
    const calls = render.mock.calls.length;
    layer.sync(
        renderer,
        next,
        100,
        100,
        [
            {
                tokenId: 'a',
                path: [
                    { x: 0, y: 0 },
                    { x: 50, y: 0 },
                ],
            },
        ],
        true,
    );
    layer.tick(120, false, new Map([['a', { x: 0, y: 0 }]]), true);
    expect(progress()).toBe(0);
    layer.tick(0, false, new Map([['a', { x: 50, y: 0 }]]), false);
    expect(progress()).toBe(1);
    expect(render).toHaveBeenCalledTimes(calls);
    layer.destroy();
});

it('switches between polygon and darkness masks and reuses the raster upload', () => {
    const layer = new PlayerVisionLayer();
    const render = vi.fn();
    const renderer = { render } as unknown as Renderer;
    const raster = { width: 2, height: 2, cellSize: 50, bits: 'Aw==', darkvision: 'Ag==' };
    const dark = { ...vision(), polygons: [], raster };
    layer.sync(renderer, vision(), 100, 100);
    layer.sync(renderer, dark, 100, 100);
    const rasterLayer = render.mock.lastCall?.[0].container;
    const sprite = rasterLayer.children[0];
    const texture = sprite.texture;
    expect(Array.from(texture.source.resource)).toEqual([
        255, 255, 255, 255, 255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    layer.sync(renderer, { ...dark }, 100, 100);
    expect(render).toHaveBeenCalledTimes(2);
    layer.sync(renderer, { ...dark, raster: { ...raster, bits: 'AQ==', darkvision: undefined } }, 100, 100);
    expect(sprite.texture).toBe(texture);
    layer.sync(renderer, vision(), 100, 100);
    expect(render.mock.lastCall?.[0].container).not.toBe(rasterLayer);
    layer.destroy();
    expect(texture.destroyed).toBe(true);
});
