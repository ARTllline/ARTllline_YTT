import type { Point } from '../tabletop/types/scene';
import type { RollMode } from '../workspace/interactions/actingToken';
import { request } from '../api/client';
import { commandId } from '../api/workspace';

export interface CharacterResource {
    key: string;
    label: string;
    current: number;
    max: number;
    icon: string;
    accent: 'violet' | 'blue' | 'amber' | 'green' | 'red';
    sort_order: number;
    player_adjustable: boolean;
}
export interface Ability {
    item_only?: boolean;
    spell?: {
        level: number;
        school: string;
        classes: string[];
        known: boolean;
        prepared: boolean;
        ritual?: boolean;
        concentration?: boolean;
    } | null;
    attack_type?: 'melee' | 'ranged' | 'spell' | 'check' | 'utility';
    range?: { normal: number; long: number | null } | null;
    area?: {
        shape: 'none' | 'circle' | 'cone' | 'line' | 'rectangle';
        size: number;
        width: number;
    } | null;
    id: string;
    name: string;
    icon: string;
    description: string | null;
    category: 'utility' | 'check' | 'attack' | 'effect';
    target: 'self' | 'token' | 'prop' | 'point' | 'none';
    check: {
        proficient?: boolean;
        bonus?: number;
        stat_key: string | null;
        modifier?: number;
        dc?: number;
        dc_visible?: boolean;
        defense?: 'ac' | 'fixed';
    } | null;
    costs: { key: string; amount: number }[];
    damage?: string | null;
    result?: {
        type: 'nothing' | 'heal' | 'cue' | 'handout';
        target: number | null;
        amount: number;
    };
    sort_order: number;
    enabled: boolean;
}
export type AbilityTarget = { kind: 'token' | 'prop'; id: string } | ({ kind: 'point' } & Point);
export interface AbilityCommand {
    inventoryItemId?: string;
    clientMutationId: string;
    characterId: string;
    abilityId: string;
    epoch: number;
    target: AbilityTarget | null;
    rollMode: RollMode;
}
export interface AbilityResult {
    provenance?: import('../workspace/interactions/model').CheckResult['provenance'] | null;
    id: string;
    abilityId: string;
    abilityName: string;
    category: Ability['category'];
    actorId: string;
    actorName: string;
    target: AbilityTarget | null;
    roll: null | {
        rawDice: number[];
        natural: number;
        total: number;
        modifier: number;
        dc?: number;
        success: boolean;
        rollMode: RollMode;
        selectedDie: number;
    };
    success: boolean;
    outcomes?: { tokenId: string; damage: number }[];
    damage: null | { expression: string; rawDice: number[]; modifier: number; total: number };
    healing: number | null;
    mutationId: string;
}
export interface GameplayFeedback {
    tokenId: string;
    text: string;
    tone: 'damage' | 'heal' | 'miss';
}
export const gameplayApi = {
    execute: (scene: string, command: AbilityCommand) =>
        request<{ execution: AbilityResult }>(
            command.inventoryItemId
                ? `/scenes/${scene}/inventory/use`
                : `/scenes/${scene}/abilities/execute`,
            'POST',
            command,
        ),
    resource: (campaign: string, characterId: string, key: string, delta: number, id: string) =>
        request(`/campaigns/${campaign}/resources/adjust`, 'POST', {
            characterId,
            key,
            delta,
            clientMutationId: id,
        }),
};
export function newAbility(category: Ability['category'], order: number): Ability {
    return {
        id: commandId(),
        name:
            category === 'attack'
                ? 'Новая атака'
                : category === 'check'
                  ? 'Новая проверка'
                  : 'Новое действие',
        icon: category === 'attack' ? 'sword' : category === 'check' ? 'eye' : 'spark',
        description: '',
        category,
        target: category === 'attack' ? 'token' : 'self',
        check: ['attack', 'check'].includes(category)
            ? {
                  stat_key: null,
                  modifier: 0,
                  dc: 10,
                  dc_visible: true,
                  defense: category === 'attack' ? 'ac' : 'fixed',
              }
            : null,
        costs: [],
        damage: category === 'attack' ? '1d8+3' : null,
        result: { type: 'nothing', target: null, amount: 0 },
        sort_order: order,
        enabled: true,
    };
}
export function canAfford(ability: Ability, resources: CharacterResource[]) {
    return ability.costs.every(
        (c) => (resources.find((r) => r.key === c.key)?.current ?? 0) >= c.amount,
    );
}
export const targetLabels = {
    self: 'На себя',
    token: 'Видимый токен',
    prop: 'Объект сцены',
    point: 'Точка мира',
    none: 'Без цели',
};
