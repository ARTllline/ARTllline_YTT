import { request } from './client';
import { commandId } from './workspace';
function mutate<T>(
    path: string,
    method: string,
    body: object,
    clientMutationId: string = commandId(),
) {
    return request<T>(path, method, { ...body, clientMutationId });
}
import type { Mutation } from './workspace';
import type { ObjectCommand, ObjectSelection, ImageAsset } from '../tabletop/types/scene';

export interface ContentTemplate {
    id: string;
    name: string;
    kind: 'prefab' | 'encounter';
    count: number;
    items: {
        kind: 'prop' | 'token';
        data: { name: string; x: number; y: number };
        image: ImageAsset | null;
        thumbnailUrl: string | null;
    }[];
}
export const objects = {
    command: (sceneId: string, command: ObjectCommand, mutationId: string) =>
        mutate<Mutation>(
            `/scenes/${sceneId}/${command.endpoint}`,
            'POST',
            command.data,
            mutationId,
        ),
    templates: (
        campaignId: string,
        kind: string,
        search: string,
        page: number,
        signal?: AbortSignal,
    ) =>
        request<{ templates: ContentTemplate[]; pages: number }>(
            `/campaigns/${campaignId}/templates?${new URLSearchParams({ kind, search, page: String(page) })}`,
            'GET',
            undefined,
            signal,
        ),
    save: (
        campaignId: string,
        sceneId: string,
        kind: 'prefab' | 'encounter',
        name: string,
        selection: ObjectSelection,
    ) =>
        mutate<{ template: ContentTemplate }>(`/campaigns/${campaignId}/templates`, 'POST', {
            sceneId,
            kind,
            name,
            ...selection,
        }),
    remove: (campaignId: string, templateId: string) =>
        mutate(`/campaigns/${campaignId}/templates/delete`, 'POST', { templateId }),
};
