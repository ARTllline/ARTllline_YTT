import { colliderPoints } from '../objects/collider';
import { vertexIndex, wallRuns } from '../structure/model';
import type { Point, Scene, Token } from '../types/scene';

type Ellipse = { center: Point; rx: number; ry: number; rotation: number };
export type MovementObstacle = ({ points: Point[]; padding: number } | Ellipse) & {
    propId?: string;
};

const offset = (p: Point, length: number, angle: number): Point => ({
    x: p.x + length * Math.cos(angle),
    y: p.y + length * Math.sin(angle),
});

export function movementObstacles(scene: Scene): MovementObstacle[] {
    if (!scene.mapWorld) return [];
    const obstacles: MovementObstacle[] = [];
    const graph = scene.structure?.graph;
    if (graph) {
        const vertices = vertexIndex(graph);
        for (const edge of graph.edges) {
            for (const { a, b, roundA, roundB, opening } of wallRuns(
                edge,
                vertices,
                graph.openings ?? [],
            )) {
                const blocks =
                    opening?.type === 'door' ? !opening.open : (opening ?? edge).blocksMovement;
                if (!blocks) continue;
                const padding = opening ? Math.min(4, edge.thickness / 2) : edge.thickness / 2;
                const angle = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
                obstacles.push({
                    points: [
                        offset(a, padding, angle),
                        offset(b, padding, angle),
                        offset(b, -padding, angle),
                        offset(a, -padding, angle),
                    ],
                    padding: 0,
                });
                if (roundA) obstacles.push({ points: [a], padding });
                if (roundB) obstacles.push({ points: [b], padding });
            }
        }
    }
    for (const prop of scene.props ?? []) {
        if (prop.movementObstacle) {
            obstacles.push({ ...prop.movementObstacle, propId: prop.id });
            continue;
        }
        const { collider: shape, preset } = prop;
        if (!shape?.blocksMovement || shape.type === 'none' || !preset) continue;
        const rotation = (prop.rotation * Math.PI) / 180;
        const transform = (point: Point) =>
            offset(
                offset(prop, (point.x - preset.width * preset.pivotX) * prop.scaleX, rotation),
                (point.y - preset.height * preset.pivotY) * prop.scaleY,
                rotation + Math.PI / 2,
            );
        if (shape.type === 'circle') {
            obstacles.push({
                center: transform(shape),
                rx: shape.radius * prop.scaleX,
                ry: shape.radius * prop.scaleY,
                rotation,
                propId: prop.id,
            });
        } else
            obstacles.push({
                points: colliderPoints(shape).map(transform),
                padding: 0,
                propId: prop.id,
            });
    }
    return obstacles;
}

/** Public aperture centres connect the sampling grid through even off-grid narrow doors. */
export function movementPortals(scene: Scene, radius: number): Point[][] {
    const graph = scene.structure?.graph;
    if (!scene.mapWorld || !graph) return [];
    const vertices = vertexIndex(graph),
        edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
    return (graph.openings ?? []).flatMap((opening) => {
        if (opening.type === 'door' ? !opening.open : opening.blocksMovement) return [];
        const edge = edges.get(opening.edgeId);
        if (!edge || opening.width <= radius * 2 + 0.02) return [];
        const a = vertices.get(edge.a),
            b = vertices.get(edge.b);
        if (!a || !b) return [];
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const center = {
            x: a.x + (b.x - a.x) * opening.center,
            y: a.y + (b.y - a.y) * opening.center,
        };
        const reach = edge.thickness / 2 + radius + 0.02;
        const dx = (-(b.y - a.y) / length) * reach,
            dy = ((b.x - a.x) / length) * reach;
        return [
            [
                { x: center.x + dx, y: center.y + dy },
                center,
                { x: center.x - dx, y: center.y - dy },
            ],
        ];
    });
}

export const routeLength = (path: readonly Point[]) =>
    path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - path[i].x, p.y - path[i].y), 0);

/** Same persisted precision as TurnBudget, using the existing ruler scale. */
export function movementCost(scene: Scene, token: Token, length: number) {
    const cost =
        ((length * (scene.grid.distancePerCell ?? 5)) / scene.grid.size) *
        (token.conditions?.some((condition) => condition.key === 'prone') ? 2 : 1);
    return cost > 0 ? Math.max(1, Math.ceil(cost * 10000 - 0.00000001)) / 10000 : 0;
}

function pointDistance(p: Point, a: Point, b: Point) {
    const dx = b.x - a.x,
        dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

const side = (a: Point, b: Point, p: Point) =>
    (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);

function ellipseHit(a: Point, b: Point, radius: number, { center, rx, ry, rotation }: Ellipse) {
    const reach = Math.max(rx, ry) + radius;
    if (pointDistance(center, a, b) > reach) return false;
    if (rx === ry) return true;
    const cos = Math.cos(rotation),
        sin = Math.sin(rotation);
    const local = (p: Point) => {
        const x = p.x - center.x,
            y = p.y - center.y;
        return { x: x * cos + y * sin, y: y * cos - x * sin };
    };
    a = local(a);
    b = local(b);
    const unit = (p: Point) => ({ x: p.x / rx, y: p.y / ry });
    if (pointDistance({ x: 0, y: 0 }, unit(a), unit(b)) <= 1) return true;

    const dx = b.x - a.x,
        dy = b.y - a.y,
        length = Math.hypot(dx, dy);
    if (length) {
        const nx = -dy / length,
            ny = dx / length;
        const signed = a.x * nx + a.y * ny;
        const support = Math.hypot(rx * nx, ry * ny);
        if (Math.abs(signed) >= support && Math.abs(signed) - support <= radius) {
            const sign = Math.sign(signed);
            const x = (sign * rx * rx * nx) / support,
                y = (sign * ry * ry * ny) / support;
            const along = ((x - a.x) * dx + (y - a.y) * dy) / length;
            if (along >= 0 && along <= length) return true;
        }
    }
    return [a, b].some(({ x, y }) => {
        let low = 0,
            high = Math.hypot(rx * x, ry * y);
        for (let i = 0; i < 48; i++) {
            const t = (low + high) / 2;
            if (Math.hypot((rx * x) / (rx * rx + t), (ry * y) / (ry * ry + t)) > 1) low = t;
            else high = t;
        }
        return Math.hypot((x * low) / (rx * rx + low), (y * low) / (ry * ry + low)) <= radius;
    });
}

export function movementBlocked(a: Point, b: Point, radius: number, obstacles: MovementObstacle[]) {
    return obstacles.some((obstacle) => {
        if ('center' in obstacle) return ellipseHit(a, b, radius, obstacle);
        const { points, padding } = obstacle;
        const reach = radius + padding;
        if (points.length === 1) return pointDistance(points[0], a, b) <= reach;
        if (
            ['x', 'y'].some((axis) => {
                const key = axis as keyof Point;
                return (
                    points.every((p) => p[key] < Math.min(a[key], b[key]) - reach) ||
                    points.every((p) => p[key] > Math.max(a[key], b[key]) + reach)
                );
            })
        )
            return false;
        let inside = false;
        let c = points[points.length - 1];
        for (const d of points) {
            if (
                (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) ||
                Math.min(
                    pointDistance(a, c, d),
                    pointDistance(b, c, d),
                    pointDistance(c, a, b),
                    pointDistance(d, a, b),
                ) <= reach
            )
                return true;
            if (c.y > a.y !== d.y > a.y && a.x < c.x + ((d.x - c.x) * (a.y - c.y)) / (d.y - c.y))
                inside = !inside;
            c = d;
        }
        return inside;
    });
}

export function movementRange(scene: Scene, token: Token) {
    if (scene.combat?.status !== 'active') return undefined;
    const budget = scene.combat.combatants.find((entry) => entry.tokenId === token.id)?.budget;
    if (!budget?.ownTurn || budget.incapacitated) return 0;
    const prone = token.conditions?.some((condition) => condition.key === 'prone');
    return (
        (budget.movementRemaining * scene.grid.size) /
        ((scene.grid.distancePerCell ?? 5) * (prone ? 2 : 1))
    );
}
