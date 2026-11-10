import type { ImageAsset, Point, Scene } from '../types/scene';
import type { Material } from '../../workspace/maps/materials';

export const CHUNK = 256;
export const MASK = 128;
export const MAX_TERRAIN_CHUNKS = 256;
export interface TerrainMaterial {
    versionId: string;
    type?: Material['type'];
    asset: ImageAsset;
    repeatSize: number;
    rotation: number;
    variation: { offset: boolean; quarterTurns: boolean };
}
export interface Terrain {
    chunks: { key: string; hash: string | null; versions?: string[] }[];
    materials: TerrainMaterial[];
}
export interface TerrainStroke {
    operation: 'paint' | 'erase';
    materialVersionId?: string;
    size: number;
    softness: number;
    strength: number;
    points: Point[];
    expected: Record<string, string | null>;
}
export type Layers = Record<string, Uint8Array>;
export interface TerrainEditState {
    hashes: Record<string, string | null>;
    snapshot: string;
}
export const decodeMask = (hex: string) =>
    Uint8Array.from({ length: hex.length / 2 }, (_, i) =>
        parseInt(hex.slice(i * 2, i * 2 + 2), 16),
    );
export const encodeMask = (mask: Uint8Array) =>
    Array.from(mask, (v) => v.toString(16).padStart(2, '0')).join('');

export function terrainPatch(scene: Scene, patch?: Terrain): Scene {
    if (!patch) return scene;
    const chunks = new Map(scene.terrain?.chunks.map((c) => [c.key, c]) ?? []);
    patch.chunks.forEach((c) => (c.hash ? chunks.set(c.key, c) : chunks.delete(c.key)));
    const materials = new Map(scene.terrain?.materials.map((m) => [m.versionId, m]) ?? []);
    patch.materials.forEach((m) => materials.set(m.versionId, m));
    if ([...chunks.values()].every((c) => c.versions)) {
        const used = new Set([...chunks.values()].flatMap((c) => c.versions!));
        for (const id of materials.keys()) if (!used.has(id)) materials.delete(id);
    }
    return {
        ...scene,
        terrain: { chunks: [...chunks.values()], materials: [...materials.values()] },
    };
}

export class StrokeLimit extends Error {}

/** Incremental maximum capsule coverage. Bounds only prune blocks whose alpha cannot improve. */
export class StrokeCoverage {
    readonly chunks = new Map<string, Uint8Array>();
    private minima = new Map<string, Uint8Array>();
    private segments = new Set<string>();
    private work = 0;
    private cutoff?: {
        settings: Pick<TerrainStroke, 'size' | 'softness' | 'strength'>;
        distances: Float64Array;
    };

    add(
        a: Point,
        b: Point,
        stroke: Pick<TerrainStroke, 'size' | 'softness' | 'strength'>,
        width: number,
        height: number,
        include?: (key: string) => boolean,
    ) {
        const dirty = new Set<string>();
        const segment = [`${a.x},${a.y}`, `${b.x},${b.y}`].sort().join(':');
        if (this.segments.has(segment)) return dirty;
        if (this.work >= 24_000_000) throw new StrokeLimit('Достигнут предел вычислений мазка.');
        this.segments.add(segment);

        const radius = stroke.size / 2;
        const feather = radius * (stroke.softness / 255);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = dx * dx + dy * dy;
        const distance = (x: number, y: number) => {
            const t = length
                ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length))
                : 0;
            const ox = x - a.x - t * dx;
            const oy = y - a.y - t * dy;
            return Math.sqrt(ox * ox + oy * oy);
        };
        const alpha = (d: number) => {
            const quantized = Math.floor(d * 256 + 0.5) / 256;
            if (quantized >= radius) return 0;
            return Math.floor(
                stroke.strength * (feather ? Math.min(1, (radius - quantized) / feather) : 1) + 0.5,
            );
        };
        // A lower bound can prove a sample cannot reach its next quantized alpha.
        let cutoff: Float64Array | undefined;
        if (radius >= 256 && feather) {
            if (this.cutoff?.settings !== stroke) {
                const distances = Float64Array.from({ length: stroke.strength }, (_, old) => {
                    let lo = 0;
                    let hi = radius * 256;
                    while (lo < hi) {
                        const mid = (lo + hi) >>> 1;
                        if (alpha(mid / 256) > old) lo = mid + 1;
                        else hi = mid;
                    }
                    return (lo - 0.5) / 256;
                });
                this.cutoff = { settings: stroke, distances };
            }
            cutoff = this.cutoff.distances;
        }
        const maxX = Math.floor((width - 2) / 2);
        const maxY = Math.floor((height - 2) / 2);
        const firstY = Math.max(0, Math.floor((Math.min(a.y, b.y) - radius) / 16));
        const lastY = Math.min(
            Math.floor(maxY / 8),
            Math.floor((Math.max(a.y, b.y) + radius) / 16),
        );

        for (let by = firstY; by <= lastY; by++) {
            // Only the part of the centreline within one radius of this band can contribute.
            const t1 = dy ? (by * 16 - radius - a.y) / dy : 0;
            const t2 = dy ? (by * 16 + 16 + radius - a.y) / dy : 1;
            const start = a.x + dx * Math.max(0, Math.min(1, Math.min(t1, t2)));
            const end = a.x + dx * Math.max(0, Math.min(1, Math.max(t1, t2)));
            const firstX = Math.max(0, Math.floor((Math.min(start, end) - radius) / 16));
            const lastX = Math.min(
                Math.floor(maxX / 8),
                Math.floor((Math.max(start, end) + radius) / 16),
            );
            let key = '';
            let mask: Uint8Array | undefined;
            let minima: Uint8Array | undefined;
            for (let bx = firstX; bx <= lastX; bx++) {
                this.work++;
                if (bx === firstX || bx % 16 === 0) {
                    key = `${Math.floor(bx / 16)}:${Math.floor(by / 16)}`;
                    mask = this.chunks.get(key);
                    minima = this.minima.get(key);
                }
                if (include && !include(key)) continue;
                const block = (by % 16) * 16 + (bx % 16);
                const previous = minima?.[block] ?? 0;
                if (previous === stroke.strength) continue;
                const cx = bx * 16 + 8 - a.x;
                const cy = by * 16 + 8 - a.y;
                const t = length ? Math.max(0, Math.min(1, (cx * dx + cy * dy) / length)) : 0;
                const ox = cx - t * dx;
                const oy = cy - t * dy;
                const center = Math.sqrt(ox * ox + oy * oy);
                // Farthest sample is sqrt(7² + 7²) from the centre. Round outwards.
                const upper = alpha(Math.max(0, center - 9.9));
                if (upper <= previous) continue;
                const lower = alpha(center + 9.9);
                const uniform = lower === upper;
                const xEnd = Math.min(7, maxX - bx * 8);
                const yEnd = Math.min(7, maxY - by * 8);
                const offset = (by % 16) * 8 * MASK + (bx % 16) * 8;
                let minimum = stroke.strength;
                let changed = false;
                this.work += Math.ceil(((xEnd + 1) * (yEnd + 1)) / 8);
                // Distance to a segment is convex. Its tangent at the block centre
                // bounds the distance below at each sample, including near retraces.
                const nx = cutoff && center ? ox / center : 0;
                const ny = cutoff && center ? oy / center : 0;
                for (let y = 0; y <= yEnd; y++) {
                    const row = offset + y * MASK;
                    for (let x = 0; x <= xEnd; x++) {
                        const old = mask?.[row + x] ?? 0;
                        let value = old;
                        if (
                            old < upper &&
                            (uniform ||
                                !cutoff ||
                                !old ||
                                center + nx * (x * 2 - 7) + ny * (y * 2 - 7) < cutoff[old] + 1e-7)
                        ) {
                            if (!uniform) this.work++;
                            value = Math.max(
                                old,
                                uniform
                                    ? upper
                                    : alpha(distance(bx * 16 + x * 2 + 1, by * 16 + y * 2 + 1)),
                            );
                            if (value > old) {
                                if (!mask) {
                                    if (this.chunks.size >= MAX_TERRAIN_CHUNKS)
                                        throw new StrokeLimit(
                                            'Достигнут предел 256 участков покрытия.',
                                        );
                                    mask = new Uint8Array(MASK * MASK);
                                    minima = new Uint8Array(256);
                                    this.chunks.set(key, mask);
                                    this.minima.set(key, minima);
                                }
                                mask[row + x] = value;
                                changed = true;
                            }
                        }
                        minimum = Math.min(minimum, value);
                    }
                }
                if (changed) {
                    minima![block] = minimum;
                    dirty.add(key);
                }
            }
        }
        return dirty;
    }
}

export function paintMasks(
    before: Layers,
    coverage: Uint8Array,
    stroke: Pick<TerrainStroke, 'operation' | 'materialVersionId'>,
): Layers {
    if (!Object.keys(before).length)
        return stroke.operation === 'paint' ? { [stroke.materialVersionId ?? '']: coverage } : {};
    const result: Layers = Object.fromEntries(
        Object.entries(before).map(([id, mask]) => [id, mask.slice()]),
    );
    const target = stroke.materialVersionId ?? '';
    if (stroke.operation === 'paint') result[target] ??= new Uint8Array(MASK * MASK);
    const entries = Object.entries(result).sort(([a], [b]) => Number(a) - Number(b));
    for (let i = 0; i < MASK * MASK; i++) {
        const a = coverage[i];
        if (!a) continue;
        let total = 0,
            sum = 0,
            largest = -1,
            recipient = stroke.operation === 'paint' ? target : '';
        for (const [id, mask] of entries) {
            if (stroke.operation === 'erase' && mask[i] > largest) {
                largest = mask[i];
                recipient = id;
            }
            total += mask[i];
            mask[i] =
                Math.floor((mask[i] * (255 - a)) / 255) +
                (stroke.operation === 'paint' && id === target ? a : 0);
            sum += mask[i];
        }
        if (recipient)
            result[recipient][i] +=
                Math.floor((total * (255 - a)) / 255) +
                (stroke.operation === 'paint' ? a : 0) -
                sum;
    }
    return Object.fromEntries(Object.entries(result).filter(([, mask]) => mask.some((a) => a > 0)));
}

/** Stable, world-wide phase. Never vary per chunk (which would create seams). */
export function patternTransform(m: TerrainMaterial, x: number, y: number) {
    const seed = Number(m.versionId) >>> 0;
    const angle = ((m.rotation + (m.variation.quarterTurns ? (seed % 4) * 90 : 0)) * Math.PI) / 180;
    const scale = m.repeatSize / m.asset.width;
    return {
        a: Math.cos(angle) * scale,
        b: Math.sin(angle) * scale,
        c: -Math.sin(angle) * scale,
        d: Math.cos(angle) * scale,
        e: -x + (m.variation.offset ? (((seed * 73) % 997) / 997) * m.repeatSize : 0),
        f: -y + (m.variation.offset ? (((seed * 193) % 991) / 991) * m.repeatSize : 0),
    };
}
