import type { Point } from '../types/scene';

export interface LightSource extends Point {
    id: string;
    name: string;
    enabled: boolean;
    tokenId?: string | null;
    radius: number;
    color: string;
    intensity: number;
    falloff: number;
}
export interface LightingSettings {
    enabled: boolean;
    mode: 'day' | 'night';
    brightness: number;
    color: string;
    sources?: LightSource[];
}
export interface RenderLight extends Point {
    id: string;
    tokenId?: string | null;
    radius: number;
    color: string;
    intensity: number;
    falloff: number;
    mask: string;
}
export interface LightingProjection {
    spill?: string;
    sceneId: string;
    revision: number;
    settings: LightingSettings;
    width: number;
    height: number;
    cellSize: number;
    sources: RenderLight[];
}
export interface LightingFrame {
    type: 'lighting.frame';
    sceneId: string;
    revision: number;
    render: LightingProjection | null;
}
export const defaultLighting: LightingSettings = {
    enabled: false,
    mode: 'day',
    brightness: 1,
    color: '#ffffff',
    sources: [],
};
export function rgb(color: string): [number, number, number] {
    return [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255) as [
        number,
        number,
        number,
    ];
}
export function maskBytes(bits: string) {
    let bytes = atob(bits.startsWith('~') ? bits.slice(1) : bits);
    if (bits.startsWith('~')) {
        let expanded = '';
        for (let i = 0; i + 2 < bytes.length; i += 3)
            expanded += bytes[i + 2].repeat(bytes.charCodeAt(i) | (bytes.charCodeAt(i + 1) << 8));
        bytes = expanded;
    }
    return bytes;
}
export function maskPixels(bits: string, pixels: Uint8Array, darkvision?: string) {
    const bytes = maskBytes(bits);
    const rgba = new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.byteLength / 4);
    for (let i = 0; i < rgba.length; i++)
        rgba[i] = bytes.charCodeAt(i >> 3) & (1 << (i & 7)) ? 0xffffffff : 0;
    if (!darkvision) return;
    // Red and alpha stay intact for the existing Pixi content/Fog masks.
    const dark = maskBytes(darkvision);
    for (let i = 0; i < rgba.length; i++)
        if (rgba[i] && dark.charCodeAt(i >> 3) & (1 << (i & 7))) rgba[i] = 0xff0000ff;
}
export function pointInPolygons(point: Point, polygons: Point[][]) {
    return polygons.some((polygon) => {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const a = polygon[i],
                b = polygon[j];
            if (
                a.y > point.y !== b.y > point.y &&
                point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
            )
                inside = !inside;
        }
        return inside;
    });
}
