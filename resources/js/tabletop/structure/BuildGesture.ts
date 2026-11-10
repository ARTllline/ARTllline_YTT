import { CurveBuildGesture, curveMode } from './CurveBuildGesture';
import { prepareCurveAperture } from './curveAperture';
import { assemblyFloorAt, drawRoomPreview, fillAssemblyFloor } from './roomAssembly';
import { openingAnchor } from './placement';
import { wallProject, wallPoint } from './curves';
import { Text, type Graphics } from 'pixi.js';
import type { SceneStore } from '../state/SceneStore';
import type { Point } from '../types/scene';
import { BuildSelectionGesture } from './BuildSelectionGesture';
import { floorFaces, floorAt, fillFloor } from './floorFill';
import { buildSnap, type BuildModifiers, type Guide } from './buildSnap';
import {
    openingEnds,
    build,
    joinEdges,
    openingOn,
    openingsError,
    reverseEdge,
    defaultBuild,
    distance,
    remove,
    splitEdge,
    structureOf,
    vertexIndex,
    type Graph,
    type Opening,
} from './model';

const guideLabels: Record<Guide['kind'], string> = {
    horizontal: 'Горизонталь',
    vertical: 'Вертикаль',
    diagonal: 'Диагональ',
    parallel: 'Параллель',
    perpendicular: 'Перпендикуляр',
};
const snapLabels = {
    vertex: 'Вершина',
    midpoint: 'Середина',
    edge: 'Ось стены',
    grid: 'Сетка',
    guide: '',
    free: '',
};

export class BuildGesture {
    private points: Point[] = [];
    private base?: string;
    private selection: BuildSelectionGesture;
    private curves: CurveBuildGesture;
    private start?: Point;
    private floorCache?: { graph: Graph; faces: ReturnType<typeof floorFaces> };
    private label = new Text({
        resolution: 2,
        style: { fontFamily: 'system-ui', fontSize: 12, fill: 0xe6f4ef },
    });

    constructor(
        private store: SceneStore,
        private preview: Graphics,
        private viewport: () => { topLeft: Point; bottomRight: Point },
    ) {
        this.curves = new CurveBuildGesture(store, preview, (p, zoom, text, color) =>
            this.drawLabel(p, zoom, text, color),
        );
        this.label.visible = false;
        preview.addChild(this.label);
        this.selection = new BuildSelectionGesture(
            store,
            preview,
            (graph, opening, zoom, invalid) => this.drawAperture(graph, opening, zoom, invalid),
            (point, zoom, text, color) => this.drawLabel(point, zoom, text, color),
        );
    }

    private get state() {
        return this.store.getSnapshot();
    }
    private get settings() {
        return this.state.build ?? defaultBuild;
    }
    private get graph() {
        return structureOf(this.state.scene);
    }

    down(point: Point, zoom: number, modifiers: BuildModifiers) {
        if (this.state.roomProposal) return true;
        if (!this.store.canBuild(this.settings.mode === 'door' || this.settings.mode === 'window'))
            return false;
        if (!this.points.length && !this.curves.active)
            this.base = this.state.scene.structure?.hash;
        if (curveMode(this.settings.mode)) {
            this.curves.down(this.snapped(point, zoom, [], modifiers).point);
            return true;
        }
        if (this.settings.mode !== 'edit') {
            if (!this.points.length && ['segment', 'rectangle'].includes(this.settings.mode))
                this.start = this.snapped(point, zoom, [], modifiers).point;
            return true;
        }
        this.selection.down(point, zoom, modifiers);
        this.draw(point, zoom, modifiers);
        return true;
    }

    up(point: Point, start: Point, zoom: number, modifiers: BuildModifiers) {
        if (this.state.roomProposal) return;
        const placing = this.settings.mode === 'door' || this.settings.mode === 'window';
        if (
            !this.store.canBuild(placing) ||
            (!placing && this.base !== this.state.scene.structure?.hash)
        ) {
            this.cancel();
            return;
        }
        const mode = this.settings.mode;
        if (mode === 'floor') {
            const face = floorAt(this.faces(), point);
            if (!face) this.store.editorNotice('Наведите на замкнутое помещение.');
            else {
                try {
                    const next =
                        fillAssemblyFloor(this.graph, point, this.settings.floor) ??
                        fillFloor(this.graph, face, this.settings.floor);
                    if (next !== this.graph) this.save(next);
                } catch (error) {
                    this.store.editorNotice((error as Error).message);
                }
            }
            this.draw(point, zoom, modifiers);
            return;
        }
        if (curveMode(mode)) {
            this.curves.up(
                this.snapped(point, zoom, [], modifiers).point,
                distance(start, point) * zoom > 5,
                modifiers.lock,
            );
            this.draw(point, zoom, modifiers);
            return;
        }
        if (mode === 'door' || mode === 'window') {
            const opening = this.placement(point, zoom, mode);
            if (opening) {
                const placement = prepareCurveAperture(this.graph, opening);
                if (placement.joined) {
                    if (this.store.canBuild()) this.save(placement.graph);
                    else
                        this.store.editorNotice(
                            'Дождитесь сохранения перед изменением стыка дуги.',
                        );
                } else this.store.placeOpening(opening);
            }
            this.draw(point, zoom, modifiers);
            return;
        }
        if (mode === 'edit') {
            this.selection.up(point, zoom, modifiers);
            this.draw(point, zoom, modifiers);
            return;
        }
        const anchor = this.start;
        this.start = undefined;
        if (anchor && distance(start, point) * zoom > 5) {
            const end = this.snapped(point, zoom, [anchor], modifiers).point;
            this.points = [anchor, end];
            this.commit();
            return;
        }
        const target = this.snapped(point, zoom, this.points, modifiers);
        const end = anchor ?? target.point;
        if ('closing' in target) {
            this.commit();
            return;
        }
        const last = this.points.at(-1);
        if (!last || distance(last, end) >= 1) this.points.push(end);
        if ((mode === 'rectangle' || mode === 'segment') && this.points.length === 2) this.commit();
        this.draw(point, zoom, modifiers);
    }

    doubleClick(point: Point, zoom: number) {
        if (!this.store.canBuild()) return;
        if (this.settings.mode === 'edit') this.selection.expand(point, zoom);
        else this.commit();
    }

    translate(delta: Point) {
        if (this.settings.mode === 'edit') this.selection.translate(delta);
    }

    commit() {
        if (this.settings.mode === 'edit' || this.settings.mode === 'floor') return;
        if (curveMode(this.settings.mode)) {
            this.curves.commit();
            return;
        }
        if (!this.store.canBuild() || this.base !== this.state.scene.structure?.hash) {
            this.cancel();
            return;
        }
        const mode = this.settings.mode;
        const closed = mode === 'rectangle' || mode === 'contour';
        const points = this.outline(this.points);
        if (points.length < (closed ? 3 : 2)) return;
        if (
            mode === 'rectangle' &&
            (distance(points[0], points[1]) < 1 || distance(points[1], points[2]) < 1)
        ) {
            this.store.editorNotice('Укажите два противоположных угла комнаты.');
            this.cancel();
            return;
        }
        if (mode === 'segment' && distance(points[0], points[1]) < 1) {
            this.cancel();
            return;
        }
        try {
            if (closed)
                this.store.addRoom(
                    build({ vertices: [], edges: [], rooms: [] }, points, this.settings, true),
                );
            else this.save(build(this.graph, points, this.settings, false));
        } catch (error) {
            this.store.editorNotice((error as Error).message);
        }
        this.cancel(false);
    }

    action(action: 'split' | 'delete' | 'reverse' | 'join') {
        try {
            this.edit(action);
        } catch (error) {
            this.store.editorNotice((error as Error).message);
        }
    }

    private save(graph: Graph) {
        const error = openingsError(graph);
        if (error) {
            this.store.editorNotice(error);
            return false;
        }
        this.store.editorNotice('');
        this.store.saveStructure(graph);
        return true;
    }

    private edit(action: 'split' | 'delete' | 'reverse' | 'join') {
        const selection = this.state.structureSelection;
        if (!selection || !this.store.canBuild()) return;
        const graph = this.graph;
        if (
            selection.kind !== 'opening' &&
            graph.assemblies?.some((a) =>
                (selection.kind === 'edges' ? selection.ids : [selection.id]).some((id) =>
                    id.startsWith(a.id + '-'),
                ),
            )
        ) {
            this.store.editorNotice(
                'Используйте исходное помещение в Inspector: форма сохраняется целиком. Проём можно удалить отдельно.',
            );
            return;
        }
        if (action === 'delete') {
            if (this.save(remove(graph, selection))) this.store.selectStructure(undefined);
        } else if (action === 'reverse' && selection.kind === 'edge') {
            const edge = graph.edges.find((row) => row.id === selection.id);
            if (edge) this.save(reverseEdge(graph, edge));
        } else if (action === 'join' && selection.kind === 'vertex') {
            const joined = joinEdges(graph, selection.id);
            if (this.save(joined.graph))
                this.store.selectStructure({ kind: 'edge', id: joined.edgeId });
        } else if (action === 'split' && selection.kind === 'edge') {
            const edge = graph.edges.find((row) => row.id === selection.id);
            if (!edge) return;
            const vertices = vertexIndex(graph);
            const next = { ...graph, vertices: [...graph.vertices], edges: [...graph.edges] };
            const vertex = splitEdge(next, edge, wallPoint(edge, vertices, 0.5));
            if (this.save(next)) this.store.selectStructure({ kind: 'vertex', id: vertex.id });
        }
    }

    private outline(points: Point[]) {
        if (this.settings.mode !== 'rectangle' || points.length < 2) return points;
        const [a, b] = points;
        return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
    }

    private snapped(point: Point, zoom: number, path: Point[], modifiers: BuildModifiers) {
        const { scene } = this.state;
        const anchors = this.settings.mode === 'rectangle' ? [] : path;
        if (
            this.settings.mode === 'contour' &&
            path.length >= 3 &&
            !modifiers.bypass &&
            !modifiers.lock &&
            distance(point, path[0]) * zoom <= 10
        )
            return {
                point: path[0],
                kind: 'vertex' as const,
                closing: true,
                guide: undefined,
                blocked: undefined,
            };
        const next = buildSnap(
            point,
            this.graph,
            scene.grid,
            zoom,
            this.settings.gridSnap,
            anchors,
            modifiers,
        );
        if (next.kind === 'vertex' || next.kind === 'midpoint' || next.kind === 'edge') return next;
        const r = this.settings.thickness / 2;
        const origin = anchors.at(-1);
        if (next.guide && origin) {
            const { x, y } = next.point;
            const clip = (from: number, to: number, limit: number) =>
                to < r
                    ? (r - from) / (to - from)
                    : to > limit - r
                      ? (limit - r - from) / (to - from)
                      : 1;
            const fraction = Math.max(
                0,
                Math.min(clip(origin.x, x, scene.width), clip(origin.y, y, scene.height)),
            );
            return {
                ...next,
                kind: fraction < 1 ? ('guide' as const) : next.kind,
                point: {
                    x: origin.x + (x - origin.x) * fraction,
                    y: origin.y + (y - origin.y) * fraction,
                },
            };
        }
        return {
            ...next,
            point: {
                x: Math.max(r, Math.min(scene.width - r, next.point.x)),
                y: Math.max(r, Math.min(scene.height - r, next.point.y)),
            },
        };
    }

    private placement(point: Point, zoom: number, type: Opening['type'], preview = false) {
        const vertices = vertexIndex(this.graph);
        let best = Infinity;
        let target: { edge: Graph['edges'][number]; center: number } | undefined;
        for (const edge of this.graph.edges) {
            const projection = wallProject(point, edge, vertices);
            const p = projection.point;
            const d = distance(point, p);
            if (d <= Math.max(edge.thickness / 2, 12 / zoom) && d < best) {
                best = d;
                target = { edge, center: projection.t };
            }
        }
        if (target) {
            const opening = openingOn(
                target.edge,
                type,
                target.center,
                this.settings.openingWidth,
                preview,
            );
            const materialVersionId = this.settings[type];
            return materialVersionId ? { ...opening, materialVersionId } : opening;
        }
    }

    private drawAperture(graph: Graph, opening: Opening, zoom: number, invalid: boolean) {
        const edge = graph.edges.find((e) => e.id === opening.edgeId)!;
        const vertices = vertexIndex(graph);
        const a = vertices.get(edge.a)!;
        const b = vertices.get(edge.b)!;
        if (distance(a, b) < 1) return;
        const [left, right] = openingEnds(edge, vertices, opening);
        const color = invalid ? 0xff8277 : opening.type === 'window' ? 0x8fddff : 0xffd48c;
        const g = this.preview;
        g.moveTo(left.x, left.y)
            .lineTo(right.x, right.y)
            .stroke({ color, width: edge.thickness + 4 / zoom, alpha: 0.35 });
        for (const p of [left, right]) g.circle(p.x, p.y, 3 / zoom).fill(color);
    }

    private faces() {
        if (this.floorCache?.graph !== this.graph)
            this.floorCache = { graph: this.graph, faces: floorFaces(this.graph) };
        return this.floorCache.faces;
    }

    draw(point: Point | undefined, zoom: number, modifiers: BuildModifiers) {
        this.label.visible = false;
        const g = this.preview.clear();
        if (!this.state.scene.mapWorld) return;
        if (this.state.roomProposal) {
            const proposal = this.state.roomProposal;
            drawRoomPreview(proposal.preview ?? proposal.incoming, g, zoom);
            return;
        }
        for (const p of this.state.openingPlacements ?? []) {
            if (
                p.status === 'confirmed' ||
                openingAnchor(this.graph, p.opening.edgeId) !== p.anchor
            )
                continue;
            this.drawAperture(this.graph, p.opening, zoom, p.status === 'rejected');
            const edge = this.graph.edges.find((e) => e.id === p.opening.edgeId)!;
            const center = wallPoint(edge, vertexIndex(this.graph), p.opening.center);
            const color = p.status === 'rejected' ? 0xff8277 : 0xffd48c;
            const r = 5 / zoom;
            if (p.status === 'rejected')
                g.moveTo(center.x - r, center.y - r)
                    .lineTo(center.x + r, center.y + r)
                    .moveTo(center.x - r, center.y + r)
                    .lineTo(center.x + r, center.y - r);
            else g.circle(center.x, center.y, r);
            g.stroke({ color, width: 2 / zoom });
        }
        const mode = this.settings.mode;
        if (mode === 'floor') {
            const face = point && floorAt(this.faces(), point);
            const source = point && assemblyFloorAt(this.graph, point);
            if (face) {
                const error = source ? undefined : face.error;
                const color = error ? 0xff8277 : 0x9ef3d7;
                g.poly((source?.points ?? face.points).flatMap((p) => [p.x, p.y]))
                    .fill({ color, alpha: 0.24 })
                    .stroke({ color, width: 2 / zoom });
                this.drawLabel(
                    point!,
                    zoom,
                    error ??
                        (source
                            ? 'Пол исходного помещения · клик — применить'
                            : this.settings.floor
                              ? 'Клик — залить пол'
                              : 'Клик — убрать материал пола'),
                    color,
                );
            } else if (point) this.drawLabel(point, zoom, 'Нет замкнутого помещения', 0xc5cbd0);
            return;
        }
        if (curveMode(mode)) {
            this.curves.draw(
                point && this.snapped(point, zoom, [], modifiers).point,
                zoom,
                modifiers.lock,
            );
            return;
        }
        if (mode === 'door' || mode === 'window') {
            const opening = point && this.placement(point, zoom, mode, true);
            if (opening) {
                const placement = prepareCurveAperture(this.graph, opening);
                this.drawAperture(
                    placement.graph,
                    placement.opening,
                    zoom,
                    !!openingsError(placement.graph),
                );
            }
            return;
        }
        if (mode === 'edit') {
            this.selection.draw(point, zoom, modifiers);
            return;
        }
        const path = this.start ? [this.start] : this.points;
        const target = point && this.snapped(point, zoom, path, modifiers);
        const points = this.outline(target ? [...path, target.point] : path);
        const closed = mode === 'rectangle' || mode === 'contour';
        if (points.length >= 2) {
            g.poly(
                points.flatMap((p) => [p.x, p.y]),
                closed,
            );
            if (closed && points.length >= 3) g.fill({ color: 0x68cbb5, alpha: 0.16 });
            g.stroke({
                color: 0x83dfc8,
                width: this.settings.thickness,
                alpha: 0.65,
                cap: 'round',
                join: 'round',
            });
        }
        if (target && point) {
            const { x, y } = target.point,
                r = 6 / zoom;
            const color = target.blocked
                ? 0xff9a8b
                : {
                      vertex: 0xffdd91,
                      midpoint: 0xffc480,
                      edge: 0x8bf5cf,
                      grid: 0xa4cbff,
                      guide: 0xb4d6ff,
                      free: 0xe0eae5,
                  }[target.kind];
            const origin = path.at(-1);
            if (origin && target.guide) {
                const dx = Math.cos(target.guide.angle),
                    dy = Math.sin(target.guide.angle);
                const projection = (x - origin.x) * dx + (y - origin.y) * dy;
                const begin = Math.max(
                    Math.min(0, projection) - 36 / zoom,
                    projection - 500 / zoom,
                );
                const end = Math.min(Math.max(0, projection) + 36 / zoom, projection + 500 / zoom);
                for (let s = begin; s < end; s += 11 / zoom) {
                    const t = Math.min(end, s + 5 / zoom);
                    g.moveTo(origin.x + dx * s, origin.y + dy * s).lineTo(
                        origin.x + dx * t,
                        origin.y + dy * t,
                    );
                }
                g.stroke({
                    color: 0xc5e0ff,
                    width: 1.5 / zoom,
                    alpha: target.guide.locked ? 0.95 : 0.65,
                });
                if (target.guide.reference) {
                    const [a, b] = target.guide.reference;
                    g.moveTo(a.x, a.y)
                        .lineTo(b.x, b.y)
                        .stroke({ color: 0xc5e0ff, width: 1.5 / zoom, alpha: 0.42 });
                }
            }
            if (target.kind === 'vertex') g.circle(x, y, r);
            else if (target.kind === 'midpoint') g.poly([x, y - r, x + r, y + r, x - r, y + r]);
            else if (target.kind === 'edge') g.poly([x, y - r, x + r, y, x, y + r, x - r, y]);
            else if (target.kind === 'guide') g.circle(x, y, r / 2);
            else g.rect(x - r / 2, y - r / 2, r, r);
            g.fill({ color: 0x19282a, alpha: 0.85 }).stroke({ color, width: 2 / zoom });
            const details = [];
            if (origin && distance(origin, target.point) >= 1) {
                const dx = x - origin.x,
                    dy = y - origin.y;
                details.push(
                    mode === 'rectangle'
                        ? `${Math.abs(dx).toFixed(1)} × ${Math.abs(dy).toFixed(1)} wu`
                        : `${distance(origin, target.point).toFixed(1)} wu · ${(Math.round((Math.atan2(dy, dx) * 180) / Math.PI) + 360) % 360}°`,
                );
            }
            if ('closing' in target) details.push('Замкнуть контур');
            else if (snapLabels[target.kind]) details.push(snapLabels[target.kind]);
            if (target.blocked) details.push('Проём рядом');
            if (target.guide)
                details.push(
                    guideLabels[target.guide.kind] + (target.guide.locked ? ' · Shift' : ''),
                );
            if (modifiers.bypass) details.push('Без привязки');
            if (details.length) this.drawLabel(point, zoom, details.join('  /  '), color);
        }
    }

    private drawLabel(point: Point, zoom: number, text: string, color: number) {
        const { topLeft, bottomRight } = this.viewport();
        this.label.text = text;
        this.label.scale.set(1 / zoom);
        const { width, height } = this.label;
        const right = point.x + 17 / zoom;
        const below = point.y + 13 / zoom;
        this.label.position.set(
            right + width + 8 / zoom <= bottomRight.x
                ? right
                : Math.max(topLeft.x + 8 / zoom, point.x - width - 17 / zoom),
            below + height + 6 / zoom <= bottomRight.y
                ? below
                : Math.max(topLeft.y + 6 / zoom, point.y - height - 13 / zoom),
        );
        this.preview
            .roundRect(
                this.label.x - 7 / zoom,
                this.label.y - 4 / zoom,
                width + 14 / zoom,
                height + 8 / zoom,
                5 / zoom,
            )
            .fill({ color: 0x101c21, alpha: 0.95 })
            .stroke({ color, width: 1 / zoom, alpha: 0.6 });
        this.label.visible = true;
    }

    refresh(point: Point | undefined, zoom: number, modifiers: BuildModifiers) {
        if (
            (this.points.length || this.start || this.selection.active || this.curves.active) &&
            this.base !== this.state.scene.structure?.hash
        )
            this.cancel();
        this.draw(point, zoom, modifiers);
    }

    cancel(clearProposal = true) {
        if (clearProposal) this.store.resolveRoom(false);
        this.points = [];
        this.curves.cancel();
        this.selection.cancel();
        this.start = undefined;
        this.label.visible = false;
        this.preview.clear();
    }
}
