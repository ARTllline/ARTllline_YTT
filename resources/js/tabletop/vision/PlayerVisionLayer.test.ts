import { expect, it, vi } from 'vitest';
import type { Renderer } from 'pixi.js';
import { PlayerVisionLayer } from './PlayerVisionLayer';
import { VISION_FEATHER_CELLS } from './coverage';
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
                uniforms: {
                    uProgress: 1,
                    uFocus: new Float32Array(4),
                    uWorldSize: new Float32Array(2),
                    uBase: 0.94,
                    uMemoryScale: new Float32Array([1, 1]),
                    uCurrentScale: new Float32Array([1, 1]),
                    uPreviousScale: new Float32Array([1, 1]),
                    uVisionFeather: new Float32Array(2),
                },
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
it('animates presentation uniforms without moving the authoritative mask or allocating geometry', () => {
    const layer = new PlayerVisionLayer(),
        render = vi.fn();
    layer.sync({ render } as unknown as Renderer, vision(), 100, 100);
    const texture = layer.currentMask.texture;
    const position = { x: layer.currentMask.x, y: layer.currentMask.y };
    const uniforms = (
        layer as unknown as {
            composite: { uniforms: { uniforms: { uFocus: Float32Array; uProgress: number } } };
        }
    ).composite.uniforms.uniforms;
    for (let i = 0; i < 100; i++) {
        layer.focus({ x: i, y: 25 }, 40, 1);
        layer.tick(8, false);
    }
    expect(uniforms.uFocus[0]).toBe(99);
    expect(layer.currentMask.texture).toBe(texture);
    expect({ x: layer.currentMask.x, y: layer.currentMask.y }).toEqual(position);
    expect(render).toHaveBeenCalledTimes(1);
    layer.sync({ render } as unknown as Renderer, vision(10), 100, 100, undefined, false, true);
    expect(uniforms.uFocus[2]).toBe(0);
    expect(uniforms.uProgress).toBe(1);
    layer.destroy();
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

it('switches between polygon and darkness masks and uploads only the two reusable raster surfaces', () => {
    const layer = new PlayerVisionLayer();
    const render = vi.fn();
    const renderer = { render } as unknown as Renderer;
    const raster = { width: 2, height: 2, cellSize: 60, bits: 'Aw==', darkvision: 'Ag==' };
    const dark = { ...vision(), polygons: [], raster };
    const feather = () =>
        (
            layer as unknown as {
                composite: { uniforms: { uniforms: { uVisionFeather: Float32Array } } };
            }
        ).composite.uniforms.uniforms.uVisionFeather[0];
    layer.sync(renderer, vision(), 100, 100);
    expect(feather()).toBe(0);
    layer.sync(renderer, dark, 100, 100);
    expect(feather()).toBeCloseTo(VISION_FEATHER_CELLS / 2);
    const texture = layer.currentMask.texture;
    expect(texture.frame.width).toBeCloseTo(100 / 60);
    expect(texture.textureMatrix.uClampFrame[2]).toBeCloseTo(100 / 120);
    expect(layer.currentMask.width).toBeCloseTo(100);
    expect(Array.from(texture.source.resource as Uint8Array)).toEqual([
        255, 255, 255, 255, 255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    layer.sync(renderer, { ...dark }, 100, 100);
    expect(render).toHaveBeenCalledTimes(1);
    layer.sync(
        renderer,
        { ...dark, raster: { ...raster, bits: 'AQ==', darkvision: undefined } },
        100,
        100,
    );
    const alternate = layer.currentMask.texture;
    expect(alternate).not.toBe(texture);
    layer.sync(renderer, dark, 100, 100);
    expect(layer.currentMask.texture).toBe(texture);
    expect(render).toHaveBeenCalledTimes(1);
    layer.sync(renderer, vision(), 100, 100);
    expect(feather()).toBe(0);
    expect(render).toHaveBeenCalledTimes(2);
    layer.destroy();
    expect(texture.destroyed).toBe(true);
    expect(alternate.destroyed).toBe(true);
});
