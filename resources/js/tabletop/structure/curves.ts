import { splitEdge } from './model';
import { reshapeAssembly } from './roomAssembly';
import type { Point } from '../types/scene';
import type { BuildSettings, Graph, Room, Vertex, Wall } from './model';

/** Degrees, positive clockwise in world coordinates. Four arcs form a closed room. */
export type Curve = {
    group: string;
    kind: 'circle' | 'ellipse';
    cx: number;
    cy: number;
    rx: number;
    ry: number;
    rotation: number;
    start: number;
    sweep: number;
};
const radians = Math.PI / 180;
export const rounded = (n: number) => Math.round(n * 1000) / 1000;
const uid = (prefix: string) => prefix + crypto.randomUUID().replaceAll('-', '');
export function curvePoint(c: Curve, t: number): Point {
    const angle = (c.start + c.sweep * t) * radians;
    const rotation = c.rotation * radians;
    const x = c.rx * Math.cos(angle),
        y = c.ry * Math.sin(angle);
    return {
        x: rounded(c.cx + x * Math.cos(rotation) - y * Math.sin(rotation)),
        y: rounded(c.cy + x * Math.sin(rotation) + y * Math.cos(rotation)),
    };
}
/** Same rule as WallCurve.php: sagitta <= .25 wu, angular step <= 5 degrees. */
export function curveSteps(c: Curve) {
    const step = Math.min(5 * radians, 2 * Math.acos(1 - 0.25 / Math.max(c.rx, c.ry)));
    return Math.max(1, Math.ceil((Math.abs(c.sweep) * radians) / step));
}
export function wallPath(edge: Wall, vertices: Map<string, Vertex>): Point[] {
    if (!edge.curve) return [vertices.get(edge.a)!, vertices.get(edge.b)!];
    const count = curveSteps(edge.curve);
    return Array.from({ length: count + 1 }, (_, i) =>
        i === 0
            ? vertices.get(edge.a)!
            : i === count
              ? vertices.get(edge.b)!
              : curvePoint(edge.curve!, i / count),
    );
}
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export function wallLength(edge: Wall, vertices: Map<string, Vertex>) {
    const path = wallPath(edge, vertices);
    return path.slice(1).reduce((sum, p, i) => sum + dist(path[i], p), 0);
}
export function wallPoint(edge: Wall, vertices: Map<string, Vertex>, t: number): Point {
    const path = wallPath(edge, vertices),
        length = wallLength(edge, vertices);
    let remaining = t * length;
    for (let i = 1; i < path.length; i++) {
        const a = path[i - 1],
            b = path[i],
            n = dist(a, b);
        if (remaining <= n || i === path.length - 1) {
            const u = remaining / n;
            return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
        }
        remaining -= n;
    }
    return path[0];
}
export function wallProject(point: Point, edge: Wall, vertices: Map<string, Vertex>) {
    const path = wallPath(edge, vertices);
    let best = Infinity,
        offset = 0,
        result = { point: path[0], t: 0, parameter: 0 };
    const length = wallLength(edge, vertices);
    for (let i = 1; i < path.length; i++) {
        const a = path[i - 1],
            b = path[i],
            n = dist(a, b);
        const u = Math.max(
            0,
            Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / (n * n)),
        );
        const p = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
        const error = dist(point, p);
        if (error < best) {
            best = error;
            result = {
                point: p,
                t: (offset + n * u) / length,
                parameter: (i - 1 + u) / (path.length - 1),
            };
        }
        offset += n;
    }
    // A topology junction lies on the parametric axis, not inside its chord.
    if (edge.curve) result.point = curvePoint(edge.curve, result.parameter);
    return result;
}
export function roomPath(graph: Graph, room: Room): Point[] {
    const vertices = new Map(graph.vertices.map((v) => [v.id, v]));
    return room.loop.flatMap((a, i) => {
        const b = room.loop[(i + 1) % room.loop.length];
        const edge = graph.edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
        if (!edge) return [vertices.get(a)!];
        const path = wallPath(edge, vertices);
        return (edge.a === a ? path : path.reverse()).slice(0, -1);
    });
}
export function curveFromGesture(mode: string, a: Point, b: Point, end?: Point): Curve {
    const circle = mode !== 'ellipse';
    const rx = circle ? dist(a, b) : Math.abs(b.x - a.x);
    const ry = circle ? rx : Math.abs(b.y - a.y);
    const start = mode === 'arc' ? Math.atan2(b.y - a.y, b.x - a.x) / radians : 0;
    let sweep = mode === 'arc' ? 180 : 360;
    if (end) sweep = (((Math.atan2(end.y - a.y, end.x - a.x) / radians - start) % 360) + 360) % 360;
    return {
        group: uid('c'),
        kind: circle ? 'circle' : 'ellipse',
        cx: rounded(a.x),
        cy: rounded(a.y),
        rx: rounded(rx),
        ry: rounded(ry),
        rotation:
            mode === 'circle'
                ? Math.round((Math.atan2(b.y - a.y, b.x - a.x) / radians) * 1e6) / 1e6
                : 0,
        start: Math.round(start * 1e6) / 1e6,
        sweep: Math.round(sweep * 1e6) / 1e6,
    };
}
export function buildCurve(
    graph: Graph,
    c: Curve,
    settings: BuildSettings,
    closed: boolean,
): Graph {
    if (Math.min(c.rx, c.ry) < Math.max(8, settings.thickness))
        throw new Error('Радиус должен быть не меньше толщины стены и 8 wu.');
    if (Math.abs(c.sweep) < 5) throw new Error('Угол дуги должен быть не меньше 5°.');
    const next = structuredClone(graph);
    const count = closed ? 4 : 1;
    const anchors = Array.from({ length: closed ? 4 : 2 }, (_, i) => {
        const p = curvePoint(c, i / count);
        const existing = next.vertices.find((v) => dist(p, v) < 0.001);
        if (existing) return existing.id;
        const vertices = new Map(next.vertices.map((v) => [v.id, v]));
        const edge = next.edges.find((e) => dist(p, wallProject(p, e, vertices).point) < 0.002);
        if (edge) return splitEdge(next, edge, p).id;
        const v = { ...p, id: uid('v') };
        next.vertices.push(v);
        return v.id;
    });
    for (let i = 0; i < count; i++)
        next.edges.push({
            id: uid('e'),
            a: anchors[i],
            b: anchors[(i + 1) % anchors.length],
            thickness: settings.thickness,
            materialVersionId: settings.wall,
            blocksMovement: true,
            blocksVision: true,
            blocksLight: true,
            curve: { ...c, start: c.start + (c.sweep * i) / count, sweep: c.sweep / count },
        });
    if (closed) next.rooms.push({ id: uid('r'), loop: anchors, materialVersionId: settings.floor });
    return next;
}
export function reshapeCurve(graph: Graph, group: string, patch: Partial<Curve>): Graph {
    const assembled = reshapeAssembly(graph, group, patch, reshapeCurve);
    if (assembled) return assembled;
    const positions = new Map<string, Point>();
    const edges = graph.edges.map((e) => {
        if (e.curve?.group !== group) return e;
        const curve = { ...e.curve, ...patch, group };
        if (curve.kind === 'circle') curve.ry = curve.rx;
        positions.set(e.a, curvePoint(curve, 0));
        positions.set(e.b, curvePoint(curve, 1));
        return { ...e, curve };
    });
    return {
        ...graph,
        edges,
        vertices: graph.vertices.map((v) =>
            positions.has(v.id) ? { ...v, ...positions.get(v.id)! } : v,
        ),
    };
}
export type CurveHandle = {
    key: 'center' | 'rx' | 'ry' | 'rotation' | 'start' | 'end';
    point: Point;
};
export function isOpenCurve(graph: Graph, group: string) {
    if (
        graph.assemblies?.some((a) =>
            a.sources.some((s) => s.graph.edges.some((e) => e.curve?.group === group)),
        )
    )
        return false;
    return graph.edges.filter((e) => e.curve?.group === group).length === 1;
}
export function curveHandles(c: Curve, open: boolean, zoom: number): CurveHandle[] {
    const point = (angle: number, extra = 0) =>
        curvePoint({ ...c, rx: c.rx + extra, ry: c.ry + extra, start: angle, sweep: 0 }, 0);
    return [
        { key: 'center', point: { x: c.cx, y: c.cy } },
        { key: 'rx', point: point(0, open ? 20 / zoom : 0) },
        ...(c.kind === 'ellipse' ? [{ key: 'ry' as const, point: point(90) }] : []),
        { key: 'rotation', point: point(270, 28 / zoom) },
        ...(open
            ? [
                  { key: 'start' as const, point: curvePoint(c, 0) },
                  { key: 'end' as const, point: curvePoint(c, 1) },
              ]
            : []),
    ];
}
export function dragCurve(
    graph: Graph,
    c: Curve,
    key: CurveHandle['key'],
    point: Point,
    lock: boolean,
): Graph {
    const dx = point.x - c.cx,
        dy = point.y - c.cy,
        rotation = c.rotation * radians;
    const local =
        Math.atan2(
            (-dx * Math.sin(rotation) + dy * Math.cos(rotation)) / c.ry,
            (dx * Math.cos(rotation) + dy * Math.sin(rotation)) / c.rx,
        ) / radians;
    const angle = lock ? Math.round(local / 15) * 15 : local;
    let patch: Partial<Curve>;
    if (key === 'center') patch = { cx: rounded(point.x), cy: rounded(point.y) };
    else if (key === 'rotation') {
        const value = Math.atan2(dy, dx) / radians + 90;
        patch = { rotation: rounded(lock ? Math.round(value / 15) * 15 : value) };
    } else if (key === 'rx')
        patch = {
            rx: Math.max(8, rounded(Math.abs(dx * Math.cos(rotation) + dy * Math.sin(rotation)))),
        };
    else if (key === 'ry')
        patch = {
            ry: Math.max(8, rounded(Math.abs(-dx * Math.sin(rotation) + dy * Math.cos(rotation)))),
        };
    else if (key === 'end') patch = { sweep: rounded((((angle - c.start) % 360) + 360) % 360) };
    else {
        const sweep = (((c.start + c.sweep - angle) % 360) + 360) % 360;
        patch = { start: rounded(angle), sweep: rounded(sweep) };
    }
    return reshapeCurve(graph, c.group, patch);
}
