import { request } from '../api/client';
import { commandId } from '../api/workspace';
import type { Character } from '../tabletop/types/scene';
import type { Ability } from '../gameplay/model';
export interface ItemDefinition {
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
    id: string;
    character_id: number;
    quantity: number;
    x: number | null;
    y: number | null;
    equipped_slot: string | null;
    definition: ItemDefinition;
}
export interface InventoryState {
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
export function fits(
    items: InventoryItem[],
    def: Pick<ItemDefinition, 'width' | 'height'>,
    x: number,
    y: number,
    ignore: string[] = [],
) {
    return (
        x >= 0 &&
        y >= 0 &&
        x + def.width <= 10 &&
        y + def.height <= 6 &&
        !items.some(
            (i) =>
                i.quantity > 0 &&
                !i.equipped_slot &&
                !ignore.includes(i.id) &&
                x < i.x! + i.definition.width &&
                x + def.width > i.x! &&
                y < i.y! + i.definition.height &&
                y + def.height > i.y!,
        )
    );
}
export const itemBinding = (id: string) => ({
    sourceType: 'inventory_item' as const,
    sourceId: id,
});
