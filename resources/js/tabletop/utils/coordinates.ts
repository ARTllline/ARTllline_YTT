import type { CameraState, GridSettings, Point } from '../types/scene';
// Large maps must fit on a tablet; the old 20% floor cropped 4096px scenes.
export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 3;
export const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));
export const screenToWorld = (point: Point, camera: CameraState): Point => ({
    x: (point.x - camera.x) / camera.zoom,
    y: (point.y - camera.y) / camera.zoom,
});
export const worldToScreen = (point: Point, camera: CameraState): Point => ({
    x: point.x * camera.zoom + camera.x,
    y: point.y * camera.zoom + camera.y,
});
export function zoomAt(camera: CameraState, anchor: Point, zoom: number): CameraState {
    const world = screenToWorld(anchor, camera);
    const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    return { x: anchor.x - world.x * next, y: anchor.y - world.y * next, zoom: next };
}
// Token positions denote their centers. Snap centers to cell centers, including negative cells.
export function snapPoint(point: Point, grid: GridSettings): Point {
    if (!grid.snap) return { ...point };
    const snap = (value: number, offset: number) =>
        Math.round((value - offset - grid.size / 2) / grid.size) * grid.size +
        offset +
        grid.size / 2;
    return { x: snap(point.x, grid.offset.x), y: snap(point.y, grid.offset.y) };
}
