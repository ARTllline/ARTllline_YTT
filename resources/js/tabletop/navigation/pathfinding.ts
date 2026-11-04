import type { Point } from '../types/scene';
import { movementBlocked, routeLength, type MovementObstacle } from '../utils/movement';

export interface NavigationRequest {
    start: Point;
    target: Point;
    radius: number;
    width: number;
    height: number;
    gridSize: number;
    obstacles: MovementObstacle[];
    portals?: Point[][];
}
export type RouteResult = {
    status: 'found' | 'unreachable' | 'budget' | 'waypoints';
    path: Point[];
    length: number;
    expanded: number;
    elapsed: number;
};
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const canonical = (p: Point): Point => ({
    x: Math.round(p.x * 1000) / 1000,
    y: Math.round(p.y * 1000) / 1000,
});

/** Broad phase only. All candidates still use MAP-07A's exact sweep. */
export function obstacleQuery(obstacles: MovementObstacle[], radius: number) {
    const bins = new Map<string, Set<MovementObstacle>>(),
        large: MovementObstacle[] = [];
    const cell = 128;
    for (const obstacle of obstacles) {
        const points = 'center' in obstacle ? [obstacle.center] : obstacle.points;
        const pad =
            radius + ('center' in obstacle ? Math.max(obstacle.rx, obstacle.ry) : obstacle.padding);
        const x0 = Math.floor((Math.min(...points.map((p) => p.x)) - pad) / cell);
        const x1 = Math.floor((Math.max(...points.map((p) => p.x)) + pad) / cell);
        const y0 = Math.floor((Math.min(...points.map((p) => p.y)) - pad) / cell);
        const y1 = Math.floor((Math.max(...points.map((p) => p.y)) + pad) / cell);
        if ((x1 - x0 + 1) * (y1 - y0 + 1) > 1024) {
            large.push(obstacle);
            continue;
        }
        for (let x = x0; x <= x1; x++)
            for (let y = y0; y <= y1; y++) {
                const key = `${x}:${y}`;
                if (!bins.has(key)) bins.set(key, new Set());
                bins.get(key)!.add(obstacle);
            }
    }
    return (a: Point, b: Point) => {
        const x0 = Math.floor(Math.min(a.x, b.x) / cell),
            x1 = Math.floor(Math.max(a.x, b.x) / cell);
        const y0 = Math.floor(Math.min(a.y, b.y) / cell),
            y1 = Math.floor(Math.max(a.y, b.y) / cell);
        if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4096) return movementBlocked(a, b, radius, obstacles);
        const candidates = new Set(large);
        for (let x = x0; x <= x1; x++)
            for (let y = y0; y <= y1; y++)
                bins.get(`${x}:${y}`)?.forEach((shape) => candidates.add(shape));
        return movementBlocked(a, b, radius, [...candidates]);
    };
}

type Node = { key: string; point: Point; g: number; f: number; parent?: Node; portal?: number };
class Frontier {
    private heap: Node[] = [];
    push(node: Node) {
        let i = this.heap.length;
        this.heap.push(node);
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this.heap[parent].f <= node.f) break;
            this.heap[i] = this.heap[parent];
            i = parent;
        }
        this.heap[i] = node;
    }
    pop() {
        const first = this.heap[0],
            last = this.heap.pop();
        if (this.heap.length && last) {
            let i = 0;
            while (i * 2 + 1 < this.heap.length) {
                let child = i * 2 + 1;
                if (child + 1 < this.heap.length && this.heap[child + 1].f < this.heap[child].f)
                    child++;
                if (last.f <= this.heap[child].f) break;
                this.heap[i] = this.heap[child];
                i = child;
            }
            this.heap[i] = last;
        }
        return first;
    }
}

/** Greedy line-of-sight pulling. Never discard a corner without sweeping it. */
export function simplifyRoute(
    path: Point[],
    blocked: (a: Point, b: Point) => boolean,
    exhausted = () => false,
): Point[] | undefined {
    const result = [path[0]];
    let current = 0;
    while (current < path.length - 1) {
        let next = path.length - 1;
        while (next > current + 1 && blocked(path[current], path[next])) {
            if (exhausted()) return;
            next--;
        }
        if (blocked(path[current], path[next])) return;
        result.push(path[next]);
        current = next;
        // Origin + 16 intermediate points + destination.
        if (result.length > 18 || exhausted()) return;
    }
    return result;
}

/** Bounded weighted A* (1.15), in a Worker. Sampling never defines game cost. */
export function findRoute(
    request: NavigationRequest,
    limits = { nodes: 24000, milliseconds: 250 },
): RouteResult {
    const began = performance.now();
    let expanded = 0,
        checks = 0;
    const result = (status: RouteResult['status'], path: Point[] = []): RouteResult => ({
        status,
        path,
        length: routeLength(path),
        expanded,
        elapsed: performance.now() - began,
    });
    const expired = () => performance.now() - began >= limits.milliseconds;
    const { radius, width, height, obstacles } = request;
    const start = canonical(request.start),
        target = canonical(request.target);
    // Extra clearance exceeds the movement contract's 0.001 coordinate rounding.
    const blocked = obstacleQuery(obstacles, radius + 0.01);
    if (expired()) return result('budget');
    const inside = (p: Point) =>
        p.x >= radius && p.y >= radius && p.x <= width - radius && p.y <= height - radius;
    if (!inside(start) || !inside(target) || blocked(start, start) || blocked(target, target))
        return result('unreachable');
    if (!blocked(start, target)) return result('found', [start, target]);
    const initialStep = Math.max(2, Math.min(24, request.gridSize / 2, radius));
    for (const step of [
        ...new Set([
            initialStep,
            Math.max(2, initialStep / 2),
            Math.max(1, Math.min(2, initialStep / 4)),
        ]),
    ]) {
        const frontier = new Frontier(),
            scores = new Map<string, number>();
        const portals: { point: Point; group: number[] }[] = [];
        const portalBins = new Map<string, number[]>();
        const cellKey = (p: Point) =>
            `${Math.round((p.x - start.x) / step)}:${Math.round((p.y - start.y) / step)}`;
        for (const group of request.portals ?? []) {
            const indices = group.map((_, i) => portals.length + i);
            for (const raw of group) {
                const point = canonical(raw),
                    key = cellKey(point);
                if (!portalBins.has(key)) portalBins.set(key, []);
                portalBins.get(key)!.push(portals.length);
                portals.push({ point, group: indices });
            }
        }
        const origin: Node = { key: '0:0', point: start, g: 0, f: 1.15 * distance(start, target) };
        frontier.push(origin);
        scores.set(origin.key, 0);
        let node: Node | undefined;
        while ((node = frontier.pop())) {
            if (scores.get(node.key) !== node.g) continue;
            if (++expanded > limits.nodes || expired()) return result('budget');
            if (distance(node.point, target) <= step * 1.5 && !blocked(node.point, target)) {
                const path = [target];
                for (let n: Node | undefined = node; n; n = n.parent) path.push(n.point);
                path.reverse();
                const simplified = simplifyRoute(path, blocked, expired);
                if (!simplified) return result(expired() ? 'budget' : 'waypoints');
                return result('found', simplified);
            }
            const ix = Math.round((node.point.x - start.x) / step),
                iy = Math.round((node.point.y - start.y) / step);
            const offer = (key: string, point: Point, portal?: number) => {
                const g = node!.g + distance(node!.point, point);
                if (
                    !inside(point) ||
                    g >= (scores.get(key) ?? Infinity) ||
                    blocked(node!.point, point)
                )
                    return;
                scores.set(key, g);
                frontier.push({
                    key,
                    point,
                    g,
                    f: g + 1.15 * distance(point, target),
                    parent: node,
                    portal,
                });
            };
            const reach = node.portal === undefined ? 1 : 2;
            const neighbourhood = portals.length ? 2 : 1;
            for (let dx = -neighbourhood; dx <= neighbourhood; dx++)
                for (let dy = -neighbourhood; dy <= neighbourhood; dy++) {
                    if (++checks % 64 === 0 && expired()) return result('budget');
                    const key = `${ix + dx}:${iy + dy}`;
                    for (const index of portalBins.get(key) ?? [])
                        offer(`p:${index}`, portals[index].point, index);
                    if (
                        Math.abs(dx) > reach ||
                        Math.abs(dy) > reach ||
                        (!dx && !dy && node.portal === undefined)
                    )
                        continue;
                    offer(
                        key,
                        canonical({
                            x: start.x + (ix + dx) * step,
                            y: start.y + (iy + dy) * step,
                        }),
                    );
                }
            if (node.portal !== undefined)
                for (const index of portals[node.portal].group)
                    offer(`p:${index}`, portals[index].point, index);
        }
        if (expired()) return result('budget');
    }
    return result('unreachable');
}
