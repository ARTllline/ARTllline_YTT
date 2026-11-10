import { describe, it, expect } from 'vitest';
import {
    attachRoom,
    compileAssembly,
    contains,
    fillAssemblyFloor,
    movedRoom,
    placementMode,
    roomOverlap,
    syncAssemblyOpenings,
    rebuildAssemblies,
} from './roomAssembly';
import { build, defaultBuild, emptyGraph, openingOn, openingsError, vertexIndex } from './model';
import { buildCurve, curvePoint, reshapeCurve, roomPath, wallPoint } from './curves';
import { floorSurfaces } from './floorFill';
import { prepareCurveAperture } from './curveAperture';
import { translateStructure } from './buildSelection';

const rect = () =>
    build(
        emptyGraph,
        [
            { x: 100, y: 100 },
            { x: 500, y: 100 },
            { x: 500, y: 500 },
            { x: 100, y: 500 },
        ],
        { ...defaultBuild, floor: '1' },
        true,
    );
const circle = (cx = 500, cy = 300, rx = 120, ry = rx, rotation = 0) =>
    buildCurve(
        emptyGraph,
        {
            group: 'circle',
            kind: rx === ry ? 'circle' : 'ellipse',
            cx,
            cy,
            rx,
            ry,
            start: 0,
            sweep: 360,
            rotation,
        },
        { ...defaultBuild, floor: '2' },
        true,
    );
describe('room assemblies', () => {
    it('places a room across a material seam inside an already merged room', () => {
        const parent = attachRoom(rect(), circle(), 'union');
        const child = build(
            emptyGraph,
            [
                { x: 350, y: 270 },
                { x: 550, y: 270 },
                { x: 550, y: 330 },
                { x: 350, y: 330 },
            ],
            { ...defaultBuild, floor: '3' },
            true,
        );
        expect(placementMode(parent, child)).toBe('partition');
        const graph = attachRoom(parent, child, 'partition');
        const surfaces = floorSurfaces(graph);
        for (const point of [
            { x: 480, y: 300 },
            { x: 530, y: 300 },
        ])
            expect(
                surfaces.filter((s) => contains(s.points, point)).at(-1)!.room.materialVersionId,
            ).toBe('3');
        const painted = fillAssemblyFloor(graph, { x: 530, y: 300 }, '4')!;
        expect(painted.assemblies![0].sources[2].graph.rooms[0].materialVersionId).toBe('4');
    });
    it('keeps a round source when its center handle is moved fully inside the parent', () => {
        const graph = attachRoom(rect(), circle(), 'union');
        const moved = reshapeCurve(graph, 'circle', { cx: 300, rx: 60 });
        expect(moved.assemblies![0].sources[1].mode).toBe('partition');
        expect(moved.rooms).toHaveLength(2);
        expect(moved.edges.filter((e) => e.curve)).toHaveLength(4);
    });
    it('places a smaller room inside a floored room and layers its floor above the parent', () => {
        const inner = build(
            emptyGraph,
            [
                { x: 200, y: 200 },
                { x: 360, y: 200 },
                { x: 360, y: 360 },
                { x: 200, y: 360 },
            ],
            { ...defaultBuild, floor: '2' },
            true,
        );
        expect(placementMode(rect(), inner)).toBe('partition');
        const graph = attachRoom(rect(), inner, 'partition');
        expect(graph.rooms).toHaveLength(2);
        expect(graph.edges).toHaveLength(8);
        expect(floorSurfaces(graph).map((s) => s.room.materialVersionId)).toEqual(['1', '2']);
        const inherited = fillAssemblyFloor(graph, { x: 280, y: 280 }, null)!;
        // Floor picking targets the innermost source as well.
        expect(inherited.assemblies![0].sources[0].graph.rooms[0].materialVersionId).toBe('1');
    });
    it('moves only the selected source across a shared wall and preserves it inside the parent', () => {
        const inner = build(
            emptyGraph,
            [
                { x: 500, y: 200 },
                { x: 650, y: 200 },
                { x: 650, y: 360 },
                { x: 500, y: 360 },
            ],
            { ...defaultBuild, floor: '2' },
            true,
        );
        expect(placementMode(rect(), inner)).toBe('partition');
        const graph = attachRoom(rect(), inner, 'partition');
        const room = graph.rooms.find((r) => contains(roomPath(graph, r), { x: 600, y: 280 }))!;
        const selectedEdges = graph.edges.filter(
            (e) => room.loop.includes(e.a) && room.loop.includes(e.b),
        );
        const ids = new Set(selectedEdges.flatMap((e) => [e.a, e.b]));
        const moved = translateStructure(
            graph,
            ids,
            { x: -250, y: 0 },
            { kind: 'room', id: room.id },
        );
        expect(moved.assemblies![0].sources[0].graph.vertices).toEqual(
            graph.assemblies![0].sources[0].graph.vertices,
        );
        expect(moved.assemblies![0].sources[1].mode).toBe('partition');
        expect(moved.rooms).toHaveLength(2);
    });
    it('keeps a standalone support wall fixed when a source room leaves it', () => {
        const graph = attachRoom(rect(), circle(), 'union');
        const parent = graph.assemblies![0].sources[0].graph;
        const child = build(
            emptyGraph,
            [
                { x: 650, y: 200 },
                { x: 800, y: 200 },
                { x: 800, y: 350 },
                { x: 650, y: 350 },
            ],
            defaultBuild,
            true,
        );
        const sources = [
            ...graph.assemblies![0].sources,
            { mode: 'partition' as const, graph: child },
        ];
        let base = {
            ...graph,
            assemblies: [{ ...graph.assemblies![0], sources }],
            vertices: [
                ...graph.vertices,
                { id: 'standalone-a', x: 650, y: 200 },
                { id: 'standalone-b', x: 650, y: 350 },
            ],
            edges: [
                ...graph.edges,
                {
                    id: 'standalone',
                    a: 'standalone-a',
                    b: 'standalone-b',
                    thickness: 14,
                    materialVersionId: null,
                },
            ],
        };
        base = rebuildAssemblies(base) as typeof base;
        const room = base.rooms.find((r) => contains(roomPath(base, r), { x: 720, y: 275 }))!;
        const ids = new Set(room.loop);
        const moved = translateStructure(
            base,
            ids,
            { x: 100, y: 0 },
            { kind: 'room', id: room.id },
        );
        const index = vertexIndex(moved);
        expect(
            moved.edges
                .filter((e) => !e.id.startsWith(base.assemblies![0].id + '-'))
                .every((e) => index.get(e.a)!.x === 650 && index.get(e.b)!.x === 650),
        ).toBe(true);
        expect(moved.assemblies![0].sources[0].graph.vertices).toEqual(parent.vertices);
        expect(moved.assemblies![0].sources[0].graph.edges).toEqual(parent.edges);
    });
    it('offers room operations when an existing independent circle is moved into a room', () => {
        const a = rect(),
            b = circle(800);
        const before = {
            ...a,
            vertices: [...a.vertices, ...b.vertices],
            edges: [...a.edges, ...b.edges],
            rooms: [...a.rooms, ...b.rooms],
        };
        const moved = translateStructure(before, new Set(b.vertices.map((v) => v.id)), {
            x: -300,
            y: 0,
        });
        const proposal = movedRoom(before, moved, { kind: 'edge', id: b.edges[0].id })!;
        expect(proposal).toBeDefined();
        const next = attachRoom(proposal.before, proposal.incoming, 'union');
        expect(next.rooms).toHaveLength(1);
        expect(next.assemblies![0].sources[1].graph.rooms[0].id).toBe(b.rooms[0].id);
        expect(next.assemblies![0].sources[1].graph.edges[0].curve!.cx).toBe(500);
    });
    it('keeps unrelated rooms outside the assembly and leaves their identities and floors intact', () => {
        const other = build(
            emptyGraph,
            [
                { x: 900, y: 100 },
                { x: 1100, y: 100 },
                { x: 1100, y: 300 },
                { x: 900, y: 300 },
            ],
            { ...defaultBuild, floor: '9' },
            true,
        );
        const base = rect();
        const graph = attachRoom(
            {
                ...base,
                vertices: [...base.vertices, ...other.vertices],
                edges: [...base.edges, ...other.edges],
                rooms: [...base.rooms, ...other.rooms],
            },
            circle(),
            'union',
        );
        expect(graph.assemblies![0].sources).toHaveLength(2);
        expect(graph.rooms.find((r) => r.id === other.rooms[0].id)).toEqual(other.rooms[0]);
    });
    it('places a door across an artificial quarter seam and preserves it through reshape', () => {
        const graph = attachRoom(rect(), circle(), 'union');
        const edge = graph.edges.find((e) => e.curve && e.curve.start === 0)!;
        const placement = prepareCurveAperture(graph, openingOn(edge, 'door', 0, 48));
        expect(placement.joined).toBe(true);
        expect(openingsError(placement.graph)).toBeUndefined();
        expect(placement.graph.assemblies![0].sources[1].graph.edges).toHaveLength(4);
        const resized = reshapeCurve(placement.graph, 'circle', { rx: 150 });
        expect(resized.openings).toHaveLength(1);
        expect(resized.openings![0].id).toBe(placement.opening.id);
    });
    it('keeps trimmed floors out of an earlier room even when that room has no material', () => {
        const base = rect();
        base.rooms[0].materialVersionId = null;
        const graph = attachRoom(base, circle(460), 'trim');
        const surfaces = floorSurfaces(graph);
        expect(surfaces.some((s) => contains(s.points, { x: 480, y: 300 }))).toBe(false);
        expect(surfaces.some((s) => contains(s.points, { x: 550, y: 300 }))).toBe(true);
        const edge = graph.edges.find((e) => e.curve && e.curve.start === 0)!;
        const door = prepareCurveAperture(graph, openingOn(edge, 'door', 0, 40));
        expect(door.joined).toBe(true);
        expect(door.graph.rooms.every((r) => r.loop.length >= 3)).toBe(true);
    });
    it('joins rooms along a shared boundary without retaining a phantom partition', () => {
        const annex = build(
            emptyGraph,
            [
                { x: 500, y: 200 },
                { x: 650, y: 200 },
                { x: 650, y: 400 },
                { x: 500, y: 400 },
            ],
            defaultBuild,
            true,
        );
        expect(roomOverlap(rect(), annex)).toBe(true);
        const graph = attachRoom(rect(), annex, 'union');
        expect(graph.rooms).toHaveLength(1);
        expect(
            graph.edges.some((e) => {
                const v = vertexIndex(graph);
                return (
                    v.get(e.a)!.x === 500 &&
                    v.get(e.b)!.x === 500 &&
                    Math.min(v.get(e.a)!.y, v.get(e.b)!.y) >= 200 &&
                    Math.max(v.get(e.a)!.y, v.get(e.b)!.y) <= 400
                );
            }),
        ).toBe(false);
    });
    it('does not explode coincident circles into sampled editable fragments', () => {
        const a = circle(),
            b = circle();
        b.edges = b.edges.map((e) => ({ ...e, curve: { ...e.curve!, group: 'second-circle' } }));
        const graph = attachRoom(a, b, 'union');
        expect(graph.edges).toHaveLength(4);
        expect(graph.rooms).toHaveLength(1);
    });
    it('changes only the picked source floor, including clearing its material', () => {
        const graph = attachRoom(rect(), circle(), 'union');
        const painted = fillAssemblyFloor(graph, { x: 580, y: 300 }, '3')!;
        expect(
            painted.assemblies![0].sources.map((s) => s.graph.rooms[0].materialVersionId),
        ).toEqual(['1', '3']);
        const cleared = fillAssemblyFloor(painted, { x: 580, y: 300 }, null)!;
        expect(cleared.assemblies![0].sources[0].graph.rooms[0].materialVersionId).toBe('1');
        expect(cleared.assemblies![0].sources[1].graph.rooms[0].materialVersionId).toBeNull();
    });
    it('makes a semicircular annex, retains source materials and editable shape', () => {
        const graph = attachRoom(rect(), circle(), 'union');
        expect(graph.rooms).toHaveLength(1);
        expect(graph.edges.filter((e) => e.curve)).toHaveLength(2);
        expect(graph.assemblies![0].sources[1].graph.edges).toHaveLength(4);
        expect(new Set(floorSurfaces(graph).map((s) => s.room.materialVersionId))).toEqual(
            new Set(['1', '2']),
        );
        const reshaped = reshapeCurve(graph, 'circle', { rx: 160 });
        expect(reshaped.rooms).toHaveLength(1);
        expect(reshaped.edges.filter((e) => e.curve).every((e) => e.curve!.rx === 160)).toBe(true);
        expect(Math.max(...roomPath(reshaped, reshaped.rooms[0]).map((p) => p.x))).toBe(660);
    });
    it('distinguishes partition and trim from union', () => {
        const partition = attachRoom(rect(), circle(460), 'partition');
        const trim = attachRoom(rect(), circle(460), 'trim');
        const union = attachRoom(rect(), circle(460), 'union');
        expect(partition.rooms.length).toBe(3);
        expect(trim.rooms.length).toBe(2);
        expect(union.rooms.length).toBe(1);
        expect(partition.edges.length).toBeGreaterThan(trim.edges.length);
        expect(trim.edges.length).toBeGreaterThan(union.edges.length);
    });
    it('preserves a door through ellipse radius edits on the original axis', () => {
        let graph = attachRoom(rect(), circle(470, 300, 150, 90, 20), 'union');
        const edge = graph.edges.find((e) => e.curve && Math.abs(e.curve.sweep) > 60)!;
        const opening = openingOn(edge, 'door', 0.5, 32);
        graph = syncAssemblyOpenings({ ...graph, openings: [opening] });
        const next = reshapeCurve(graph, 'circle', { rx: 180, ry: 110 });
        expect(next.openings).toHaveLength(1);
        expect(next.openings![0].id).toBe(opening.id);
        expect(next.openings![0].width).toBe(32);
        expect(openingsError(next)).toBeUndefined();
        const newEdge = next.edges.find((e) => e.id === next.openings![0].edgeId)!;
        const p = wallPoint(newEdge, vertexIndex(next), next.openings![0].center);
        expect(p.x).toBeGreaterThan(500);
    });
    it('rejects removal or cutting of an existing aperture without mutating inputs', () => {
        const before = rect(),
            edge = before.edges[1];
        before.openings = [openingOn(edge, 'window', 0.5, 40)];
        const saved = structuredClone(before);
        expect(() => attachRoom(before, circle(), 'union')).toThrow('проём');
        expect(before).toEqual(saved);
    });
    it('handles curve intersections and repeated annexes without losing source parameters', () => {
        const first = attachRoom(rect(), circle(470), 'union');
        const next = attachRoom(first, circle(560, 200, 140, 85, -25), 'union');
        expect(next.rooms).toHaveLength(1);
        expect(next.assemblies![0].sources).toHaveLength(3);
        for (const edge of next.edges.filter((e) => e.curve)) {
            const vertices = vertexIndex(next);
            expect(
                Math.hypot(
                    vertices.get(edge.a)!.x - curvePoint(edge.curve!, 0).x,
                    vertices.get(edge.a)!.y - curvePoint(edge.curve!, 0).y,
                ),
            ).toBeLessThanOrEqual(0.006);
        }
        expect(compileAssembly(next.assemblies![0]).edges).toEqual(next.edges);
    });
});
