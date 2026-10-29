import { describe, expect, it } from 'vitest';
import { radialPosition, radialFocus, radialSlot } from './radialLayout';
describe('radial menu geometry and keyboard access', () => {
    it('fits all viewport edges including a narrow tablet', () => {
        for (const width of [280, 390, 768, 1440, 1920])
            for (const x of [0, width])
                for (const y of [0, 844]) {
                    const p = radialPosition(x, y, width, 844);
                    expect(p.left).toBeGreaterThanOrEqual(8);
                    expect(p.left + p.size).toBeLessThanOrEqual(width - 8);
                    expect(p.top + p.size).toBeLessThanOrEqual(836);
                }
    });
    it('wraps focus in both directions with explicit start and end', () => {
        expect(radialFocus(0, 'ArrowLeft', 7)).toBe(6);
        expect(radialFocus(6, 'ArrowDown', 7)).toBe(0);
        expect(radialFocus(4, 'Home', 7)).toBe(0);
        expect(radialFocus(2, 'End', 7)).toBe(6);
        expect(radialSlot(0, 6).top).toBe('15%');
    });
});
