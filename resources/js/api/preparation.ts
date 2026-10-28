import { request } from './client';
import { commandId } from './workspace';
import type { ImageAsset } from '../tabletop/types/scene';
export type AssetKind = 'map' | 'token' | 'handout' | 'prop' | 'music' | 'ambient' | 'sfx';
export interface Label {
    id: string;
    name: string;
}
export interface LibraryAsset extends ImageAsset {
    name: string;
    originalName: string;
    duration?: number | null;
    kind: AssetKind;
    thumbnailUrl: string;
    fileSize: number;
    mimeType: string;
    createdAt: string;
    tags: Label[];
    collections: Label[];
}
export interface LibraryFilters {
    kind: string;
    search: string;
    tag: string;
    collection: string;
    sort: string;
    page: number;
}
export interface LibraryPage {
    assets: LibraryAsset[];
    tags: Label[];
    collections: Label[];
    page: number;
    pages: number;
    total: number;
}
export interface Handout {
    id: string;
    title: string;
    description: string | null;
    asset: ImageAsset;
    thumbnailUrl: string;
}
export const libraryQuery = (filters: LibraryFilters) =>
    new URLSearchParams(
        Object.entries(filters)
            .filter(([, value]) => value !== '')
            .map(([key, value]) => [key, String(value)]),
    ).toString();
export const preparation = {
    assets: (campaign: string, filters: LibraryFilters, signal?: AbortSignal) =>
        request<LibraryPage>(
            `/campaigns/${campaign}/assets?${libraryQuery(filters)}`,
            'GET',
            undefined,
            signal,
        ),
    detail: (id: string) =>
        request<LibraryAsset & { usage: string[]; handout: Handout | null }>(
            `/assets/${id}/detail`,
        ),
    update: (id: string, data: { name: string; tags: string[]; collections: string[] }) =>
        request<LibraryAsset>(`/assets/${id}`, 'PATCH', data),
    remove: (id: string) => request(`/assets/${id}`, 'DELETE'),
    upload: (campaign: string, file: File, kind: AssetKind) => {
        const form = new FormData();
        form.set('file', file);
        form.set('kind', kind);
        return request<LibraryAsset>(`/campaigns/${campaign}/assets`, 'POST', form);
    },
    handouts: (campaign: string, page = 1, signal?: AbortSignal) =>
        request<{ handouts: Handout[]; page: number; pages: number }>(
            `/campaigns/${campaign}/handouts?page=${page}`,
            'GET',
            undefined,
            signal,
        ),
    saveHandout: (campaign: string, assetId: string, title: string, description: string) =>
        request<Handout>(`/campaigns/${campaign}/handouts`, 'POST', {
            assetId,
            title,
            description,
            clientMutationId: commandId(),
        }),
    showHandout: (campaign: string, handoutId: string) =>
        request(`/campaigns/${campaign}/handouts/show`, 'POST', {
            handoutId,
            clientMutationId: commandId(),
        }),
};
