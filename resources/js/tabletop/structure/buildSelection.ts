import { wallPath, roomPath, curvePoint } from './curves';
import type { Point, Scene } from '../types/scene';
import { movementBlocked, movementObstacles } from '../utils/movement';
import { rectangle } from '../utils/spatialGeometry';
import { buildSnap, type BuildModifiers } from './buildSnap';
import { constrainedDelta } from './junctions';
import { translateAssembly } from './roomAssembly';
import {
    distance,
    emptyGraph,
    openingsError,
    snap,
    vertexIndex,
    type Graph,
    type Selection,
    type Vertex,
    type Wall,
} from './model';

export function roomWalls(graph: Graph, loop: string[]) {
    const next = new Map(loop.map((id, i) => [id, loop[(i + 1) % loop.length]]));
    return graph.edges.filter((edge) => next.get(edge.a) === edge.b || next.get(edge.b) === edge.a);
}

export function selectedWalls(graph: Graph, selection?: Selection): Wall[] {
    if (selection?.kind === 'edges') {
        const ids = new Set(selection.ids);
        const groups = new Set(
            graph.edges.filter((e) => ids.has(e.id) && e.curve).map((e) => e.curve!.group),
        );
        return graph.edges.filter(
            (edge) => ids.has(edge.id) || (edge.curve && groups.has(edge.curve.group)),
        );
    }
    if (selection?.kind === 'edge') {
        const curve = graph.edges.find((e) => e.id === selection.id)?.curve;
        return graph.edges.filter((edge) =>
            curve ? edge.curve?.group === curve.group : edge.id === selection.id,
        );
    }
    if (selection?.kind !== 'room') return [];
    const room = graph.rooms.find((room) => room.id === selection.id);
    return room ? roomWalls(graph, room.loop) : [];
}

export function wallSelection(ids: string[]): Selection | undefined {
    if (!ids.length) return;
    return ids.length === 1 ? { kind: 'edge', id: ids[0] } : { kind: 'edges', ids };
}

export function connectedSelection(graph: Graph, wall: Wall) {
    const rooms = graph.rooms.filter((room) => roomWalls(graph, room.loop).includes(wall));
    if (rooms.length === 1) return { kind: 'room' as const, id: rooms[0].id };

    const incident = new Map<string, Wall[]>();
    for (const edge of graph.edges) {
        for (const id of [edge.a, edge.b]) {
            const walls = incident.get(id) ?? [];
            walls.push(edge);
            incident.set(id, walls);
        }
    }
    const vertices = new Set([wall.a, wall.b]);
    const edges = new Set<string>();
    for (const id of vertices) {
        for (const edge of incident.get(id) ?? []) {
            edges.add(edge.id);
            vertices.add(edge.a);
            vertices.add(edge.b);
        }
    }
    return wallSelection([...edges]);
}

export function wallsInBox(graph: Graph, start: Point, end: Point) {
    const box = rectangle(start, end);
    const vertices = vertexIndex(graph);
    const contains = ({ x, y }: Point) =>
        x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
    return graph.edges.filter((edge) => wallPath(edge, vertices).every(contains));
}

export function moveVertices(graph: Graph, selection: Selection) {
    if (selection.kind === 'vertex')
        return new Set(graph.vertices.some((v) => v.id === selection.id) ? [selection.id] : []);
    const selected = selectedWalls(graph, selection);
    const groups = new Set(selected.flatMap((e) => (e.curve ? [e.curve.group] : [])));
    return new Set(
        graph.edges
            .filter((e) => selected.includes(e) || (e.curve && groups.has(e.curve.group)))
            .flatMap((e) => [e.a, e.b]),
    );
}

type MoveSnap = {
    delta: Point;
    kind?: 'grid' | 'align' | 'vertex' | 'midpoint' | 'edge' | 'guide';
    marker?: Point;
    guide?: Point;
};

export function snapMove(
    scene: Scene,
    graph: Graph,
    ids: Set<string>,
    delta: Point,
    zoom: number,
    gridSnap: boolean,
    anchor?: Point,
    modifiers: BuildModifiers = { lock: false, bypass: false },
): MoveSnap {
    if (modifiers.lock) delta = constrainedDelta(delta);
    if (modifiers.bypass)
        return {
            delta,
            ...(modifiers.lock &&
                anchor && {
                    guide: anchor,
                    marker: { x: anchor.x + delta.x, y: anchor.y + delta.y },
                }),
        };
    let best: MoveSnap = { delta };
    const radius = Math.min(10 / zoom, scene.grid.size * 0.45);
    let error = radius;
    const stationary = graph.vertices.filter((v) => !ids.has(v.id));
    const targets: Graph = {
        ...graph,
        vertices: stationary,
        edges: graph.edges.filter((e) => !ids.has(e.a) && !ids.has(e.b)),
    };
    const origins = anchor
        ? [anchor, ...graph.vertices.filter((v) => ids.has(v.id))]
        : graph.vertices.filter((v) => ids.has(v.id));
    const lockedOrigin = modifiers.lock && anchor ? anchor : undefined;
    // Topology snaps win over grid and alignment; every correction translates the whole selection.
    for (const origin of origins) {
        const point = { x: origin.x + delta.x, y: origin.y + delta.y };
        const target = buildSnap(
            point,
            targets,
            scene.grid,
            zoom,
            false,
            modifiers.lock ? [origin] : [],
            modifiers,
        );
        if (!['vertex', 'midpoint', 'edge'].includes(target.kind)) continue;
        const error = distance(point, target.point);
        if (error > radius) continue;
        const correction = {
            x: delta.x + target.point.x - point.x,
            y: delta.y + target.point.y - point.y,
        };
        if (modifiers.lock && distance(correction, constrainedDelta(correction)) > 0.0001) continue;
        return {
            delta: correction,
            kind: target.kind as MoveSnap['kind'],
            marker: target.point,
            guide: { x: origin.x, y: origin.y },
        };
    }
    const consider = (point: Point, marker: Point, kind: MoveSnap['kind'], guide?: Point) => {
        const d = distance(point, marker);
        if (d >= error || (kind === 'align' && d < 0.0005)) return;
        const correction = { x: delta.x + marker.x - point.x, y: delta.y + marker.y - point.y };
        if (modifiers.lock && distance(correction, constrainedDelta(correction)) > 0.0001) return;
        error = d;
        best = {
            delta: { x: delta.x + marker.x - point.x, y: delta.y + marker.y - point.y },
            kind,
            marker,
            guide,
        };
    };
    for (const vertex of origins) {
        const point = { x: vertex.x + delta.x, y: vertex.y + delta.y };
        const grid = snap(point, emptyGraph, scene.grid, zoom, gridSnap);
        if (grid.kind === 'grid') consider(point, grid.point, 'grid');
        for (const other of stationary) {
            if (distance(point, other) > 160 / zoom || distance(point, other) < radius) continue;
            consider(point, { x: other.x, y: point.y }, 'align', other);
            consider(point, { x: point.x, y: other.y }, 'align', other);
        }
    }
    if (modifiers.lock && !best.guide && lockedOrigin) {
        best.guide = lockedOrigin;
        best.marker = { x: lockedOrigin.x + best.delta.x, y: lockedOrigin.y + best.delta.y };
    }
    return best;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

export function translateStructure(
    graph: Graph,
    ids: Set<string>,
    delta: Point,
    selection?: Selection,
): Graph {
    const assembled = translateAssembly(graph, ids, delta, translateStructure, selection);
    if (assembled) return assembled;
    const dx = round(delta.x),
        dy = round(delta.y);
    if (!ids.size || (!dx && !dy)) return graph;
    return {
        ...graph,
        edges: graph.edges.map((e) =>
            e.curve && ids.has(e.a) && ids.has(e.b)
                ? {
                      ...e,
                      curve: { ...e.curve, cx: round(e.curve.cx + dx), cy: round(e.curve.cy + dy) },
                  }
                : e,
        ),
        vertices: graph.vertices.map((v) =>
            ids.has(v.id) ? { ...v, x: round(v.x + dx), y: round(v.y + dy) } : v,
        ),
    };
}

// Match the StructuralGeometry junction rule for the changed wall axes.
function crosses(a: Vertex, b: Vertex, c: Vertex, d: Vertex) {
    if (
        Math.max(a.x, b.x) < Math.min(c.x, d.x) ||
        Math.max(c.x, d.x) < Math.min(a.x, b.x) ||
        Math.max(a.y, b.y) < Math.min(c.y, d.y) ||
        Math.max(c.y, d.y) < Math.min(a.y, b.y)
    )
        return false;
    const side = (p: Point, q: Point, r: Point) => {
        const cross = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
        return Math.abs(cross) < 0.0000001 ? 0 : Math.sign(cross);
    };
    const touches = (p: Vertex, q: Vertex, r: Vertex, sign: number) =>
        sign === 0 &&
        r.id !== p.id &&
        r.id !== q.id &&
        r.x >= Math.min(p.x, q.x) &&
        r.x <= Math.max(p.x, q.x) &&
        r.y >= Math.min(p.y, q.y) &&
        r.y <= Math.max(p.y, q.y);
    const u = side(a, b, c),
        v = side(a, b, d),
        w = side(c, d, a),
        z = side(c, d, b);
    return (
        (u * v < 0 && w * z < 0) ||
        touches(a, b, c, u) ||
        touches(a, b, d, v) ||
        touches(c, d, a, w) ||
        touches(c, d, b, z)
    );
}

export function translationError(scene: Scene, before: Graph, after: Graph, ids: Set<string>) {
    if (before === after) return;
    const vertices = vertexIndex(after);
    const oldEdges = new Map(before.edges.map((e) => [e.id, e]));
    const changed = after.edges.filter(
        (edge) =>
            ids.has(edge.a) ||
            ids.has(edge.b) ||
            !oldEdges.has(edge.id) ||
            oldEdges.get(edge.id)!.a !== edge.a ||
            oldEdges.get(edge.id)!.b !== edge.b,
    );
    const positions = new Set(after.vertices.map((v) => `${v.x}:${v.y}`));
    if (positions.size !== vertices.size) return 'В одной точке может быть только одна вершина.';
    const segments = after.edges.flatMap((edge) => {
        const path = wallPath(edge, vertices);
        return path.slice(1).map(
            (p, i) =>
                [
                    { ...path[i], id: i === 0 ? edge.a : edge.id + ':' + i },
                    { ...p, id: i === path.length - 2 ? edge.b : edge.id + ':' + (i + 1) },
                ] as const,
        );
    });
    for (const edge of changed) {
        if (edge.curve) {
            for (const [id, t] of [
                [edge.a, 0],
                [edge.b, 1],
            ] as const)
                if (distance(vertices.get(id)!, curvePoint(edge.curve, t)) > 0.003)
                    return 'Перемещайте кривую целиком или измените её управляющими маркерами.';
        }
        const path = wallPath(edge, vertices),
            r = edge.thickness / 2;
        if (path.some((v) => v.x < r || v.y < r || v.x + r > scene.width || v.y + r > scene.height))
            return 'Стена с учётом толщины выходит за границы карты.';
        if (distance(path[0], path.at(-1)!) < (edge.curve ? 0.01 : 1))
            return 'Стена становится слишком короткой.';
    }
    for (let i = 0; i < segments.length; i++)
        for (let j = 0; j < i; j++)
            if (crosses(...segments[i], ...segments[j]))
                return 'Стены могут пересекаться только в общей вершине.';
    const area = (graph: Graph, room: Graph['rooms'][number]) => {
        const loop = roomPath(graph, room);
        return loop.reduce((sum, a, i) => {
            const b = loop[(i + 1) % loop.length];
            return sum + a.x * b.y - b.x * a.y;
        }, 0);
    };
    for (const room of after.rooms) {
        const next = area(after, room);
        const oldRoom = before.rooms.find((r) => r.id === room.id);
        if (
            new Set(room.loop).size !== room.loop.length ||
            Math.abs(next) < 2 ||
            (oldRoom && next * area(before, oldRoom) <= 0)
        )
            return 'Перемещение сворачивает контур комнаты.';
    }
    const openingError = openingsError(after);
    if (openingError) return openingError;
    if (scene.structure && scene.tokens.length) {
        const obstacles = movementObstacles({
            ...scene,
            props: [],
            structure: { ...scene.structure, graph: { ...after, edges: changed } },
        });
        if (
            scene.tokens.some((token) =>
                movementBlocked(token, token, (token.size * token.scale) / 2, obstacles),
            )
        )
            return 'Перемещение перекрывает место, занятое токеном.';
    }
}
