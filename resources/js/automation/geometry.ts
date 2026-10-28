import type { Region } from './model';
import type { Point } from '../tabletop/types/scene';
const bound = (n: number) => Math.round(Math.max(-1000000, Math.min(1000000, n)) * 1000) / 1000;
export function drawRegion(shape: Region['shape'], start: Point, end: Point): Region['geometry'] {
    if (shape === 'circle')
        return {
            x: bound(start.x),
            y: bound(start.y),
            radius: Math.min(50000, Math.max(5, Math.hypot(end.x - start.x, end.y - start.y))),
        };
    return {
        x: bound(Math.min(start.x, end.x)),
        y: bound(Math.min(start.y, end.y)),
        width: Math.min(100000, Math.max(10, Math.abs(end.x - start.x))),
        height: Math.min(100000, Math.max(10, Math.abs(end.y - start.y))),
    };
}
export function regionHandle(r: Region): Point {
    const g = r.geometry;
    return r.shape === 'circle'
        ? { x: g.x + g.radius!, y: g.y }
        : { x: g.x + g.width!, y: g.y + g.height! };
}
export function regionHit(r: Region, p: Point): boolean {
    const g = r.geometry;
    return r.shape === 'circle'
        ? Math.hypot(p.x - g.x, p.y - g.y) <= g.radius!
        : p.x >= g.x && p.x <= g.x + g.width! && p.y >= g.y && p.y <= g.y + g.height!;
}
export function transformRegion(r: Region, start: Point, point: Point, resize: boolean): Region {
    const g = r.geometry,
        dx = point.x - start.x,
        dy = point.y - start.y;
    if (!resize) return { ...r, geometry: { ...g, x: bound(g.x + dx), y: bound(g.y + dy) } };
    return {
        ...r,
        geometry:
            r.shape === 'circle'
                ? {
                      ...g,
                      radius: Math.max(
                          5,
                          Math.min(50000, Math.hypot(point.x - g.x, point.y - g.y)),
                      ),
                  }
                : {
                      ...g,
                      width: Math.max(10, Math.min(100000, g.width! + dx)),
                      height: Math.max(10, Math.min(100000, g.height! + dy)),
                  },
    };
}
