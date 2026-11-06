import type { Scene } from '../types/scene';

/** Row runs keep the GPU geometry small; the wire bitset is <= 43 KiB. */
export function exploredRuns(memory: NonNullable<Scene['vision']>['explored']) {
    const runs: { x: number; y: number; width: number; height: number }[] = [];
    if (!memory?.bits) return runs;
    const bits = atob(memory.bits);
    const marked = (x: number, y: number) => {
        const bit = y * memory.width + x;
        return !!(bits.charCodeAt(bit >> 3) & (1 << (bit % 8)));
    };
    for (let y = 0; y < memory.height; y++) {
        let x = 0;
        while (x < memory.width) {
            if (!marked(x, y)) {
                x++;
                continue;
            }
            const start = x++;
            while (x < memory.width && marked(x, y)) x++;
            runs.push({
                x: start * memory.cellSize,
                y: y * memory.cellSize,
                width: (x - start) * memory.cellSize,
                height: memory.cellSize,
            });
        }
    }
    return runs;
}
