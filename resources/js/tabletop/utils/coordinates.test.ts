import { describe, expect, it } from 'vitest';
import { screenToWorld, worldToScreen, snapPoint, zoomAt, MIN_ZOOM, MAX_ZOOM } from './coordinates';
import { createDemoScene } from '../state/demoScene';
describe('world coordinates and camera', () => {
    it.each([0.2, 0.65, 1, 2.75, 3])(
        'round-trips negative and fractional coordinates at zoom %s',
        (zoom) => {
            const camera = { x: -192.8, y: 425.3, zoom };
            const point = { x: -320.75, y: 1024.125 };
            const result = screenToWorld(worldToScreen(point, camera), camera);
            expect(result.x).toBeCloseTo(point.x, 10);
            expect(result.y).toBeCloseTo(point.y, 10);
        },
    );
    it('keeps the world point below the cursor fixed during every interpolated zoom step', () => {
        let camera = { x: 80, y: -300, zoom: 0.5 };
        const anchor = { x: 271.3, y: 542.8 };
        const before = screenToWorld(anchor, camera);
        for (const zoom of [0.55, 0.7, 0.9, 1.2, 2]) {
            camera = zoomAt(camera, anchor, zoom);
            const after = screenToWorld(anchor, camera);
            expect(after.x).toBeCloseTo(before.x, 10);
            expect(after.y).toBeCloseTo(before.y, 10);
        }
    });
    it('bounds zoom while preserving its anchor', () => {
        expect(zoomAt({ x: 0, y: 0, zoom: 1 }, { x: 100, y: 50 }, 100).zoom).toBe(MAX_ZOOM);
        expect(zoomAt({ x: 0, y: 0, zoom: 1 }, { x: 100, y: 50 }, 0.001).zoom).toBe(MIN_ZOOM);
    });
});
describe('center snapping', () => {
    const grid = createDemoScene().grid;
    it('snaps to cell centers including negative space', () => {
        expect(snapPoint({ x: 61, y: -61 }, grid)).toEqual({ x: 90, y: -90 });
        expect(snapPoint({ x: 30, y: 90 }, grid)).toEqual({ x: 30, y: 90 });
    });
    it('uses calibrated origins and cell sizes', () => {
        expect(
            snapPoint({ x: 75, y: 74 }, { ...grid, size: 40, offset: { x: 10, y: -5 } }),
        ).toEqual({ x: 70, y: 55 });
    });
    it('does not mutate input and preserves exact coordinates with snapping disabled', () => {
        const point = { x: 13.24, y: -8.9 };
        expect(snapPoint(point, { ...grid, snap: false })).toEqual(point);
        expect(snapPoint(point, grid)).not.toBe(point);
    });
});
