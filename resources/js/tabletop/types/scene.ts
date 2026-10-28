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
}
export interface Scene {
    width: number;
    height: number;
    grid: GridSettings;
    tokens: readonly Token[];
}
export type TokenPatch = Partial<
    Pick<Token, 'x' | 'y' | 'name' | 'rotation' | 'scale' | 'hp' | 'maxHp'>
>;
export type Tool = 'select' | 'pan';
