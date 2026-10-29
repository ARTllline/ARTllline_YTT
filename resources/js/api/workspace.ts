import { t } from '../i18n';
import type { FogAction, FogState, FogStroke, FogBase } from '../tabletop/types/spatial';
import type { Combat, CombatCommand, TokenCombatCommand } from '../tabletop/types/combat';
import type { ObjectPatch as importObjectPatch } from '../tabletop/state/objectPatch';
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
    liveRevision: number;
    activeSceneId: string | null;
    scenes: { id: string; name: string }[];
    members?: { id: string; name: string; role: string }[];
}
export interface Mutation extends importObjectPatch {
    region?: import('../automation/model').Region;
    deletedRegionId?: string;
    note?: import('../tabletop/types/scene').SceneNote;
    deletedNoteId?: string;
    combat?: Combat | null;
    fog?: FogState;
    fogAction?: FogAction;
    mutationId?: string;
    revision: number;
    token?: Token;
    grid?: GridSettings;
    map?: SceneMap | null;
    deletedId?: string;
}
export interface RealtimeConfig {
    key: string;
    host: string;
    port: number;
    scheme: string;
}
export let realtimeConfig: RealtimeConfig;
export const commandId = () => crypto.randomUUID();
export const api = {
    note: (
        scene: string,
        command: import('../tabletop/types/scene').NoteCommand,
        clientMutationId: string,
    ) =>
        request<Mutation>(
            `/scenes/${scene}/notes`,
            'POST',
            command.action === 'update'
                ? { action: command.action, id: command.id, ...command.patch, clientMutationId }
                : { ...command, clientMutationId },
        ),
    combat: (scene: string, command: CombatCommand, clientMutationId: string) => {
        const { action, ...data } = command;
        return request<Mutation>(`/scenes/${scene}/combat/${action}`, 'POST', {
            ...data,
            clientMutationId,
        });
    },
    tokenCombat: (id: string, command: TokenCombatCommand, clientMutationId: string) => {
        const { action, ...data } = command;
        return request<Mutation>(`/tokens/${id}/${action}`, 'POST', { ...data, clientMutationId });
    },
    session: async () => {
        const value = await request<{ user: User | null; csrf: string; realtime: RealtimeConfig }>(
            '/session',
        );
        realtimeConfig = value.realtime;
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
    createScene: (
        campaign: string,
        name: string,
        mapAssetId?: string,
        clientMutationId = commandId(),
    ) =>
        request<{ id: string; name: string }>(`/campaigns/${campaign}/scenes`, 'POST', {
            name,
            mapAssetId,
            clientMutationId,
        }),
    renameScene: (id: string, name: string) =>
        request<{ revision: number }>(`/scenes/${id}`, 'PATCH', {
            name,
            clientMutationId: commandId(),
        }),
    deleteScene: (id: string) =>
        request(`/scenes/${id}`, 'DELETE', { clientMutationId: commandId() }),
    activate: (campaign: string, sceneId: string | null) =>
        request<Campaign>(`/campaigns/${campaign}/activate`, 'POST', {
            sceneId,
            clientMutationId: commandId(),
        }),
    snapshot: (id: string, signal?: AbortSignal) =>
        request<Scene>(`/scenes/${id}/snapshot`, 'GET', undefined, signal),
    fog: (scene: string, stroke: FogStroke, clientMutationId: string) =>
        request<Mutation>(`/scenes/${scene}/fog/actions`, 'POST', { ...stroke, clientMutationId }),
    resetFog: (scene: string, base: FogBase, clientMutationId: string) =>
        request<Mutation>(`/scenes/${scene}/fog/reset`, 'POST', { base, clientMutationId }),
    grid: (scene: string, grid: GridSettings, clientMutationId = commandId()) =>
        request<Mutation>(`/scenes/${scene}/grid`, 'PUT', { ...grid, clientMutationId }),
    map: (scene: string, map: SceneMap | null, clientMutationId = commandId()) =>
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
                      clientMutationId,
                  }
                : { assetId: null, x: 0, y: 0, width: 1440, height: 1080, clientMutationId },
        ),
    createToken: (
        scene: string,
        point: Point,
        asset?: ImageAsset & { name: string },
        identity?: {
            name: string;
            kind: Token['kind'];
            disposition: NonNullable<Token['disposition']>;
            hp: number;
        },
    ) =>
        request<Mutation>(`/scenes/${scene}/tokens`, 'POST', {
            ...point,
            name: asset?.name.slice(0, 80) ?? t('New token'),
            ...(asset ? { token_image_asset_id: asset.id } : {}),
            ...(identity
                ? {
                      name: identity.name,
                      kind: identity.kind,
                      disposition: identity.disposition,
                      hp: identity.hp,
                      max_hp: Math.max(1, identity.hp),
                  }
                : {}),
            clientMutationId: commandId(),
        }),
    move: (id: string, point: Point, clientMutationId = commandId(), dragSessionId?: string) =>
        request<Mutation>(`/tokens/${id}/move`, 'POST', {
            ...point,
            clientMutationId,
            dragSessionId,
        }),
    token: (id: string, patch: TokenPatch, clientMutationId = commandId()) => {
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
        return request<Mutation>(`/tokens/${id}`, 'PATCH', { ...fields, clientMutationId });
    },
    deleteToken: (id: string) =>
        request<Mutation>(`/tokens/${id}`, 'DELETE', { clientMutationId: commandId() }),
    upload: (campaign: string, file: File, kind: 'map' | 'token') => {
        const form = new FormData();
        form.set('file', file);
        form.set('kind', kind);
        return request<ImageAsset>(`/campaigns/${campaign}/assets`, 'POST', form);
    },
};
