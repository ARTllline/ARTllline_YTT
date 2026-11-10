import {
    distance,
    project,
    splitEdge,
    vertexIndex,
    openingsError,
    type Graph,
    type Vertex,
    type Wall,
} from './model';
import type { Point } from '../types/scene';

const epsilon = 0.0015;
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Planarize straight axes without removing walls or changing their properties. */
export function connectJunctions(graph: Graph, before: Graph = graph): Graph {
    const aliases = new Map<string, string>();
    const vertices: Vertex[] = [];
    // Prefer stationary IDs when a moved endpoint meets an existing vertex.
    const old = vertexIndex(before);
    const ordered = [...graph.vertices].sort(
        (a, b) =>
            Number(distance(a, old.get(a.id) ?? { x: Infinity, y: Infinity }) > epsilon) -
            Number(distance(b, old.get(b.id) ?? { x: Infinity, y: Infinity }) > epsilon),
    );
    for (const v of ordered) {
        const p = { ...v, x: round(v.x), y: round(v.y) };
        const shared = vertices.find((other) => distance(other, p) < epsilon);
        aliases.set(v.id, shared?.id ?? v.id);
        if (!shared) vertices.push(p);
    }
    const next: Graph = {
        ...graph,
        vertices,
        edges: graph.edges.map((e) => ({ ...e, a: aliases.get(e.a)!, b: aliases.get(e.b)! })),
        rooms: graph.rooms.map((r) => ({ ...r, loop: r.loop.map((id) => aliases.get(id)!) })),
    };
    const index = vertexIndex(next);
    const straight = next.edges.filter((e) => !e.curve);
    for (let i = 0; i < straight.length; i++) {
        const a = index.get(straight[i].a),
            b = index.get(straight[i].b);
        if (!a || !b) throw new Error('Отсутствует вершина стены.');
        for (const edge of straight.slice(0, i)) {
            const c = index.get(edge.a)!,
                d = index.get(edge.b)!;
            const ux = b.x - a.x,
                uy = b.y - a.y;
            const vx = d.x - c.x,
                vy = d.y - c.y;
            const cross = ux * vy - uy * vx;
            if (Math.abs(cross) < 1e-8) continue;
            const t = ((c.x - a.x) * vy - (c.y - a.y) * vx) / cross;
            const s = ((c.x - a.x) * uy - (c.y - a.y) * ux) / cross;
            if (t < 0 || t > 1 || s < 0 || s > 1) continue;
            const p = { x: round(a.x + ux * t), y: round(a.y + uy * t) };
            if (!next.vertices.some((v) => distance(v, p) < epsilon)) {
                next.vertices.push({ ...p, id: 'v' + crypto.randomUUID().replaceAll('-', '') });
                if (next.vertices.length > 512)
                    throw new Error('Достигнут предел структуры (512 вершин).');
            }
        }
    }
    for (const edge of straight) {
        const a = index.get(edge.a)!,
            b = index.get(edge.b)!;
        const cuts = next.vertices
            .filter(
                (v) => v.id !== a.id && v.id !== b.id && distance(v, project(v, a, b)) < epsilon,
            )
            .sort((u, v) => distance(a, u) - distance(a, v));
        let remaining = edge;
        for (const cut of cuts) {
            splitEdge(next, remaining, cut, cut);
            remaining = next.edges.at(-1)!;
        }
    }
    const pairs = new Map<string, Wall>();
    const currentVertices = vertexIndex(next);
    for (const e of next.edges) {
        if (e.a === e.b) throw new Error('Стена становится слишком короткой.');
        const pair = [e.a, e.b].sort().join(':');
        const other = pairs.get(pair);
        if (!other) {
            pairs.set(pair, e);
            continue;
        }
        if (e.curve || other.curve) throw new Error('Кривые стены накладываются друг на друга.');
        const hasOpening = (wall: Wall) =>
            next.openings?.some((o) => o.edgeId === wall.id) ? 1 : 0;
        const stationary = (wall: Wall) => {
            const original = before.edges.find((o) => o.id === wall.id);
            return original &&
                distance(currentVertices.get(wall.a)!, old.get(original.a)!) < epsilon &&
                distance(currentVertices.get(wall.b)!, old.get(original.b)!) < epsilon
                ? 1
                : 0;
        };
        const winner =
            hasOpening(e) > hasOpening(other) ||
            (hasOpening(e) === hasOpening(other) && stationary(e) > stationary(other))
                ? e
                : other;
        const loser = winner === e ? other : e;
        const merged = { ...winner, thickness: Math.max(winner.thickness, loser.thickness) };
        for (const flag of ['blocksMovement', 'blocksVision', 'blocksLight'] as const)
            if (winner[flag] !== undefined || loser[flag] !== undefined)
                merged[flag] = (winner[flag] ?? true) || (loser[flag] ?? true);
        const reversed = loser.a !== winner.a;
        next.openings = next.openings?.map((o) =>
            o.edgeId !== loser.id
                ? o
                : ({
                      ...o,
                      edgeId: winner.id,
                      center: reversed ? 1 - o.center : o.center,
                      ...(o.type === 'door' && reversed
                          ? {
                                hinge: o.hinge === 'a' ? 'b' : 'a',
                                direction: o.direction === 'left' ? 'right' : 'left',
                            }
                          : {}),
                  } as typeof o),
        );
        pairs.set(pair, merged);
    }
    next.edges = [...pairs.values()];
    const error = openingsError(next);
    if (error) throw new Error(error);
    if (next.vertices.length > 512 || next.edges.length > 512)
        throw new Error('Достигнут предел структуры (512 вершин или стен).');
    return next;
}

export function constrainedDelta(delta: Point): Point {
    const angle = (Math.round(Math.atan2(delta.y, delta.x) / (Math.PI / 4)) * Math.PI) / 4;
    const length = delta.x * Math.cos(angle) + delta.y * Math.sin(angle);
    return { x: length * Math.cos(angle), y: length * Math.sin(angle) };
}
