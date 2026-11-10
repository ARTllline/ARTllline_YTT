import type { ImageAsset, Point, SceneProp } from '../types/scene';

export const flags = {
    blocksMovement: 'Движение',
    blocksVision: 'Обзор',
    blocksLight: 'Свет',
} as const;
export type Blocking = Record<keyof typeof flags, boolean>;
export type Collider = Blocking &
    (
        | { type: 'none' }
        | { type: 'rectangle'; x: number; y: number; width: number; height: number }
        | { type: 'circle'; x: number; y: number; radius: number }
        | { type: 'polygon'; points: Point[] }
    );
export interface PresetSettings {
    width: number;
    height: number;
    pivotX: number;
    pivotY: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
    collider: Collider;
    tags: string[];
    light?: { radius: number; color: string; intensity: number; falloff: number };
}
export interface ObjectPreset {
    id: string;
    name: string;
    category: string;
    asset: ImageAsset;
    builtin?: boolean;
    thumbnailUrl?: string;
    settings: PresetSettings;
}

export function colliderPoints(collider: Collider): Point[] {
    if (collider.type === 'polygon') return collider.points;
    if (collider.type === 'rectangle') {
        const { x, y, width, height } = collider;
        return [
            { x, y },
            { x: x + width, y },
            { x: x + width, y: y + height },
            { x, y: y + height },
        ];
    }
    if (collider.type === 'circle') {
        const { x, y, radius } = collider;
        return Array.from({ length: 64 }, (_, i) => {
            const angle = (i * Math.PI) / 32;
            return { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius };
        });
    }
    return [];
}

export function propLocalPoint(
    prop: Pick<SceneProp, 'image' | 'pivotX' | 'pivotY'>,
    point: Point,
    scaleX: number,
    scaleY: number,
) {
    return {
        x: (point.x - prop.image.width * (prop.pivotX ?? 0.5)) * scaleX,
        y: (point.y - prop.image.height * (prop.pivotY ?? 0.5)) * scaleY,
    };
}

export function blockingColor(value: Partial<Blocking>) {
    const colors = [0x83939a, 0x5ee4be, 0xbba4ff, 0x5ebfff, 0xffcd79, 0xa5e87e, 0xff94c7, 0xffa477];
    return colors[
        Number(!!value.blocksMovement) +
            2 * Number(!!value.blocksVision) +
            4 * Number(!!value.blocksLight)
    ];
}
