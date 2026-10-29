import { describe, expect, it } from 'vitest';
import { diceNotation } from './diceNotation';
describe('authoritative dice presentation boundary', () => {
    it('preserves both advantage faces in their server order', () => {
        expect(diceNotation([17, 6])).toBe('2d20@17,6');
        expect(diceNotation([1, 20])).toBe('2d20@1,20');
        expect(diceNotation([4, 2], 6)).toBe('2d6@4,2');
    });
    it('rejects malformed faces and unsupported dice', () => {
        for (const values of [[], [0], [21], [1.5], [NaN], Array(21).fill(1)])
            expect(() => diceNotation(values)).toThrow();
        expect(() => diceNotation([5], 4)).toThrow();
        expect(() => diceNotation([1], 100)).toThrow();
    });
});
