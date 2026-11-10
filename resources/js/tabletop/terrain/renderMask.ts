import { CHUNK, MASK } from './model';

export const GUTTER = 8;
export const TILE_PIXELS = CHUNK + GUTTER * 2;
export const MASK_PIXELS = MASK + GUTTER;

/** Interpolate all material weights at the same world position to preserve coverage.
 * Crossed world-space waves shift only the rendered edge, never the editable samples.
 */
const offsets = Float32Array.from({ length: 1024 }, (_, i) => {
    const phase = (i * Math.PI) / 512;
    return 1.45 * Math.sin(phase * 13) + 0.7 * Math.sin(phase * 27) + 0.35 * Math.sin(phase * 43);
});

export function renderMask(
    samples: Uint8Array,
    pixels: Uint8ClampedArray,
    worldX: number,
    worldY: number,
) {
    for (let y = 0; y < TILE_PIXELS; y++) {
        const sy = (y - 0.5) / 2;
        const wy = worldY + y;
        for (let x = 0; x < TILE_PIXELS; x++) {
            const sx = (x - 0.5) / 2;
            const wx = worldX + x;
            const shiftX = offsets[(wy + 2 * wx) & 1023] + 0.3 * offsets[(2 * wy - wx) & 1023];
            const shiftY = offsets[(wx - wy + 83) & 1023] + 0.3 * offsets[(2 * wx + wy) & 1023];
            const u = Math.max(0, Math.min(MASK_PIXELS - 1, sx + shiftX));
            const v = Math.max(0, Math.min(MASK_PIXELS - 1, sy + shiftY));
            const ix = Math.min(MASK_PIXELS - 2, Math.floor(u));
            const iy = Math.min(MASK_PIXELS - 2, Math.floor(v));
            const i = iy * MASK_PIXELS + ix;
            const top = samples[i] + (samples[i + 1] - samples[i]) * (u - ix);
            const bottom =
                samples[i + MASK_PIXELS] +
                (samples[i + MASK_PIXELS + 1] - samples[i + MASK_PIXELS]) * (u - ix);
            pixels[(y * TILE_PIXELS + x) * 4 + 3] = top + (bottom - top) * (v - iy);
        }
    }
}
