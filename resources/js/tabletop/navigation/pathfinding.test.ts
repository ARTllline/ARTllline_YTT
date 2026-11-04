import { expect, it } from 'vitest';
import fixture from '../../../../tests/Fixtures/movement.json';
import type { Scene } from '../types/scene';
import { movementBlocked, movementObstacles, movementPortals } from '../utils/movement';
import { findRoute, obstacleQuery, simplifyRoute, type NavigationRequest } from './pathfinding';

const box = (x: number, y: number, w: number, h: number) => ({
    points: [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
    ],
    padding: 0,
});
const base: NavigationRequest = {
    start: { x: 50, y: 150 },
    target: { x: 450, y: 150 },
    radius: 10,
    width: 600,
    height: 400,
    gridSize: 60,
    obstacles: [],
};
function valid(request: NavigationRequest) {
    const route = findRoute(request, { nodes: 24000, milliseconds: 2000 });
    expect(route.status).toBe('found');
    expect(route.path.length).toBeLessThanOrEqual(18);
    expect(route.path[0]).toEqual(request.start);
    expect(route.path.at(-1)).toEqual(request.target);
    for (let i = 1; i < route.path.length; i++)
        expect(
            movementBlocked(route.path[i - 1], route.path[i], request.radius, request.obstacles),
        ).toBe(false);
    return route;
}
it('routes around a building without clipping corners and is deterministic', () => {
    const request = { ...base, obstacles: [box(200, 80, 120, 220)] };
    const route = valid(request);
    expect(route.path.length).toBeGreaterThan(2);
    expect(valid(request).path).toEqual(route.path);
    expect(route.length).toBeGreaterThan(400);
});
it('uses the existing structural geometry for doors, windows and wall thickness', () => {
    const graph = structuredClone(fixture.graph) as NonNullable<Scene['structure']>['graph'];
    const obstacles = () => movementObstacles({ mapWorld: {}, structure: { graph } } as Scene);
    const request = {
        ...base,
        start: { x: 100, y: 234 },
        target: { x: 700, y: 234 },
        width: 800,
        height: 600,
        radius: 30,
        obstacles: obstacles(),
    };
    expect(valid(request).path).toHaveLength(2);
    if (graph.openings?.[0].type === 'door') graph.openings[0].open = false;
    if (graph.openings?.[1].type === 'window') graph.openings[1].blocksMovement = true;
    const closed = valid({ ...request, obstacles: obstacles() });
    expect(closed.path.length).toBeGreaterThan(2);
    expect(closed.length).toBeGreaterThan(600);
});
it('routes between furniture and accepts only a footprint that fits a narrow passage', () => {
    const obstacles = [box(200, 0, 100, 137), box(200, 163, 100, 237)];
    expect(valid({ ...base, obstacles, radius: 12 }).path).toHaveLength(2);
    expect(findRoute({ ...base, obstacles, radius: 13 }).status).not.toBe('found');
    valid({ ...base, obstacles: [box(140, 70, 50, 110), box(270, 150, 50, 120)] });
});

it('connects an angled narrow doorway independently of the navigation grid phase', () => {
    const graph = structuredClone(fixture.graph) as NonNullable<Scene['structure']>['graph'];
    const rotate = ({ x, y }: { x: number; y: number }) => ({
        x: Math.round((300 + (x - 300) * Math.cos(0.5) - (y - 234) * Math.sin(0.5)) * 1000) / 1000,
        y: Math.round((234 + (x - 300) * Math.sin(0.5) + (y - 234) * Math.cos(0.5)) * 1000) / 1000,
    });
    graph.vertices = graph.vertices.map((v) => ({ ...v, ...rotate(v) }));
    if (graph.openings?.[1].type === 'window') graph.openings[1].blocksMovement = true;
    const scene = { mapWorld: {}, structure: { graph } } as Scene;
    const portals = movementPortals(scene, 30);
    const route = valid({
        ...base,
        width: 900,
        height: 700,
        radius: 30,
        start: rotate({ x: 100, y: 150 }),
        target: rotate({ x: 700, y: 290 }),
        portals,
        obstacles: movementObstacles(scene),
    });
    expect(portals).toHaveLength(1);
    expect(route.length).toBeLessThan(700); // Through the aperture, rather than around the wall ends.
    expect(route.path.length).toBeGreaterThan(2);
});
it('uses transformed polygon and exact ellipse colliders', () => {
    for (const prop of fixture.props) {
        const obstacles = movementObstacles({
            mapWorld: {},
            props: [
                {
                    x: 250,
                    y: 150,
                    rotation: prop.rotation,
                    scaleX: prop.scaleX,
                    scaleY: prop.scaleY,
                    preset: { width: 100, height: 100, pivotX: 0.5, pivotY: 0.5 },
                    collider: { ...prop.collider, blocksMovement: true },
                },
            ],
        } as unknown as Scene);
        expect(valid({ ...base, obstacles }).path.length).toBeGreaterThan(2);
    }
});
it('never shortcuts a long zigzag route through obstacles or exceeds the waypoint contract', () => {
    const obstacles = Array.from({ length: 20 }, (_, i) =>
        box(70 + i * 40, i % 2 ? 0 : 75, 8, 325),
    );
    const route = findRoute(
        { ...base, target: { x: 940, y: 150 }, width: 1000, obstacles },
        { nodes: 100000, milliseconds: 3000 },
    );
    expect(route.status).toBe('waypoints');
    expect(route.path).toEqual([]);
});
it('bounds search and refuses an embedded origin or occupied destination', () => {
    const request = { ...base, obstacles: [box(200, 0, 80, 400)] };
    expect(findRoute(request, { nodes: 5, milliseconds: 200 }).status).toBe('budget');
    expect(findRoute({ ...base, obstacles: [box(40, 140, 20, 20)] }).status).toBe('unreachable');
    expect(findRoute({ ...base, obstacles: [box(440, 140, 20, 20)] }).status).toBe('unreachable');
});
it('spatial broad phase preserves the exact sweep for long and local queries', () => {
    const obstacles = [
        box(200, 80, 40, 180),
        { center: { x: 350, y: 150 }, rx: 40, ry: 8, rotation: 0.7 },
    ];
    const query = obstacleQuery(obstacles, 10);
    for (let y = 0; y < 400; y += 7)
        expect(query({ x: 50, y }, { x: 500, y: 400 - y })).toBe(
            movementBlocked({ x: 50, y }, { x: 500, y: 400 - y }, 10, obstacles),
        );
});
it('simplification checks every shortcut and refuses unsafe or oversized routes', () => {
    const path = [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 0 },
    ];
    expect(simplifyRoute(path, () => false)).toEqual([path[0], path[2]]);
    expect(simplifyRoute(path, (a, b) => a === path[0] && b === path[2])).toEqual(path);
    expect(simplifyRoute(path, () => true)).toBeUndefined();
    expect(
        simplifyRoute(
            path,
            () => false,
            () => true,
        ),
    ).toBeUndefined();
});
