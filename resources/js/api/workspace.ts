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
export interface TokenMovement {
    instant?: boolean;
    continuous?: boolean;
    duration?: number;
    tokenId: string;
    path: Point[];
}

export interface ControlReceipt {
    streamId: string;
    acceptedSequence: number;
    position: Point;
    maxBatchDistance: number;
    remainingCredit: number;
    acceptedDistance: number;
}

export interface Mutation extends importObjectPatch {
    controlReceipt?: ControlReceipt;
    lighting?: Scene['lighting'];
    movementGeometryChanged?: boolean;
    vision?: Scene['vision'];
    tokenMovements?: TokenMovement[];
    structure?: import('../tabletop/structure/model').Structure;
    structurePatch?: import('../tabletop/structure/model').StructurePatch;
    structureRefresh?: boolean;
    structureEdit?: {
        before: { hash: string; snapshot: string };
        after: { hash: string; snapshot: string };
    };
    terrain?: import('../tabletop/terrain/model').Terrain;
    terrainEdit?: {
        before: import('../tabletop/terrain/model').TerrainEditState;
        after: import('../tabletop/terrain/model').TerrainEditState;
    };
    propEdits?: { id: string; present: boolean; snapshot: string }[];
    mapWorld?: import('../tabletop/mapWorld').MapWorld | null;
    scene?: Partial<Scene>;
    character?: import('../tabletop/types/scene').Character;
    region?: import('../automation/model').Region;
    deletedRegionId?: string;
    note?: import('../tabletop/types/scene').SceneNote;
    deletedNoteId?: string;
    combat?: Combat | null;
    fog?: FogState;
    fogAction?: FogAction;
    fogRemovedSequence?: number;
    fogPrevious?: { base: FogBase; sequence: number; actions?: FogAction[] };
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
    structure: (
        scene: string,
        change:
            | { value: import('../tabletop/structure/model').Graph }
            | { door: import('../tabletop/structure/model').DoorCommand }
            | { opening: import('../tabletop/structure/model').OpeningCommand },
        expected: string,
        clientMutationId: string,
    ) =>
        request<Mutation>(`/scenes/${scene}/structure`, 'POST', {
            ...change,
            expected,
            clientMutationId,
        }),
    terrain: (
        scene: string,
        stroke: import('../tabletop/terrain/model').TerrainStroke,
        clientMutationId: string,
    ) => request<Mutation>(`/scenes/${scene}/terrain`, 'POST', { ...stroke, clientMutationId }),
    mapWorld: (
        scene: string,
        value: import('../tabletop/mapWorld').MapState,
        expected: import('../tabletop/mapWorld').MapState,
        clientMutationId: string,
    ) =>
        request<Mutation>(`/scenes/${scene}/map-world`, 'POST', {
            value,
            expected,
            clientMutationId,
        }),
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
    placeLibraryActor: (
        scene: string,
        library: 'characters' | 'npcs',
        actorId: string,
        point: Point,
    ) =>
        request<Mutation>(`/scenes/${scene}/${library}`, 'POST', {
            [library === 'npcs' ? 'npcId' : 'characterId']: actorId,
            ...point,
            clientMutationId: commandId(),
        }),
    createToken: (
        scene: string,
        point: Point,
        asset?: ImageAsset & { name: string },
        identity?: {
            characterId?: string;
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
                      ...(identity.characterId ? { character_id: identity.characterId } : {}),
                  }
                : {}),
            clientMutationId: commandId(),
        }),
    move: (
        id: string,
        point: Point,
        clientMutationId = commandId(),
        dragSessionId?: string,
        intent?: 'override' | 'teleport',
        waypoints?: Point[],
        instant = waypoints === undefined,
        playback?: boolean,
    ) =>
        request<Mutation>(`/tokens/${id}/move`, 'POST', {
            ...point,
            clientMutationId,
            dragSessionId,
            intent,
            waypoints,
            instant,
            playback,
            routeStep: !instant && waypoints !== undefined,
        }),
    token: (id: string, patch: TokenPatch, clientMutationId = commandId()) => {
        const fields: Record<string, unknown> = {};
        const keys: Record<string, string> = {
            checkStats: 'check_stats',
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
