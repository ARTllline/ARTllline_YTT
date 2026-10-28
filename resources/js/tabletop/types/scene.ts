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
    props?: readonly SceneProp[];
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
export interface SceneProp extends Point {
    id: string;
    name: string | null;
    image: ImageAsset;
    rotation: number;
    scaleX: number;
    scaleY: number;
    zIndex: number;
    isHidden?: boolean;
    isLocked?: boolean;
}
export interface ObjectSelection {
    tokenIds: string[];
    propIds: string[];
}
export type ObjectCommand =
    | {
          endpoint: 'props';
          data:
              | { action: 'create'; assetId: string; x: number; y: number }
              | {
                    action: 'update';
                    id: string;
                    patch?: Partial<{
                        name: string;
                        x: number;
                        y: number;
                        rotation: number;
                        scale_x: number;
                        scale_y: number;
                        is_hidden: boolean;
                        is_locked: boolean;
                    }>;
                    order?: 'front' | 'back' | 'forward' | 'backward';
                };
      }
    | {
          endpoint: 'selection';
          data: ObjectSelection &
              (
                  | { action: 'duplicate' | 'delete' }
                  | {
                        action: 'move';
                        anchorKind: 'token' | 'prop';
                        anchorId: string;
                        x: number;
                        y: number;
                    }
              );
      }
    | { endpoint: 'spawn'; data: { templateId: string; x: number; y: number }; encounter?: string };
export type NoteCommand =
    | { action: 'create'; x: number; y: number }
    | { action: 'update'; id: string; patch: Partial<Omit<SceneNote, 'id'>> }
    | { action: 'delete'; id: string };
export type Tool =
    'select' | 'pan' | 'fog' | 'ruler' | 'circle' | 'cone' | 'rectangle' | 'ping' | 'note';
