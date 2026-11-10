import { MeshGeometry } from 'pixi.js';
import type { Point } from '../types/scene';
import type { Curve } from './curves';
import { distance, type Wall, type wallRuns } from './model';

type Run = ReturnType<typeof wallRuns>[number];
const radians = Math.PI / 180;

/** Elliptical arc station from a shared zero, including across subdivided source walls. */
function station(curve: Curve, degrees: number) {
    const angle = degrees * radians;
    const count = Math.max(1, Math.ceil(Math.abs(degrees) / 10));
    const step = angle / count;
    const speed = (a: number) => Math.hypot(curve.rx * Math.sin(a), curve.ry * Math.cos(a));
    let length = 0;
    for (let i = 0; i < count; i++)
        length += (speed(i * step) + 4 * speed((i + 0.5) * step) + speed((i + 1) * step)) / 6;
    return length * step;
}

function normal(a: Point, b: Point) {
    const length = distance(a, b);
    return { x: (a.y - b.y) / length, y: (b.x - a.x) / length };
}

function curveNormal(curve: Curve, degrees: number) {
    const angle = degrees * radians;
    const rotation = curve.rotation * radians;
    const dx = -curve.rx * Math.sin(angle);
    const dy = curve.ry * Math.cos(angle);
    return normal(
        { x: 0, y: 0 },
        {
            x: (dx * Math.cos(rotation) - dy * Math.sin(rotation)) * Math.sign(curve.sweep),
            y: (dx * Math.sin(rotation) + dy * Math.cos(rotation)) * Math.sign(curve.sweep),
        },
    );
}

function miter(a: Point, b: Point) {
    const divisor = Math.max(1, 1 + a.x * b.x + a.y * b.y);
    return { x: (a.x + b.x) / divisor, y: (a.y + b.y) / divisor };
}

/** Build bands with shared UVs through the curve samples and consistent phase through splits. */
export class WallStrip {
    private readonly positions: number[] = [];
    private readonly uvs: number[] = [];
    private readonly indices: number[] = [];

    add(
        edge: Wall,
        runs: Run[],
        radius: number,
        repeatSize: number,
        capStart: boolean,
        capEnd: boolean,
    ) {
        runs = runs.filter(({ a, b }) => distance(a, b) > 0.0001);
        const first = runs[0]?.a;
        const last = runs.at(-1)?.b;
        if (!first || !last || distance(first, last) < 0.001) return;
        const curve = edge.curve;
        const axis = normal(first, last);
        const direction = curve
            ? Math.sign(curve.sweep)
            : axis.y < -0.0001 || (Math.abs(axis.y) <= 0.0001 && axis.x > 0)
              ? -1
              : 1;
        let period = repeatSize;
        let offset = (first.x * axis.y - first.y * axis.x) * direction;
        let scale = direction;
        if (curve) {
            const perimeter = station(curve, 360);
            period = perimeter / Math.max(1, Math.round(perimeter / repeatSize));
            offset = station(curve, curve.start);
            const sampledLength = runs.reduce(
                (sum, run) => sum + (run.opening?.width ?? distance(run.a, run.b)),
                0,
            );
            scale = (station(curve, curve.start + curve.sweep) - offset) / sampledLength;
        }
        offset %= period;
        const normals = runs.map(({ a, b }) => normal(a, b));
        if (capStart && !runs[0].opening) {
            this.cap(
                first,
                curve ? curveNormal(curve, curve.start) : normals[0],
                radius,
                offset,
                period,
                direction,
                -1,
            );
        }
        for (let i = 0; i < runs.length; i++) {
            const { a, b, opening } = runs[i];
            const next = offset + (opening && curve ? opening.width : distance(a, b)) * scale;
            if (!opening) {
                const n = normals[i];
                const left =
                    i === 0 && curve
                        ? curveNormal(curve, curve.start)
                        : i > 0 && !runs[i - 1].opening
                          ? miter(normals[i - 1], n)
                          : n;
                const right =
                    i === runs.length - 1 && curve
                        ? curveNormal(curve, curve.start + curve.sweep)
                        : i < runs.length - 1 && !runs[i + 1].opening
                          ? miter(n, normals[i + 1])
                          : n;
                const start = this.positions.length / 2;
                this.section(a, left, radius, offset / period, direction);
                this.section(b, right, radius, next / period, direction);
                this.indices.push(start, start + 1, start + 2, start + 1, start + 3, start + 2);
            }
            offset = next;
        }
        if (capEnd && !runs.at(-1)?.opening) {
            this.cap(
                last,
                curve ? curveNormal(curve, curve.start + curve.sweep) : normals.at(-1)!,
                radius,
                offset,
                period,
                direction,
                1,
            );
        }
    }

    private cap(
        p: Point,
        n: Point,
        radius: number,
        station: number,
        period: number,
        direction: number,
        end: number,
    ) {
        const center = this.positions.length / 2;
        this.positions.push(p.x, p.y);
        this.uvs.push(station / period, 0.5);
        for (let i = 0; i <= 12; i++) {
            const a = (i * Math.PI) / 12;
            const x = Math.sin(a) * radius * end;
            const y = Math.cos(a) * radius;
            this.positions.push(p.x + x * n.y + y * n.x, p.y - x * n.x + y * n.y);
            this.uvs.push((station + x * direction) / period, 0.5 - (y * direction) / (2 * radius));
            if (i) this.indices.push(center, center + i, center + i + 1);
        }
    }

    private section(p: Point, n: Point, radius: number, u: number, direction: number) {
        this.positions.push(
            p.x + n.x * radius,
            p.y + n.y * radius,
            p.x - n.x * radius,
            p.y - n.y * radius,
        );
        this.uvs.push(u, direction < 0 ? 1 : 0, u, direction < 0 ? 0 : 1);
    }

    geometry() {
        return new MeshGeometry({
            positions: new Float32Array(this.positions),
            uvs: new Float32Array(this.uvs),
            indices: new Uint32Array(this.indices),
        });
    }
}
