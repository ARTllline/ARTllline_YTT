import type { GridSettings, Point, Scene } from '../types/scene';
import type { Material } from '../../workspace/maps/materials';

export type Vertex = Point & { id: string };
export type Wall = {
    id: string;
    a: string;
    b: string;
    thickness: number;
    materialVersionId: string | null;
    blocksMovement?: boolean;
    blocksVision?: boolean;
    blocksLight?: boolean;
};
export type Room = { id: string; loop: string[]; materialVersionId: string | null };
type Aperture = { id: string; edgeId: string; center: number; width: number };
export type Door = Aperture & {
    type: 'door';
    open: boolean;
    locked?: boolean;
    hinge: 'a' | 'b';
    direction: 'left' | 'right';
    angle: number;
};
export type DoorCommand =
    { id: string; open: boolean; locked?: never } | { id: string; locked: boolean; open?: never };
export type WindowOpening = Aperture & {
    type: 'window';
    frame: 'wood' | 'iron';
    blocksMovement?: boolean;
    blocksVision?: boolean;
    blocksLight?: boolean;
};
export type Opening = Door | WindowOpening;
export type Graph = { vertices: Vertex[]; edges: Wall[]; rooms: Room[]; openings?: Opening[] };
export type Surface = Pick<Material, 'versionId' | 'asset' | 'repeatSize' | 'rotation'> &
    Partial<Pick<Material, 'name'>>;
export type Structure = { hash: string; graph: Graph; materials: Surface[] };
type Delta<T> = { upsert: T[]; remove: string[] };
export type StructurePatch = {
    base: string;
    hash: string;
    materials: Surface[];
    vertices: Delta<Vertex>;
    edges: Delta<Wall>;
    rooms: Delta<Room>;
    openings?: Delta<Opening>;
};
export type Selection = { kind: 'vertex' | 'edge' | 'room' | 'opening'; id: string };
export type BuildSettings = {
    mode: 'wall' | 'segment' | 'rectangle' | 'contour' | 'edit' | 'door' | 'window';
    wall: string | null;
    floor: string | null;
    thickness: number;
    gridSnap: boolean;
    openingWidth: number;
};
export const defaultBuild: BuildSettings = {
    mode: 'wall',
    wall: null,
    floor: null,
    thickness: 14,
    gridSnap: true,
    openingWidth: 64,
};
export const emptyGraph: Graph = { vertices: [], edges: [], rooms: [] };
export const emptyHash = 'e9e2551ff7d2a3824cb4725dc15cf3826753f8fb28c4849fa8d448b73171831a';

function applyDelta<T extends { id: string }>(current: T[], delta: Delta<T>): T[] {
    const rows = new Map(current.map((row) => [row.id, row]));
    for (const id of delta.remove) rows.delete(id);
    for (const row of delta.upsert) rows.set(row.id, row);
    return [...rows.values()].sort((a, b) => (a.id < b.id ? -1 : Number(a.id !== b.id)));
}

export function applyStructurePatch(
    current: Structure | null | undefined,
    patch: StructurePatch,
): Structure {
    const graph = current?.graph ?? emptyGraph;
    const openings = patch.openings
        ? applyDelta(graph.openings ?? [], patch.openings)
        : graph.openings;
    return {
        hash: patch.hash,
        materials: patch.materials,
        graph: {
            vertices: applyDelta(graph.vertices, patch.vertices),
            edges: applyDelta(graph.edges, patch.edges),
            rooms: applyDelta(graph.rooms, patch.rooms),
            ...(openings?.length ? { openings } : {}),
        },
    };
}

export const vertexIndex = (graph: Graph) =>
    new Map(graph.vertices.map((vertex) => [vertex.id, vertex]));
const id = (prefix: string) => prefix + crypto.randomUUID().replaceAll('-', '');
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function project(point: Point, a: Point, b: Point) {
    const dx = b.x - a.x,
        dy = b.y - a.y;
    const t = Math.max(
        0,
        Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)),
    );
    return { x: a.x + dx * t, y: a.y + dy * t };
}

export type Snap = { point: Point; kind: 'vertex' | 'edge' | 'grid' | 'free'; id?: string };
export function snap(
    point: Point,
    graph: Graph,
    grid: GridSettings,
    zoom: number,
    gridSnap: boolean,
): Snap {
    const radius = Math.min(10 / zoom, grid.size * 0.45);
    let nearest = radius;
    let result: Snap | undefined;
    for (const vertex of graph.vertices) {
        const d = distance(point, vertex);
        if (d <= nearest) {
            nearest = d;
            result = { point: vertex, kind: 'vertex', id: vertex.id };
        }
    }
    if (result) return result;
    const vertices = vertexIndex(graph);
    for (const edge of graph.edges) {
        const p = project(point, vertices.get(edge.a)!, vertices.get(edge.b)!);
        const d = distance(point, p);
        if (d <= nearest) {
            nearest = d;
            result = { point: p, kind: 'edge', id: edge.id };
        }
    }
    if (result) return result;
    if (gridSnap) {
        const x = grid.offset.x + Math.round((point.x - grid.offset.x) / grid.size) * grid.size;
        const y = grid.offset.y + Math.round((point.y - grid.offset.y) / grid.size) * grid.size;
        if (distance(point, { x, y }) <= radius) return { point: { x, y }, kind: 'grid' };
    }
    return { point, kind: 'free' };
}

export function splitEdge(graph: Graph, edge: Wall, point: Point): Vertex {
    const vertices = vertexIndex(graph);
    const a = vertices.get(edge.a)!;
    const length = distance(a, vertices.get(edge.b)!);
    const cut = distance(a, point);
    const newEdge = { ...edge, id: id('e'), a: '' };
    if (graph.openings)
        graph.openings = graph.openings.map((opening) => {
            if (opening.edgeId !== edge.id) return opening;
            const offset = opening.center * length;
            if (Math.abs(offset - cut) < opening.width / 2 + edge.thickness / 2)
                throw new Error('Разрез слишком близко к проёму.');
            return offset < cut
                ? { ...opening, center: offset / cut }
                : { ...opening, edgeId: newEdge.id, center: (offset - cut) / (length - cut) };
        });
    const vertex = { id: id('v'), x: point.x, y: point.y };
    graph.vertices.push(vertex);
    graph.edges = graph.edges.map((row) => (row.id === edge.id ? { ...row, b: vertex.id } : row));
    graph.edges.push({ ...newEdge, a: vertex.id });
    graph.rooms = graph.rooms.map((room) => {
        const loop = room.loop.flatMap((a, i) => {
            const b = room.loop[(i + 1) % room.loop.length];
            return samePair(edge, a, b) ? [a, vertex.id] : [a];
        });
        return { ...room, loop };
    });
    return vertex;
}

function samePair(edge: Wall, a: string, b: string) {
    return (edge.a === a && edge.b === b) || (edge.a === b && edge.b === a);
}

export function build(
    graph: Graph,
    points: Point[],
    settings: BuildSettings,
    closed: boolean,
): Graph {
    const next: Graph = {
        ...graph,
        vertices: [...graph.vertices],
        edges: [...graph.edges],
        rooms: [...graph.rooms],
    };
    const loop = points.map((point) => {
        const vertex = next.vertices.find((v) => distance(point, v) < 0.001);
        if (vertex) return vertex.id;
        const vertices = vertexIndex(next);
        const edge = next.edges.find(
            (e) => distance(point, project(point, vertices.get(e.a)!, vertices.get(e.b)!)) < 0.001,
        );
        if (edge) return splitEdge(next, edge, point).id;
        const row = { id: id('v'), x: point.x, y: point.y };
        next.vertices.push(row);
        return row.id;
    });
    const path = closed ? [...loop, loop[0]] : loop;
    for (let i = 1; i < path.length; i++) {
        const a = path[i - 1],
            b = path[i];
        if (a === b || next.edges.some((edge) => samePair(edge, a, b))) continue;
        next.edges.push({
            id: id('e'),
            a,
            b,
            thickness: settings.thickness,
            materialVersionId: settings.wall,
            blocksMovement: true,
            blocksVision: true,
            blocksLight: true,
        });
    }
    if (closed) next.rooms.push({ id: id('r'), loop, materialVersionId: settings.floor });
    return next;
}

export function remove(graph: Graph, selection: Selection): Graph {
    if (selection.kind === 'opening')
        return { ...graph, openings: graph.openings?.filter((o) => o.id !== selection.id) };
    const edges = graph.edges.filter((edge) =>
        selection.kind === 'edge'
            ? edge.id !== selection.id
            : selection.kind === 'vertex'
              ? ![edge.a, edge.b].includes(selection.id)
              : true,
    );
    const used = new Set(edges.flatMap((edge) => [edge.a, edge.b]));
    return {
        ...graph,
        vertices: graph.vertices.filter((vertex) => used.has(vertex.id)),
        edges,
        rooms: graph.rooms.filter(
            (room) =>
                (selection.kind !== 'room' || room.id !== selection.id) &&
                room.loop.every((a, i) =>
                    edges.some((edge) => samePair(edge, a, room.loop[(i + 1) % room.loop.length])),
                ),
        ),
    };
}

export function roomAt(graph: Graph, point: Point): Room | undefined {
    const vertices = vertexIndex(graph);
    return [...graph.rooms].reverse().find((room) => {
        let inside = false;
        const loop = room.loop.map((key) => vertices.get(key)!);
        for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
            const a = loop[i],
                b = loop[j];
            if (
                a.y > point.y !== b.y > point.y &&
                point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
            )
                inside = !inside;
        }
        return inside;
    });
}

export const structureOf = (scene: Scene) => scene.structure?.graph ?? emptyGraph;

export function openingOn(
    edge: Wall,
    type: Opening['type'],
    center: number,
    width: number,
    preview = false,
): Opening {
    const aperture = { id: preview ? 'preview' : id('o'), edgeId: edge.id, center, width };
    return type === 'door'
        ? {
              ...aperture,
              type,
              open: false,
              locked: false,
              hinge: 'a',
              direction: 'left',
              angle: 90,
          }
        : {
              ...aperture,
              type,
              frame: 'wood',
              blocksMovement: true,
              blocksVision: false,
              blocksLight: false,
          };
}

export function putOpening(graph: Graph, opening: Opening): Graph {
    return {
        ...graph,
        openings: [...(graph.openings ?? []).filter((o) => o.id !== opening.id), opening],
    };
}

export function openingsError(graph: Graph): string | undefined {
    const vertices = vertexIndex(graph);
    const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
    const ends = new Map<string, number>();
    for (const opening of [...(graph.openings ?? [])].sort((a, b) => a.center - b.center)) {
        const edge = edges.get(opening.edgeId);
        if (!edge) return 'Стена содержит проём. Сначала удалите проём.';
        const length = distance(vertices.get(edge.a)!, vertices.get(edge.b)!);
        const left = opening.center * length - opening.width / 2;
        const right = left + opening.width;
        if (
            !Number.isFinite(left) ||
            opening.width < 8 ||
            opening.width > 512 ||
            left < (ends.get(edge.id) ?? edge.thickness / 2 - 1) + 1 ||
            right > length - edge.thickness / 2
        )
            return 'Проём пересекает другой проём или слишком близок к торцу стены.';
        ends.set(edge.id, right);
    }
}

function flip(opening: Opening): Opening {
    const reversed = { ...opening, center: 1 - opening.center };
    if (reversed.type === 'door') {
        reversed.hinge = reversed.hinge === 'a' ? 'b' : 'a';
        reversed.direction = reversed.direction === 'left' ? 'right' : 'left';
    }
    return reversed;
}

export function reverseEdge(graph: Graph, edge: Wall): Graph {
    return {
        ...graph,
        edges: graph.edges.map((row) =>
            row.id === edge.id ? { ...row, a: edge.b, b: edge.a } : row,
        ),
        openings: graph.openings?.map((opening) =>
            opening.edgeId === edge.id ? flip(opening) : opening,
        ),
    };
}

export function joinEdges(graph: Graph, vertexId: string): { graph: Graph; edgeId: string } {
    const incident = graph.edges.filter((edge) => edge.a === vertexId || edge.b === vertexId);
    const [first, second] = incident;
    const error = 'Для соединения нужны две соосные стены с одинаковыми свойствами.';
    if (
        incident.length !== 2 ||
        first.thickness !== second.thickness ||
        first.materialVersionId !== second.materialVersionId ||
        first.blocksMovement !== second.blocksMovement ||
        first.blocksVision !== second.blocksVision ||
        first.blocksLight !== second.blocksLight
    )
        throw new Error(error);
    const a = first.a === vertexId ? first.b : first.a;
    const b = second.a === vertexId ? second.b : second.a;
    const vertices = vertexIndex(graph);
    const start = vertices.get(a)!;
    const end = vertices.get(b)!;
    const joint = vertices.get(vertexId)!;
    if (distance(joint, project(joint, start, end)) > 0.002) throw new Error(error);
    const left = distance(start, joint);
    const right = distance(joint, end);
    return {
        edgeId: first.id,
        graph: {
            vertices: graph.vertices.filter((v) => v.id !== vertexId),
            edges: graph.edges
                .filter((e) => e.id !== second.id)
                .map((e) => (e.id === first.id ? { ...first, a, b } : e)),
            rooms: graph.rooms.map((room) => ({
                ...room,
                loop: room.loop.filter((v) => v !== vertexId),
            })),
            openings: graph.openings?.map((opening) => {
                if (opening.edgeId !== first.id && opening.edgeId !== second.id) return opening;
                const onFirst = opening.edgeId === first.id;
                const reversed = onFirst ? first.a !== a : second.a !== vertexId;
                const oriented = reversed ? flip(opening) : opening;
                const offset = onFirst ? left * oriented.center : left + right * oriented.center;
                return { ...oriented, edgeId: first.id, center: offset / (left + right) };
            }),
        },
    };
}

export function along(a: Point, b: Point, t: number): Point {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function apertureEnds(a: Point, b: Point, opening: Pick<Opening, 'center' | 'width'>) {
    const half = opening.width / (2 * distance(a, b));
    return [along(a, b, opening.center - half), along(a, b, opening.center + half)] as const;
}

export function wallRuns(edge: Wall, vertices: Map<string, Vertex>, openings: Opening[]) {
    const a = vertices.get(edge.a)!;
    const b = vertices.get(edge.b)!;
    const runs: { a: Point; b: Point; roundA: boolean; roundB: boolean; opening?: Opening }[] = [];
    let start: Point = a;
    for (const opening of openings
        .filter((o) => o.edgeId === edge.id)
        .sort((a, b) => a.center - b.center)) {
        const [left, right] = apertureEnds(a, b, opening);
        runs.push({ a: start, b: left, roundA: start === a, roundB: false });
        runs.push({ a: left, b: right, roundA: false, roundB: false, opening });
        start = right;
    }
    runs.push({ a: start, b, roundA: start === a, roundB: true });
    return runs;
}
