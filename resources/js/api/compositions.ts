import { request } from './client';
import { commandId } from './workspace';
import type { ImageAsset, ObjectSelection } from '../tabletop/types/scene';

export interface CompositionMember {
    kind: 'token' | 'prop';
    name: string;
    x: number;
    y: number;
    rotation: number;
    width: number;
    height: number;
    pivotX: number;
    pivotY: number;
    image: ImageAsset | null;
    container: boolean;
    items: number;
    interactions: number;
}
export interface CompositionPreset {
    id: string;
    name: string;
    description: string | null;
    revision: number;
    count: number;
    members: CompositionMember[];
}
export const compositions = {
    list: (search: string, page: number, signal?: AbortSignal) =>
        request<{ presets: CompositionPreset[]; pages: number }>(
            `/library/compositions?${new URLSearchParams({ search, page: String(page) })}`,
            'GET',
            undefined,
            signal,
        ),
    save: (
        sceneId: string,
        selection: ObjectSelection,
        expectedRevision: number,
        name: string,
        description: string,
    ) =>
        request<{ preset: CompositionPreset }>(`/scenes/${sceneId}/composition-presets`, 'POST', {
            ...selection,
            expectedRevision,
            name,
            description,
            clientMutationId: commandId(),
        }),
    command: (
        preset: CompositionPreset,
        action: 'rename' | 'duplicate' | 'delete',
        name?: string,
        description?: string,
    ) =>
        request(`/library/compositions/${preset.id}/command`, 'POST', {
            action,
            expectedRevision: preset.revision,
            name,
            description,
            clientMutationId: commandId(),
        }),
};

export const compositionIssue = (members: CompositionMember[], x: number, y: number) =>
    members.some(
        (m) =>
            !Number.isFinite(x + m.x) ||
            !Number.isFinite(y + m.y) ||
            Math.abs(x + m.x) > 1_000_000 ||
            Math.abs(y + m.y) > 1_000_000,
    )
        ? 'Группа выходит за допустимые границы координат.'
        : null;
