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
    // Only GM projections contain configuration. Players receive id/label/icon.
    result_type?: 'handout' | 'cue';
    result_target?: string;
    enabled?: boolean;
}
export type InteractionResources = {
    handouts: { id: string; name: string }[];
    cues: { id: string; name: string }[];
};
export const interactions = {
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
    ) =>
        request<{ accepted: boolean; handout?: Handout }>(`/scenes/${scene}/interact`, 'POST', {
            kind,
            id,
            actionId,
            epoch,
            clientMutationId,
        }),
};
