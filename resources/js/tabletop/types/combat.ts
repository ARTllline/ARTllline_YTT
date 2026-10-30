export interface TokenCondition {
    description?: string;
    sourceTokenId?: string | null;
    durationMode?: string;
    remainingRounds?: number | null;
    compendiumEntryId?: number | null;
    id: string;
    key: string | null;
    label: string;
    visibility?: 'public' | 'gm_only';
}
export interface Combatant {
    budget?: import('../../gameplay/combat').TurnResources;
    id: string;
    tokenId: string;
    initiative: number | null;
}
export interface Combat {
    id: string;
    status: 'preparing' | 'active';
    round: number;
    currentTurn: { combatantId: string } | { gmHiddenTurn: true } | null;
    combatants: Combatant[];
}
export type CombatCommand =
    | {
          action: 'override';
          combatId: string;
          combatantId: string;
          action_available?: boolean;
          bonus_available?: boolean;
          reaction_available?: boolean;
          movement_spent?: number;
      }
    | { action: 'prepare' }
    | { action: 'add'; combatId: string; tokenIds: string[] }
    | { action: 'remove' | 'current'; combatId: string; combatantId: string }
    | { action: 'initiative'; combatId: string; combatantId: string; initiative: number | null }
    | { action: 'reorder'; combatId: string; combatantIds: string[] }
    | { action: 'begin' | 'end' | 'sort'; combatId: string }
    | {
          action: 'next' | 'previous';
          combatId: string;
          expectedRound: number;
          expectedCurrentCombatantId: string | null;
      };
export type TokenCombatCommand =
    | { action: 'stand-up' }
    | { action: 'hp'; delta: number }
    | { action: 'hp-set'; value: number }
    | {
          action: 'condition-add';
          key?: string;
          label?: string;
          visibility: 'public' | 'gm_only';
          duration_mode?: string;
          rounds?: number;
          source_token_id?: string;
      }
    | { action: 'condition-remove'; conditionId: string }
    | { action: 'condition-visibility'; conditionId: string; visibility: 'public' | 'gm_only' };
export function currentTokenId(combat?: Combat | null): string | undefined {
    const turn = combat?.status === 'active' ? combat.currentTurn : null;
    return turn && 'combatantId' in turn
        ? combat?.combatants.find((c) => c.id === turn.combatantId)?.tokenId
        : undefined;
}
