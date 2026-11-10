import { describe, expect, it, vi } from 'vitest';
import type { Graphics } from 'pixi.js';
import { SceneStore } from '../state/SceneStore';
import { createDemoScene } from '../state/demoScene';
import { BuildSelectionGesture } from './BuildSelectionGesture';
import { selectionAnchors } from './buildAnchors';
import { snapMove, translateStructure, translationError } from './buildSelection';
import { connectJunctions } from './junctions';
import { floorAt, floorFaces, fillFloor, floorSurfaces } from './floorFill';
import {
    build,
    defaultBuild,
    emptyGraph,
    openingOn,
    openingEnds,
    putOpening,
    roomAt,
    vertexIndex,
    type Graph,
} from './model';

const p = (x: number, y: number) => ({ x, y });
const line = (graph: Graph, a: number[], b: number[]) =>
    build(graph, [p(a[0], a[1]), p(b[0], b[1])], defaultBuild, false);
const room = () =>
    build(emptyGraph, [p(100, 100), p(400, 100), p(400, 400), p(100, 400)], defaultBuild, true);
const scene = (graph: Graph) => ({
    ...createDemoScene(),
    tokens: [],
    props: [],
    mapWorld: { bounds: { x: 0, y: 0, width: 1440, height: 1080 } },
    structure: { graph, hash: 'test', materials: [] },
});

describe('architectural wall graph', () => {
    it('creates arbitrary-angle X and T junctions, keeping every wall and the room perimeter', () => {
        const original = room();
        const crossing = line(original, [220, 40], [280, 220]);
        const joint = crossing.vertices.find((v) => v.x === 240 && v.y === 100)!;
        expect(crossing.edges.filter((e) => e.a === joint.id || e.b === joint.id)).toHaveLength(4);
        expect(crossing.rooms[0].loop).toContain(joint.id);
        for (const edge of original.edges)
            expect(crossing.edges.some((e) => e.id === edge.id)).toBe(true);
        const branch = line(crossing, [320, 100], [350, 50]);
        const t = branch.vertices.find((v) => v.x === 320 && v.y === 100)!;
        expect(branch.edges.filter((e) => e.a === t.id || e.b === t.id)).toHaveLength(3);
        expect(original.rooms[0].loop).toHaveLength(4);
        expect(original.edges).toHaveLength(4);
    });

    it('preserves both openings through multiple cuts and rejects a cut through an aperture atomically', () => {
        let graph = line(emptyGraph, [100, 200], [600, 200]);
        const edge = graph.edges[0];
        graph = putOpening(
            putOpening(graph, openingOn(edge, 'door', 0.15, 30)),
            openingOn(edge, 'window', 0.85, 30),
        );
        const ends = graph.openings!.map((o) => openingEnds(edge, vertexIndex(graph), o));
        graph = line(line(graph, [250, 100], [250, 300]), [450, 100], [450, 300]);
        graph.openings!.forEach((o, i) => {
            const wall = graph.edges.find((e) => e.id === o.edgeId)!;
            const next = openingEnds(wall, vertexIndex(graph), o);
            next.forEach((p, j) => {
                expect(p.x).toBeCloseTo(ends[i][j].x);
                expect(p.y).toBeCloseTo(ends[i][j].y);
            });
        });
        const frozen = JSON.stringify(graph);
        expect(() => line(graph, [175, 100], [175, 300])).toThrow(/Разрез/);
        expect(JSON.stringify(graph)).toBe(frozen);
    });

    it('welds a translated endpoint and coalesces coincident walls without keeping duplicates', () => {
        const graph = line(line(emptyGraph, [100, 100], [200, 100]), [300, 200], [400, 250]);
        const moving = new Set([graph.edges[0].a, graph.edges[0].b]);
        const next = connectJunctions(translateStructure(graph, moving, p(100, 100)), graph);
        expect(next.vertices).toHaveLength(3);
        expect(next.edges).toHaveLength(2);
        expect(next.edges[0].b).toBe(next.edges[1].a);
        const overlap = translateStructure(graph, new Set([graph.edges[1].b]), p(-100, -50));
        expect(() => connectJunctions(overlap, graph)).toThrow(/короткой/);
        const duplicate = {
            ...graph,
            edges: [...graph.edges, { ...graph.edges[0], id: 'duplicate' }],
        };
        const normalized=connectJunctions(duplicate);
        expect(normalized.edges).toHaveLength(graph.edges.length);
        expect(normalized.edges.some(e=>e.id===graph.edges[0].id)).toBe(true);
    });

    it('normalizes a moved wall into an X and still rejects bounds, folded rooms and token overlap', () => {
        const graph = line(line(emptyGraph, [100, 100], [500, 100]), [300, 200], [300, 400]);
        const moving = new Set([graph.edges[0].a, graph.edges[0].b]);
        const next = connectJunctions(translateStructure(graph, moving, p(0, 150)), graph);
        expect(next.edges).toHaveLength(4);
        expect(translationError(scene(graph), graph, next, moving)).toBeUndefined();
        expect(
            translationError(
                scene(graph),
                graph,
                translateStructure(graph, moving, p(-100, 0)),
                moving,
            ),
        ).toMatch(/границы/);
        const original = room();
        const ids = new Set([original.vertices[1].id, original.vertices[2].id]);
        expect(
            translationError(
                scene(original),
                original,
                translateStructure(original, ids, p(-350, 0)),
                ids,
            ),
        ).toBeDefined();
    });
});

describe('move anchors and smart snapping', () => {
    it('offers center, corners, side midpoints and arbitrary contour points', () => {
        const graph = room(),
            selection = { kind: 'room' as const, id: graph.rooms[0].id };
        expect(selectionAnchors(graph, selection)).toHaveLength(9);
        expect(selectionAnchors(graph, selection)[0].point).toEqual(p(250, 250));
        const contour = build(
            emptyGraph,
            [p(100, 100), p(400, 180), p(300, 400)],
            defaultBuild,
            true,
        );
        expect(
            selectionAnchors(contour, { kind: 'room', id: contour.rooms[0].id }).some(
                (h) => h.kind === 'contour' && h.point.x === 300,
            ),
        ).toBe(true);
    });

    it('translates the whole room from every anchor, including Shift held at pointer-down', () => {
        for (const zoom of [0.5, 1])
            for (const anchorIndex of [0, 1, 5]) {
                const graph = room();
                const store = new SceneStore(scene(graph), 'gm');
                store.setMapEditor({
                    backgroundVisible: true,
                    objectsVisible: true,
                    objectsLocked: true,
                });
                store.spatial.setTool('build');
                const selection = { kind: 'room' as const, id: graph.rooms[0].id };
                store.selectStructure(selection);
                const save = vi.spyOn(store, 'saveStructure');
                const gesture = new BuildSelectionGesture(
                    store,
                    {} as Graphics,
                    () => {},
                    () => {},
                );
                const start = selectionAnchors(graph, selection)[anchorIndex].point;
                gesture.down(start, zoom, { lock: true, bypass: true });
                gesture.up(p(start.x + 90, start.y + 80), zoom, { lock: true, bypass: true });
                expect(save).toHaveBeenCalledTimes(1);
                const next = save.mock.calls[0][0];
                for (const v of graph.vertices)
                    expect(next.vertices.find((p) => p.id === v.id)).toMatchObject({
                        x: v.x + 85,
                        y: v.y + 85,
                    });
            }
    });

    it('snaps to stationary vertices, midpoints and axes at both zooms; Alt bypasses, Shift constrains', () => {
        const graph = line(line(emptyGraph, [100, 100], [200, 100]), [400, 200], [600, 200]);
        const ids = new Set([graph.edges[0].a, graph.edges[0].b]);
        for (const zoom of [0.5, 1]) {
            const target = (delta: { x: number; y: number }, lock = false, bypass = false) =>
                snapMove(scene(graph), graph, ids, delta, zoom, true, p(100, 100), {
                    lock,
                    bypass,
                });
            expect(target(p(298, 98))).toMatchObject({ kind: 'vertex', delta: p(300, 100) });
            expect(target(p(398, 98))).toMatchObject({ kind: 'midpoint', delta: p(400, 100) });
            expect(target(p(350, 98))).toMatchObject({ kind: 'edge', delta: p(350, 100) });
            expect(target(p(298, 98), false, true)).toEqual({ delta: p(298, 98) });
            const locked = target(p(120, 98), true, false).delta;
            expect(locked.x).toBeCloseTo(locked.y);
        }
    });
});

describe('floor paint on closed wall faces', () => {
    it('previews and fills a wall-only enclosure; changes material without duplicating the room', () => {
        const graph = { ...room(), rooms: [] };
        const face = floorAt(floorFaces(graph), p(250, 250))!;
        expect(face.loop).toHaveLength(4);
        const painted = fillFloor(graph, face, '12');
        const repainted = fillFloor(painted, floorAt(floorFaces(painted), p(250, 250))!, '13');
        expect(repainted.rooms).toHaveLength(1);
        expect(repainted.rooms[0]).toMatchObject({
            id: painted.rooms[0].id,
            materialVersionId: '13',
        });
        expect(fillFloor(repainted, floorFaces(repainted)[0], '13')).toBe(repainted);
        expect(
            fillFloor(repainted, floorFaces(repainted)[0], null).rooms[0].materialVersionId,
        ).toBeNull();
        expect(graph.rooms).toEqual([]);
    });

    it('fills the hovered face independently after a partition, ignores dangling walls and excludes open space', () => {
        let graph = line(room(), [250, 100], [250, 400]);
        graph = line(graph, [100, 250], [180, 260]);
        const faces = floorFaces(graph);
        expect(faces).toHaveLength(2);
        const left = floorAt(faces, p(150, 200))!,
            right = floorAt(faces, p(350, 200))!;
        expect(left).not.toBe(right);
        expect(left.points.every((p) => p.x <= 250)).toBe(true);
        const outer = {
            ...graph,
            rooms: graph.rooms.map((r) => ({ ...r, materialVersionId: '10' })),
        };
        const painted = fillFloor(outer, floorAt(floorFaces(outer), p(150, 200))!, '12');
        expect(
            floorSurfaces({ ...painted, rooms: [...painted.rooms].reverse() }).map(
                (s) => s.room.materialVersionId,
            ),
        ).toEqual(['10', '12']);
        for (const rooms of [painted.rooms, [...painted.rooms].reverse()]) {
            expect(roomAt({ ...painted, rooms }, p(150, 200))?.materialVersionId).toBe('12');
            expect(roomAt({ ...painted, rooms }, p(350, 200))?.materialVersionId).toBe('10');
        }
        expect(floorAt(faces, p(50, 50))).toBeUndefined();
        expect(floorFaces(line(emptyGraph, [100, 100], [200, 200]))).toEqual([]);
    });

    it('handles concave contours and explicitly refuses an area with an unsupported hole', () => {
        let graph = build(
            emptyGraph,
            [p(100, 100), p(500, 100), p(500, 200), p(200, 200), p(200, 500), p(100, 500)],
            defaultBuild,
            true,
        );
        expect(floorAt(floorFaces(graph), p(400, 400))).toBeUndefined();
        expect(floorAt(floorFaces(graph), p(150, 400))).toBeDefined();
        graph = build(
            room(),
            [p(200, 200), p(300, 200), p(300, 300), p(200, 300)],
            defaultBuild,
            true,
        );
        const outside = floorAt(floorFaces(graph), p(150, 150))!;
        expect(() => fillFloor(graph, outside, '12')).toThrow(/внутренний/);
        expect(
            fillFloor(graph, floorAt(floorFaces(graph), p(250, 250))!, '12').rooms[1]
                .materialVersionId,
        ).toBe('12');
    });
});
