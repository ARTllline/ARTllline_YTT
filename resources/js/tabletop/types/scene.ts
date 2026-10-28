import type { FogState } from './spatial';
import type { Combat, TokenCondition } from './combat';
export interface Point {
    x: number;
    y: number;
}
export interface CameraState extends Point {
    zoom: number;
}
export interface GridSettings {
    distancePerCell?: number;
    distanceUnit?: string;
    visible: boolean;
    snap: boolean;
    size: number;
    offset: Point;
}
export interface Token extends Point {
    conditions?: TokenCondition[];
    isOwner?: boolean;
    id: string;
    name: string;
    kind: 'hero' | 'scout' | 'archer';
    rotation: number;
    scale: number;
    size: number;
    hp?: number;
    maxHp?: number;
    canMove?: boolean;
    color: number;
    ac?: number | null;
    speed?: number | null;
    isHidden?: boolean;
    isLocked?: boolean;
    ownerUserId?: string | null;
    image?: ImageAsset | null;
}
export interface ImageAsset {
    id: string;
    url: string;
    width: number;
    height: number;
}
export interface SceneMap extends Point {
    asset: ImageAsset;
    width: number;
    height: number;
}
export interface Scene {
    notes?: readonly SceneNote[];
    combat?: Combat | null;
    fog?: FogState;
    id?: string;
    campaignId?: string;
    name?: string;
    revision?: number;
    liveRevision?: number;
    map?: SceneMap | null;
    width: number;
    height: number;
    grid: GridSettings;
    tokens: readonly Token[];
}
export type TokenPatch = Partial<
    Pick<
        Token,
        | 'x'
        | 'y'
        | 'name'
        | 'rotation'
        | 'scale'
        | 'size'
        | 'hp'
        | 'maxHp'
        | 'ac'
        | 'speed'
        | 'isHidden'
        | 'isLocked'
        | 'ownerUserId'
        | 'image'
    >
>;
export interface SceneNote extends Point {
    id: string;
    title: string;
    body: string;
    icon: 'note' | 'warning' | 'secret' | 'encounter' | 'clue';
}
export type NoteCommand =
    | { action: 'create'; x: number; y: number }
    | { action: 'update'; id: string; patch: Partial<Omit<SceneNote, 'id'>> }
    | { action: 'delete'; id: string };
export type Tool =
    'select' | 'pan' | 'fog' | 'ruler' | 'circle' | 'cone' | 'rectangle' | 'ping' | 'note';
