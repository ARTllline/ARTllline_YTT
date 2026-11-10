import { wallProject, wallPoint, wallLength } from './curves';
import type { Point } from '../types/scene';
import {
    cutOverlapsOpening,
    distance,
    emptyGraph,
    project,
    snap,
    vertexIndex,
    type Graph,
    type Wall,
} from './model';

type Grid = Parameters<typeof snap>[2];
type GuideKind = 'horizontal' | 'vertical' | 'diagonal' | 'parallel' | 'perpendicular';
export type Guide = {
    kind: GuideKind;
    angle: number;
    locked?: boolean;
    reference?: [Point, Point];
};
type Target = {
    point: Point;
    kind: 'vertex' | 'midpoint' | 'edge' | 'grid' | 'guide' | 'free';
    guide?: Guide;
    blocked?: true;
};
export type BuildModifiers = { lock: boolean; bypass: boolean };

const eighth = Math.PI / 4;
const fixed: Guide[] = [
    { kind: 'horizontal', angle: 0 },
    { kind: 'diagonal', angle: eighth },
    { kind: 'vertical', angle: 2 * eighth },
    { kind: 'diagonal', angle: 3 * eighth },
];
const angle = (a: Point, b: Point) => Math.atan2(b.y - a.y, b.x - a.x);
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const delta = (a: Point, b: Point) => ({ x: a.x - b.x, y: a.y - b.y });
const direction = (radians: number) => ({ x: Math.cos(radians), y: Math.sin(radians) });
const offset = (a: Point, v: Point, n: number) => ({ x: a.x + n * v.x, y: a.y + n * v.y });
const aligned = (p: Point, origin: Point, guide: Guide) =>
    Math.abs(cross(delta(p, origin), direction(guide.angle))) < 0.0001;

function along(p: Point, origin: Point, guide: Guide) {
    const v = direction(guide.angle);
    const d = delta(p, origin);
    return offset(origin, v, d.x * v.x + d.y * v.y);
}

function intersect(a: Point, b: Point, origin: Point, guide: Guide) {
    const v = delta(b, a);
    const dir = direction(guide.angle);
    const divisor = cross(v, dir);
    if (Math.abs(divisor) < 0.0001) return;
    const t = cross(delta(origin, a), dir) / divisor;
    if (t >= 0 && t <= 1) return offset(a, v, t);
}

export function buildSnap(
    point: Point,
    graph: Graph,
    grid: Grid,
    zoom: number,
    gridSnap: boolean,
    path: Point[],
    { lock, bypass }: BuildModifiers,
): Target {
    const radius = Math.min(10 / zoom, grid.size * 0.45);
    const origin = path.at(-1);
    const previous = path.at(-2);
    const locked =
        origin && lock
            ? { ...fixed[(Math.round(angle(origin, point) / eighth) + 4) % 4], locked: true }
            : undefined;
    if (bypass)
        return locked && origin
            ? { point: along(point, origin, locked), kind: 'guide', guide: locked }
            : { point, kind: 'free' };

    const vertices = vertexIndex(graph);
    const guides = [...fixed];
    const addReference = (a: Point, b: Point) => {
        const rotation = angle(a, b);
        guides.push({ kind: 'parallel', angle: rotation, reference: [a, b] });
        guides.push({ kind: 'perpendicular', angle: rotation + Math.PI / 2, reference: [a, b] });
    };
    if (origin && previous && !locked) addReference(previous, origin);
    let nearby: [Point, Point] | undefined;
    let nearest = 60 / zoom;
    const targets: Partial<Record<'vertex' | 'midpoint' | 'edge', Target>> = {};
    const consider = (kind: 'vertex' | 'midpoint' | 'edge', candidate: Point, edge?: Wall) => {
        const d = distance(point, candidate);
        const best = targets[kind];
        if (d > radius || (best && d >= distance(point, best.point))) return;
        if (locked && origin && !aligned(candidate, origin, locked)) return;
        const target: Target = { point: candidate, kind };
        if (edge && graph.openings?.length) {
            const length = wallLength(edge, vertices);
            const cut = wallProject(candidate, edge, vertices).t * length;
            if (graph.openings.some((opening) => cutOverlapsOpening(edge, opening, length, cut)))
                target.blocked = true;
        }
        targets[kind] = target;
    };
    for (const vertex of graph.vertices) consider('vertex', vertex);
    for (const edge of graph.edges) {
        const a = vertices.get(edge.a)!;
        const b = vertices.get(edge.b)!;
        const axis = wallProject(point, edge, vertices).point;
        if (origin && !locked && !edge.curve) {
            const d = distance(origin, project(origin, a, b));
            if (d < 0.001) addReference(a, b);
            else if (d < nearest) {
                nearest = d;
                nearby = [a, b];
            }
        }
        const midpoint = wallPoint(edge, vertices, 0.5);
        if (distance(point, midpoint) <= radius * 0.8) consider('midpoint', midpoint, edge);
        const candidate =
            locked && origin && !edge.curve && !aligned(axis, origin, locked)
                ? intersect(a, b, origin, locked)
                : axis;
        if (candidate) consider('edge', candidate, edge);
    }
    if (nearby) addReference(...nearby);
    const topology = targets.vertex ?? targets.midpoint ?? targets.edge;
    const gridTarget = snap(point, emptyGraph, grid, zoom, gridSnap);
    let guide: Guide | undefined = locked;
    if (origin && !guide) {
        const target = topology?.point ?? point;
        let best = topology ? 0.0001 : Math.min(radius * 0.7, distance(origin, point) * 0.25);
        for (const candidate of guides) {
            const d = distance(target, along(target, origin, candidate));
            if (d >= best - 0.00001) continue;
            best = d;
            guide = candidate;
        }
    }
    if (topology) return { ...topology, guide };
    if (origin && guide) {
        if (gridTarget.kind === 'grid' && aligned(gridTarget.point, origin, guide))
            return { point: gridTarget.point, kind: 'grid', guide };
        return { point: along(point, origin, guide), kind: 'guide', guide };
    }
    return { point: gridTarget.point, kind: gridTarget.kind === 'grid' ? 'grid' : 'free' };
}
