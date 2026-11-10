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
import { buildSnap } from './buildSnap';

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
    it('snaps to a vertex, midpoint or wall axis before the grid at both editor zooms', () => {
        for (const zoom of [0.5, 1]) {
            const graph = room();
            const target = (x: number, y: number) =>
                buildSnap({ x, y }, graph, grid, zoom, true, [], { lock: false, bypass: false });
            expect(target(66, 74).kind).toBe('vertex');
            expect(target(127, 70 + 6 / zoom)).toEqual({
                kind: 'midpoint',
                point: { x: 125, y: 70 },
            });
            expect(target(155, 70 + 6 / zoom)).toMatchObject({
                kind: 'edge',
                point: { x: 155, y: 70 },
            });
            expect(target(245, 70).kind).toBe('grid');
        }
    });

    it('projects onto relative guides and lets Shift and Alt compose independently', () => {
        const target = (x: number, y: number, lock = false, bypass = false) =>
            buildSnap(
                { x, y },
                emptyGraph,
                grid,
                1,
                true,
                [
                    { x: 200, y: 100 },
                    { x: 300, y: 150 },
                ],
                { lock, bypass },
            );
        expect(target(402, 200)).toMatchObject({ guide: { kind: 'parallel' } });
        expect(target(251, 250)).toMatchObject({ guide: { kind: 'perpendicular' } });
        expect(target(425, 152)).toMatchObject({ guide: { kind: 'horizontal' } });
        expect(target(425, 152, false, true)).toEqual({ point: { x: 425, y: 152 }, kind: 'free' });
        const locked = target(396, 216, true, true);
        expect(locked.guide).toMatchObject({ kind: 'diagonal', locked: true });
        expect(locked.point.x - 300).toBeCloseTo(locked.point.y - 150);
    });

    it('extends a second room along a split wall while preserving openings and their world positions', () => {
        const original = room();
        const edge = original.edges[0];
        const door = openingOn(edge, 'door', 0.25, 14);
        const window = openingOn(edge, 'window', 0.75, 14);
        const graph = { ...original, openings: [door, window] };
        const branch = build(
            graph,
            [
                { x: 125, y: 70 },
                { x: 125, y: 30 },
            ],
            defaultBuild,
            false,
        );
        const annex = build(
            branch,
            [
                { x: 65, y: 30 },
                { x: 185, y: 30 },
                { x: 185, y: 70 },
                { x: 65, y: 70 },
            ],
            defaultBuild,
            true,
        );
        expect(annex.rooms.map((r) => r.loop.length)).toEqual([5, 6]);
        expect(annex.edges).toHaveLength(10);
        expect(annex.openings?.map((opening) => opening.id)).toEqual([door.id, window.id]);
        for (const opening of annex.openings ?? []) {
            const parent = annex.edges.find((wall) => wall.id === opening.edgeId)!;
            const vertices = vertexIndex(annex);
            const [a, b] = [vertices.get(parent.a)!, vertices.get(parent.b)!];
            expect(a.x + (b.x - a.x) * opening.center).toBe(opening.type === 'door' ? 95 : 155);
        }
        expect(openingsError(annex)).toBeUndefined();
        expect(graph.openings).toEqual([door, window]);
    });

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
