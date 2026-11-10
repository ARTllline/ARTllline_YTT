import { createServer } from 'vite';
import { writeFileSync } from 'node:fs';
const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
});
try {
    const { build, defaultBuild, emptyGraph, openingOn } = await vite.ssrLoadModule(
        '/resources/js/tabletop/structure/model.ts',
    );
    const { buildCurve } = await vite.ssrLoadModule('/resources/js/tabletop/structure/curves.ts');
    const { attachRoom, syncAssemblyOpenings } = await vite.ssrLoadModule(
        '/resources/js/tabletop/structure/roomAssembly.ts',
    );
    const { prepareCurveAperture } = await vite.ssrLoadModule(
        '/resources/js/tabletop/structure/curveAperture.ts',
    );
    const rect = () =>
        build(
            emptyGraph,
            [
                { x: 100, y: 100 },
                { x: 500, y: 100 },
                { x: 500, y: 500 },
                { x: 100, y: 500 },
            ],
            defaultBuild,
            true,
        );
    const oval = (cx = 500, cy = 300, rx = 120, ry = rx, rotation = 0, group = 'circle') =>
        buildCurve(
            emptyGraph,
            {
                group,
                kind: rx === ry ? 'circle' : 'ellipse',
                cx,
                cy,
                rx,
                ry,
                rotation,
                start: 0,
                sweep: 360,
            },
            defaultBuild,
            true,
        );
    const fixtures = {};
    for (const mode of ['union', 'partition', 'trim'])
        fixtures[mode] = attachRoom(rect(), oval(460), mode);
    fixtures.semicircle = attachRoom(rect(), oval(), 'union');
    fixtures.ellipse = attachRoom(fixtures.union, oval(560, 200, 140, 85, -25, 'ellipse'), 'union');
    const withDoor = attachRoom(rect(), oval(470, 300, 150, 90, 20), 'union');
    const edge = withDoor.edges.find((e) => e.curve && Math.abs(e.curve.sweep) > 60);
    withDoor.openings = [openingOn(edge, 'door', 0.5, 32)];
    fixtures.door = syncAssemblyOpenings(withDoor);
    const seamBefore = attachRoom(rect(), oval(), 'union');
    const seamEdge = seamBefore.edges.find((e) => e.curve && e.curve.start === 0);
    seamBefore.openings = [openingOn(seamEdge, 'window', 0.65, 24)];
    fixtures.seamBefore = syncAssemblyOpenings(seamBefore);
    fixtures.seamAfter = prepareCurveAperture(
        fixtures.seamBefore,
        openingOn(seamEdge, 'door', 0, 48),
    ).graph;
    fixtures.nested = attachRoom(rect(), oval(300, 300, 60), 'partition');
    const adjacent = build(
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
    fixtures.adjacent = attachRoom(rect(), adjacent, 'partition');
    const withWall = rect();
    withWall.vertices.push({ id: 'free-a', x: 500, y: 50 }, { id: 'free-b', x: 500, y: 550 });
    withWall.edges.push({
        id: 'free-wall',
        a: 'free-a',
        b: 'free-b',
        thickness: 14,
        materialVersionId: null,
        blocksMovement: true,
        blocksVision: true,
        blocksLight: true,
    });
    fixtures.adjacentWall = attachRoom(withWall, adjacent, 'partition');
    const crossingMaterialSeam = build(
        emptyGraph,
        [
            { x: 350, y: 270 },
            { x: 550, y: 270 },
            { x: 550, y: 330 },
            { x: 350, y: 330 },
        ],
        defaultBuild,
        true,
    );
    fixtures.nestedAcrossSeam = attachRoom(fixtures.semicircle, crossingMaterialSeam, 'partition');
    writeFileSync('tests/Fixtures/room-assemblies.json', JSON.stringify(fixtures, null, 2) + '\n');
} finally {
    await vite.close();
}
