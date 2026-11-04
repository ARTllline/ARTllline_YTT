import { GUTTER, MASK_PIXELS, TILE_PIXELS, renderMask } from './renderMask';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { api } from '../../api/workspace';
import * as client from '../../api/client';
import { reduceEvent } from '../../realtime/protocol';
import { initialEditorView } from '../mapEditor';
import { createDemoScene } from '../state/demoScene';
import { SceneStore } from '../state/SceneStore';
import { ScenePersistence } from '../state/ScenePersistence';
import {
    CHUNK,
    decodeMask,
    encodeMask,
    paintMasks,
    patternTransform,
    StrokeCoverage,
    terrainPatch,
    type TerrainStroke,
} from './model';
import { StrokeRaster, type RasterRequest } from './StrokeRaster';
import { TerrainGesture } from './TerrainGesture';
import type { TerrainLayer } from './TerrainLayer';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});
const stroke: TerrainStroke = {
    operation: 'paint',
    materialVersionId: '1',
    size: 100,
    softness: 180,
    strength: 173,
    points: [
        { x: 240.25, y: 249.5 },
        { x: 280.5, y: 280.25 },
    ],
    expected: {},
};
function coverage(points = stroke.points) {
    const c = new StrokeCoverage();
    points.forEach((p, i) => c.add(points[Math.max(0, i - 1)], p, stroke, 1024, 1024));
    return c;
}
const scene = () => ({
    ...createDemoScene(),
    id: '1',
    revision: 0,
    width: 1024,
    height: 1024,
    mapWorld: { bounds: { x: 0, y: 0, width: 1024, height: 1024 } },
    terrain: { chunks: [], materials: [] },
});

describe('deterministic alpha terrain', () => {
    it('preserves separate alpha weights through overlapping paint and erase without changing the source', () => {
        const mask = new Uint8Array(16384).fill(255),
            alpha = new Uint8Array(16384).fill(128);
        const mixed = paintMasks({ '1': mask }, alpha, {
            operation: 'paint',
            materialVersionId: '2',
        });
        expect(mask[0]).toBe(255);
        expect([mixed['1'][0], mixed['2'][0]]).toEqual([127, 128]);
        const erased = paintMasks(mixed, alpha, { operation: 'erase' });
        expect(erased['1'][0] + erased['2'][0]).toBe(127);
        expect(decodeMask(encodeMask(mixed['2']))).toEqual(mixed['2']);
        expect(paintMasks(mixed, mask, { operation: 'erase' })).toEqual({});
        const absent = new Uint8Array(16384);
        absent[1] = 255;
        const left = mixed['1'].slice(),
            right = mixed['2'].slice();
        left[1] = right[1] = 0;
        const isolated = paintMasks({ '0': absent, '1': left, '2': right }, alpha, {
            operation: 'erase',
        });
        expect(isolated['0'][0]).toBe(0); // Integer remainders cannot introduce an absent material.
    });
    it('is invariant to collinear event subdivision and duplicate samples', () => {
        const [a, b] = stroke.points;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        expect(coverage([a, mid, b, b]).chunks).toEqual(coverage().chunks);
        expect(coverage().chunks.size).toBe(4);
    });
    it('matches the PHP v1 golden mask hashes at four chunk boundaries', () => {
        const hashes = Object.fromEntries(
            [...coverage().chunks].map(([key, mask]) => [
                key,
                createHash('sha256').update(mask).digest('hex'),
            ]),
        );
        // Checked against scripts/qa/terrain-benchmark.php; changing this is a brush format change.
        expect(hashes).toEqual(GOLDEN);
    });
    it('anchors repeat, rotation and deterministic variation in the same world phase across chunks', () => {
        const m = {
            versionId: '9',
            asset: { id: '1', url: '/private', width: 256, height: 128 },
            repeatSize: 120,
            rotation: 25,
            variation: { offset: true, quarterTurns: true },
        };
        const a = patternTransform(m, 0, 0),
            b = patternTransform(m, 256, 256);
        expect(a.e - b.e).toBeCloseTo(256);
        expect(a.f - b.f).toBeCloseTo(256);
        expect(a.a).toEqual(b.a);
        expect(a.b).toEqual(b.b);
        expect(patternTransform(m, 0, 0)).toEqual(a);
    });
    it('matches a per-sample capsule reference across hard and soft retraces', () => {
        const points = [
            { x: 61.25, y: 42 },
            { x: 295.75, y: 80.5 },
            { x: 127, y: 16.25 },
            { x: 295.75, y: 80.5 },
        ];
        for (const [size, softness] of [
            [109, 0],
            [109, 97],
            [109, 255],
            [1024, 255],
        ]) {
            const settings = { size, softness, strength: 131 };
            const radius = settings.size / 2;
            const c = new StrokeCoverage();
            points.forEach((b, i) => c.add(points[Math.max(0, i - 1)], b, settings, 301, 125));
            const mismatches: number[][] = [];
            for (let y = 1; y < 125; y += 2) {
                for (let x = 1; x < 301; x += 2) {
                    const reference = Math.max(
                        ...points.map((b, i) => {
                            const a = points[Math.max(0, i - 1)];
                            const dx = b.x - a.x,
                                dy = b.y - a.y;
                            const length = dx * dx + dy * dy;
                            const t = length
                                ? Math.max(
                                      0,
                                      Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length),
                                  )
                                : 0;
                            const distance =
                                Math.floor(
                                    Math.hypot(x - a.x - t * dx, y - a.y - t * dy) * 256 + 0.5,
                                ) / 256;
                            if (distance >= radius) return 0;
                            return Math.floor(
                                settings.strength *
                                    (softness
                                        ? Math.min(
                                              1,
                                              (radius - distance) / (radius * (softness / 255)),
                                          )
                                        : 1) +
                                    0.5,
                            );
                        }),
                    );
                    const mask = c.chunks.get(x < 256 ? '0:0' : '1:0');
                    const actual = mask?.[((y - 1) / 2) * 128 + ((x % 256) - 1) / 2] ?? 0;
                    if (actual !== reference) mismatches.push([x, y, actual, reference]);
                }
            }
            expect(mismatches).toEqual([]);
        }
    });

    it('clips coverage to world bounds and enforces a CPU budget', () => {
        const c = new StrokeCoverage();
        c.add({ x: 0, y: 0 }, { x: 0, y: 0 }, stroke, 1024, 1024);
        expect([...c.chunks.keys()]).toEqual(['0:0']);
        expect(() =>
            c.add({ x: 0, y: 0 }, { x: 20000, y: 20000 }, { ...stroke, size: 1024 }, 20000, 20000),
        ).toThrow('256');
    });
});

describe('normal persistence, history and reconnect', () => {
    it('saves one stroke, undoes and redoes exact snapshots through the existing queue', async () => {
        const store = new SceneStore(scene()),
            { queue } = new ScenePersistence(store, '1');
        store.setMapEditor(initialEditorView);
        const result = {
            revision: 1,
            terrain: { chunks: [{ key: '0:0', hash: 'h', versions: ['1'] }], materials: [] },
            terrainEdit: {
                before: { hashes: { '0:0': null }, snapshot: 'encrypted-before' },
                after: { hashes: { '0:0': 'h' }, snapshot: 'encrypted-after' },
            },
        };
        const send = vi.spyOn(api, 'terrain').mockResolvedValue(result);
        store.terrainStroke(stroke);
        await queue.flush();
        expect(send).toHaveBeenCalledTimes(1);
        const history = vi.spyOn(client, 'request').mockResolvedValue({
            revision: 2,
            terrain: { chunks: [{ key: '0:0', hash: null }], materials: [] },
        });
        store.history!.run();
        await queue.flush();
        expect(history.mock.calls[0][2]).toMatchObject({
            changes: [{ value: { snapshot: 'encrypted-before' }, expected: { '0:0': 'h' } }],
        });
        expect(store.getSnapshot().scene.terrain?.chunks).toEqual([]);
        history.mockResolvedValue({ ...result, revision: 3 });
        store.history!.run(true);
        await queue.flush();
        expect(history.mock.calls[1][2]).toMatchObject({
            changes: [{ value: { snapshot: 'encrypted-after' }, expected: { '0:0': null } }],
        });
        expect(store.getSnapshot().scene.terrain?.chunks[0].hash).toBe('h');
    });
    it('releases a rejected conflict and retains the scene/editor during resnapshot', async () => {
        const store = new SceneStore(scene()),
            { queue } = new ScenePersistence(store, '1');
        store.setMapEditor(initialEditorView);
        vi.spyOn(api, 'terrain').mockRejectedValue(new client.ApiError('Покрытие изменилось', 409));
        vi.spyOn(api, 'snapshot').mockResolvedValue({ ...scene(), revision: 2 });
        store.terrainStroke(stroke);
        await queue.flush();
        expect(queue.getSnapshot().status).toBe('saved');
        expect(store.getSnapshot().mapEditor).toBe(initialEditorView);
        expect(store.getSnapshot().editorNotice).toBe('Покрытие изменилось');
        const player = new SceneStore(scene(), 'player');
        new ScenePersistence(player, '1');
        player.terrainStroke(stroke);
        expect(api.terrain).toHaveBeenCalledTimes(1);
    });
    it('settles denied terrain even when permission loss also revokes the snapshot', async () => {
        const store = new SceneStore(scene()),
            { queue } = new ScenePersistence(store, '1');
        store.setMapEditor(initialEditorView);
        vi.spyOn(api, 'terrain').mockRejectedValue(new client.ApiError('Access revoked', 403));
        vi.spyOn(api, 'snapshot').mockRejectedValue(new client.ApiError('Access revoked', 403));
        const complete = vi.fn();
        store.terrainStroke(stroke, complete);
        await queue.flush();
        expect(queue.getSnapshot().status).toBe('saved');
        expect(store.getSnapshot().editorNotice).toBe('Access revoked');
        expect(complete).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
    });
    it('applies small ordered events, evicts unused versions and hydrates reconnect snapshots', () => {
        const patch = { chunks: [{ key: '0:0', hash: 'h', versions: ['1'] }], materials: [] };
        const event = {
            type: 'terrain.updated',
            sceneId: '1',
            revision: 1,
            mutationId: 'm',
            payload: { terrain: patch },
        };
        const next = reduceEvent(scene(), event);
        expect(next).toMatchObject({ terrain: patch });
        expect(reduceEvent(scene(), { ...event, revision: 3 })).toBe('gap');
        const store = new SceneStore(scene());
        store.setMapEditor(initialEditorView);
        if (next === 'gap') throw Error('gap');
        store.reconcile(next);
        expect(store.getSnapshot().mapEditor).toBe(initialEditorView);
        expect(
            terrainPatch(next, { chunks: [{ key: '0:0', hash: null }], materials: [] }).terrain
                ?.chunks,
        ).toEqual([]);
    });
    it('keeps a long retraced stroke in one raster and returns an accepted prefix at world capacity', () => {
        const raster = new StrokeRaster({
            stroke: { ...stroke, size: 1024 },
            width: 4096,
            height: 2048,
            occupied: [],
        });
        const points = Array.from({ length: 700 }, (_, i) => ({ x: i % 2 ? 3100 : 550, y: 800 }));
        let cursor = 0;
        const chunks = new Set<string>();
        while (cursor < points.length) {
            const reply = raster.batch(points.slice(cursor));
            expect(reply.limit).toBeUndefined();
            expect(reply.consumed).toBeGreaterThan(0);
            cursor += reply.consumed;
            reply.dirty.forEach(([key]) => chunks.add(key));
        }
        expect(chunks.size).toBeGreaterThan(32);

        const occupied = ['0:0', ...Array.from({ length: 255 }, (_, i) => 'existing:' + i)];
        const capped = new StrokeRaster({ stroke, width: 1024, height: 1024, occupied });
        expect(capped.batch([{ x: 100, y: 100 }]).dirty.map(([key]) => key)).toEqual(['0:0']);
        const rejected = capped.batch([{ x: 650, y: 650 }]);
        expect(rejected).toMatchObject({ consumed: 0, dirty: [] });
        expect(rejected.limit).toContain('256');
    });

    it('cancels a live stroke before submission and detects a concurrent changed chunk', async () => {
        const store = new SceneStore(scene());
        store.setMapEditor({
            ...initialEditorView,
            terrain: {
                active: true,
                operation: 'paint',
                size: 100,
                softness: 180,
                strength: 255,
                material: {
                    id: '1',
                    version: 1,
                    name: 'Test',
                    type: 'terrain',
                    versionId: '1',
                    asset: { id: '1', url: '', width: 32, height: 32 },
                    repeatSize: 32,
                    rotation: 0,
                    variation: { offset: false, quarterTurns: false },
                },
            },
        });
        const commit = vi.spyOn(store, 'terrainStroke');
        const layer = {
            ensure: vi.fn().mockResolvedValue({}),
            setPreview: vi.fn(),
            cancelPreview: vi.fn(),
        };
        class TestWorker {
            private raster?: StrokeRaster;
            onmessage?: (event: unknown) => void;
            postMessage(message: RasterRequest) {
                if (message.settings) this.raster = new StrokeRaster(message.settings);
                queueMicrotask(() =>
                    this.onmessage?.({ data: this.raster!.batch(message.points) }),
                );
            }
            terminate() {}
        }
        vi.stubGlobal('Worker', TestWorker);
        vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 0));
        vi.stubGlobal('cancelAnimationFrame', clearTimeout);
        const gesture = new TerrainGesture(store, layer as unknown as TerrainLayer);
        gesture.down({ x: 100, y: 100 });
        gesture.move({ x: 150, y: 100 });
        gesture.up({ x: 150, y: 100 });
        gesture.cancel();
        await Promise.resolve();
        expect(commit).not.toHaveBeenCalled();
        gesture.down({ x: 100, y: 100 });
        store.reconcile({
            ...scene(),
            terrain: { chunks: [{ key: '0:0', hash: 'changed' }], materials: [] },
        });
        gesture.up({ x: 150, y: 100 });
        expect(commit).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(store.getSnapshot().editorNotice).toContain('изменилось'));
    });
});

const GOLDEN = {
    '0:0': 'b81bdf93b6d865327a182166259740e7c8776eea14dffe35fa47216c57a6a99d',
    '1:0': 'a338ad2781b014b4f40bb823e22d2a8b375d93962b6c9d3aa031e54020cd2d70',
    '0:1': '4cc356872183223af68cb3097821a4a30a4299662ac572cd23e7ca0d516172ed',
    '1:1': '526bef761f7d5484b5fb283ff102c8ae4cb299134e723c3e026a90e835e8d238',
};

it('renders the same weighted edge in adjacent tile gutters without losing opaque coverage', () => {
    const tile = (origin: number, complement: boolean) => {
        const samples = Uint8Array.from({ length: MASK_PIXELS ** 2 }, (_, i) => {
            const x = origin + (i % MASK_PIXELS) * 2 + 1;
            const y = Math.floor(i / MASK_PIXELS) * 2 + 1;
            const alpha = Math.max(0, Math.min(255, (x - y) * 4));
            return complement ? 255 - alpha : alpha;
        });
        const pixels = new Uint8ClampedArray(TILE_PIXELS ** 2 * 4);
        renderMask(samples, pixels, origin, 0);
        return (x: number, y: number) => pixels[(y * TILE_PIXELS + x) * 4 + 3];
    };
    const left = tile(-GUTTER, false);
    const right = tile(CHUNK - GUTTER, false);
    const other = tile(CHUNK - GUTTER, true);
    for (let y = GUTTER; y < CHUNK + GUTTER; y++) {
        for (const x of [GUTTER - 1, GUTTER]) {
            expect(right(x, y)).toBe(left(CHUNK + x, y));
            expect(Math.abs(right(x, y) + other(x, y) - 255)).toBeLessThanOrEqual(1);
        }
    }
});
