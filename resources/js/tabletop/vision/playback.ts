import type { TokenMovement } from '../../api/workspace';
import type { Point } from '../types/scene';

/** Playback progress on an accepted polyline; never interpolates visibility geometry. */
export function visibilityPlayback(movements: readonly TokenMovement[] = []) {
    return movements
        .filter((move) => !move.instant && move.path.length > 1)
        .map((move) => {
            let length = 0;
            const segments = move.path.slice(1).map((b, i) => {
                const a = move.path[i],
                    size = Math.hypot(b.x - a.x, b.y - a.y),
                    offset = length;
                length += size;
                return { a, b, size, offset };
            });
            return { id: move.tokenId, length, segments };
        });
}
export function visibilityPlaybackProgress(
    paths: ReturnType<typeof visibilityPlayback>,
    positions?: ReadonlyMap<string, Point>,
) {
    let progress = 1;
    for (const path of paths) {
        const point = positions?.get(path.id);
        if (!point || path.length === 0) continue;
        const model = (point as Point & { model?: Point }).model;
        if (model && point.x === model.x && point.y === model.y) continue;
        let closest = Infinity,
            along = 0;
        for (const { a, b, size, offset } of path.segments) {
            if (!size) continue;
            const t = Math.max(
                0,
                Math.min(
                    1,
                    ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / (size * size),
                ),
            );
            const distance = Math.hypot(
                point.x - a.x - t * (b.x - a.x),
                point.y - a.y - t * (b.y - a.y),
            );
            if (distance < closest) {
                closest = distance;
                along = offset + t * size;
            }
        }
        progress = Math.min(progress, along / path.length);
    }
    return progress;
}
