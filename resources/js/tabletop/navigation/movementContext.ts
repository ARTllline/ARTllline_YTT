import type { Scene } from '../types/scene';
import { movementObstacles } from '../utils/movement';

/** Recipient deltas may replace arrays without changing any collision geometry. */
export function sameMovementGeometry(a: Scene, b: Scene, geometryChanged?: boolean) {
    if (geometryChanged !== undefined) return !geometryChanged && a.id === b.id;
    if (
        a.id !== b.id ||
        a.width !== b.width ||
        a.height !== b.height ||
        !!a.mapWorld !== !!b.mapWorld ||
        a.structure?.hash !== b.structure?.hash ||
        (a.grid !== b.grid && JSON.stringify(a.grid) !== JSON.stringify(b.grid))
    )
        return false;
    return (
        a.props === b.props ||
        JSON.stringify(movementObstacles(a)) === JSON.stringify(movementObstacles(b))
    );
}
