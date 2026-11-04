import type { Scene } from './types/scene';

/** Local presentation/interaction preferences. Never serialized or broadcast. */
export interface MapEditorView {
    collisionDebug?: boolean;
    terrain?: {
        active: boolean;
        operation: 'paint' | 'erase';
        material?: import('../workspace/maps/materials').Material;
        size: number;
        softness: number;
        strength: number;
    };
    backgroundVisible: boolean;
    objectsVisible: boolean;
    objectsLocked: boolean;
}
export const defaultTerrainBrush: NonNullable<MapEditorView['terrain']> = {
    active: true,
    operation: 'paint',
    size: 180,
    softness: 96,
    strength: 255,
};
export const terrainBrushStorage = 'ytt.terrain-brush.v1';

export function readTerrainBrush() {
    try {
        const saved = JSON.parse(localStorage.getItem(terrainBrushStorage) ?? '{}');
        const brush = { ...defaultTerrainBrush };
        for (const [key, min, max] of [
            ['size', 4, 1024],
            ['softness', 0, 255],
            ['strength', 1, 255],
        ] as const) {
            if (Number.isInteger(saved[key]) && saved[key] >= min && saved[key] <= max)
                brush[key] = saved[key];
        }
        return brush;
    } catch {
        return { ...defaultTerrainBrush };
    }
}
export const initialEditorView: MapEditorView = {
    backgroundVisible: true,
    objectsVisible: true,
    objectsLocked: false,
};
export function editorInteractionScene(scene: Scene, editor?: MapEditorView | null): Scene {
    return editor
        ? {
              ...scene,
              tokens: [],
              notes: [],
              regions: [],
              props: editor.objectsVisible && !editor.objectsLocked ? scene.props : [],
          }
        : scene;
}
