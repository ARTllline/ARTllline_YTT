export interface Point {
    x: number;
    y: number;
}
export interface CameraState extends Point {
    zoom: number;
}
export interface GridSettings {
    visible: boolean;
    snap: boolean;
    size: number;
    offset: Point;
}
export interface Token extends Point {
    id: string;
    name: string;
    kind: 'hero' | 'scout' | 'archer';
    rotation: number;
    scale: number;
    size: number;
    hp: number;
    maxHp: number;
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
    id?: string;
    campaignId?: string;
    name?: string;
    revision?: number;
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
export type Tool = 'select' | 'pan';
