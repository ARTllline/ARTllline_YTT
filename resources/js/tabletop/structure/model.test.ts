import { describe, expect, it } from 'vitest';
import {
    apertureEnds,
    build,
    defaultBuild,
    emptyGraph,
    emptyHash,
    joinEdges,
    openingOn,
    openingsError,
    putOpening,
    remove,
    reverseEdge,
    snap,
    splitEdge,
    vertexIndex,
    wallRuns,
} from './model';
import type { GridSettings, Scene } from '../types/scene';
import { reduceEvent, type SceneEvent } from '../../realtime/protocol';

const grid = { size: 60, offset: { x: 5, y: 10 }, snap: false } as GridSettings;
const room = () =>
    build(
        emptyGraph,
        [
            { x: 65, y: 70 },
            { x: 185, y: 70 },
            { x: 185, y: 190 },
            { x: 65, y: 190 },
        ],
        defaultBuild,
        true,
    );

describe('structure authoring', () => {
    it('prioritizes existing vertices and edges with a screen-pixel radius and snaps to grid intersections independently', () => {
        const graph = room();
        expect(snap({ x: 68, y: 73 }, graph, grid, 2, false).kind).toBe('vertex');
        expect(snap({ x: 130, y: 74 }, graph, grid, 2, false)).toMatchObject({
            kind: 'edge',
            point: { x: 130, y: 70 },
        });
        expect(snap({ x: 130, y: 74 }, graph, grid, 3, false).kind).toBe('free');
        expect(snap({ x: 246, y: 71 }, graph, grid, 1, true)).toMatchObject({
            kind: 'grid',
            point: { x: 245, y: 70 },
        });
    });

    it('branches onto a room wall, retains the original edge ID and updates the shared floor loop', () => {
        const original = room();
        const graph = build(
            original,
            [
                { x: 125, y: 70 },
                { x: 125, y: 25 },
            ],
            defaultBuild,
            false,
        );
        const split = graph.vertices.find((v) => v.x === 125 && v.y === 70)!;
        expect(graph.edges.find((e) => e.id === original.edges[0].id)?.b).toBe(split.id);
        expect(graph.rooms[0].loop[1]).toBe(split.id);
        expect(graph.edges).toHaveLength(6);
        expect(remove(graph, { kind: 'vertex', id: split.id }).rooms).toEqual([]);
        expect(remove(graph, { kind: 'room', id: graph.rooms[0].id }).edges).toEqual(graph.edges);
        expect(original.rooms[0].loop).toHaveLength(4);
    });

    it('updates both winding directions of a shared room edge on split', () => {
        const graph = room();
        const [a, b] = graph.vertices;
        graph.rooms.push({
            ...graph.rooms[0],
            id: 'reverse',
            loop: [...graph.rooms[0].loop].reverse(),
        });
        const v = splitEdge(graph, graph.edges[0], { x: 125, y: 70 });
        expect(graph.rooms[0].loop.slice(0, 3)).toEqual([a.id, v.id, b.id]);
        expect(graph.rooms[1].loop.slice(-3)).toEqual([b.id, v.id, a.id]);
    });

    it('preserves apertures and shared floor loops across split, reverse and join', () => {
        let graph = room();
        const [a, b] = graph.vertices;
        const edge = graph.edges[0];
        const door = openingOn(edge, 'door', 0.25, 24);
        const window = openingOn(edge, 'window', 0.75, 24);
        graph = putOpening(putOpening(graph, door), window);
        const [left, right] = apertureEnds(a, b, door);
        expect(wallRuns(edge, vertexIndex(graph), graph.openings!)[0]).toMatchObject({
            b: left,
            roundA: true,
            roundB: false,
        });
        expect(() => splitEdge(graph, edge, { x: 95, y: 70 })).toThrow('Разрез');
        expect(graph.edges).toHaveLength(4);
        expect(openingsError(remove(graph, { kind: 'edge', id: edge.id }))).toContain(
            'Сначала удалите',
        );
        const split = splitEdge(graph, edge, { x: 125, y: 70 });
        graph = reverseEdge(graph, graph.edges[0]);
        expect(graph.openings?.[0]).toMatchObject({
            ...door,
            center: 0.5,
            hinge: 'b',
            direction: 'right',
        });
        expect(apertureEnds(split, a, graph.openings![0])).toEqual([right, left]);
        const joined = joinEdges(graph, split.id);
        expect(joined.graph.openings).toEqual([door, window]);
        expect(joined.graph.rooms[0].loop).toEqual(
            room().rooms[0].loop.map((_, i) => graph.vertices[i].id),
        );
        expect(openingsError(joined.graph)).toBeUndefined();
    });

    it('applies ordered incremental edits and requests recovery for a mismatched graph hash', () => {
        const graph = room();
        const scene = { id: '1', revision: 1, tokens: [] } as unknown as Scene;
        const event: SceneEvent = {
            type: 'structure.updated',
            sceneId: '1',
            revision: 2,
            mutationId: 'first',
            payload: {
                structurePatch: {
                    base: emptyHash,
                    hash: 'room',
                    materials: [],
                    vertices: { upsert: graph.vertices, remove: [] },
                    edges: { upsert: graph.edges, remove: [] },
                    rooms: { upsert: graph.rooms, remove: [] },
                },
            },
        };
        expect(reduceEvent(scene, event)).toMatchObject({
            revision: 2,
            structure: { hash: 'room', graph: { rooms: graph.rooms } },
        });
        expect(
            reduceEvent(
                { ...scene, structure: { hash: 'other', graph: emptyGraph, materials: [] } },
                event,
            ),
        ).toBe('gap');
    });
});
