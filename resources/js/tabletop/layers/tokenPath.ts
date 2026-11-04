import type { Point } from '../types/scene';

// Presentation speed only. Gameplay commits the complete accepted path immediately.
export const movementTiming = { speed: 360, minimumMs: 80, rampMs: 80 };

export function tokenPath(path: readonly Point[], continuous = false, durationMs?: number) {
    const edges = path.slice(1).flatMap((end, i) => {
        const start = path[i];
        const length = Math.hypot(end.x - start.x, end.y - start.y);
        return length > 0 ? [{ start, end, length }] : [];
    });
    const length = edges.reduce((sum, segment) => sum + segment.length, 0);
    if (!length || !Number.isFinite(length)) return;
    const speed = Math.min(movementTiming.speed, length / (movementTiming.minimumMs / 1000));
    const corner = (i: number) => {
        if (i < 0 || i >= edges.length - 1) return 0;
        const a = edges[i],
            b = edges[i + 1];
        const dot =
            ((a.end.x - a.start.x) * (b.end.x - b.start.x) +
                (a.end.y - a.start.y) * (b.end.y - b.start.y)) /
            (a.length * b.length);
        return Math.max(0.35, Math.sqrt(Math.max(0, (1 + dot) / 2)));
    };
    const continuousDuration = Math.min(600, Math.max(1, durationMs ?? (length / 180) * 1000));
    const segments = edges.map((edge, i) => {
        const cruise = (edge.length / speed) * 1000;
        const ramp = continuous ? 0 : Math.min(movementTiming.rampMs, cruise / 3);
        const startSpeed = continuous ? 1 : corner(i - 1);
        const endSpeed = continuous ? 1 : corner(i);
        const duration = continuous
            ? (continuousDuration * edge.length) / length
            : cruise + ramp * (1 - (startSpeed + endSpeed) / 2);
        return { ...edge, duration, ramp, startSpeed, endSpeed };
    });
    const duration = segments.reduce((sum, segment) => sum + segment.duration, 0);
    return { segments, length, duration, elapsed: 0, continuous };
}

type TokenPath = NonNullable<ReturnType<typeof tokenPath>>;

function segmentPosition(path: TokenPath) {
    let elapsed = Math.max(0, path.elapsed);
    for (let i = 0; i < path.segments.length; i++) {
        const segment = path.segments[i];
        const { duration, ramp, startSpeed, endSpeed } = segment;
        if (elapsed < duration) {
            // Short speed ramps stay exactly on the accepted polyline. Rounding
            // geometric corners could cut through collision clearance.
            const distance =
                elapsed < ramp
                    ? startSpeed * elapsed + ((1 - startSpeed) * elapsed * elapsed) / (2 * ramp)
                    : elapsed > duration - ramp
                      ? duration -
                        ramp * (1 - (startSpeed + endSpeed) / 2) -
                        endSpeed * (duration - elapsed) -
                        ((1 - endSpeed) * (duration - elapsed) ** 2) / (2 * ramp)
                      : elapsed - (ramp * (1 - startSpeed)) / 2;
            const fraction = distance / (duration - ramp * (1 - (startSpeed + endSpeed) / 2));
            return {
                index: i,
                point: {
                    x: segment.start.x + (segment.end.x - segment.start.x) * fraction,
                    y: segment.start.y + (segment.end.y - segment.start.y) * fraction,
                },
            };
        }
        elapsed -= duration;
    }
    return { index: path.segments.length, point: path.segments.at(-1)!.end };
}

export function pathPosition(path: TokenPath): Point {
    return segmentPosition(path).point;
}

/** Preserve every unplayed collision corner, including eased normal routes. */
export function remainingTokenPath(path: TokenPath): Point[] {
    const { index, point } = segmentPosition(path);
    return [point, ...path.segments.slice(index).map((segment) => segment.end)];
}
