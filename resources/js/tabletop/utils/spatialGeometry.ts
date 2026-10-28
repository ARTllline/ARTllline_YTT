import { t } from '../../i18n';
import type { GridSettings, Point } from '../types/scene';
import { snapPoint } from './coordinates';
export const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
export const measured = (pixels: number, grid: GridSettings) =>
    (pixels / grid.size) * (grid.distancePerCell ?? 5);
export const measureLabel = (pixels: number, grid: GridSettings) =>
    `${Number(measured(pixels, grid).toFixed(1))} ${t(`unit.${grid.distanceUnit ?? 'ft'}` as import('../../i18n').TranslationKey)}`;
export const spatialSnap = (point: Point, grid: GridSettings, snap: boolean) =>
    snapPoint(point, { ...grid, snap });
export const rectangle = (a: Point, b: Point) => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
});
export const cone = (a: Point, b: Point) => ({
    angle: Math.atan2(b.y - a.y, b.x - a.x),
    length: distance(a, b),
    aperture: Math.PI / 3,
});
