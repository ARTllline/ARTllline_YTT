import { expect, it } from 'vitest';
import { SceneStore } from '../state/SceneStore';
import { createDemoScene } from '../state/demoScene';
import { debugRays, probePoints, type LosDebug } from './model';

it('keeps diagnostic spokes inside world bounds without inventing visibility', () => {
    const points = probePoints({ x: 10, y: 15 }, 600, 800, 600);
    expect(points).toHaveLength(32);
    expect(points.every((p) => p.x >= 0 && p.x <= 800 && p.y >= 0 && p.y <= 600)).toBe(true);
    expect(probePoints({ x: 10, y: 15 }, 0, 800, 600).every((p) => p.x === 10 && p.y === 15)).toBe(
        true,
    );
});

it('passes server blockers and footprint rays to the overlay and rejects player debug state', () => {
    const target = { x: 200, y: 100 };
    const blocker = { id: 'secret', source: 'prop', point: { x: 150, y: 100 } };
    const ray = { target, visible: false, reason: 'blocked' as const, distance: 100, blocker };
    const debug: LosDebug = {
        schemaVersion: 1,
        sceneId: '5',
        revision: 2,
        geometryKey: 'key',
        policy: 'policy',
        observer: { x: 100, y: 100 },
        range: 600,
        results: [
            { point: target, ...ray },
            {
                tokenId: '2',
                visible: true,
                visibility: 'partial',
                visibleSamples: 1,
                sampleCount: 9,
                rays: [ray],
            },
        ],
    };
    expect(debugRays(debug)).toHaveLength(2);
    expect(debugRays(debug).every((r) => r.blocker === blocker)).toBe(true);
    const player = new SceneStore(createDemoScene(), 'player');
    player.setLosDebug(debug);
    expect(player.getSnapshot().losDebug).toBeUndefined();
    const gm = new SceneStore(createDemoScene(), 'gm');
    gm.setLosDebug(debug);
    expect(gm.getSnapshot().losDebug).toBe(debug);
    gm.setLosDebug();
    expect(gm.getSnapshot().losDebug).toBeUndefined();
});
