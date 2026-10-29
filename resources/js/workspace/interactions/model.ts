import { BookOpen, Eye, Hand, Search, DoorOpen, Sparkles, MessageCircle, Play } from 'lucide-react';
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
            },
        ),
};
