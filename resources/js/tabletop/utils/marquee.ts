import { propFootprint } from './selectionTransform';
import type { ObjectSelection, Point, Scene } from '../types/scene';

/** Intersections in world coordinates, including rotated prop footprints. */
export function marqueeSelection(
    scene: Scene,
    a: Point,
    b: Point,
    previous?: ObjectSelection,
    additive = false,
): ObjectSelection {
    const x = Math.min(a.x, b.x),
        y = Math.min(a.y, b.y);
    const w = Math.abs(a.x - b.x),
        h = Math.abs(a.y - b.y);
    const tokenIds = scene.tokens
        .filter((t) => {
            const dx = t.x - Math.max(x, Math.min(x + w, t.x));
            const dy = t.y - Math.max(y, Math.min(y + h, t.y));
            return dx * dx + dy * dy <= ((t.size * t.scale) / 2) ** 2;
        })
        .map((t) => t.id);
    const box = [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
    ];
    const propIds = (scene.props ?? [])
        .filter((p) => {
            const r = (p.rotation * Math.PI) / 180,
                c = Math.cos(r),
                s = Math.sin(r);
            const corners = propFootprint(p);
            return [
                { x: 1, y: 0 },
                { x: 0, y: 1 },
                { x: c, y: s },
                { x: -s, y: c },
            ].every((axis) => {
                const one = box.map((v) => v.x * axis.x + v.y * axis.y);
                const two = corners.map((v) => v.x * axis.x + v.y * axis.y);
                return Math.max(...one) >= Math.min(...two) && Math.max(...two) >= Math.min(...one);
            });
        })
        .map((p) => p.id);
    const toggle = (old: string[], hits: string[]) => [
        ...old.filter((id) => !hits.includes(id)),
        ...hits.filter((id) => !old.includes(id)),
    ];
    return previous
        ? {
              tokenIds: additive
                  ? [...new Set([...previous.tokenIds, ...tokenIds])]
                  : toggle(previous.tokenIds, tokenIds),
              propIds: additive
                  ? [...new Set([...previous.propIds, ...propIds])]
                  : toggle(previous.propIds, propIds),
          }
        : { tokenIds, propIds };
}
