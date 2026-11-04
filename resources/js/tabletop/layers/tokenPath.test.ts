import { expect, it } from 'vitest';
import { movementTiming, pathPosition, remainingTokenPath, tokenPath } from './tokenPath';

it('traverses waypoints by distance with short local speed ramps', () => {
    const path = tokenPath([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 200 },
    ])!;
    expect(pathPosition(path)).toEqual({ x: 0, y: 0 });
    path.elapsed = path.duration / 4;
    const before = pathPosition(path);
    expect(before.x).toBeGreaterThan(60);
    expect(before.x).toBeLessThan(80);
    expect(before.y).toBe(0);
    path.elapsed = path.duration / 2;
    expect(pathPosition(path).x).toBe(100);
    expect(pathPosition(path).y).toBeGreaterThan(45);
    expect(pathPosition(path).y).toBeLessThan(50);
    path.elapsed = path.duration * 2;
    expect(pathPosition(path)).toEqual({ x: 100, y: 200 });
});

it('plays long routes at walking speed without a duration cap and keeps short moves quick', () => {
    const origin = { x: 0, y: 0 };
    expect(tokenPath([origin, origin])).toBeUndefined();
    const path = tokenPath([origin, { x: 1800, y: 0 }])!;
    expect(path.duration).toBe(5080);
    path.elapsed = 2000;
    const a = pathPosition(path);
    path.elapsed += 1000;
    expect(pathPosition(path).x - a.x).toBeCloseTo(movementTiming.speed);
    expect(tokenPath([origin, { x: 10, y: 0 }])!.duration).toBeLessThan(120);
});

it('slows locally at turns, never rounds corners, and preserves the eased remainder', () => {
    const path = tokenPath([
        { x: 0, y: 0 },
        { x: 180, y: 0 },
        { x: 180, y: 180 },
    ])!;
    const cornerTime = path.segments[0].duration;
    path.elapsed = cornerTime;
    expect(pathPosition(path)).toEqual({ x: 180, y: 0 });
    path.elapsed = cornerTime - 10;
    const before = pathPosition(path);
    path.elapsed = cornerTime + 10;
    const after = pathPosition(path);
    expect(before.y).toBe(0);
    expect(after.x).toBe(180);
    expect(after.y).toBeCloseTo(180 - before.x);
    path.elapsed = cornerTime - 30;
    expect(remainingTokenPath(path)).toEqual([
        pathPosition(path),
        { x: 180, y: 0 },
        { x: 180, y: 180 },
    ]);
    path.elapsed = cornerTime + 30;
    expect(remainingTokenPath(path)).toEqual([pathPosition(path), { x: 180, y: 180 }]);
});
