import { describe, expect, it } from 'vitest';
import { explorationPixels } from './explorationPixels';
import { exploredRuns } from './exploration';

describe('territory bitset', () => {
    it('decodes row-major little-endian bits across byte and row boundaries', () => {
        expect(
            exploredRuns({
                policy: 'player',
                width: 5,
                height: 2,
                cellSize: 4,
                bits: btoa(String.fromCharCode(0b11100110, 0b00000011)),
            }),
        ).toEqual([
            { x: 4, y: 0, width: 8, height: 4 },
            { x: 0, y: 4, width: 20, height: 4 },
        ]);
    });
    it('does not invent territory before hydration or for empty observers', () => {
        expect(exploredRuns(undefined)).toEqual([]);
        expect(
            exploredRuns({ policy: 'party', width: 2, height: 2, cellSize: 4, bits: 'AA==' }),
        ).toEqual([]);
    });
});

it('uploads memory bits into reusable RGBA pixels and clears removed territory', () => {
    const pixels = new Uint8Array(40);
    const memory = {
        policy: 'player' as const,
        width: 5,
        height: 2,
        cellSize: 4,
        bits: btoa(String.fromCharCode(0b11100110, 0b00000011)),
    };
    explorationPixels(memory, pixels);
    expect([...pixels.filter((_, i) => i % 4 === 3)]).toEqual([
        0, 255, 255, 0, 0, 255, 255, 255, 255, 255,
    ]);
    explorationPixels({ ...memory, bits: '' }, pixels);
    expect(pixels.every((v) => v === 0)).toBe(true);
});
