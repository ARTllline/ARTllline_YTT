import { patternTransform, type TerrainMaterial } from './model';

export function alternateSurface(material: TerrainMaterial) {
    if (material.type !== 'terrain' && !material.variation.offset) return;
    const seed = Number(material.versionId) >>> 0;
    return {
        ...material,
        repeatSize: material.repeatSize * (1.19 + (seed % 5) * 0.07),
        rotation: material.rotation + (seed % 2 === 0 ? 53 : -67),
        variation: { ...material.variation, offset: true },
    };
}

export function fillSurface(
    ctx: CanvasRenderingContext2D,
    pattern: CanvasPattern,
    material: TerrainMaterial,
    x: number,
    y: number,
    size: number,
) {
    const matrix = patternTransform(material, x, y);
    pattern.setTransform(
        new DOMMatrix([matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]),
    );
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, size, size);
}

const FIELD_STEP = 96;
export const BLEND_SAMPLE = 8;

function field(x: number, y: number) {
    let hash = Math.imul(x ^ 0x27d4eb2d, 0x85ebca6b) ^ Math.imul(y ^ 0x165667b1, 0xc2b2ae35);
    hash = Math.imul(hash ^ (hash >>> 15), 0x2c1b3c6d);
    return ((hash ^ (hash >>> 12)) >>> 0) / 0xffffffff;
}

/** Coherent world-space weights, sampled on the same lattice across tile gutters. */
export function surfaceBlend(x: number, y: number) {
    const cx = Math.floor(x / FIELD_STEP);
    const cy = Math.floor(y / FIELD_STEP);
    const u = x / FIELD_STEP - cx;
    const v = y / FIELD_STEP - cy;
    const sx = u * u * (3 - 2 * u);
    const sy = v * v * (3 - 2 * v);
    const top = field(cx, cy) * (1 - sx) + field(cx + 1, cy) * sx;
    const bottom = field(cx, cy + 1) * (1 - sx) + field(cx + 1, cy + 1) * sx;
    return 0.08 + 0.84 * (top * (1 - sy) + bottom * sy);
}
