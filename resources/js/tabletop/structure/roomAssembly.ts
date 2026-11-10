import type { Point } from '../types/scene';
import type { Graph, Opening, Selection, Wall } from './model';
import { distance, openingsError, vertexIndex } from './model';
import { curvePoint, roomPath, wallLength, wallPath, wallPoint, wallProject } from './curves';
import { floorFaces } from './floorFill';
import { connectJunctions } from './junctions';
import { detachRoomWalls } from './detachRoomWalls';

export type RoomMode = 'union' | 'partition' | 'trim';
export type RoomSource = { mode: RoomMode; graph: Graph };
export type Assembly = { id: string; sources: RoomSource[] };
export type FloorRegion = { id: string; points: Point[]; materialVersionId: string | null };
const empty = (): Graph => ({ vertices: [], edges: [], rooms: [] });
const round = (n: number) => Math.round(n * 1000) / 1000;
const eps = 0.003;
const issue = 'Операция затрагивает проём. Переместите или удалите его отдельным действием.';
export function contains(points: Point[], p: Point) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i],
            b = points[j];
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
            inside = !inside;
    }
    return inside;
}
const polygonArea = (points: Point[]) =>
    Math.abs(
        points.reduce((sum, p, i) => {
            const q = points[(i + 1) % points.length];
            return sum + p.x * q.y - q.x * p.y;
        }, 0),
    );
export function nestedRoom(inner: Graph, outer: Graph) {
    const polygon = roomPath(outer, outer.rooms[0]),
        points = roomPath(inner, inner.rooms[0]);
    return (
        polygonArea(points) < polygonArea(polygon) - 0.01 &&
        points.every(
            (p) =>
                contains(polygon, p) ||
                outer.edges.some(
                    (e) => distance(p, wallProject(p, e, vertexIndex(outer)).point) < 0.006,
                ),
        )
    );
}
export function placementMode(before: Graph, incoming: Graph): RoomMode | undefined {
    const sources = roomSources(before);
    if (
        before.rooms.some((r) =>
            nestedRoom(incoming, {
                ...before,
                rooms: [r],
                edges: before.edges.filter((e) =>
                    r.loop.some(
                        (v, i) =>
                            (e.a === v && e.b === r.loop[(i + 1) % r.loop.length]) ||
                            (e.b === v && e.a === r.loop[(i + 1) % r.loop.length]),
                    ),
                ),
            }),
        )
    )
        return 'partition';
    if (sources.some((s) => nestedRoom(incoming, s.graph) || nestedRoom(s.graph, incoming)))
        return 'partition';
    const points = roomPath(incoming, incoming.rooms[0]);
    const strict = (g: Graph, p: Point) =>
        contains(roomPath(g, g.rooms[0]), p) &&
        !g.edges.some((e) => distance(p, wallProject(p, e, vertexIndex(g)).point) < 0.006);
    const overlaps = sources.some(
        (s) =>
            points.some((p) => strict(s.graph, p)) ||
            roomPath(s.graph, s.graph.rooms[0]).some((p) => strict(incoming, p)) ||
            incoming.edges.some((a) =>
                s.graph.edges.some((b) =>
                    intersections(a, incoming, b, s.graph).some(
                        ([t, u]) =>
                            t > 1e-6 &&
                            t < 1 - 1e-6 &&
                            u > 1e-6 &&
                            u < 1 - 1e-6 &&
                            Math.abs(
                                implicit(at(a, incoming, Math.max(0, t - 0.0001)), b, s.graph) -
                                    implicit(at(a, incoming, Math.min(1, t + 0.0001)), b, s.graph),
                            ) > 1e-8,
                    ),
                ),
            ),
    );
    return roomOverlap(before, incoming) && !overlaps ? 'partition' : undefined;
}
const priorityCache = new WeakMap<RoomSource[], { index: number; depth: number }[]>();
function sourcePriority(sources: RoomSource[]) {
    const cached = priorityCache.get(sources);
    if (cached) return cached;
    const result = sources
        .map((s, j) => {
            const previous = sources.slice(0, j);
            const covered = (p: Point) =>
                previous.some(
                    (o) =>
                        contains(roomPath(o.graph, o.graph.rooms[0]), p) ||
                        o.graph.edges.some(
                            (e) =>
                                distance(p, wallProject(p, e, vertexIndex(o.graph)).point) < 0.006,
                        ),
                );
            const strict = (p: Point) =>
                previous.some(
                    (o) =>
                        contains(roomPath(o.graph, o.graph.rooms[0]), p) &&
                        !o.graph.edges.some(
                            (e) =>
                                distance(p, wallProject(p, e, vertexIndex(o.graph)).point) < 0.006,
                        ),
                );
            let interior = false;
            const enclosed =
                previous.length > 0 &&
                s.graph.edges.every((e) => {
                    const cuts = [
                        0,
                        1,
                        ...previous.flatMap((o) =>
                            o.graph.edges.flatMap((b) =>
                                intersections(e, s.graph, b, o.graph).map(([t]) => t),
                            ),
                        ),
                    ].sort((a, b) => a - b);
                    return cuts.every((t, i) => {
                        const p = at(e, s.graph, t),
                            mid = at(e, s.graph, (t + (cuts[i + 1] ?? t)) / 2);
                        interior ||= strict(p) || strict(mid);
                        return covered(p) && covered(mid);
                    });
                });
            return {
                index: j,
                depth:
                    sources.filter((o) => o !== s && nestedRoom(s.graph, o.graph)).length +
                    Number(enclosed && interior),
            };
        })
        .sort((a, b) => b.depth - a.depth || a.index - b.index);
    priorityCache.set(sources, result);
    return result;
}
function at(edge: Wall, graph: Graph, t: number): Point {
    if (edge.curve) return curvePoint(edge.curve, t);
    const vertices = vertexIndex(graph),
        a = vertices.get(edge.a)!,
        b = vertices.get(edge.b)!;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
function implicit(p: Point, edge: Wall, graph: Graph) {
    if (edge.curve) {
        const c = edge.curve,
            r = (c.rotation * Math.PI) / 180;
        const x = p.x - c.cx,
            y = p.y - c.cy;
        return (
            ((x * Math.cos(r) + y * Math.sin(r)) / c.rx) ** 2 +
            ((-x * Math.sin(r) + y * Math.cos(r)) / c.ry) ** 2 -
            1
        );
    }
    const vertices = vertexIndex(graph),
        a = vertices.get(edge.a)!,
        b = vertices.get(edge.b)!;
    return ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / distance(a, b);
}
/** Root isolation on the parametric axis, followed by bisection; no polygonization is persisted. */
function intersections(a: Wall, ga: Graph, b: Wall, gb: Graph): [number, number][] {
    if (!a.curve && b.curve) return intersections(b, gb, a, ga).map(([t, u]) => [u, t]);
    const coincident =
        a.curve &&
        b.curve &&
        (['cx', 'cy', 'rx', 'ry', 'rotation'] as const).every((k) => a.curve![k] === b.curve![k]);
    if (coincident) {
        const candidates = [
            0,
            1,
            ...[0, 1].map((t) => wallProject(at(b, gb, t), a, vertexIndex(ga)).parameter),
        ];
        return candidates.flatMap((t) => {
            const p = at(a, ga, t),
                q = wallProject(p, b, vertexIndex(gb));
            return distance(p, q.point) < 0.006 ? [[t, q.parameter] as [number, number]] : [];
        });
    }
    const count = a.curve ? Math.max(72, Math.ceil(Math.abs(a.curve.sweep) * 2)) : 1;
    const roots: number[] = [];
    let left = 0,
        fl = implicit(at(a, ga, 0), b, gb);
    for (let i = 1; i <= count; i++) {
        const right = i / count,
            fr = implicit(at(a, ga, right), b, gb);
        if (Math.abs(fl) < 1e-8) roots.push(left);
        if (fl * fr < 0) {
            let lo = left,
                hi = right,
                f = fl;
            for (let n = 0; n < 36; n++) {
                const mid = (lo + hi) / 2,
                    fm = implicit(at(a, ga, mid), b, gb);
                if (fm * f > 0) {
                    lo = mid;
                    f = fm;
                } else hi = mid;
            }
            roots.push((lo + hi) / 2);
        }
        if (i === count && Math.abs(fr) < 1e-8) roots.push(right);
        left = right;
        fl = fr;
    }
    // Collinear axes: their endpoints are the only required cuts.
    if (
        !a.curve &&
        !b.curve &&
        Math.abs(implicit(at(a, ga, 0), b, gb)) < eps &&
        Math.abs(implicit(at(a, ga, 1), b, gb)) < eps
    ) {
        for (const t of [0, 1]) roots.push(wallProject(at(b, gb, t), a, vertexIndex(ga)).t);
    }
    const result: [number, number][] = [];
    for (const t of roots) {
        const p = at(a, ga, t),
            q = wallProject(p, b, vertexIndex(gb));
        if (distance(p, q.point) > 0.006 || result.some(([u]) => Math.abs(u - t) < 1e-6)) continue;
        result.push([t, b.curve ? q.parameter : q.t]);
    }
    return result;
}

export function compileAssembly(assembly: Assembly, floorOnly = false): Graph {
    const { sources, id } = assembly;
    const polygons = sources.map((s) => roomPath(s.graph, s.graph.rooms[0]));
    const sourceOrder = sourcePriority(sources);
    const boundary = (i: number, p: Point) =>
        sources[i].graph.edges.some(
            (e) => distance(p, wallProject(p, e, vertexIndex(sources[i].graph)).point) < 0.006,
        );
    const inside = (i: number, p: Point) => {
        const edges = sources[i].graph.edges;
        if (edges[0]?.curve && edges.every((e) => e.curve?.group === edges[0].curve!.group))
            return implicit(p, edges[0], sources[i].graph) < -1e-7;
        return contains(polygons[i], p) && !boundary(i, p);
    };
    const rows = sources.flatMap((s, source) =>
        s.graph.edges.map((edge, ordinal) => ({ edge, source, ordinal, cuts: [0, 1] })),
    );
    for (let i = 0; i < rows.length; i++)
        for (let j = 0; j < i; j++) {
            const a = rows[i],
                b = rows[j];
            if (a.source === b.source) continue;
            for (const [t, u] of intersections(
                a.edge,
                sources[a.source].graph,
                b.edge,
                sources[b.source].graph,
            )) {
                a.cuts.push(t);
                b.cuts.push(u);
            }
        }
    const result = empty();
    const vertex = (p: Point) => {
        const existing = result.vertices.find((v) => distance(v, p) < 0.006);
        if (existing) return existing.id;
        const v = { id: `${id}-v${result.vertices.length}`, x: round(p.x), y: round(p.y) };
        result.vertices.push(v);
        return v.id;
    };
    const bindings = new Map<string, Opening[]>();
    for (const row of rows) {
        const { edge, source, ordinal } = row,
            graph = sources[source].graph,
            vertices = vertexIndex(graph);
        const cuts = [...new Set(row.cuts.map((t) => Math.round(t * 1e8) / 1e8))].sort(
            (a, b) => a - b,
        );
        const parentLength = wallLength(edge, vertices);
        const openings = (graph.openings ?? []).filter((o) => o.edgeId === edge.id);
        for (let n = 1; n < cuts.length; n++) {
            const start = cuts[n - 1],
                end = cuts[n];
            if (end - start < 1e-7) continue;
            const mid = at(edge, graph, (start + end) / 2);
            const previous = sources.slice(0, source).some((_, i) => inside(i, mid));
            const pa = at(edge, graph, start),
                pb = at(edge, graph, end);
            const size = distance(pa, pb),
                normal = { x: (-(pb.y - pa.y) / size) * 0.1, y: ((pb.x - pa.x) / size) * 0.1 };
            const sides = [
                { x: mid.x + normal.x, y: mid.y + normal.y },
                { x: mid.x - normal.x, y: mid.y - normal.y },
            ];
            const sharedUnion = sources.some(
                (s, i) =>
                    i !== source &&
                    ((i > source && s.mode === 'union') ||
                        (i < source && sources[source].mode === 'union')) &&
                    boundary(i, mid) &&
                    sides.every((p) => inside(source, p) || inside(i, p)),
            );
            const removed =
                !floorOnly &&
                (sharedUnion ||
                    (sources[source].mode === 'trim' && previous) ||
                    sources.some((s, i) => i > source && s.mode === 'union' && inside(i, mid)) ||
                    (sources[source].mode === 'union' && previous));
            const curve = edge.curve && {
                ...edge.curve,
                start: Math.round((edge.curve.start + edge.curve.sweep * start) * 1e6) / 1e6,
                sweep: Math.round(edge.curve.sweep * (end - start) * 1e6) / 1e6,
            };
            const fragment: Wall = {
                ...edge,
                id: `${id}-e${source}x${ordinal}x${n - 1}`,
                a: '',
                b: '',
                ...(curve && { curve }),
            };
            const offsetA = wallProject(pa, edge, vertices).t * parentLength;
            const offsetB = wallProject(pb, edge, vertices).t * parentLength;
            const mapped: Opening[] = [];
            for (const opening of openings) {
                const center = opening.center * parentLength;
                if (center < offsetA - eps || center > offsetB + eps) continue;
                if (
                    removed ||
                    center - opening.width / 2 < offsetA + edge.thickness / 2 - eps ||
                    center + opening.width / 2 > offsetB - edge.thickness / 2 + eps
                )
                    throw new Error(issue);
                mapped.push({
                    ...opening,
                    edgeId: fragment.id,
                    center: Math.round(((center - offsetA) / (offsetB - offsetA)) * 1e8) / 1e8,
                });
            }
            if (removed) continue;
            fragment.a = vertex(pa);
            fragment.b = vertex(pb);
            // Shared boundaries keep the first source's material and flags.
            const duplicate = result.edges.find(
                (e) =>
                    ((e.a === fragment.a && e.b === fragment.b) ||
                        (e.a === fragment.b && e.b === fragment.a)) &&
                    distance(at(e, result, 0.5), mid) < 0.006,
            );
            if (duplicate) {
                if (
                    mapped.some(
                        (o) => ![...bindings.values()].flat().some((old) => old.id === o.id),
                    )
                )
                    throw new Error(issue);
                continue;
            }
            result.edges.push(fragment);
            bindings.set(fragment.id, mapped);
        }
    }
    result.openings = [...bindings.values()].flat();
    if (
        result.openings.length !==
        new Set(sources.flatMap((s) => s.graph.openings?.map((o) => o.id) ?? [])).size
    )
        throw new Error(issue);
    const faces = floorFaces(result);
    result.rooms = faces.map((f, i) => ({
        id: `${id}-r${i}`,
        loop: f.loop,
        materialVersionId: null,
    }));
    if (!result.rooms.length) throw new Error('Не удалось построить замкнутый контур помещений.');
    result.floors = [];
    if (floorOnly) {
        // A separate planar subdivision preserves material seams without physical walls.
        // In particular, a source with no floor must not reveal a later overlapping floor.
        result.floors = faces.map((face, i) => {
            const points = face.points;
            let source = -1;
            for (let n = 0; n < points.length; n++) {
                const a = points[n],
                    b = points[(n + 1) % points.length],
                    length = distance(a, b);
                if (length < 0.001) continue;
                const p = {
                    x: (a.x + b.x) / 2 - ((b.y - a.y) / length) * 0.05,
                    y: (a.y + b.y) / 2 + ((b.x - a.x) / length) * 0.05,
                };
                if (!contains(points, p)) continue;
                source = sourceOrder.find(({ index }) => inside(index, p))?.index ?? -1;
                if (source >= 0) break;
            }
            if (source < 0) throw new Error('Не удалось определить материал области пола.');
            return {
                id: `${id}-f${i}`,
                points,
                materialVersionId: sources[source].graph.rooms[0].materialVersionId,
            };
        });
    } else result.floors = compileAssembly(assembly, true).floors;
    const error = openingsError(result);
    if (error) throw new Error(error);
    return result;
}

export function rebuildAssemblies(graph: Graph): Graph {
    if (!graph.assemblies?.length) return graph;
    const prefixes = graph.assemblies.map((a) => a.id + '-');
    const owned = (id: string) => prefixes.some((p) => id.startsWith(p));
    const result: Graph = {
        ...graph,
        edges: graph.edges.filter((e) => !owned(e.id)),
        rooms: graph.rooms.filter((r) => !owned(r.id)),
        vertices: graph.vertices.filter((v) => !owned(v.id)),
        openings: graph.openings?.filter((o) => !owned(o.edgeId)),
        floors: graph.floors?.filter((f) => !owned(f.id)) ?? [],
    };
    for (const assembly of graph.assemblies) {
        const compiled = compileAssembly(assembly);
        result.vertices.push(...compiled.vertices);
        result.edges.push(...compiled.edges);
        result.rooms.push(...compiled.rooms);
        result.openings = [...(result.openings ?? []), ...(compiled.openings ?? [])];
        result.floors!.push(...compiled.floors!);
    }
    return result.edges.some((e) => !owned(e.id)) ? connectJunctions(result, graph) : result;
}

function roomSources(graph: Graph): RoomSource[] {
    const sources = graph.assemblies?.flatMap((a) => a.sources) ?? [];
    for (const room of graph.rooms.filter(
        (r) => !graph.assemblies?.some((a) => r.id.startsWith(a.id + '-')),
    )) {
        const edges = graph.edges.filter((e) =>
            room.loop.some(
                (v, i) =>
                    (e.a === v && e.b === room.loop[(i + 1) % room.loop.length]) ||
                    (e.b === v && e.a === room.loop[(i + 1) % room.loop.length]),
            ),
        );
        sources.push({
            mode: 'partition',
            graph: {
                vertices: graph.vertices.filter((v) => room.loop.includes(v.id)),
                edges,
                rooms: [room],
                openings: graph.openings?.filter((o) => edges.some((e) => e.id === o.edgeId)),
            },
        });
    }
    return sources;
}
export function roomOverlap(before: Graph, incoming: Graph) {
    if (!incoming.rooms.length) return false;
    const polygon = roomPath(incoming, incoming.rooms[0]);
    return roomSources(before).some((s) => {
        const p = roomPath(s.graph, s.graph.rooms[0]);
        if (polygon.some((v) => contains(p, v)) || p.some((v) => contains(polygon, v))) return true;
        return incoming.edges.some((a) =>
            s.graph.edges.some((b) => {
                const cuts = intersections(a, incoming, b, s.graph);
                return (
                    cuts.some(([t, u]) => t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) ||
                    (cuts.length > 1 &&
                        distance(at(a, incoming, cuts[0][0]), at(a, incoming, cuts.at(-1)![0])) >
                            0.006)
                );
            }),
        );
    });
}
export function attachRoom(before: Graph, incoming: Graph, mode: RoomMode): Graph {
    const all = roomSources(before);
    const involved = new Set(all.filter((s) => roomOverlap(s.graph, incoming)));
    let changed = true;
    while (changed) {
        const count = involved.size;
        for (const a of before.assemblies ?? [])
            if (a.sources.some((s) => involved.has(s))) for (const s of a.sources) involved.add(s);
        const vertices = new Set([...involved].flatMap((s) => s.graph.vertices.map((v) => v.id)));
        for (const s of all) if (s.graph.vertices.some((v) => vertices.has(v.id))) involved.add(s);
        changed = count !== involved.size;
    }
    const sources = all.filter((s) => involved.has(s));
    const replaced = before.assemblies?.filter((a) => a.sources.some((s) => involved.has(s))) ?? [];
    const taken = new Set(sources.flatMap((s) => s.graph.edges.map((e) => e.id)));
    const roomIds = new Set(sources.map((s) => s.graph.rooms[0].id));
    const prefixes = replaced.map((a) => a.id + '-');
    const base: Graph = {
        ...before,
        assemblies: before.assemblies?.filter((a) => !replaced.includes(a)) ?? [],
        floors: before.floors?.filter((f) => !prefixes.some((p) => f.id.startsWith(p))) ?? [],
        rooms: before.rooms.filter(
            (r) => !roomIds.has(r.id) && !prefixes.some((p) => r.id.startsWith(p)),
        ),
        edges: before.edges.filter(
            (e) => !taken.has(e.id) && !prefixes.some((p) => e.id.startsWith(p)),
        ),
        openings: before.openings?.filter(
            (o) => !taken.has(o.edgeId) && !prefixes.some((p) => o.edgeId.startsWith(p)),
        ),
    };
    const used = new Set(base.edges.flatMap((e) => [e.a, e.b]));
    base.vertices = base.vertices.filter((v) => used.has(v.id));
    const assembly: Assembly = {
        id: replaced[0]?.id ?? 'a' + crypto.randomUUID().replaceAll('-', '').slice(0, 12),
        sources: [...sources, { mode, graph: incoming }],
    };
    return rebuildAssemblies({ ...base, assemblies: [...base.assemblies!, assembly] });
}

export function movedRoom(
    before: Graph,
    moved: Graph,
    selection?: Selection,
): { before: Graph; incoming: Graph } | undefined {
    const group =
        selection?.kind === 'edge'
            ? before.edges.find((e) => e.id === selection.id)?.curve?.group
            : undefined;
    const room = before.rooms.find(
        (r) =>
            (selection?.kind === 'room' && r.id === selection.id) ||
            (group &&
                r.loop.every((v) =>
                    before.edges.some((e) => e.curve?.group === group && e.a === v),
                )),
    );
    if (!room || before.assemblies?.some((a) => room.id.startsWith(a.id + '-'))) return;
    const source = roomSources(before).find((s) => s.graph.rooms[0].id === room.id);
    if (!source) return;
    const edgeIds = new Set(source.graph.edges.map((e) => e.id));
    // Existing shared room vertices use the ordinary connected-wall transform.
    if (before.rooms.some((r) => r.id !== room.id && r.loop.some((v) => room.loop.includes(v))))
        return;
    const incoming: Graph = {
        vertices: moved.vertices.filter((v) => room.loop.includes(v.id)),
        edges: moved.edges.filter((e) => edgeIds.has(e.id)),
        rooms: [room],
        openings: moved.openings?.filter((o) => edgeIds.has(o.edgeId)),
    };
    const base: Graph = {
        ...before,
        rooms: before.rooms.filter((r) => r.id !== room.id),
        edges: before.edges.filter((e) => !edgeIds.has(e.id)),
        openings: before.openings?.filter((o) => !edgeIds.has(o.edgeId)),
    };
    const used = new Set(base.edges.flatMap((e) => [e.a, e.b]));
    base.vertices = base.vertices.filter((v) => used.has(v.id));
    return roomOverlap(base, incoming) ? { before: base, incoming } : undefined;
}

/** Persist aperture location on the original axis, rather than on a disposable fragment. */
export function syncAssemblyOpenings(graph: Graph): Graph {
    if (!graph.assemblies?.length) return graph;
    const assemblies = graph.assemblies.map((a) => ({
        ...a,
        sources: a.sources.map((s, si) => {
            const openings: Opening[] = [];
            s.graph.edges.forEach((edge, ei) => {
                const parentVertices = vertexIndex(s.graph);
                for (const o of graph.openings ?? []) {
                    if (!o.edgeId.startsWith(`${a.id}-e${si}x${ei}x`)) continue;
                    const fragment = graph.edges.find((e) => e.id === o.edgeId);
                    if (!fragment) throw new Error(issue);
                    const p = wallPoint(fragment, vertexIndex(graph), o.center);
                    openings.push({
                        ...o,
                        edgeId: edge.id,
                        center: wallProject(p, edge, parentVertices).t,
                    });
                }
            });
            return { ...s, graph: { ...s.graph, openings } };
        }),
    }));
    return { ...graph, assemblies };
}

export function translateAssembly(
    graph: Graph,
    ids: Set<string>,
    delta: Point,
    translate: (g: Graph, ids: Set<string>, delta: Point) => Graph,
    selection?: Selection,
): Graph | undefined {
    if (!round(delta.x) && !round(delta.y)) return graph;
    if (
        !graph.assemblies?.some((a) =>
            graph.edges.some((e) => e.id.startsWith(a.id + '-') && ids.has(e.a) && ids.has(e.b)),
        )
    )
        return;
    const synced = syncAssemblyOpenings(graph);
    const selectedOutside = new Set(
        selection?.kind === 'edge'
            ? [selection.id]
            : selection?.kind === 'edges'
              ? selection.ids
              : [],
    );
    const detached = selection ? detachRoomWalls(synced, ids, selectedOutside) : synced;
    const direct = translate({ ...detached, assemblies: undefined }, ids, delta);
    const explicit = selection
        ? new Set(
              selection.kind === 'edge'
                  ? [selection.id]
                  : selection.kind === 'edges'
                    ? selection.ids
                    : selection.kind === 'room'
                      ? graph.edges
                            .filter((e) => {
                                const room = graph.rooms.find((r) => r.id === selection.id);
                                return room?.loop.some(
                                    (v, i) =>
                                        (e.a === v &&
                                            e.b === room.loop[(i + 1) % room.loop.length]) ||
                                        (e.b === v &&
                                            e.a === room.loop[(i + 1) % room.loop.length]),
                                );
                            })
                            .map((e) => e.id)
                      : [],
          )
        : undefined;
    const next = {
        ...direct,
        assemblies: synced.assemblies!.map((a) => ({
            ...a,
            sources: a.sources.map((s, si) => {
                const fragments = graph.edges.filter((e) => e.id.startsWith(`${a.id}-e${si}x`));
                const selected = explicit
                    ? fragments.length > 0 &&
                      (selection?.kind === 'room'
                          ? fragments.every((e) => explicit.has(e.id))
                          : fragments.some((e) => explicit.has(e.id)))
                    : fragments.some((e) => ids.has(e.a) && ids.has(e.b));
                return selected
                    ? {
                          ...s,
                          graph: translate(
                              s.graph,
                              new Set(s.graph.vertices.map((v) => v.id)),
                              delta,
                          ),
                      }
                    : s;
            }),
        })),
    };
    next.assemblies = next.assemblies.map((a, i) => ({
        ...a,
        sources: positionedSources(
            a.sources,
            new Set(
                a.sources.flatMap((s, j) =>
                    s.graph !== synced.assemblies![i].sources[j].graph ? [j] : [],
                ),
            ),
        ),
    }));
    return rebuildAssemblies(next);
}

export function positionedSources(sources: RoomSource[], changed: Set<number>): RoomSource[] {
    return sources.map((s, i) =>
        changed.has(i) && sources.some((o, j) => i !== j && nestedRoom(s.graph, o.graph))
            ? { ...s, mode: 'partition' }
            : s,
    );
}

export function syncAssemblySurfaces(graph: Graph): Graph {
    if (!graph.assemblies?.length) return graph;
    const result = syncAssemblyOpenings(graph);
    const compiled = rebuildAssemblies(result);
    result.assemblies = result.assemblies!.map((a) => ({
        ...a,
        sources: a.sources.map((s, si) => {
            const edges = s.graph.edges.map((e, ei) => {
                const fragments = graph.edges.filter((f) =>
                    f.id.startsWith(`${a.id}-e${si}x${ei}x`),
                );
                const changed = fragments.find((f) => {
                    const original = compiled.edges.find((o) => o.id === f.id);
                    return (
                        original &&
                        [
                            'thickness',
                            'materialVersionId',
                            'blocksMovement',
                            'blocksVision',
                            'blocksLight',
                        ].some((k) => f[k as keyof Wall] !== original[k as keyof Wall])
                    );
                });
                if (!changed) return e;
                const { thickness, materialVersionId, blocksMovement, blocksVision, blocksLight } =
                    changed;
                return {
                    ...e,
                    thickness,
                    materialVersionId,
                    blocksMovement,
                    blocksVision,
                    blocksLight,
                };
            });
            return {
                ...s,
                graph: {
                    ...s.graph,
                    edges,
                    rooms: s.graph.rooms,
                },
            };
        }),
    }));
    return rebuildAssemblies(result);
}

export function reshapeAssembly(
    graph: Graph,
    group: string,
    patch: Partial<NonNullable<Wall['curve']>>,
    reshape: (g: Graph, group: string, patch: Partial<NonNullable<Wall['curve']>>) => Graph,
): Graph | undefined {
    if (
        !graph.assemblies?.some((a) =>
            a.sources.some((s) => s.graph.edges.some((e) => e.curve?.group === group)),
        )
    )
        return;
    const synced = syncAssemblyOpenings(graph);
    return rebuildAssemblies({
        ...synced,
        assemblies: synced.assemblies!.map((a) => ({
            ...a,
            sources: positionedSources(
                a.sources.map((s) => ({ ...s, graph: reshape(s.graph, group, patch) })),
                new Set(
                    a.sources.flatMap((s, i) =>
                        s.graph.edges.some((e) => e.curve?.group === group) ? [i] : [],
                    ),
                ),
            ),
        })),
    });
}

export function drawRoomPreview(graph: Graph, g: import('pixi.js').Graphics, zoom: number) {
    for (const room of graph.rooms)
        g.poly(roomPath(graph, room).flatMap((p) => [p.x, p.y])).fill({
            color: 0x83dfc8,
            alpha: 0.16,
        });
    const vertices = vertexIndex(graph);
    for (const e of graph.edges)
        g.poly(
            wallPath(e, vertices).flatMap((p) => [p.x, p.y]),
            false,
        ).stroke({ color: 0x83dfc8, width: Math.max(e.thickness, 2 / zoom), alpha: 0.8 });
}

export function assemblyFloorAt(graph: Graph, point: Point) {
    for (const assembly of graph.assemblies ?? []) {
        const order = sourcePriority(assembly.sources);
        for (const { index } of order) {
            const source = assembly.sources[index],
                points = roomPath(source.graph, source.graph.rooms[0]);
            if (contains(points, point)) return { assembly, index, points };
        }
    }
}

export function fillAssemblyFloor(
    graph: Graph,
    point: Point,
    materialVersionId: string | null,
): Graph | undefined {
    const hit = assemblyFloorAt(graph, point);
    if (!hit) return;
    return rebuildAssemblies({
        ...graph,
        assemblies: graph.assemblies!.map((a) =>
            a.id !== hit.assembly.id
                ? a
                : {
                      ...a,
                      sources: a.sources.map((s, i) =>
                          i !== hit.index
                              ? s
                              : {
                                    ...s,
                                    graph: {
                                        ...s.graph,
                                        rooms: s.graph.rooms.map((r) => ({
                                            ...r,
                                            materialVersionId,
                                        })),
                                    },
                                },
                      ),
                  },
        ),
    });
}
