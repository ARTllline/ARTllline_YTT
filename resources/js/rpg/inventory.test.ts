import { describe, expect, it } from 'vitest';
import { fits, itemBinding, type InventoryItem } from './model';
import { normalizeSlots, placeBinding, defaultSlots } from '../gameplay/hotbarModel';
import { writeGameplayEntry, readGameplayEntry } from '../gameplay/gameplayDrag';
const sword = {
    id: 'sword',
    quantity: 1,
    x: 0,
    y: 0,
    equipped_slot: null,
    definition: { width: 1, height: 3 },
} as InventoryItem;
describe('spatial inventory and shared bindings', () => {
    it('rejects overlapping footprints and boundary overflow while preserving equipment space', () => {
        expect(fits([sword], { width: 2, height: 2 }, 0, 1)).toBe(false);
        expect(fits([sword], { width: 2, height: 2 }, 1, 1)).toBe(true);
        expect(fits([], { width: 2, height: 2 }, 9, 0)).toBe(false);
        expect(fits([], { width: 1, height: 3 }, 0, 4)).toBe(false);
        expect(
            fits([{ ...sword, equipped_slot: 'main_hand' }], { width: 2, height: 2 }, 0, 0),
        ).toBe(true);
    });
    it('allows moving the source rectangle through its own old cells but not another item', () => {
        expect(fits([sword], { width: 1, height: 3 }, 0, 1, ['sword'])).toBe(true);
        expect(
            fits([sword, { ...sword, id: 'other', y: 3 }], { width: 1, height: 3 }, 0, 1, [
                'sword',
            ]),
        ).toBe(false);
    });
    it('keeps ability and inventory namespaces distinct and roundtrips the same drop protocol', () => {
        const item = itemBinding('same-id'),
            slots = placeBinding(defaultSlots(['same-id']), item, 12);
        expect(normalizeSlots(slots, ['same-id'])[12]).toEqual(item);
        expect(slots[0]?.sourceType).toBe('ability');
        let value = '';
        const data = {
            effectAllowed: 'none' as const,
            setData: (_type: string, s: string) => {
                value = s;
            },
            getData: () => value,
        };
        writeGameplayEntry(data, item);
        expect(readGameplayEntry(data)).toEqual(item);
    });
});
