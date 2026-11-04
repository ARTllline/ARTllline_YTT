import type { GridSettings, Scene, SceneMap } from './types/scene';

export interface MapWorld {
    schemaVersion?: number;
    bounds: { x: number; y: number; width: number; height: number };
}
export interface MapSettings {
    width: number;
    height: number;
    map: SceneMap | null;
    grid: GridSettings;
}
export const mapSettings = (scene: Scene): MapSettings => ({
    width: scene.width,
    height: scene.height,
    map: scene.map ?? null,
    grid: scene.grid,
});
export function mapState(settings: MapSettings, enabled: boolean) {
    const map = settings.map;
    return {
        enabled,
        width: settings.width,
        height: settings.height,
        map: map
            ? {
                  assetId: map.asset.id,
                  x: map.x,
                  y: map.y,
                  width: map.width,
                  height: map.height,
                  crop: map.crop ?? null,
              }
            : null,
        grid: {
            type: 'square',
            ...settings.grid,
            distancePerCell: settings.grid.distancePerCell ?? 5,
            distanceUnit: settings.grid.distanceUnit ?? 'ft',
        },
    };
}
export type MapState = ReturnType<typeof mapState>;
/** Invalid form values stay in the draft, but must never reach renderer loops/textures. */
export function displayScene(scene: Scene, draft?: MapSettings | null): Scene {
    if (!draft) return scene;
    const bounded = (value: number, min: number, max: number, fallback: number) =>
        Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
    return {
        ...scene,
        width: bounded(draft.width, 120, 20000, scene.width),
        height: bounded(draft.height, 120, 20000, scene.height),
        grid: { ...draft.grid, size: bounded(draft.grid.size, 20, 160, scene.grid.size) },
        map: draft.map
            ? {
                  ...draft.map,
                  width: bounded(draft.map.width, 1, 20000, 1),
                  height: bounded(draft.map.height, 1, 20000, 1),
              }
            : null,
    };
}

/** Calibration uses world distances, never resizes objects or the reference image. */
export function calibrateGrid(
    a: { x: number; y: number },
    b: { x: number; y: number },
    cells: number,
) {
    const size = Math.hypot(b.x - a.x, b.y - a.y) / cells;
    if (!Number.isFinite(size) || cells <= 0 || size < 20 || size > 160)
        throw new Error(
            'Размер клетки должен быть от 20 до 160. Измените число клеток или масштаб изображения.',
        );
    return { size, offset: { ...a } };
}
