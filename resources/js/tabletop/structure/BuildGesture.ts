import type { Graphics } from 'pixi.js';
import type { SceneStore } from '../state/SceneStore';
import type { Point } from '../types/scene';
import {
    apertureEnds,
    build,
    joinEdges,
    openingOn,
    openingsError,
    putOpening,
    reverseEdge,
    defaultBuild,
    distance,
    project,
    remove,
    roomAt,
    snap,
    splitEdge,
    structureOf,
    vertexIndex,
    wallRuns,
    type Graph,
    type Opening,
    type Selection,
} from './model';

export class BuildGesture {
    private points: Point[] = [];
    private base?: string;
    private drag?: { start: Point; ids: string[]; opening?: Opening; next?: Graph };
    private cursor?: Point;

    constructor(
        private store: SceneStore,
        private preview: Graphics,
    ) {}

    private get state() {
        return this.store.getSnapshot();
    }
    private get settings() {
        return this.state.build ?? defaultBuild;
    }
    private get graph() {
        return structureOf(this.state.scene);
    }

    down(point: Point, zoom: number) {
        if (!this.store.canBuild()) return false;
        if (!this.points.length) this.base = this.state.scene.structure?.hash;
        if (this.settings.mode !== 'edit') return true;
        const selection = this.hit(point, zoom);
        this.store.selectStructure(selection);
        if (selection?.kind === 'opening') {
            this.drag = {
                start: point,
                ids: [],
                opening: this.graph.openings?.find((o) => o.id === selection.id),
            };
        }
        if (selection?.kind === 'vertex') this.drag = { start: point, ids: [selection.id] };
        if (selection?.kind === 'edge') {
            const edge = this.graph.edges.find((row) => row.id === selection.id)!;
            this.drag = { start: point, ids: [edge.a, edge.b] };
        }
        this.draw(point, zoom);
        return true;
    }

    move(point: Point, zoom: number, start: Point) {
        if (this.drag) this.moveSelection(point, zoom);
        const rubberBand = this.settings.mode === 'rectangle' || this.settings.mode === 'segment';
        this.draw(point, zoom, rubberBand ? start : undefined);
    }

    up(point: Point, start: Point, zoom: number) {
        if (!this.store.canBuild() || this.base !== this.state.scene.structure?.hash) {
            this.cancel();
            return;
        }
        const mode = this.settings.mode;
        if (mode === 'door' || mode === 'window') {
            const opening = this.placement(point, zoom, mode);
            if (opening) {
                const next = putOpening(this.graph, opening);
                if (this.save(next)) {
                    this.store.configureBuild({ mode: 'edit' });
                    this.store.selectStructure({ kind: 'opening', id: opening.id });
                }
            }
            this.draw(point, zoom);
            return;
        }
        if (mode === 'edit') {
            if (this.drag && distance(point, start) * zoom > 3) {
                this.moveSelection(point, zoom);
                if (this.drag.next) this.save(this.drag.next);
            }
            this.drag = undefined;
            this.draw(point, zoom);
            return;
        }
        const end = this.snapped(point, zoom).point;
        if (
            !this.points.length &&
            (mode === 'rectangle' || mode === 'segment') &&
            distance(start, point) * zoom > 5
        ) {
            this.points = [this.snapped(start, zoom).point, end];
            this.commit();
            return;
        }
        if (
            mode === 'contour' &&
            this.points.length >= 3 &&
            distance(point, this.points[0]) * zoom <= 10
        ) {
            this.commit();
            return;
        }
        const last = this.points.at(-1);
        if (!last || distance(last, end) >= 1) this.points.push(end);
        if ((mode === 'rectangle' || mode === 'segment') && this.points.length === 2) this.commit();
        this.draw(point, zoom);
    }

    commit() {
        if (!this.store.canBuild() || this.base !== this.state.scene.structure?.hash) {
            this.cancel();
            return;
        }
        const mode = this.settings.mode;
        const closed = mode === 'rectangle' || mode === 'contour';
        const points = this.outline(this.points);
        if (points.length < (closed ? 3 : 2)) return;
        try {
            this.save(build(this.graph, points, this.settings, closed));
        } catch (error) {
            this.store.editorNotice((error as Error).message);
        }
        this.cancel();
    }

    action(action: 'split' | 'delete' | 'apply' | 'reverse' | 'join') {
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

    private edit(action: 'split' | 'delete' | 'apply' | 'reverse' | 'join') {
        const selection = this.state.structureSelection;
        if (!selection || !this.store.canBuild()) return;
        const graph = this.graph;
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
            const a = vertices.get(edge.a)!,
                b = vertices.get(edge.b)!;
            const next = { ...graph, vertices: [...graph.vertices], edges: [...graph.edges] };
            const vertex = splitEdge(next, edge, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
            if (this.save(next)) this.store.selectStructure({ kind: 'vertex', id: vertex.id });
        } else if (action === 'apply' && selection.kind === 'edge') {
            this.save({
                ...graph,
                edges: graph.edges.map((edge) =>
                    edge.id === selection.id
                        ? {
                              ...edge,
                              thickness: this.settings.thickness,
                              materialVersionId: this.settings.wall,
                          }
                        : edge,
                ),
            });
        } else if (action === 'apply' && selection.kind === 'room') {
            this.save({
                ...graph,
                rooms: graph.rooms.map((room) =>
                    room.id === selection.id
                        ? { ...room, materialVersionId: this.settings.floor }
                        : room,
                ),
            });
        }
    }

    private outline(points: Point[]) {
        if (this.settings.mode !== 'rectangle' || points.length < 2) return points;
        const [a, b] = points;
        return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
    }

    private snapped(point: Point, zoom: number) {
        const { scene } = this.state;
        const next = snap(point, this.graph, scene.grid, zoom, this.settings.gridSnap);
        if (next.kind === 'vertex' || next.kind === 'edge') return next;
        const r = this.settings.thickness / 2;
        return {
            ...next,
            point: {
                x: Math.max(r, Math.min(scene.width - r, next.point.x)),
                y: Math.max(r, Math.min(scene.height - r, next.point.y)),
            },
        };
    }

    private hit(point: Point, zoom: number): Selection | undefined {
        const graph = this.graph;
        const vertices = vertexIndex(graph);
        const target = snap(point, graph, this.state.scene.grid, zoom, false);
        if (target.kind === 'vertex') return { kind: 'vertex', id: target.id! };
        let best: Selection | undefined;
        let nearest = Infinity;
        for (const edge of graph.edges) {
            const d = distance(point, project(point, vertices.get(edge.a)!, vertices.get(edge.b)!));
            if (d <= Math.max(edge.thickness / 2, 8 / zoom) && d < nearest) {
                nearest = d;
                const a = vertices.get(edge.a)!;
                const b = vertices.get(edge.b)!;
                const along = distance(a, project(point, a, b));
                const opening = graph.openings?.find(
                    (o) =>
                        o.edgeId === edge.id &&
                        Math.abs(o.center * distance(a, b) - along) <= o.width / 2,
                );
                best = opening
                    ? { kind: 'opening', id: opening.id }
                    : { kind: 'edge', id: edge.id };
            }
        }
        if (best) return best;
        const room = roomAt(graph, point);
        return room && { kind: 'room', id: room.id };
    }

    private moveSelection(point: Point, zoom: number) {
        const { start, ids, opening } = this.drag!;
        const { scene } = this.state;
        const graph = this.graph;
        if (opening) {
            const edge = graph.edges.find((e) => e.id === opening.edgeId)!;
            const vertices = vertexIndex(graph);
            const a = vertices.get(edge.a)!;
            const b = vertices.get(edge.b)!;
            const length = distance(a, b);
            const delta =
                ((point.x - start.x) * (b.x - a.x) + (point.y - start.y) * (b.y - a.y)) /
                (length * length);
            this.drag!.next = putOpening(graph, { ...opening, center: opening.center + delta });
            return;
        }
        const anchor = graph.vertices.find((v) => v.id === ids[0])!;
        const desired = { x: anchor.x + point.x - start.x, y: anchor.y + point.y - start.y };
        // Dragging preserves identities. Grid snap only, so a move cannot silently merge topology.
        const { point: target } = snap(
            desired,
            { vertices: [], edges: [], rooms: [] },
            scene.grid,
            zoom,
            this.settings.gridSnap,
        );
        this.drag!.next = {
            ...graph,
            vertices: graph.vertices.map((v) =>
                ids.includes(v.id)
                    ? { ...v, x: v.x + target.x - anchor.x, y: v.y + target.y - anchor.y }
                    : v,
            ),
        };
    }

    private placement(point: Point, zoom: number, type: Opening['type'], preview = false) {
        const vertices = vertexIndex(this.graph);
        let best = Infinity;
        let target: { edge: Graph['edges'][number]; center: number } | undefined;
        for (const edge of this.graph.edges) {
            const a = vertices.get(edge.a)!;
            const b = vertices.get(edge.b)!;
            const p = project(point, a, b);
            const d = distance(point, p);
            if (d <= Math.max(edge.thickness / 2, 12 / zoom) && d < best) {
                best = d;
                target = { edge, center: distance(a, p) / distance(a, b) };
            }
        }
        if (target)
            return openingOn(target.edge, type, target.center, this.settings.openingWidth, preview);
    }

    private drawAperture(graph: Graph, opening: Opening, zoom: number, invalid: boolean) {
        const edge = graph.edges.find((e) => e.id === opening.edgeId)!;
        const vertices = vertexIndex(graph);
        const a = vertices.get(edge.a)!;
        const b = vertices.get(edge.b)!;
        if (distance(a, b) < 1) return;
        const [left, right] = apertureEnds(a, b, opening);
        const color = invalid ? 0xff8277 : opening.type === 'window' ? 0x8fddff : 0xffd48c;
        const g = this.preview;
        g.moveTo(left.x, left.y)
            .lineTo(right.x, right.y)
            .stroke({ color, width: edge.thickness + 4 / zoom, alpha: 0.35 });
        for (const p of [left, right]) g.circle(p.x, p.y, 3 / zoom).fill(color);
    }

    draw(point: Point | undefined, zoom: number, down?: Point) {
        this.cursor = point;
        const g = this.preview.clear();
        if (!this.state.scene.mapWorld) return;
        const mode = this.settings.mode;
        if (mode === 'door' || mode === 'window') {
            const opening = point && this.placement(point, zoom, mode, true);
            if (opening)
                this.drawAperture(
                    this.graph,
                    opening,
                    zoom,
                    !!openingsError(putOpening(this.graph, opening)),
                );
            return;
        }
        if (mode === 'edit') {
            const graph = this.drag?.next ?? this.graph;
            const vertices = vertexIndex(graph);
            const selected = this.state.structureSelection;
            const hover = point && this.hit(point, zoom);
            const highlight = selected ?? hover;
            if (highlight?.kind === 'opening') {
                const opening = graph.openings?.find((o) => o.id === highlight.id);
                if (opening) this.drawAperture(graph, opening, zoom, !!openingsError(graph));
            }
            if (highlight?.kind === 'room') {
                const room = graph.rooms.find((row) => row.id === highlight.id);
                if (room)
                    g.poly(
                        room.loop.flatMap((id) => {
                            const v = vertices.get(id)!;
                            return [v.x, v.y];
                        }),
                    )
                        .fill({ color: 0x70d4bd, alpha: 0.17 })
                        .stroke({ color: 0xa9ebd7, width: 2 / zoom });
            }
            for (const edge of graph.edges) {
                if (
                    edge.id !== highlight?.id &&
                    !this.drag?.ids.some((id) => id === edge.a || id === edge.b)
                )
                    continue;
                for (const { a, b } of wallRuns(edge, vertices, graph.openings ?? [])) {
                    g.moveTo(a.x, a.y)
                        .lineTo(b.x, b.y)
                        .stroke({
                            color: 0x9ef3d7,
                            width: Math.max(3 / zoom, edge.thickness),
                            alpha: 0.75,
                        });
                }
            }
            for (const vertex of graph.vertices) {
                const active = vertex.id === highlight?.id || this.drag?.ids.includes(vertex.id);
                g.circle(vertex.x, vertex.y, (active ? 6 : 3.5) / zoom)
                    .fill(active ? 0xb2f6de : 0x61988a)
                    .stroke({ color: 0x17332f, width: 1 / zoom });
            }
            return;
        }
        const target = point && this.snapped(point, zoom);
        const points = this.outline([
            ...(down && !this.points.length ? [this.snapped(down, zoom).point] : this.points),
            ...(target ? [target.point] : []),
        ]);
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
        if (target) {
            const { x, y } = target.point,
                r = 6 / zoom;
            const color = { vertex: 0xffdd91, edge: 0x8bf5cf, grid: 0xa4cbff, free: 0xe0eae5 }[
                target.kind
            ];
            if (target.kind === 'vertex') g.circle(x, y, r);
            else if (target.kind === 'edge') g.poly([x, y - r, x + r, y, x, y + r, x - r, y]);
            else g.rect(x - r / 2, y - r / 2, r, r);
            g.stroke({ color, width: 2 / zoom });
        }
    }

    refresh(zoom: number) {
        if ((this.points.length || this.drag) && this.base !== this.state.scene.structure?.hash)
            this.cancel();
        this.draw(this.cursor, zoom);
    }

    cancel() {
        this.points = [];
        this.drag = undefined;
        this.cursor = undefined;
        this.preview.clear();
    }
}
