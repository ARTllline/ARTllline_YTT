import {
    cutOverlapsOpening,
    openingsError,
    putOpening,
    splitEdge,
    vertexIndex,
    type Graph,
    type Opening,
} from './model';
import { wallLength, wallPoint, wallProject } from './curves';
import { rebuildAssemblies, syncAssemblyOpenings } from './roomAssembly';

/** Remove an artificial parametric seam when an aperture straddles it. Real junctions remain protected. */
function bridge(graph: Graph, opening: Opening): Graph | undefined {
    const edge = graph.edges.find((e) => e.id === opening.edgeId);
    if (!edge?.curve) return;
    const vertices = vertexIndex(graph),
        length = wallLength(edge, vertices);
    const left = opening.center * length - opening.width / 2;
    const nearStart = left < edge.thickness / 2;
    const nearEnd = left + opening.width > length - edge.thickness / 2;
    if (nearStart === nearEnd) return;
    const other = graph.edges.find(
        (e) =>
            e.id !== edge.id &&
            e.curve?.group === edge.curve!.group &&
            (nearStart ? e.b === edge.a : e.a === edge.b),
    );
    if (!other?.curve || Math.sign(other.curve.sweep) !== Math.sign(edge.curve.sweep)) return;
    const first = nearStart ? other : edge,
        second = nearStart ? edge : other;
    const joint = first.b;
    if (
        graph.edges.filter((e) => e.a === joint || e.b === joint).length !== 2 ||
        graph.rooms.some((r) => r.loop.includes(joint) && r.loop.length <= 3)
    )
        return;
    const sweep = first.curve!.sweep + second.curve!.sweep;
    if (Math.abs(sweep) >= 359.999) return;
    const merged = { ...first, b: second.b, curve: { ...first.curve!, sweep } };
    const next: Graph = {
        ...graph,
        vertices: graph.vertices.filter((v) => v.id !== joint),
        edges: graph.edges
            .filter((e) => e.id !== second.id)
            .map((e) => (e.id === first.id ? merged : e)),
        rooms: graph.rooms.map((r) => ({ ...r, loop: r.loop.filter((v) => v !== joint) })),
    };
    next.openings = [...(graph.openings ?? []).filter((o) => o.id !== opening.id), opening].map(
        (o) => {
            if (o.edgeId !== first.id && o.edgeId !== second.id) return o;
            const old = graph.edges.find((e) => e.id === o.edgeId)!;
            const p = wallPoint(old, vertices, o.center);
            return { ...o, edgeId: merged.id, center: wallProject(p, merged, vertexIndex(next)).t };
        },
    );
    if (openingsError(next)) return;
    if (!graph.rooms.length) return next;
    // A closed room still needs at least three distinct boundary vertices after clipping.
    // Move the artificial seam into a free part of the merged arc instead of leaving a digon.
    const mergedVertices = vertexIndex(next),
        mergedLength = wallLength(merged, mergedVertices);
    const onMerged = next.openings!.filter((o) => o.edgeId === merged.id);
    for (const t of [0.25, 0.75, 0.125, 0.875]) {
        if (onMerged.some((o) => cutOverlapsOpening(merged, o, mergedLength, t * mergedLength)))
            continue;
        const divided = structuredClone(next);
        divided.openings = divided.openings!.filter((o) => o.edgeId !== merged.id);
        splitEdge(divided, merged, wallPoint(merged, mergedVertices, t));
        const fragments = [divided.edges.find((e) => e.id === merged.id)!, divided.edges.at(-1)!];
        let valid = true;
        for (const o of onMerged) {
            const p = wallPoint(merged, mergedVertices, o.center);
            const candidates = fragments.map((e) => ({
                edge: e,
                projection: wallProject(p, e, vertexIndex(divided)),
            }));
            const owner = candidates.find(({ edge, projection }) => {
                const length = wallLength(edge, vertexIndex(divided));
                return (
                    projection.t * length - o.width / 2 >= edge.thickness / 2 &&
                    projection.t * length + o.width / 2 <= length - edge.thickness / 2
                );
            });
            if (!owner) {
                valid = false;
                break;
            }
            divided.openings.push({ ...o, edgeId: owner.edge.id, center: owner.projection.t });
        }
        if (valid && !openingsError(divided)) return divided;
    }
}

export function prepareCurveAperture(
    graph: Graph,
    opening: Opening,
): { graph: Graph; opening: Opening; joined: boolean } {
    const ordinary = putOpening(graph, opening);
    if (!openingsError(ordinary)) return { graph: ordinary, opening, joined: false };
    for (const assembly of graph.assemblies ?? [])
        for (let si = 0; si < assembly.sources.length; si++) {
            const source = assembly.sources[si];
            const ei = source.graph.edges.findIndex((_, i) =>
                opening.edgeId.startsWith(`${assembly.id}-e${si}x${i}x`),
            );
            if (ei < 0) continue;
            const edge = graph.edges.find((e) => e.id === opening.edgeId)!;
            const p = wallPoint(edge, vertexIndex(graph), opening.center);
            const rawOpening = {
                ...opening,
                edgeId: source.graph.edges[ei].id,
                center: wallProject(p, source.graph.edges[ei], vertexIndex(source.graph)).t,
            };
            const synced = syncAssemblyOpenings(graph);
            const raw = bridge(
                synced.assemblies!.find((a) => a.id === assembly.id)!.sources[si].graph,
                rawOpening,
            );
            if (!raw) break;
            try {
                const next = rebuildAssemblies({
                    ...synced,
                    assemblies: synced.assemblies!.map((a) =>
                        a.id !== assembly.id
                            ? a
                            : {
                                  ...a,
                                  sources: a.sources.map((s, i) =>
                                      i !== si ? s : { ...s, graph: raw },
                                  ),
                              },
                    ),
                });
                return {
                    graph: next,
                    opening: next.openings!.find((o) => o.id === opening.id)!,
                    joined: true,
                };
            } catch {
                break;
            }
        }
    if (!graph.assemblies?.some((a) => opening.edgeId.startsWith(a.id + '-'))) {
        const next = bridge(graph, opening);
        if (next)
            return {
                graph: next,
                opening: next.openings!.find((o) => o.id === opening.id)!,
                joined: true,
            };
    }
    return { graph: ordinary, opening, joined: false };
}
