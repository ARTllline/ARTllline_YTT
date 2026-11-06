import type { Scene } from '../types/scene';

/** Upload the bounded territory bitset directly; no tessellation or row-run Graphics. */
export function explorationPixels(
    memory: NonNullable<Scene['vision']>['explored'],
    pixels: Uint8Array,
) {
    pixels.fill(0);
    if (!memory?.bits) return;
    const bits = atob(memory.bits);
    for (let bit = 0; bit < memory.width * memory.height; bit++) {
        if (bits.charCodeAt(bit >> 3) & (1 << (bit % 8))) {
            pixels.fill(255, bit * 4, bit * 4 + 4);
        }
    }
}
