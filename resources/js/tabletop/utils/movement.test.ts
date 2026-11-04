import { expect, it } from 'vitest';
import fixture from '../../../../tests/Fixtures/movement.json';
import type { Scene, SceneProp, Token } from '../types/scene';
import { movementBlocked, movementObstacles, movementRange, movementCost } from './movement';

const scene = { mapWorld: {}, grid: { size: 60, distancePerCell: 5 } } as Scene;
for (const example of fixture.cases) {
    it(example.name, () => {
        const graph = structuredClone(fixture.graph) as NonNullable<Scene['structure']>['graph'];
        const door = graph.openings?.[0];
        const window = graph.openings?.[1];
        if (door?.type === 'door') door.open = !example.closeDoor;
        if (window?.type === 'window') window.blocksMovement = !!example.blockWindow;
        const obstacles = movementObstacles({
            ...scene,
            structure: { graph, hash: 'fixture', materials: [] },
        });
        expect(movementBlocked(example.a, example.b, example.radius, obstacles)).toBe(
            example.blocked,
        );
    });
}
for (const example of fixture.props) {
    it(example.name, () => {
        const prop = {
            x: 250,
            y: 250,
            rotation: example.rotation,
            scaleX: example.scaleX,
            scaleY: example.scaleY,
            preset: { width: 100, height: 100, pivotX: 0.5, pivotY: 0.5 },
            collider: { ...example.collider, blocksMovement: true },
        } as SceneProp;
        const obstacles = movementObstacles({ ...scene, props: [prop] });
        expect(movementBlocked({ x: 50, y: 250 }, { x: 450, y: 250 }, 10, obstacles)).toBe(
            example.blocked,
        );
        expect(movementBlocked({ x: 50, y: 100 }, { x: 450, y: 100 }, 10, obstacles)).toBe(false);
        expect(movementObstacles({ ...scene, props: [{ ...prop, collider: undefined }] })).toEqual(
            [],
        );
    });
}
it('converts the existing turn budget into world units', () => {
    const token = { id: 't', conditions: [{ key: 'prone' }] } as Token;
    const combat = {
        status: 'active',
        combatants: [{ tokenId: 't', budget: { ownTurn: true, movementRemaining: 15 } }],
    } as Scene['combat'];
    expect(movementRange({ ...scene, combat }, token)).toBe(90);
    expect(movementRange({ ...scene, combat }, { ...token, conditions: [] })).toBe(180);
    expect(movementRange({ ...scene, combat }, { ...token, id: 'other' })).toBe(0);
    expect(movementRange(scene, token)).toBeUndefined();
    expect(movementCost(scene, token, 100)).toBe(16.6667);
    expect(movementCost(scene, { ...token, conditions: [] }, 100)).toBe(8.3334);
});

it('uses the public movement silhouette without needing GM preset data', () => {
    const obstacle = { points: [{ x: 200, y: 150 }], padding: 20 };
    const obstacles = movementObstacles({
        ...scene,
        props: [{ id: 'public', movementObstacle: obstacle } as SceneProp],
    });
    expect(movementBlocked({ x: 50, y: 150 }, { x: 300, y: 150 }, 10, obstacles)).toBe(true);
    expect(obstacles).toEqual([{ ...obstacle, propId: 'public' }]);
});
