import type { Point } from '../tabletop/types/scene';
import type { RollMode } from '../workspace/interactions/actingToken';
import { request } from '../api/client';
import { commandId } from '../api/workspace';

export interface CharacterResource {
    recovery?: 'manual' | 'short_rest' | 'long_rest';
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
    casting?: {
        available: boolean;
        reason: string;
        levels: {
            level: number;
            current: number | null;
            damage?: string | null;
            healing?: string | null;
        }[];
    };
    requires_sight?: boolean;
    activation?: 'action' | 'bonus_action' | 'reaction' | 'free';
    attack?: {
        ability: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha' | 'spellcasting';
        proficient: boolean;
        bonus: number;
    } | null;
    save?: {
        ability: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
        dc_source: 'fixed' | 'spellcasting';
        dc: number;
        on_success: 'negates' | 'half' | 'full';
        on_failure: 'full' | 'none';
    } | null;
    damage_components?: { dice: string; type: string }[];
    condition_effects?: {
        key: string;
        when: 'hit' | 'failed_save' | 'successful_save' | 'always';
        duration_mode: string;
        rounds?: number;
    }[];
    item_only?: boolean;
    spell?: {
        coverage?: 'FULL' | 'PARTIAL' | 'MANUAL';
        reasons?: string[];
        source_key?: string;
        source_entry_id?: number | null;
        available?: boolean;
        manual_allowed?: boolean;
        reference?: string;
        casting_time?: string | null;
        duration_text?: string | null;
        duration?: {
            mode: 'instantaneous' | 'rounds' | 'seconds' | 'manual' | 'source_start';
            amount: number;
        };
        components?: string[];
        material?: string | null;
        scaling?: Partial<
            Record<
                'damage' | 'healing' | 'temporary_hp',
                { per_level?: string | null; spellcasting?: boolean }
            >
        >;
        cantrip_dice?: string | null;
        cantrip_tier?: number;
        effects?: {
            type: 'modifier' | 'temporary_hp' | 'remove_condition';
            key?: string;
            value?: number;
            dice?: string | null;
            when: 'always' | 'hit' | 'failed_save' | 'successful_save';
            choices?: string[];
        }[];
        material_definition_id?: number | null;
        material_quantity?: number;
        consume_material?: boolean;
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
        dice?: string | null;
    };
    sort_order: number;
    enabled: boolean;
}
export type AbilityTarget = { kind: 'token' | 'prop'; id: string } | ({ kind: 'point' } & Point);
export interface AbilityCommand {
    castLevel?: number;
    effectChoice?: string;
    manualComplete?: boolean;
    actorTokenId?: string;
    inventoryItemId?: string;
    itemAction?: 'use' | 'throw';
    clientMutationId: string;
    characterId?: string;
    abilityId: string;
    epoch: number;
    target: AbilityTarget | null;
    rollMode: RollMode;
}
export interface AbilityResult {
    castLevel?: number;
    coverage?: string;
    manualResolution?: string | null;
    provenance?: import('../workspace/interactions/model').CheckResult['provenance'] | null;
    id: string;
    abilityId: string;
    abilityName: string;
    category: Ability['category'];
    actorId: string;
    actorName: string;
    target: AbilityTarget | null;
    roll: null | {
        automaticFailure?: boolean;
        context?: {
            mode: RollMode;
            advantage: { label: string }[];
            disadvantage: { label: string }[];
            automaticFailure: { label: string }[];
        };
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
    outcomes?: {
        tokenId: string;
        damage: number;
        save?: { success: boolean; automaticFailure?: boolean; rollMode: RollMode } | null;
    }[];
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
