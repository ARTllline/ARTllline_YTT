import type { Point } from '../types/scene';
import { roomPath, wallPath } from './curves';
import { vertexIndex, type Graph, type Room } from './model';

type Face = { loop: string[]; points: Point[]; area: number; room?: Room; error?: string };
const area = (p: Point[]) =>
    p.reduce((s, a, i) => {
        const b = p[(i + 1) % p.length];
        return s + a.x * b.y - b.x * a.y;
    }, 0);
const contains = (polygon: Point[], p: Point) => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i],
            b = polygon[j];
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
            inside = !inside;
    }
    return inside;
};

/** A painted subregion stays above its original enclosing room, regardless of ID order. */
export function floorSurfaces(graph: Graph) {
    return [
        ...graph.rooms
            .filter((room) => room.materialVersionId)
            .map((room) => ({ room, points: roomPath(graph, room) }))
            .sort((a, b) => Math.abs(area(b.points)) - Math.abs(area(a.points))),
        ...(graph.floors ?? [])
            .filter((f) => f.materialVersionId)
            .map((f) => ({
                room: { id: f.id, loop: [], materialVersionId: f.materialVersionId },
                points: f.points,
            })),
    ].sort((a, b) => Math.abs(area(b.points)) - Math.abs(area(a.points)));
}

/** Bounded planar faces, ignoring bridges (unfinished walls inside a room). */
export function floorFaces(graph: Graph): Face[] {
    const index = vertexIndex(graph);
    const adjacency = new Map<string, { to: string; edge: number }[]>();
    graph.edges.forEach((e, edge) => {
        for (const [from, to] of [
            [e.a, e.b],
            [e.b, e.a],
        ]) {
            const list = adjacency.get(from) ?? [];
            list.push({ to, edge });
            adjacency.set(from, list);
        }
    });
    const visited = new Map<string, number>(),
        low = new Map<string, number>(),
        bridges = new Set<number>();
    let clock = 0;
    const visit = (v: string, parent = -1) => {
        visited.set(v, ++clock);
        low.set(v, clock);
        for (const { to, edge } of adjacency.get(v) ?? []) {
            if (edge === parent) continue;
            if (!visited.has(to)) {
                visit(to, edge);
                low.set(v, Math.min(low.get(v)!, low.get(to)!));
                if (low.get(to)! > visited.get(v)!) bridges.add(edge);
            } else low.set(v, Math.min(low.get(v)!, visited.get(to)!));
        }
    };
    for (const v of graph.vertices) if (!visited.has(v.id)) visit(v.id);
    const paths = graph.edges.map((e) => wallPath(e, index));
    for (const [v, list] of adjacency) {
        const direction = ({ edge }: (typeof list)[number]) => {
            const path = paths[edge];
            const p = graph.edges[edge].a === v ? path[1] : path.at(-2)!;
            const a = index.get(v)!;
            return Math.atan2(p.y - a.y, p.x - a.x);
        };
        adjacency.set(
            v,
            list
                .filter(({ edge }) => !bridges.has(edge))
                .sort((a, b) => direction(a) - direction(b)),
        );
    }
    const used = new Set<string>(),
        faces: Face[] = [];
    for (const [start, list] of adjacency)
        for (const first of list) {
            const key = `${start}:${first.edge}`;
            if (used.has(key)) continue;
            const loop: string[] = [],
                points: Point[] = [];
            let from = start,
                current = first;
            do {
                used.add(`${from}:${current.edge}`);
                loop.push(from);
                const edge = graph.edges[current.edge];
                const path =
                    edge.a === from ? paths[current.edge] : [...paths[current.edge]].reverse();
                points.push(...path.slice(0, -1));
                const next = adjacency.get(current.to)!;
                const twin = next.findIndex((e) => e.edge === current.edge);
                from = current.to;
                current = next[(twin + next.length - 1) % next.length];
            } while (`${from}:${current.edge}` !== key && loop.length <= graph.edges.length * 2);
            const size = area(points);
            if (size < 2 || loop.length > 128 || new Set(loop).size !== loop.length) continue;
            const ids = new Set(loop);
            const room = graph.rooms.find(
                (r) => r.loop.length === loop.length && r.loop.every((id) => ids.has(id)),
            );
            faces.push({
                loop: room?.loop ?? loop,
                points: room ? roomPath(graph, room) : points,
                area: size,
                room,
            });
        }
    for (const face of faces) {
        // The room format has no holes: never silently paint across an inner closed enclosure.
        if (
            faces.some(
                (other) =>
                    other !== face &&
                    other.area < face.area &&
                    other.loop.every((id) => !face.loop.includes(id)) &&
                    contains(face.points, other.points[0]),
            )
        )
            face.error =
                'Область содержит внутренний замкнутый контур. Разделите её стеной перед заливкой.';
    }
    return faces;
}

export function floorAt(faces: Face[], point: Point): Face | undefined {
    return faces.filter((face) => contains(face.points, point)).sort((a, b) => a.area - b.area)[0];
}

export function fillFloor(graph: Graph, face: Face, materialVersionId: string | null): Graph {
    if (face.error) throw new Error(face.error);
    if (face.room) {
        if (face.room.materialVersionId === materialVersionId) return graph;
        return {
            ...graph,
            rooms: graph.rooms.map((r) =>
                r.id === face.room!.id ? { ...r, materialVersionId } : r,
            ),
        };
    }
    if (!materialVersionId) return graph;
    return {
        ...graph,
        rooms: [
            ...graph.rooms,
            {
                id: 'r' + crypto.randomUUID().replaceAll('-', ''),
                loop: face.loop,
                materialVersionId,
            },
        ],
    };
}
