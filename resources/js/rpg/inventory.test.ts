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
    it('uses one cell even for legacy large definitions, including the last cell', () => {
        expect(fits([sword], 0, 0)).toBe(false);
        expect(fits([sword], 0, 1)).toBe(true);
        expect(fits([], 9, 5)).toBe(true);
        expect(fits([], 10, 5)).toBe(false);
        expect(fits([], 9, 6)).toBe(false);
        expect(fits([], -1, 0)).toBe(false);
        expect(fits([{ ...sword, equipped_slot: 'main_hand' }], 0, 0)).toBe(true);
    });
    it('ignores the moving instance and consumed stacks, but rejects occupied cells', () => {
        expect(fits([sword], 0, 0, ['sword'])).toBe(true);
        expect(fits([sword, { ...sword, id: 'other', y: 1 }], 0, 1, ['sword'])).toBe(false);
        expect(fits([{ ...sword, quantity: 0 }], 0, 0)).toBe(true);
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
