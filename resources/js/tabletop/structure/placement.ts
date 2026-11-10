import { structureOf, type Graph, type Opening } from './model';
import type { Scene } from '../types/scene';
import { syncAssemblyOpenings } from './roomAssembly';

export type Placement = {
    opening: Opening;
    anchor: string;
    status: 'pending' | 'confirmed' | 'rejected';
    sent?: boolean;
    error?: string;
};

// Pin the supporting geometry, not the whole graph: other openings may be accepted first.
export function openingAnchor(graph: Graph, edgeId: string) {
    const edge = graph.edges.find((e) => e.id === edgeId);
    return JSON.stringify([
        edge && [
            edge.id,
            edge.a,
            edge.b,
            edge.thickness,
            edge.curve && Object.entries(edge.curve).sort(([a], [b]) => a.localeCompare(b)),
        ],
        ...[edge?.a, edge?.b].map((id) => {
            const vertex = graph.vertices.find((v) => v.id === id);
            return vertex && [vertex.id, vertex.x, vertex.y];
        }),
    ]);
}

export function placementGraph(scene: Scene, placement: Placement): Graph {
    const graph = structureOf(scene);
    if (openingAnchor(graph, placement.opening.edgeId) !== placement.anchor)
        throw new Error('Стена изменилась. Укажите положение проёма заново.');
    if (graph.openings?.some((o) => o.id === placement.opening.id))
        throw new Error('Проём с этим ID уже существует.');
    return syncAssemblyOpenings({
        ...graph,
        openings: [...(graph.openings ?? []), placement.opening],
    });
}
