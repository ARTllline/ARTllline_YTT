import {
    curvePoint,
    wallPath,
    wallLength,
    wallPoint,
    wallProject,
    roomPath,
    type Curve,
} from './curves';
import type { GridSettings, Point, Scene } from '../types/scene';
import type { Material } from '../../workspace/maps/materials';
import { connectJunctions } from './junctions';
import type { Assembly, FloorRegion } from './roomAssembly';

export type Vertex = Point & { id: string };
export type Wall = {
    id: string;
    a: string;
    b: string;
    curve?: Curve;
    thickness: number;
    materialVersionId: string | null;
    blocksMovement?: boolean;
    blocksVision?: boolean;
    blocksLight?: boolean;
};
export type Room = { id: string; loop: string[]; materialVersionId: string | null };
type Aperture = {
    id: string;
    edgeId: string;
    center: number;
    width: number;
    materialVersionId?: string | null;
};
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
    open?: boolean;
    frame: 'wood' | 'iron';
    blocksMovement?: boolean;
    blocksVision?: boolean;
    blocksLight?: boolean;
};
export type Opening = Door | WindowOpening;
export type OpeningCommand = { id: string; open: boolean };
export const openingIsOpen = (opening: Opening) => opening.open ?? opening.type === 'window';
export type Graph = {
    vertices: Vertex[];
    edges: Wall[];
    rooms: Room[];
    openings?: Opening[];
    assemblies?: Assembly[];
    floors?: FloorRegion[];
};
export type Surface = Pick<Material, 'versionId' | 'asset' | 'repeatSize' | 'rotation'> &
    Partial<Pick<Material, 'name' | 'displayName' | 'layout' | 'type'>>;
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
    assemblies?: Delta<Assembly>;
    floors?: Delta<FloorRegion>;
};
export type Selection =
    { kind: 'vertex' | 'edge' | 'room' | 'opening'; id: string } | { kind: 'edges'; ids: string[] };
export type BuildSettings = {
    mode:
        | 'wall'
        | 'segment'
        | 'rectangle'
        | 'circle'
        | 'ellipse'
        | 'arc'
        | 'contour'
        | 'edit'
        | 'floor'
        | 'door'
        | 'window';
    wall: string | null;
    floor: string | null;
    door?: string | null;
    window?: string | null;
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
            ...(patch.assemblies || graph.assemblies
                ? {
                      assemblies: patch.assemblies
                          ? applyDelta(graph.assemblies ?? [], patch.assemblies)
                          : graph.assemblies,
                  }
                : {}),
            ...(patch.floors || graph.floors
                ? {
                      floors: patch.floors
                          ? applyDelta(graph.floors ?? [], patch.floors)
                          : graph.floors,
                  }
                : {}),
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
        const p = wallProject(point, edge, vertices).point;
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

export function splitEdge(graph: Graph, edge: Wall, point: Point, shared?: Vertex): Vertex {
    if (edge.curve && graph.openings?.some((o) => o.edgeId === edge.id))
        throw new Error('Разрез кривой с проёмом пока не поддерживается. Сначала удалите проём.');
    const vertices = vertexIndex(graph);
    const length = wallLength(edge, vertices);
    const projection = wallProject(point, edge, vertices);
    const cut = projection.t * length;
    if (edge.curve) point = curvePoint(edge.curve, projection.parameter);
    const newEdge = {
        ...edge,
        id: id('e'),
        a: '',
        ...(edge.curve && {
            curve: {
                ...edge.curve,
                start: edge.curve.start + edge.curve.sweep * projection.parameter,
                sweep: edge.curve.sweep * (1 - projection.parameter),
            },
        }),
    };
    if (graph.openings)
        graph.openings = graph.openings.map((opening) => {
            if (opening.edgeId !== edge.id) return opening;
            const offset = opening.center * length;
            if (cutOverlapsOpening(edge, opening, length, cut)) throw new Error(blockedSplit);
            return offset < cut
                ? { ...opening, center: offset / cut }
                : { ...opening, edgeId: newEdge.id, center: (offset - cut) / (length - cut) };
        });
    const vertex = shared ?? { id: id('v'), x: point.x, y: point.y };
    if (!shared) graph.vertices.push(vertex);
    graph.edges = graph.edges.map((row) =>
        row.id === edge.id
            ? {
                  ...row,
                  b: vertex.id,
                  ...(edge.curve && {
                      curve: { ...edge.curve, sweep: edge.curve.sweep * projection.parameter },
                  }),
              }
            : row,
    );
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

export const blockedSplit = 'Разрез слишком близко к проёму.';
export const cutOverlapsOpening = (edge: Wall, opening: Opening, length: number, cut: number) =>
    opening.edgeId === edge.id &&
    Math.abs(opening.center * length - cut) < opening.width / 2 + edge.thickness / 2;

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
    const anchors = points.map((point) => {
        const vertex = next.vertices.find((v) => distance(point, v) < 0.001);
        if (vertex) return vertex.id;
        const vertices = vertexIndex(next);
        const edge = next.edges.find(
            (e) => distance(point, wallProject(point, e, vertices).point) < 0.002,
        );
        if (edge) return splitEdge(next, edge, point).id;
        const row = { id: id('v'), x: point.x, y: point.y };
        next.vertices.push(row);
        return row.id;
    });
    const path = closed ? [...anchors, anchors[0]] : anchors;
    const vertices = vertexIndex(next);
    const loop: string[] = [path[0]];
    for (let i = 1; i < path.length; i++) {
        const a = path[i - 1],
            b = path[i];
        if (a === b) continue;
        const start = vertices.get(a)!;
        const end = vertices.get(b)!;
        // Follow existing junctions on a shared side, including vertices just split above.
        const junctions = next.vertices
            .filter((v) => v.id !== a && v.id !== b && distance(v, project(v, start, end)) < 0.001)
            .sort((left, right) => distance(start, left) - distance(start, right));
        let from = a;
        for (const to of [...junctions.map((v) => v.id), b]) {
            if (!next.edges.some((edge) => !edge.curve && samePair(edge, from, to)))
                next.edges.push({
                    id: id('e'),
                    a: from,
                    b: to,
                    thickness: settings.thickness,
                    materialVersionId: settings.wall,
                    blocksMovement: true,
                    blocksVision: true,
                    blocksLight: true,
                });
            loop.push(to);
            from = to;
        }
    }
    if (closed)
        next.rooms.push({
            id: id('r'),
            loop: loop.slice(0, -1),
            materialVersionId: settings.floor,
        });
    return connectJunctions(next, graph);
}

export function remove(graph: Graph, selection: Selection): Graph {
    if (selection.kind === 'opening')
        return { ...graph, openings: graph.openings?.filter((o) => o.id !== selection.id) };
    const groups = new Set(
        graph.edges
            .filter(
                (edge) =>
                    edge.curve &&
                    (selection.kind === 'edge'
                        ? edge.id === selection.id
                        : selection.kind === 'edges' && selection.ids.includes(edge.id)),
            )
            .map((edge) => edge.curve!.group),
    );
    const edges = graph.edges.filter((edge) =>
        edge.curve && groups.has(edge.curve.group)
            ? false
            : selection.kind === 'edges'
              ? !selection.ids.includes(edge.id)
              : selection.kind === 'edge'
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
    let selected: Room | undefined;
    let smallest = Infinity;
    for (const room of [...graph.rooms].reverse()) {
        let inside = false;
        const loop = roomPath(graph, room);
        for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
            const a = loop[i],
                b = loop[j];
            if (
                a.y > point.y !== b.y > point.y &&
                point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
            )
                inside = !inside;
        }
        if (!inside) continue;
        const area = Math.abs(
            loop.reduce((sum, a, i) => {
                const b = loop[(i + 1) % loop.length];
                return sum + a.x * b.y - b.x * a.y;
            }, 0),
        );
        if (area < smallest) {
            selected = room;
            smallest = area;
        }
    }
    return selected;
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
              open: true,
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
    for (const edge of graph.edges) {
        if (
            edge.curve &&
            (Math.min(edge.curve.rx, edge.curve.ry) < Math.max(8, edge.thickness) ||
                Math.abs(edge.curve.sweep) < 0.01)
        )
            return 'Радиус меньше толщины стены или угол дуги меньше 5°.';
    }
    for (const opening of [...(graph.openings ?? [])].sort((a, b) => a.center - b.center)) {
        const edge = edges.get(opening.edgeId);
        if (!edge) return 'Стена содержит проём. Сначала удалите проём.';
        const length = wallLength(edge, vertices);
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
    if (edge.curve && graph.openings?.some((o) => o.edgeId === edge.id))
        throw new Error('Разворот кривой с проёмом пока не поддерживается. Сначала удалите проём.');
    return {
        ...graph,
        edges: graph.edges.map((row) =>
            row.id === edge.id
                ? {
                      ...row,
                      a: edge.b,
                      b: edge.a,
                      ...(edge.curve && {
                          curve: {
                              ...edge.curve,
                              start: edge.curve.start + edge.curve.sweep,
                              sweep: -edge.curve.sweep,
                          },
                      }),
                  }
                : row,
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
        first.curve ||
        second.curve ||
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
    if (edge.curve) return curvedRuns(edge, vertices, openings);
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

export function openingEnds(
    edge: Wall,
    vertices: Map<string, Vertex>,
    opening: Pick<Opening, 'center' | 'width'>,
) {
    const half = opening.width / (2 * wallLength(edge, vertices));
    return [
        wallPoint(edge, vertices, opening.center - half),
        wallPoint(edge, vertices, opening.center + half),
    ] as const;
}
function curvedRuns(edge: Wall, vertices: Map<string, Vertex>, openings: Opening[]) {
    const path = wallPath(edge, vertices),
        length = wallLength(edge, vertices);
    const offsets = [0];
    for (let i = 1; i < path.length; i++)
        offsets.push(offsets[i - 1] + distance(path[i - 1], path[i]));
    const runs: { a: Point; b: Point; roundA: boolean; roundB: boolean; opening?: Opening }[] = [];
    const solid = (start: number, end: number, roundA: boolean, roundB: boolean) => {
        const points = [
            wallPoint(edge, vertices, start / length),
            ...path.filter((_, i) => offsets[i] > start + 1e-6 && offsets[i] < end - 1e-6),
            wallPoint(edge, vertices, end / length),
        ];
        for (let i = 1; i < points.length; i++)
            if (distance(points[i - 1], points[i]) > 1e-6)
                runs.push({
                    a: points[i - 1],
                    b: points[i],
                    roundA: i > 1 || roundA,
                    roundB: i < points.length - 1 || roundB,
                });
    };
    let start = 0;
    for (const opening of openings
        .filter((o) => o.edgeId === edge.id)
        .sort((a, b) => a.center - b.center)) {
        const left = opening.center * length - opening.width / 2,
            right = left + opening.width;
        solid(start, left, start === 0, false);
        const [a, b] = openingEnds(edge, vertices, opening);
        runs.push({ a, b, roundA: false, roundB: false, opening });
        start = right;
    }
    solid(start, length, start === 0, true);
    return runs;
}
