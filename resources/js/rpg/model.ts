import { request } from '../api/client';
import { commandId } from '../api/workspace';
import type { Character } from '../tabletop/types/scene';
import type { Ability } from '../gameplay/model';
export interface ItemDefinition {
    gameplay?: import('./itemGameplay').ItemGameplay | null;
    compendium_entry_id?: number | null;
    id: string;
    name: string;
    icon: string;
    description: string | null;
    category: string;
    rarity: string;
    width: number;
    height: number;
    max_stack: number;
    equipment_slots: string[];
    modifiers: { ac?: number; speed?: number; checks?: Record<string, number> };
    use_ability_id: string | null;
}
export interface InventoryItem {
    grip?: 'one' | 'two';
    attack_ability?: 'auto' | 'str' | 'dex';
    weapon_proficient?: boolean;
    action?: {
        ability: Ability | null;
        secondary?: Ability | null;
        available: boolean;
        reason: string;
        ammunition?: number | null;
    };
    id: string;
    character_id: number;
    quantity: number;
    x: number | null;
    y: number | null;
    equipped_slot: string | null;
    definition: ItemDefinition;
}
export interface InventoryState {
    recipients?: { id: string; name: string }[];
    items: InventoryItem[];
    useAbilities: Ability[];
    width: number;
    height: number;
    slots: Record<string, string>;
    character: Character;
    base: { ac: number | null; speed: number | null };
}
export const inventoryApi = {
    read: (campaign: string, character: string, signal?: AbortSignal) =>
        request<InventoryState>(
            `/campaigns/${campaign}/characters/${character}/inventory`,
            'GET',
            undefined,
            signal,
        ),
    command: (
        campaign: string,
        character: string,
        data: Record<string, unknown>,
        id: string = commandId(),
    ) =>
        request<InventoryState>(
            `/campaigns/${campaign}/characters/${character}/inventory`,
            'POST',
            { ...data, clientMutationId: id },
        ),
    definitions: (campaign: string) =>
        request<{ definitions: ItemDefinition[] }>(`/campaigns/${campaign}/items`),
    save: (campaign: string, data: Partial<ItemDefinition>) =>
        request<{ definition: ItemDefinition }>(`/campaigns/${campaign}/items`, 'POST', {
            ...data,
            clientMutationId: commandId(),
        }),
};
export function fits(items: InventoryItem[], x: number, y: number, ignore: string[] = []) {
    return (
        x >= 0 &&
        y >= 0 &&
        x < 10 &&
        y < 6 &&
        !items.some(
            (i) =>
                i.quantity > 0 &&
                !i.equipped_slot &&
                !ignore.includes(i.id) &&
                x === i.x &&
                y === i.y,
        )
    );
}
export const itemBinding = (id: string) => ({
    sourceType: 'inventory_item' as const,
    sourceId: id,
});
