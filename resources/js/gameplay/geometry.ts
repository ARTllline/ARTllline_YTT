import type { Ability, AbilityTarget } from './model';
import type { Point, Scene, Token } from '../tabletop/types/scene';
import { distance, measured } from '../tabletop/utils/spatialGeometry';
import { snapPoint } from '../tabletop/utils/coordinates';

export const pixels = (units: number, scene: Scene) =>
    (units * scene.grid.size) / (scene.grid.distancePerCell ?? 5);
export function areaContains(
    ability: Ability,
    origin: Point,
    aim: Point,
    point: Point,
    scene: Scene,
) {
    const area = ability.area;
    if (!area || area.shape === 'none') return false;
    const dx = measured(point.x - origin.x, scene.grid),
        dy = measured(point.y - origin.y, scene.grid);
    if (area.shape === 'circle')
        return measured(distance(aim, point), scene.grid) <= area.size + 0.00001;
    if (area.shape === 'rectangle')
        return (
            Math.abs(measured(point.x - aim.x, scene.grid)) <= area.size / 2 + 0.00001 &&
            Math.abs(measured(point.y - aim.y, scene.grid)) <= area.width / 2 + 0.00001
        );
    const angle = Math.atan2(aim.y - origin.y, aim.x - origin.x);
    if (area.shape === 'line') {
        const along = dx * Math.cos(angle) + dy * Math.sin(angle),
            across = Math.abs(-dx * Math.sin(angle) + dy * Math.cos(angle));
        return (
            along >= -0.00001 && along <= area.size + 0.00001 && across <= area.width / 2 + 0.00001
        );
    }
    const delta = Math.atan2(
        Math.sin(Math.atan2(dy, dx) - angle),
        Math.cos(Math.atan2(dy, dx) - angle),
    );
    return Math.hypot(dx, dy) <= area.size + 0.00001 && Math.abs(delta) <= Math.PI / 6 + 0.00001;
}
export function aimPoint(ability: Ability, actor: Point, point: Point, scene: Scene): Point {
    if (ability.area && ['cone', 'line'].includes(ability.area.shape)) {
        const max = pixels(
                ability.range?.long ?? ability.range?.normal ?? ability.area.size,
                scene,
            ),
            d = distance(actor, point);
        return d > max
            ? {
                  x: actor.x + ((point.x - actor.x) * max) / d,
                  y: actor.y + ((point.y - actor.y) * max) / d,
              }
            : point;
    }
    return snapPoint(point, scene.grid);
}
export function abilityPreview(
    ability: Ability,
    scene: Scene,
    actor: Token | undefined,
    target: AbilityTarget | null,
) {
    const point =
        target?.kind === 'point'
            ? target
            : target?.kind === 'token'
              ? scene.tokens.find((t) => t.id === target.id)
              : target?.kind === 'prop'
                ? scene.props?.find((p) => p.id === target.id)
                : actor;
    const length = actor && point ? measured(distance(actor, point), scene.grid) : 0;
    const max = ability.range?.long ?? ability.range?.normal;
    const valid =
        !!point &&
        !!actor &&
        (max == null || length <= max + 0.00001) &&
        point.x >= 0 &&
        point.y >= 0 &&
        point.x <= scene.width &&
        point.y <= scene.height &&
        (!ability.area || !['cone', 'line'].includes(ability.area.shape) || length > 0.001);
    const affected =
        actor && point && ability.area && ability.area.shape !== 'none'
            ? scene.tokens
                  .filter(
                      (t) =>
                          !(t.id === actor.id && ['cone', 'line'].includes(ability.area!.shape)) &&
                          areaContains(ability, actor, point, t, scene),
                  )
                  .map((t) => t.id)
            : [];
    return {
        point,
        distance: length,
        max,
        valid,
        long: ability.range != null && length > ability.range.normal,
        affected,
    };
}
