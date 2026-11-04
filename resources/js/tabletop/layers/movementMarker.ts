import type { Graphics } from 'pixi.js';
import type { Point } from '../types/scene';

/** A world footprint plus a destination reticle that stays readable at low zoom. */
export function movementMarker(
    ink: Graphics,
    target: Point,
    radius: number,
    zoom: number,
    color: number,
    blocked = false,
) {
    ink.circle(target.x, target.y, radius)
        .fill({ color, alpha: 0.08 })
        .stroke({ color, width: 1.5 / zoom, alpha: 0.7 });
    const r = 6 / zoom;
    ink.circle(target.x, target.y, r)
        .fill({ color: 0x101820, alpha: 0.85 })
        .stroke({ color, width: 1.5 / zoom });
    const d = (blocked ? 3 : 2) / zoom;
    if (blocked) {
        ink.moveTo(target.x - d, target.y - d)
            .lineTo(target.x + d, target.y + d)
            .moveTo(target.x + d, target.y - d)
            .lineTo(target.x - d, target.y + d)
            .stroke({ color, width: 1.5 / zoom });
    } else ink.circle(target.x, target.y, d).fill(color);
}
