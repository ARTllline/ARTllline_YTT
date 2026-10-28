import { request } from '../api/client';
import { commandId, type Mutation } from '../api/workspace';
import type { Scene } from '../tabletop/types/scene';
export interface Region {
    id: string;
    name: string;
    shape: 'rectangle' | 'circle';
    enabled: boolean;
    geometry: { x: number; y: number; width?: number; height?: number; radius?: number };
}
export type RegionCommand =
    | ({ action: 'create' | 'update'; id?: string } & Omit<Region, 'id'>)
    | { action: 'delete'; id: string };
export const eventLabels = {
    'region.enter': 'Вход в область',
    'region.exit': 'Выход из области',
    'object.interact': 'Взаимодействие с объектом',
    'scene.activated': 'Сцена активирована',
    'combat.started': 'Бой начат',
    'combat.round': 'Новый раунд',
};
export interface Trigger {
    id: string;
    name: string;
    eventType: keyof typeof eventLabels;
    cueId: string | null;
    regionId: string | null;
    objectType: 'token' | 'prop';
    objectId: string | null;
    actorFilter: 'player' | 'token' | 'any';
    actorTokenId: string | null;
    enabled: boolean;
    once: boolean;
    cooldownMs: number;
    minimumRound: number;
    fireCount: number;
    lastFiredAt: string | null;
}
export interface TriggerData {
    cues: { id: string; name: string }[];
    triggers: Trigger[];
    history: {
        id: number;
        trigger_id: number;
        source_event: keyof typeof eventLabels;
        source_key: string;
        cue_run_id: string | null;
        fired_at: string;
    }[];
}
export const automation = {
    read: (scene: string, signal?: AbortSignal) =>
        request<TriggerData>(`/scenes/${scene}/triggers`, 'GET', undefined, signal),
    region: (scene: string, command: RegionCommand, id: string) =>
        request<Mutation>(`/scenes/${scene}/regions`, 'POST', { ...command, clientMutationId: id }),
    trigger: (scene: string, data: object) =>
        request<Mutation>(`/scenes/${scene}/triggers`, 'POST', {
            ...data,
            clientMutationId: commandId(),
        }),
    interact: (
        scene: string,
        kind: 'token' | 'prop',
        id: string,
        epoch: number,
        mutation: string,
    ) =>
        request<{ accepted: boolean }>(`/scenes/${scene}/interact`, 'POST', {
            kind,
            id,
            epoch,
            clientMutationId: mutation,
        }),
};
export function applyRegionPatch(
    scene: Scene,
    patch: { region?: Region; deletedRegionId?: string },
): Scene {
    if (!patch.region && !patch.deletedRegionId) return scene;
    return {
        ...scene,
        regions: [
            ...(scene.regions ?? []).filter(
                (r) => r.id !== patch.region?.id && r.id !== patch.deletedRegionId,
            ),
            ...(patch.region ? [patch.region] : []),
        ],
    };
}
