import { request } from '../../api/client';
import { commandId } from '../../api/workspace';
import type { ImageAsset } from '../../tabletop/types/scene';

export const materialTypes = {
    terrain: 'Terrain · грунт',
    floor: 'Floor · пол',
    wall: 'Wall · стены',
};
export interface Material {
    id: string;
    versionId: string;
    version: number;
    name: string;
    type: keyof typeof materialTypes;
    asset: ImageAsset;
    repeatSize: number;
    rotation: number;
    variation: { offset: boolean; quarterTurns: boolean };
}
export const materialBody = (m: Omit<Material, 'id' | 'versionId'>) => ({
    name: m.name,
    type: m.type,
    assetId: m.asset.id,
    repeatSize: m.repeatSize,
    rotation: m.rotation,
    variation: m.variation,
    version: m.version,
});
export const materials = {
    list: (search: string, type: string, page: number, signal: AbortSignal) =>
        request<{ materials: Material[]; pages: number }>(
            `/library/materials?${new URLSearchParams({ search, type, page: String(page) })}`,
            'GET',
            undefined,
            signal,
        ),
    save: (m: Omit<Material, 'id' | 'versionId'>, id?: string) =>
        request<Material>(`/library/materials${id ? `/${id}` : ''}`, id ? 'PATCH' : 'POST', {
            ...materialBody(m),
            clientMutationId: commandId(),
        }),
    duplicate: (id: string) =>
        request<Material>(`/library/materials/${id}/duplicate`, 'POST', {
            clientMutationId: commandId(),
        }),
    remove: (id: string) =>
        request(`/library/materials/${id}`, 'DELETE', { clientMutationId: commandId() }),
};

/** repeatSize is the width of one image repeat; preserve texture aspect ratio. */
export function repeatPixels(m: Pick<Material, 'repeatSize' | 'asset'>, pixelsPerUnit: number) {
    return {
        width: m.repeatSize * pixelsPerUnit,
        height: (m.repeatSize * pixelsPerUnit * m.asset.height) / Math.max(1, m.asset.width),
    };
}
