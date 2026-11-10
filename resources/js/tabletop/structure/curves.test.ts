import { describe, expect, it } from 'vitest';
import {
    dragCurve,
    buildCurve,
    curveFromGesture,
    curvePoint,
    curveSteps,
    reshapeCurve,
    roomPath,
    wallLength,
    wallPath,
    wallPoint,
    wallProject,
} from './curves';
import {
    build,
    defaultBuild,
    emptyGraph,
    openingOn,
    openingsError,
    openingEnds,
    putOpening,
    roomAt,
    remove,
    splitEdge,
    vertexIndex,
    wallRuns,
} from './model';
import {
    moveVertices,
    selectedWalls,
    translateStructure,
    translationError,
} from './buildSelection';
import type { Scene } from '../types/scene';
import fixture from '../../../../tests/Fixtures/curved-walls.json';
import { movementBlocked, movementObstacles } from '../utils/movement';

describe('parametric Build curves', () => {
    const settings = { ...defaultBuild, gridSnap: false };
    const ellipse = () =>
        buildCurve(
            emptyGraph,
            {
                ...curveFromGesture('ellipse', { x: 360, y: 300 }, { x: 500, y: 390 }),
                rotation: 25,
            },
            settings,
            true,
        );
    it('shares tessellation coordinates and round joins with the PHP geometry fixture', () => {
        const graph = ellipse(),
            vertices = vertexIndex(graph);
        const runs = graph.edges.flatMap((e) => wallRuns(e, vertices, []));
        expect(runs).toHaveLength(fixture.runs.length);
        runs.forEach((run, i) => {
            expect(run.a.x).toBeCloseTo(fixture.runs[i].a.x, 7);
            expect(run.a.y).toBeCloseTo(fixture.runs[i].a.y, 7);
            expect(run.b.x).toBeCloseTo(fixture.runs[i].b.x, 7);
            expect(run.b.y).toBeCloseTo(fixture.runs[i].b.y, 7);
            expect(run.roundA && run.roundB).toBe(true);
        });
        expect(roomPath(graph, graph.rooms[0])).toHaveLength(72);
        expect(roomAt(graph, { x: 360, y: 300 })?.id).toBe(graph.rooms[0].id);
        expect(roomAt(graph, { x: 500, y: 390 })).toBeUndefined();
    });
    it('preserves shape, wall IDs, openings and attached straight vertices when resized and moved', () => {
        let graph = ellipse();
        const edge = graph.edges[0],
            group = edge.curve!.group;
        graph = build(graph, [graph.vertices[0], { x: 650, y: 360 }], settings, false);
        graph = putOpening(graph, openingOn(edge, 'door', 0.5, 40));
        const next = reshapeCurve(graph, group, { rx: 160, rotation: 30 });
        expect(openingsError(next)).toBeUndefined();
        expect(next.openings).toEqual(graph.openings);
        expect(next.edges.map((e) => e.id)).toEqual(graph.edges.map((e) => e.id));
        const walls = selectedWalls(next, { kind: 'edge', id: edge.id });
        expect(walls).toHaveLength(4);
        const ids = moveVertices(next, { kind: 'edge', id: edge.id });
        const moved = translateStructure(next, ids, { x: 5, y: 10 });
        expect(moved.edges[0].curve!.cx).toBe(365);
        expect(moved.edges[4].curve).toBeUndefined();
        expect(moved.vertices.find((v) => v.id === next.edges[4].a)!.x).toBe(
            next.vertices[0].x + 5,
        );
        expect(openingsError(reshapeCurve(graph, group, { rx: 16, ry: 16 }))).toBeDefined();
        expect(() =>
            splitEdge(graph, graph.edges[0], wallPoint(graph.edges[0], vertexIndex(graph), 0.5)),
        ).toThrow(/проём/);
    });
    it('connects a straight wall to an interior arc point without losing the parametric floor', () => {
        const graph = ellipse(),
            c = graph.edges[0].curve!,
            point = curvePoint(c, 0.5);
        const next = build(graph, [point, { x: 600, y: 550 }], settings, false);
        expect(next.edges.filter((e) => e.curve)).toHaveLength(5);
        expect(next.rooms[0].loop).toHaveLength(5);
        const joint = next.vertices.find((v) => Math.hypot(v.x - point.x, v.y - point.y) < 0.1)!;
        expect(next.edges.filter((e) => e.a === joint.id || e.b === joint.id)).toHaveLength(3);
        const resized = reshapeCurve(next, c.group, { rx: 150 });
        expect(resized.rooms[0].loop).toEqual(next.rooms[0].loop);
        expect(roomAt(resized, { x: 360, y: 300 })).toBeDefined();
    });
    it('uses the same aperture chord in visible walls and movement, with bounded approximation', () => {
        let graph = ellipse();
        const vertices = vertexIndex(graph),
            edge = graph.edges[0];
        const door = openingOn(edge, 'door', 0.5, 40);
        if (door.type !== 'door') throw new Error('Expected door');
        graph = putOpening(graph, door);
        const [a, b] = openingEnds(edge, vertices, door);
        const run = wallRuns(edge, vertices, [door]).find((r) => r.opening)!;
        expect(run.a).toEqual(a);
        expect(run.b).toEqual(b);
        const path = wallPath(edge, vertices);
        expect(wallLength(edge, vertices)).toBeGreaterThan(
            Math.hypot(path.at(-1)!.x - path[0].x, path.at(-1)!.y - path[0].y),
        );
        for (let i = 1; i < path.length; i++) {
            const midpoint = curvePoint(edge.curve!, (i - 0.5) / curveSteps(edge.curve!));
            const chord = {
                x: (path[i].x + path[i - 1].x) / 2,
                y: (path[i].y + path[i - 1].y) / 2,
            };
            expect(Math.hypot(midpoint.x - chord.x, midpoint.y - chord.y)).toBeLessThan(0.252);
        }
        expect(wallProject(path[7], edge, vertices).parameter).toBeCloseTo(7 / 18, 6);
        const scene = {
            width: 720,
            height: 600,
            mapWorld: {},
            structure: { graph, materials: [], hash: '' },
            tokens: [],
            props: [],
        } as unknown as Scene;
        const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        expect(movementBlocked(center, center, 1, movementObstacles(scene))).toBe(true);
        const open = {
            ...scene,
            structure: { ...scene.structure!, graph: putOpening(graph, { ...door, open: true }) },
        };
        expect(movementBlocked(center, center, 1, movementObstacles(open))).toBe(false);
        const ids = new Set(graph.vertices.map((v) => v.id));
        const invalid = reshapeCurve(graph, edge.curve!.group, { rx: 400 });
        expect(translationError(scene, graph, invalid, ids)).toMatch(/границы/);
    });

    it('keeps open-arc radius, rotation and angular handles parametric', () => {
        const curve = curveFromGesture(
            'arc',
            { x: 300, y: 300 },
            { x: 400, y: 300 },
            { x: 300, y: 400 },
        );
        const graph = buildCurve(emptyGraph, curve, settings, false);
        const radius = dragCurve(graph, curve, 'rx', { x: 420, y: 300 }, false);
        expect(radius.edges[0].curve).toMatchObject({ rx: 120, ry: 120 });
        const rotated = dragCurve(graph, curve, 'rotation', { x: 400, y: 200 }, true);
        expect(rotated.edges[0].curve!.rotation).toBe(45);
        const span = dragCurve(graph, curve, 'end', { x: 200, y: 300 }, false);
        expect(span.edges[0].curve!.sweep).toBe(180);
        expect(span.vertices[1]).toMatchObject({ x: 200, y: 300 });
        const before = dragCurve(graph, curve, 'start', { x: 370.711, y: 370.711 }, true);
        expect(before.edges[0].curve).toMatchObject({ start: 45, sweep: 45 });
    });
    it('joins the snapped radius point of an oblique circle to a straight wall', () => {
        const base = build(
            emptyGraph,
            [
                { x: 400, y: 400 },
                { x: 600, y: 400 },
            ],
            settings,
            false,
        );
        const curve = curveFromGesture('circle', { x: 300, y: 300 }, { x: 450, y: 400 });
        const graph = buildCurve(base, curve, settings, true);
        const joint = graph.vertices.find((v) => Math.hypot(v.x - 450, v.y - 400) < 0.002)!;
        expect(joint).toBeDefined();
        expect(graph.edges.filter((e) => e.a === joint.id || e.b === joint.id)).toHaveLength(4);
    });

    it('selects and deletes a whole parametric curve through a wall or marquee selection', () => {
        const graph = ellipse();
        const selection = { kind: 'edges' as const, ids: [graph.edges[0].id] };
        expect(selectedWalls(graph, selection)).toHaveLength(4);
        expect(remove(graph, selection).edges).toHaveLength(0);
        expect(remove(graph, { kind: 'edge', id: graph.edges[0].id }).rooms).toHaveLength(0);
        expect(remove(graph, { kind: 'room', id: graph.rooms[0].id }).edges).toHaveLength(4);
    });
});
