export const HOTBAR_SIZE = 12;
export type HotbarSlots = (string | null)[];
export function placeAbility(slots: HotbarSlots, abilityId: string, index: number): HotbarSlots {
    if (index < 0 || index >= HOTBAR_SIZE) return slots;
    const next = [...slots],
        previous = next.indexOf(abilityId);
    if (previous >= 0) next[previous] = next[index];
    next[index] = abilityId;
    return next;
}
export function defaultSlots(ids: string[]): HotbarSlots {
    return Array.from({ length: HOTBAR_SIZE }, (_, i) => ids[i] ?? null);
}
