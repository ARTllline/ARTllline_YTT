import { CHUNK, MASK } from './model';

export const GUTTER = 8;
export const TILE_PIXELS = CHUNK + GUTTER * 2;
export const MASK_PIXELS = MASK + GUTTER;

/** Interpolate all material weights at the same world position to preserve coverage.
 * A small periodic field shifts only the rendered edge, never the editable samples.
 */
const offsets = Float32Array.from({ length: 512 }, (_, i) => {
    const phase = (i * Math.PI) / 256;
    return 1.35 * Math.sin(phase * 11) + 0.9 * Math.sin(phase * 19) + 0.55 * Math.sin(phase * 31);
});

export function renderMask(
    samples: Uint8Array,
    pixels: Uint8ClampedArray,
    worldX: number,
    worldY: number,
) {
    for (let y = 0; y < TILE_PIXELS; y++) {
        const sy = (y - 0.5) / 2;
        const shiftX = offsets[(worldY + y) & 511];
        for (let x = 0; x < TILE_PIXELS; x++) {
            const sx = (x - 0.5) / 2;
            const u = Math.max(0, Math.min(MASK_PIXELS - 1, sx + shiftX));
            const v = Math.max(0, Math.min(MASK_PIXELS - 1, sy + offsets[(worldX + x + 83) & 511]));
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
