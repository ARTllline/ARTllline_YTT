import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { request } from '../../api/client';
import { LightingReader } from './LightingReader';
import { defaultLighting, maskPixels } from './model';
import type { Scene } from '../types/scene';

vi.mock('../../api/client', () => ({ request: vi.fn() }));
const scene = (x = 0, revision = 1): Scene => ({
    id: '7',
    revision,
    width: 800,
    height: 600,
    grid: { visible: false, snap: false, size: 50, offset: { x: 0, y: 0 } },
    lighting: { ...defaultLighting, enabled: true, brightness: 1 - x / 10 },
    tokens: [
        {
            id: 'a',
            x,
            y: 0,
            name: 'Hero',
            kind: 'player_character',
            rotation: 0,
            scale: 1,
            size: 30,
            color: 0,
        },
    ],
});
beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(request).mockReset();
});
afterEach(() => vi.useRealTimers());
it('coalesces changes, ignores revoked projections and never fetches on idle/camera revisions', async () => {
    const deliver = vi.fn();
    const reader = new LightingReader(deliver, vi.fn());
    let resolve!: (value: unknown) => void;
    vi.mocked(request).mockImplementationOnce(
        () =>
            new Promise((r) => {
                resolve = r;
            }),
    );
    reader.sync(scene());
    reader.sync(scene(1, 2));
    await vi.advanceTimersByTimeAsync(36);
    expect(request).toHaveBeenCalledTimes(1);
    reader.sync(scene(2, 3));
    resolve({ sceneId: '7', revision: 2 });
    await vi.advanceTimersByTimeAsync(36);
    expect(deliver).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(2);
    reader.destroy();
});
it('accepts a matching view across unrelated revisions and aborts on teardown', async () => {
    const deliver = vi.fn(),
        failed = vi.fn();
    const reader = new LightingReader(deliver, failed);
    const result = { sceneId: '7', revision: 1 };
    vi.mocked(request).mockResolvedValue(result);
    reader.sync(scene());
    await vi.advanceTimersByTimeAsync(40);
    expect(deliver).toHaveBeenCalledWith(result);
    for (let i = 2; i < 100; i++) reader.sync(scene(0, i));
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
    reader.destroy();
    expect(vi.mocked(request).mock.calls[0][3]?.aborted).toBe(true);
});
it('decodes only authorized mask bits and clears revoked pixels', () => {
    const pixels = new Uint8Array(16).fill(255);
    maskPixels('BQ==', pixels);
    expect([...pixels]).toEqual([255, 255, 255, 255, 0, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0]);
    maskPixels('AA==', pixels);
    expect([...pixels]).toEqual(new Array(16).fill(0));
    maskPixels('~AQAF', pixels); // one byte, value 5, encoded as little-endian run length
    expect(pixels[3]).toBe(255);
    expect(pixels[7]).toBe(0);
    expect(pixels[11]).toBe(255);
});
it('uses pushed frames during movement without additional reads and rehydrates after reconnect', async () => {
    const reader = new LightingReader(vi.fn(), vi.fn());
    vi.mocked(request).mockResolvedValue({ sceneId: '7', revision: 1 });
    reader.sync(scene());
    await vi.advanceTimersByTimeAsync(40);
    reader.streamedFrame();
    for (let i = 2; i < 20; i++) reader.sync({ ...scene(), revision: i, tokens: scene(i).tokens });
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).toHaveBeenCalledTimes(1);
    reader.reset();
    reader.sync(scene());
    await vi.advanceTimersByTimeAsync(40);
    expect(request).toHaveBeenCalledTimes(2);
    reader.destroy();
});
