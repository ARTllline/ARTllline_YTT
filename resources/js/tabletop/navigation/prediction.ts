import type { Point } from '../types/scene';

/** Keep unaccepted corners, including reversals; never shortcut a rejected prefix. */
export function predictionRemainder(
    sent: readonly Point[],
    acceptedDistance: number,
    position: Point,
    tail: readonly Point[],
): Point[] {
    if (!Number.isFinite(acceptedDistance) || acceptedDistance < 0)
        throw Error('Invalid movement receipt');
    let remaining = acceptedDistance;
    let i = 1;
    for (; i < sent.length; i++) {
        const length = Math.hypot(sent[i].x - sent[i - 1].x, sent[i].y - sent[i - 1].y);
        if (remaining < length - 1e-7) break;
        remaining -= length;
    }
    const a = sent[Math.min(i - 1, sent.length - 1)];
    const b = sent[i] ?? a;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const t = length ? Math.max(0, Math.min(1, remaining / length)) : 0;
    if (
        remaining > length + 0.002 ||
        Math.hypot(position.x - a.x - (b.x - a.x) * t, position.y - a.y - (b.y - a.y) * t) > 0.003
    )
        throw Error('Movement origin changed');
    return [position, ...sent.slice(i), ...tail.slice(1)];
}
