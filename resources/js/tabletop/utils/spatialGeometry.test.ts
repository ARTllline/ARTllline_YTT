import { expect, it } from 'vitest';
import { cone, distance, measured, measureLabel, rectangle, spatialSnap } from './spatialGeometry';
const grid = {
    size: 60,
    offset: { x: 10, y: -10 },
    visible: true,
    snap: true,
    distancePerCell: 5,
    distanceUnit: 'ft',
};
it('measures Euclidean world distances independent of camera and labels units', () => {
    expect(distance({ x: 0, y: 0 }, { x: 180, y: 240 })).toBe(300);
    expect(measured(360, grid)).toBe(30);
    expect(measureLabel(360, grid)).toBe('30 ft');
    expect(measureLabel(120, { ...grid, distancePerCell: 1.5, distanceUnit: 'm' })).toBe('3 m');
});
it('normalizes rectangle corners and cone direction/length/aperture', () => {
    expect(rectangle({ x: 100, y: 200 }, { x: -20, y: 10 })).toEqual({
        x: -20,
        y: 10,
        width: 120,
        height: 190,
    });
    expect(cone({ x: 0, y: 0 }, { x: 0, y: 120 })).toEqual({
        angle: Math.PI / 2,
        length: 120,
        aperture: Math.PI / 3,
    });
    expect(distance({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(0);
});
it('uses cell centers with offsets and negative cells, and allows exact unsnapped geometry', () => {
    expect(spatialSnap({ x: 12, y: 0 }, grid, true)).toEqual({ x: 40, y: 20 });
    expect(spatialSnap({ x: -50, y: -50 }, grid, true)).toEqual({ x: -20, y: -40 });
    expect(spatialSnap({ x: 12.5, y: 4 }, grid, false)).toEqual({ x: 12.5, y: 4 });
});
