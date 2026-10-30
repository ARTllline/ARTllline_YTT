import type { InventoryItem } from '../rpg/model';

export const PAGE_SIZE = 16;
export const HOTBAR_SIZE = 32;
/** Resolved and authorized source identities; positions remain canonical. */
export interface SlotBinding {
    sourceType: 'ability' | 'inventory_item';
    sourceId: string;
}
export interface DeckLayout {
    version: 2;
    slots: HotbarSlots;
}
export type HotbarSlots = (SlotBinding | null)[];
export const abilityBinding = (id: string): SlotBinding => ({
    sourceType: 'ability',
    sourceId: id,
});
export function canBindInventoryItem(item: InventoryItem): boolean {
    // Unavailable weapons may be prepared on the deck before equipping them.
    return item.quantity > 0 && !!(item.action?.ability || item.definition.use_ability_id);
}
export function isBinding(value: unknown): value is SlotBinding {
    return (
        !!value &&
        typeof value === 'object' &&
        'sourceType' in value &&
        ['ability', 'inventory_item'].includes(String(value.sourceType)) &&
        'sourceId' in value &&
        typeof value.sourceId === 'string' &&
        value.sourceId.length > 0 &&
        value.sourceId.length <= 128
    );
}
export function placeBinding(slots: HotbarSlots, binding: SlotBinding, index: number): HotbarSlots {
    if (index < 0 || index >= HOTBAR_SIZE) return slots;
    const next = [...slots],
        previous = next.findIndex(
            (s) => s?.sourceType === binding.sourceType && s.sourceId === binding.sourceId,
        );
    if (previous >= 0) next[previous] = next[index];
    next[index] = binding;
    return next;
}
export function defaultSlots(ids: string[]): HotbarSlots {
    return Array.from({ length: HOTBAR_SIZE }, (_, i) => (ids[i] ? abilityBinding(ids[i]) : null));
}
/** Read legacy twelve-ID arrays without repacking holes or changing slot order. */
export function normalizeSlots(value: unknown, available: string[]): HotbarSlots {
    const raw = Array.isArray(value) ? value : [];
    const seen = new Set<string>();
    return Array.from({ length: HOTBAR_SIZE }, (_, i) => {
        const binding = typeof raw[i] === 'string' ? abilityBinding(raw[i]) : raw[i];
        if (
            !isBinding(binding) ||
            (binding.sourceType === 'ability' && !available.includes(binding.sourceId)) ||
            seen.has(`${binding.sourceType}:${binding.sourceId}`)
        )
            return null;
        seen.add(`${binding.sourceType}:${binding.sourceId}`);
        return binding;
    });
}
