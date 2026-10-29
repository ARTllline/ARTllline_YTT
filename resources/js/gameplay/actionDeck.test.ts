import { describe, expect, it } from 'vitest';
import { abilityBinding, defaultSlots, normalizeSlots, placeBinding } from './hotbarModel';
import { GAMEPLAY_ENTRY_MIME, readGameplayEntry, writeGameplayEntry } from './gameplayDrag';

describe('typed action deck', () => {
    it('preserves legacy holes and positions while extending to 32 slots', () => {
        const old = Array.from({ length: 12 }, (_, i) => (i === 11 ? 'bow' : null));
        const next = normalizeSlots(old, ['bow']);
        expect(next).toHaveLength(32);
        expect(next[11]).toEqual(abilityBinding('bow'));
        expect(next.filter(Boolean)).toHaveLength(1);
        expect(next[0]).toBeNull();
    });
    it('swaps across pages without duplicating a binding or packing empty cells', () => {
        const slots = defaultSlots(['sword', 'bow']);
        const moved = placeBinding(slots, abilityBinding('sword'), 31);
        expect(moved[0]).toBeNull();
        expect(moved[31]).toEqual(abilityBinding('sword'));
        const swapped = placeBinding(moved, abilityBinding('bow'), 31);
        expect(swapped[1]).toEqual(abilityBinding('sword'));
        expect(swapped[31]).toEqual(abilityBinding('bow'));
        expect(slots[0]).toEqual(abilityBinding('sword'));
        expect(placeBinding(swapped, abilityBinding('bow'), 32)).toBe(swapped);
    });
    it('drops stale, unsupported and duplicate bindings without shifting other slots', () => {
        const slots = normalizeSlots(
            [
                abilityBinding('a'),
                abilityBinding('a'),
                { sourceType: 'item', sourceId: 'a' },
                abilityBinding('deleted'),
                abilityBinding('b'),
            ],
            ['a', 'b'],
        );
        expect(slots.slice(0, 5)).toEqual([
            abilityBinding('a'),
            null,
            null,
            null,
            abilityBinding('b'),
        ]);
    });
    it('shares one bounded versioned payload between gameplay windows and deck slots', () => {
        const data = new Map<string, string>();
        const transfer = {
            effectAllowed: 'none' as const,
            setData: (type: string, value: string) => data.set(type, value),
            getData: (type: string) => data.get(type) ?? '',
        };
        writeGameplayEntry(transfer, abilityBinding('bow'));
        expect(readGameplayEntry(transfer)).toEqual(abilityBinding('bow'));
        for (const payload of [
            'invalid',
            JSON.stringify({ version: 2, binding: abilityBinding('bow') }),
            JSON.stringify({ version: 1, binding: { sourceType: 'item', sourceId: 'fake' } }),
            'x'.repeat(1025),
        ]) {
            data.set(GAMEPLAY_ENTRY_MIME, payload);
            expect(readGameplayEntry(transfer)).toBeNull();
        }
    });
});
