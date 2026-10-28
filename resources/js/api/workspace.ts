import { request, setCsrf } from './client';
import type {
    Scene,
    Token,
    TokenPatch,
    GridSettings,
    ImageAsset,
    SceneMap,
    Point,
} from '../tabletop/types/scene';
export interface User {
    id: string;
    name: string;
    email: string;
}
export interface CampaignSummary {
    id: string;
    name: string;
    role: 'gm' | 'player';
}
export interface Campaign extends CampaignSummary {
    activeSceneId: string | null;
    scenes: { id: string; name: string }[];
    members?: { id: string; name: string; role: string }[];
}
export interface Mutation {
    revision: number;
    token?: Token;
    grid?: GridSettings;
    map?: SceneMap | null;
    deletedId?: string;
}
export const api = {
    session: async () => {
        const value = await request<{ user: User | null; csrf: string }>('/session');
        setCsrf(value.csrf);
        return value.user;
    },
    auth: async (mode: 'login' | 'register', fields: Record<string, string>) => {
        const value = await request<{ user: User; csrf: string }>(`/${mode}`, 'POST', fields);
        setCsrf(value.csrf);
        return value.user;
    },
    logout: () => request('/logout', 'POST'),
    campaigns: () => request<{ campaigns: CampaignSummary[] }>('/campaigns'),
    campaign: (id: string, signal?: AbortSignal) =>
        request<Campaign>(`/campaigns/${id}`, 'GET', undefined, signal),
    createCampaign: (name: string) => request<Campaign>('/campaigns', 'POST', { name }),
    renameCampaign: (id: string, name: string) =>
        request<Campaign>(`/campaigns/${id}`, 'PATCH', { name }),
    createScene: (campaign: string, name: string) =>
        request<{ id: string; name: string }>(`/campaigns/${campaign}/scenes`, 'POST', { name }),
    renameScene: (id: string, name: string) =>
        request<{ revision: number }>(`/scenes/${id}`, 'PATCH', { name }),
    deleteScene: (id: string) => request(`/scenes/${id}`, 'DELETE'),
    activate: (campaign: string, sceneId: string | null) =>
        request<Campaign>(`/campaigns/${campaign}/activate`, 'POST', { sceneId }),
    snapshot: (id: string, signal?: AbortSignal) =>
        request<Scene>(`/scenes/${id}/snapshot`, 'GET', undefined, signal),
    grid: (scene: string, grid: GridSettings) =>
        request<Mutation>(`/scenes/${scene}/grid`, 'PUT', grid),
    map: (scene: string, map: SceneMap | null) =>
        request<Mutation>(
            `/scenes/${scene}/map`,
            'PUT',
            map
                ? {
                      assetId: map.asset.id,
                      x: map.x,
                      y: map.y,
                      width: map.width,
                      height: map.height,
                  }
                : { assetId: null, x: 0, y: 0, width: 1440, height: 1080 },
        ),
    createToken: (scene: string, point: Point) =>
        request<Mutation>(`/scenes/${scene}/tokens`, 'POST', { ...point, name: 'New token' }),
    move: (id: string, point: Point) => request<Mutation>(`/tokens/${id}/move`, 'POST', point),
    token: (id: string, patch: TokenPatch) => {
        const fields: Record<string, unknown> = {};
        const keys: Record<string, string> = {
            maxHp: 'max_hp',
            isHidden: 'is_hidden',
            isLocked: 'is_locked',
            ownerUserId: 'owner_user_id',
        };
        Object.entries(patch).forEach(([key, value]) => {
            if (key === 'image') fields.token_image_asset_id = patch.image?.id ?? null;
            else fields[keys[key] ?? key] = value;
        });
        return request<Mutation>(`/tokens/${id}`, 'PATCH', fields);
    },
    deleteToken: (id: string) => request<Mutation>(`/tokens/${id}`, 'DELETE'),
    upload: (campaign: string, file: File, kind: 'map' | 'token') => {
        const form = new FormData();
        form.set('file', file);
        form.set('kind', kind);
        return request<ImageAsset>(`/campaigns/${campaign}/assets`, 'POST', form);
    },
};
