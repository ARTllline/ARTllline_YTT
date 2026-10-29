import { BookOpen, Eye, Hand, Search, DoorOpen, Sparkles, MessageCircle, Play } from 'lucide-react';
import type { RollMode } from './actingToken';
import { request } from '../../api/client';
import type { Mutation } from '../../api/workspace';
import type { Handout } from '../../api/preparation';

export const interactionIcons = {
    book: { Icon: BookOpen, label: 'Книга' },
    eye: { Icon: Eye, label: 'Глаз' },
    hand: { Icon: Hand, label: 'Рука' },
    search: { Icon: Search, label: 'Поиск' },
    door: { Icon: DoorOpen, label: 'Дверь' },
    sparkles: { Icon: Sparkles, label: 'Искры' },
    message: { Icon: MessageCircle, label: 'Реплика' },
    play: { Icon: Play, label: 'Запуск' },
};
export interface ObjectInteraction {
    id: string;
    label: string;
    icon: keyof typeof interactionIcons;
    // Result configuration exists only in GM projections.
    result_type?: 'handout' | 'cue' | 'nothing';
    result_target?: string;
    enabled?: boolean;
    check?: InteractionCheck;
}
export type InteractionResult = {
    result_type: 'nothing' | 'handout' | 'cue';
    result_target?: string | null;
};
// Only enabled/label and explicitly visible DC occur in the Player projection.
export interface InteractionCheck {
    enabled: boolean;
    label: string;
    ability_key?: string;
    stat_key?: string;
    dc?: number;
    dc_visible?: boolean;
    modifier?: number;
    retry?: 'once' | 'once_per_player' | 'repeatable';
    success?: InteractionResult;
    failure?: InteractionResult;
}
export interface CheckResult {
    id: string;
    actionId: string;
    actionLabel: string;
    label: string;
    natural: number;
    modifier: number;
    total: number;
    success: boolean;
    dc?: number;
    tokenId: string | null;
    rolledAt: string;
    rollMode: RollMode;
    rawDice: number[];
    selectedDie: number;
    provenance: {
        source: 'token_stat' | 'character_stat' | 'legacy_interaction';
        characterId?: string;
        characterName?: string;
        tokenId: string | null;
        tokenName: string | null;
        statKey: string | null;
        statLabel: string;
        baseModifier: number;
        otherModifiers: { label: string; modifier: number }[];
        finalModifier: number;
    };
}
/** Receipts committed before the stat migration retain their original response shape. */
export function normalizeCheckResult(check: CheckResult): CheckResult {
    return {
        ...check,
        rollMode: check.rollMode ?? 'normal',
        rawDice: check.rawDice ?? [check.natural],
        selectedDie: check.selectedDie ?? 0,
        provenance: check.provenance ?? {
            source: 'legacy_interaction',
            tokenId: check.tokenId,
            tokenName: null,
            statKey: null,
            statLabel: check.label,
            baseModifier: check.modifier,
            otherModifiers: [],
            finalModifier: check.modifier,
        },
    };
}
export type CheckHistory = CheckResult & { actor: { id: string; name: string } };
export type InteractionResources = {
    handouts: { id: string; name: string }[];
    cues: { id: string; name: string }[];
};
export const interactions = {
    history: (scene: string, kind: 'token' | 'prop', id: string, signal?: AbortSignal) =>
        request<{ checks: CheckHistory[] }>(
            `/scenes/${scene}/object-checks?kind=${kind}&id=${id}`,
            'GET',
            undefined,
            signal,
        ),
    resources: (scene: string, signal?: AbortSignal) =>
        request<InteractionResources>(
            `/scenes/${scene}/object-action-resources`,
            'GET',
            undefined,
            signal,
        ),
    save: (
        scene: string,
        kind: 'token' | 'prop',
        id: string,
        actions: ObjectInteraction[],
        clientMutationId: string,
    ) =>
        request<Mutation>(`/scenes/${scene}/object-actions`, 'POST', {
            kind,
            id,
            actions,
            clientMutationId,
        }),
    run: (
        scene: string,
        kind: 'token' | 'prop',
        id: string,
        actionId: string,
        epoch: number,
        clientMutationId: string,
        actorTokenId?: string,
        rollMode?: RollMode,
    ) =>
        request<{ accepted: boolean; handout?: Handout; check?: CheckResult }>(
            `/scenes/${scene}/interact`,
            'POST',
            {
                kind,
                id,
                actionId,
                epoch,
                clientMutationId,
                ...(actorTokenId ? { actorTokenId } : {}),
                ...(rollMode ? { rollMode } : {}),
            },
        ).then((response) => ({
            ...response,
            ...(response.check ? { check: normalizeCheckResult(response.check) } : {}),
        })),
};
