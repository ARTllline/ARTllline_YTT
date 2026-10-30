import type { AbilityResult } from '../../gameplay/model';
export interface SessionRoll {
    total: number;
    dc?: number;
    success?: boolean;
    rawDice?: number[];
    modifier?: number;
    rollMode?: string;
    context?: { advantage?: { label: string }[]; disadvantage?: { label: string }[] };
    bonusRolls?: { label: string; roll: { total: number; expression: string } }[];
}
export interface SessionOutcome {
    tokenId: string;
    damage: number;
    save?:
        | (SessionRoll & {
              provenance?: { breakdown?: { label: string; value: number }[] };
              dcProvenance?: { label: string; value: number }[];
          })
        | null;
    hpBefore?: number;
    hpAfter?: number;
    damageDetail?: {
        components?: {
            type?: string;
            total?: number;
            amount?: number;
            rolled?: number;
            saveEffect?: string;
            adjustments?: string[];
            resistance?: boolean;
            immunity?: boolean;
            vulnerability?: boolean;
        }[];
    };
}
export interface SessionResult extends Omit<AbilityResult, 'outcomes' | 'roll'> {
    outcomes?: SessionOutcome[];
    roll: SessionRoll | null;
    damageRolls?: {
        type: string;
        roll: { expression: string; rawDice: number[]; total: number };
    }[];
    gmContext?: {
        sourceTokenId?: string;
        description: string;
        remaining: string;
        activation: string;
        slotSpent: number;
    };
}
export interface ResolutionTask {
    id: string;
    characterId: string | null;
    createdAt: string;
    result: SessionResult;
}
export interface SessionState {
    pending: ResolutionTask[];
    undoId: string | null;
}
export interface CombatEvent {
    id: string;
    type: string;
    createdAt: string;
    data: {
        tokenId?: string;
        actorId?: string;
        targetId?: string;
        sourceId?: string;
        name?: string;
        actorName?: string;
        abilityName?: string;
        round?: number;
        key?: string;
        reason?: string;
        cause?: string;
        spell?: string;
        stat?: string;
        operation?: string;
        note?: string;
        status?: string;
        before?: { hp: number; conditions: { label: string }[] };
        after?: { hp: number; conditions: { label: string }[] };
        roll?: SessionRoll;
        save?: SessionRoll;
        provenance?: { finalModifier?: number; breakdown?: { label: string; value: number }[] };
        result?: SessionResult;
        outcomes?: {
            tokenId: string;
            name: string;
            roll: SessionRoll;
            provenance?: { breakdown?: { label: string; value: number }[] };
        }[];
        changes?: Record<string, number | boolean>;
    };
}
