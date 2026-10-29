import type { Graphics } from 'pixi.js';
import type { Point } from '../types/scene';
import { cone, distance, rectangle } from './spatialGeometry';

/** Shared by ruler/AoE overlays and ability previews. */
export function drawSpatialShape(
    ink: Graphics,
    shape: 'ruler' | 'circle' | 'cone' | 'rectangle' | 'line',
    start: Point,
    end: Point,
    color: number,
    zoom: number,
    width = 0,
    alpha = 0.14,
) {
    if (shape === 'ruler') {
        ink.moveTo(start.x, start.y)
            .lineTo(end.x, end.y)
            .stroke({ color, width: 2 / zoom });
        return;
    }
    if (shape === 'circle') ink.circle(start.x, start.y, distance(start, end));
    else if (shape === 'rectangle') {
        const r = rectangle(start, end);
        ink.rect(r.x, r.y, r.width, r.height);
    } else if (shape === 'line') {
        const angle = Math.atan2(end.y - start.y, end.x - start.x),
            dx = (-Math.sin(angle) * width) / 2,
            dy = (Math.cos(angle) * width) / 2;
        ink.poly([
            start.x + dx,
            start.y + dy,
            end.x + dx,
            end.y + dy,
            end.x - dx,
            end.y - dy,
            start.x - dx,
            start.y - dy,
        ]);
    } else {
        const c = cone(start, end);
        ink.moveTo(start.x, start.y)
            .arc(start.x, start.y, c.length, c.angle - c.aperture / 2, c.angle + c.aperture / 2)
            .closePath();
    }
    ink.fill({ color, alpha }).stroke({ color, width: 2 / zoom });
}
