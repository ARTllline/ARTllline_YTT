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
    const dark = darkvision ? maskBytes(darkvision) : '';
    const rgba = new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.byteLength / 4);
    rgba.fill(0);
    // Red and alpha stay intact for the existing Pixi content/Fog masks.
    const count = Math.min(bytes.length, Math.ceil(rgba.length / 8));
    for (let i = 0; i < count; i++) {
        let visible = bytes.charCodeAt(i);
        if (!visible) continue;
        const dim = dark.charCodeAt(i) | 0;
        const offset = i * 8;
        if (visible === 255 && !dim) {
            rgba.fill(0xffffffff, offset, offset + 8);
            continue;
        }
        while (visible) {
            const bit = visible & -visible;
            rgba[offset + 31 - Math.clz32(bit)] = dim & bit ? 0xff0000ff : 0xffffffff;
            visible ^= bit;
        }
    }
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
