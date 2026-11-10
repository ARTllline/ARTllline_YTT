import type { Scene } from '../types/scene';
import { maskPixels } from '../lighting/model';

/** Upload the bounded territory bitset directly; no tessellation or row-run Graphics. */
export function explorationPixels(
    memory: NonNullable<Scene['vision']>['explored'],
    pixels: Uint8Array,
) {
    if (!memory?.bits) {
        pixels.fill(0);
        return;
    }
    const length = memory.width * memory.height * 4;
    maskPixels(memory.bits, pixels.subarray(0, length));
    pixels.fill(0, length);
}
