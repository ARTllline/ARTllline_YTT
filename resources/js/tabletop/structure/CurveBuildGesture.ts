import type { Graphics } from 'pixi.js';
import type { SceneStore } from '../state/SceneStore';
import type { Point } from '../types/scene';
import { buildCurve, curveFromGesture, curvePoint, curveSteps } from './curves';
import { defaultBuild, distance, openingsError, structureOf } from './model';

export const curveMode = (mode: string) => ['circle', 'ellipse', 'arc'].includes(mode);
export class CurveBuildGesture {
    private points: Point[] = [];
    private anchor?: Point;
    private lock = false;
    constructor(
        private store: SceneStore,
        private preview: Graphics,
        private label: (p: Point, zoom: number, text: string, color: number) => void,
    ) {}
    get active() {
        return !!this.points.length || !!this.anchor;
    }
    down(point: Point) {
        if (!this.points.length) this.anchor = point;
    }
    up(point: Point, moved: boolean, lock: boolean) {
        this.lock = lock;
        const settings = this.store.getSnapshot().build ?? defaultBuild;
        if (this.anchor && moved) this.points = [this.anchor, point];
        else this.points.push(this.anchor ?? point);
        this.anchor = undefined;
        if (this.points.length >= (settings.mode === 'arc' ? 3 : 2)) this.commit();
    }
    commit() {
        if (this.points.length < 2) return;
        const state = this.store.getSnapshot(),
            settings = state.build ?? defaultBuild;
        const [a, b, end] = this.points;
        try {
            const graph = buildCurve(
                settings.mode === 'arc'
                    ? structureOf(state.scene)
                    : { vertices: [], edges: [], rooms: [] },
                this.shape(settings.mode, a, b, end, this.lock),
                settings,
                settings.mode !== 'arc',
            );
            const error = openingsError(graph);
            if (error) this.store.editorNotice(error);
            else {
                this.store.editorNotice('');
                if (settings.mode === 'arc') this.store.saveStructure(graph);
                else this.store.addRoom(graph);
            }
        } catch (error) {
            this.store.editorNotice((error as Error).message);
        }
        this.cancel();
    }
    private shape(mode: string, a: Point, b: Point, end: Point | undefined, lock: boolean) {
        const c = curveFromGesture(mode, a, b, end);
        if (mode === 'arc' && lock) {
            const finish = c.start + c.sweep;
            c.start = Math.round(c.start / 15) * 15;
            c.sweep = Math.max(15, Math.min(345, Math.round(finish / 15) * 15 - c.start));
        }
        return c;
    }
    draw(point: Point | undefined, zoom: number, lock: boolean) {
        if (!point) return;
        const state = this.store.getSnapshot(),
            settings = state.build ?? defaultBuild;
        const points = this.anchor ? [this.anchor] : this.points;
        const [a, b] = points;
        if (!a) return;
        if (!b && distance(a, point) < 1) return;
        const c = this.shape(settings.mode, a, b ?? point, b ? point : undefined, lock);
        if (Math.min(c.rx, c.ry) < 1) return;
        const count = curveSteps(c);
        const path = Array.from({ length: count + 1 }, (_, i) => curvePoint(c, i / count));
        const invalid =
            Math.min(c.rx, c.ry) < Math.max(8, settings.thickness) || Math.abs(c.sweep) < 5;
        const color = invalid ? 0xff8277 : 0x83dfc8;
        const g = this.preview;
        g.poly(
            path.flatMap((p) => [p.x, p.y]),
            settings.mode !== 'arc',
        );
        if (settings.mode !== 'arc') g.fill({ color, alpha: 0.16 });
        g.stroke({ color, width: settings.thickness, alpha: 0.65, cap: 'round', join: 'round' });
        g.moveTo(a.x, a.y)
            .lineTo(point.x, point.y)
            .stroke({ color, width: 1 / zoom, alpha: 0.7 });
        g.circle(a.x, a.y, 4 / zoom).fill(color);
        g.circle(point.x, point.y, 5 / zoom).stroke({ color, width: 1.5 / zoom });
        const text =
            settings.mode === 'arc'
                ? `R ${c.rx.toFixed(1)} wu · ${c.start.toFixed(1)}° → ${(c.start + c.sweep).toFixed(1)}° · дуга ${c.sweep.toFixed(1)}°${b ? ' · клик — конец' : ' · задайте радиус'}`
                : `Rx ${c.rx.toFixed(1)} · Ry ${c.ry.toFixed(1)} wu · ${(c.rx * 2).toFixed(1)} × ${(c.ry * 2).toFixed(1)} wu`;
        this.label(point, zoom, text, color);
    }
    cancel() {
        this.points = [];
        this.anchor = undefined;
    }
}
