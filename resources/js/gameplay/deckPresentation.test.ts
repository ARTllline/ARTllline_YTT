import { describe, expect, it } from 'vitest';
import { deckBanks } from './deckPresentation';
import { abilityBinding, defaultSlots, placeBinding } from './hotbarModel';

describe('deck visual banks', () => {
    it('preserves the canonical rows and shortcuts instead of packing bindings', () => {
        const banks = deckBanks(0, false);
        expect(banks[0].indices).toEqual([0, 1, 2, 3, 8, 9, 10, 11]);
        expect(banks[1].indices).toEqual([4, 5, 6, 7, 12, 13, 14, 15]);
        expect(
            deckBanks(1, false)
                .flatMap((b) => b.indices)
                .sort((a, b) => a - b),
        ).toEqual(Array.from({ length: 16 }, (_, i) => i + 16));
    });
    it('shows all 32 positions exactly once in expanded view', () => {
        const indices = deckBanks(1, true).flatMap((b) => b.indices);
        expect(new Set(indices).size).toBe(32);
        expect(indices.slice().sort((a, b) => a - b)).toEqual(
            Array.from({ length: 32 }, (_, i) => i),
        );
    });
    it('retains sparse swap destinations between banks and pages', () => {
        const original = defaultSlots(['a', 'b']);
        const index = deckBanks(1, false)[1].indices[7];
        const moved = placeBinding(original, abilityBinding('a'), index);
        expect(index).toBe(31);
        expect(moved[31]).toEqual(abilityBinding('a'));
        expect(moved[0]).toBeNull();
        expect(moved[1]).toEqual(abilityBinding('b'));
        expect(original[0]).toEqual(abilityBinding('a'));
    });
});
