import type { Graph } from './model';

/** Shared support walls stay where they are when an editable source room leaves them. */
export function detachRoomWalls(
    graph: Graph,
    moving: Set<string>,
    selectedOutside: Set<string> = new Set(),
): Graph {
    const owned = (id: string) => graph.assemblies?.some((a) => id.startsWith(a.id + '-'));
    const outside = graph.edges.filter((e) => !owned(e.id) && !selectedOutside.has(e.id));
    const attached = new Set(outside.flatMap((e) => [e.a, e.b]).filter((id) => moving.has(id)));
    if (!attached.size) return graph;
    const aliases = new Map(
        [...attached].map((id) => [id, 'v' + crypto.randomUUID().replaceAll('-', '')]),
    );
    return {
        ...graph,
        vertices: [
            ...graph.vertices,
            ...graph.vertices
                .filter((v) => attached.has(v.id))
                .map((v) => ({ ...v, id: aliases.get(v.id)! })),
        ],
        edges: graph.edges.map((e) =>
            owned(e.id) || selectedOutside.has(e.id)
                ? e
                : { ...e, a: aliases.get(e.a) ?? e.a, b: aliases.get(e.b) ?? e.b },
        ),
        rooms: graph.rooms.map((r) =>
            owned(r.id) ? r : { ...r, loop: r.loop.map((id) => aliases.get(id) ?? id) },
        ),
    };
}
