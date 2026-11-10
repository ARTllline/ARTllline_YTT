import {
    curveHandles,
    isOpenCurve,
    dragCurve,
    roomPath,
    wallProject,
    wallLength,
    type Curve,
    type CurveHandle,
} from './curves';
import type { Graphics } from 'pixi.js';
import type { SceneStore } from '../state/SceneStore';
import type { Point } from '../types/scene';
import { rectangle } from '../utils/spatialGeometry';
import type { BuildModifiers } from './buildSnap';
import { selectionAnchors } from './buildAnchors';
import { connectJunctions } from './junctions';
import { movedRoom } from './roomAssembly';
import {
    connectedSelection,
    moveVertices,
    selectedWalls,
    snapMove,
    translateStructure,
    translationError,
    wallsInBox,
    wallSelection,
} from './buildSelection';
import {
    defaultBuild,
    distance,
    openingsError,
    putOpening,
    roomAt,
    snap,
    structureOf,
    vertexIndex,
    wallRuns,
    type Graph,
    type Opening,
    type Selection,
} from './model';

type Drag = {
    start: Point;
    anchor?: Point;
    hit?: Selection;
    selection?: Selection;
    ids: Set<string>;
    opening?: Opening;
    curve?: { value: Curve; key: CurveHandle['key'] };
    additive: boolean;
    marquee: boolean;
};

export class BuildSelectionGesture {
    private drag?: Drag;

    constructor(
        private store: SceneStore,
        private preview: Graphics,
        private aperture: (graph: Graph, opening: Opening, zoom: number, invalid: boolean) => void,
        private label: (point: Point, zoom: number, text: string, color: number) => void,
    ) {}

    private get scene() {
        return this.store.getSnapshot().scene;
    }

    private get selection() {
        return this.store.getSnapshot().structureSelection;
    }

    get active() {
        return !!this.drag;
    }

    down(point: Point, zoom: number, modifiers: BuildModifiers) {
        const graph = structureOf(this.scene);
        const selected = this.selectedCurve(graph);
        const handle =
            selected &&
            [...curveHandles(selected.value, selected.open, zoom)]
                .reverse()
                .find((h) => distance(h.point, point) * zoom < 9);
        if (handle && selected) {
            this.drag = {
                start: point,
                selection: this.selection,
                ids: new Set(
                    graph.edges
                        .filter((e) => e.curve?.group === selected.value.group)
                        .flatMap((e) => [e.a, e.b]),
                ),
                additive: false,
                marquee: false,
                curve: { value: selected.value, key: handle.key },
            };
            return;
        }
        const anchor = selectionAnchors(graph, this.selection).find(
            (h) => distance(h.point, point) * zoom < 9,
        );
        if (anchor && this.selection) {
            this.drag = {
                start: point,
                anchor: anchor.point,
                hit: this.hit(point, zoom, modifiers.lock) ?? this.selection,
                selection: this.selection,
                ids: moveVertices(graph, this.selection),
                additive: modifiers.lock,
                marquee: false,
            };
            return;
        }
        const hit = this.hit(point, zoom, modifiers.lock);
        const wallId = this.wallId(graph, hit);
        const keepGroup =
            (this.selection?.kind === 'edges' || this.selection?.kind === 'room') &&
            selectedWalls(graph, this.selection).some(
                (wall) =>
                    wall.id === wallId ||
                    (hit?.kind === 'vertex' && (wall.a === hit.id || wall.b === hit.id)),
            );
        const selection = keepGroup ? this.selection : hit;
        this.drag = {
            start: point,
            hit,
            selection,
            ids: selection ? moveVertices(graph, selection) : new Set(),
            opening:
                selection?.kind === 'opening'
                    ? graph.openings?.find((opening) => opening.id === selection.id)
                    : undefined,
            marquee: modifiers.lock || !hit,
            additive: modifiers.lock,
        };
    }

    up(point: Point, zoom: number, modifiers: BuildModifiers) {
        const drag = this.drag;
        this.cancel();
        if (!drag) return;
        const graph = structureOf(this.scene);
        const moved = distance(point, drag.start) * zoom > 4;
        if (drag.marquee) {
            const ids = new Set(
                drag.additive ? selectedWalls(graph, this.selection).map((edge) => edge.id) : [],
            );
            if (moved) {
                for (const wall of wallsInBox(graph, drag.start, point)) ids.add(wall.id);
            } else {
                const id = this.wallId(graph, drag.hit);
                if (id && !ids.delete(id)) ids.add(id);
                if (!id && drag.additive) return;
            }
            this.store.selectStructure(wallSelection([...ids]));
            return;
        }
        if (!moved) {
            if (drag.additive && drag.anchor) {
                const id = this.wallId(graph, drag.hit);
                if (id) {
                    const ids = new Set(selectedWalls(graph, this.selection).map((e) => e.id));
                    if (!ids.delete(id)) ids.add(id);
                    this.store.selectStructure(wallSelection([...ids]));
                }
                return;
            }
            this.store.selectStructure(drag.hit);
            return;
        }
        this.store.selectStructure(drag.selection);
        const result = this.transform(graph, drag, point, zoom, modifiers);
        this.save(graph, result.graph, result.error);
    }

    expand(point: Point, zoom: number) {
        const graph = structureOf(this.scene);
        const hit = this.hit(point, zoom, true);
        const id = this.wallId(graph, hit);
        const wall = graph.edges.find((edge) => edge.id === id);
        if (wall) this.store.selectStructure(connectedSelection(graph, wall));
    }

    translate(delta: Point) {
        if (!this.store.canBuild() || !this.selection) return;
        if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) return;
        const graph = structureOf(this.scene);
        const ids = moveVertices(graph, this.selection);
        const result = this.connected(
            graph,
            translateStructure(graph, ids, delta, this.selection),
            ids,
        );
        this.save(graph, result.graph, result.error);
    }

    private connected(before: Graph, moved: Graph, ids: Set<string>) {
        if (before === moved) return { graph: before, error: undefined };
        if (movedRoom(before, moved, this.selection)) return { graph: moved, error: undefined };
        try {
            const graph = connectJunctions(moved, before);
            return { graph, error: translationError(this.scene, before, graph, ids) };
        } catch (error) {
            return { graph: moved, error: (error as Error).message };
        }
    }

    private save(before: Graph, next: Graph, error?: string) {
        if (this.store.proposeRoomMove(next)) return;
        if (error) this.store.editorNotice(error);
        else if (next !== before) {
            this.store.editorNotice('');
            this.store.saveStructure(next);
        }
    }

    private selectedCurve(graph: Graph) {
        const walls = selectedWalls(graph, this.selection);
        const value = walls[0]?.curve;
        if (!value || !walls.every((e) => e.curve?.group === value.group)) return;
        return {
            value,
            open: isOpenCurve(graph, value.group),
        };
    }

    private wallId(graph: Graph, selection?: Selection) {
        if (selection?.kind === 'edge') return selection.id;
        if (selection?.kind === 'opening')
            return graph.openings?.find((opening) => opening.id === selection.id)?.edgeId;
    }

    private hit(point: Point, zoom: number, wallOnly = false): Selection | undefined {
        const graph = structureOf(this.scene);
        const vertices = vertexIndex(graph);
        if (!wallOnly) {
            const target = snap(point, { ...graph, edges: [] }, this.scene.grid, zoom, false);
            if (target.kind === 'vertex') {
                const edge = graph.edges.find(
                    (e) =>
                        (e.curve || graph.assemblies?.some((a) => e.id.startsWith(a.id + '-'))) &&
                        (e.a === target.id || e.b === target.id),
                );
                return edge ? { kind: 'edge', id: edge.id } : { kind: 'vertex', id: target.id! };
            }
        }
        let best: Selection | undefined;
        let nearest = Infinity;
        for (const edge of graph.edges) {
            const projection = wallProject(point, edge, vertices);
            const axis = projection.point;
            const d = distance(point, axis);
            if (d > Math.max(edge.thickness / 2, 8 / zoom) || d >= nearest) continue;
            nearest = d;
            const opening =
                !wallOnly &&
                graph.openings?.find(
                    (o) =>
                        o.edgeId === edge.id &&
                        Math.abs((o.center - projection.t) * wallLength(edge, vertices)) <=
                            o.width / 2,
                );
            best = opening ? { kind: 'opening', id: opening.id } : { kind: 'edge', id: edge.id };
        }
        if (best || wallOnly) return best;
        const room = roomAt(graph, point);
        return room && { kind: 'room', id: room.id };
    }

    private transform(
        graph: Graph,
        drag: Drag,
        point: Point,
        zoom: number,
        modifiers: BuildModifiers,
    ): { graph: Graph; error?: string; text: string; marker?: Point; guide?: Point } {
        try {
            return this.transformGraph(graph, drag, point, zoom, modifiers);
        } catch (error) {
            return { graph, error: (error as Error).message, text: 'Изменение формы' };
        }
    }

    private transformGraph(
        graph: Graph,
        drag: Drag,
        point: Point,
        zoom: number,
        modifiers: BuildModifiers,
    ): { graph: Graph; error?: string; text: string; marker?: Point; guide?: Point } {
        const delta = { x: point.x - drag.start.x, y: point.y - drag.start.y };
        if (drag.curve) {
            const settings = this.store.getSnapshot().build ?? defaultBuild;
            const target = modifiers.bypass
                ? point
                : snap(
                      point,
                      { vertices: [], edges: [], rooms: [] },
                      this.scene.grid,
                      zoom,
                      settings.gridSnap,
                  ).point;
            const c0 = drag.curve.value;
            const open = isOpenCurve(graph, c0.group);
            const handleOffset = open && drag.curve.key === 'rx' ? 20 / zoom : 0;
            const adjusted = {
                x: target.x - handleOffset * Math.cos((c0.rotation * Math.PI) / 180),
                y: target.y - handleOffset * Math.sin((c0.rotation * Math.PI) / 180),
            };
            const next = dragCurve(graph, c0, drag.curve.key, adjusted, modifiers.lock);
            const c = next.edges.find((e) => e.curve?.group === drag.curve!.value.group)!.curve!;
            return {
                graph: next,
                error: translationError(this.scene, graph, next, drag.ids),
                text: `Rx ${c.rx.toFixed(1)} · Ry ${c.ry.toFixed(1)} wu · поворот ${c.rotation.toFixed(1)}° · ${c.start.toFixed(1)}° / ${c.sweep.toFixed(1)}°`,
            };
        }

        if (drag.opening) {
            const edge = graph.edges.find((edge) => edge.id === drag.opening!.edgeId)!;
            const vertices = vertexIndex(graph);
            const length = wallLength(edge, vertices);
            const origin = wallProject(drag.start, edge, vertices).t;
            const target = wallProject(point, edge, vertices).t;
            const offset = (target - origin) * length;
            const next = putOpening(graph, {
                ...drag.opening,
                center: drag.opening.center + offset / length,
            });
            return { graph: next, error: openingsError(next), text: `Δ ${offset.toFixed(1)} wu` };
        }
        const settings = this.store.getSnapshot().build ?? defaultBuild;
        const target = snapMove(
            this.scene,
            graph,
            drag.ids,
            delta,
            zoom,
            settings.gridSnap,
            drag.anchor ?? drag.start,
            modifiers,
        );
        const next = translateStructure(graph, drag.ids, target.delta, drag.selection);
        const { x, y } = target.delta;
        const snapLabel =
            target.kind &&
            {
                grid: 'Сетка',
                align: 'Выравнивание',
                vertex: 'Вершина',
                midpoint: 'Середина',
                edge: 'Ось стены',
                guide: 'Направление',
            }[target.kind];
        return {
            ...this.connected(graph, next, drag.ids),
            text: [
                `Δ X ${x.toFixed(1)} · Y ${y.toFixed(1)} wu`,
                snapLabel,
                modifiers.lock && 'Shift · 45°',
                modifiers.bypass && 'Без привязки',
            ]
                .filter(Boolean)
                .join('  /  '),
            marker: target.marker,
            guide: target.guide,
        };
    }

    draw(point: Point | undefined, zoom: number, modifiers: BuildModifiers) {
        const before = structureOf(this.scene);
        const drag = this.drag;
        const moved = drag && point && distance(point, drag.start) * zoom > 4;
        const result =
            moved && !drag.marquee
                ? this.transform(before, drag, point, zoom, modifiers)
                : undefined;
        const graph = result?.graph ?? before;
        const vertices = vertexIndex(graph);
        const selection =
            (drag?.marquee ? this.selection : (drag?.selection ?? this.selection)) ??
            (point && this.hit(point, zoom));
        const walls = new Set(selectedWalls(graph, selection).map((wall) => wall.id));
        const moving = result && drag?.ids;
        const color = result?.error ? 0xff8277 : 0x9ef3d7;
        const g = this.preview;
        if (moved && drag.marquee) {
            const { x, y, width, height } = rectangle(drag.start, point);
            g.rect(x, y, width, height)
                .fill({ color, alpha: 0.12 })
                .stroke({ color, width: 1 / zoom });
            if (!drag.additive) walls.clear();
            for (const wall of wallsInBox(graph, drag.start, point)) walls.add(wall.id);
            this.label(point, zoom, `Стены · ${walls.size}`, color);
        }
        for (const room of graph.rooms) {
            const selected = selection?.kind === 'room' && selection.id === room.id;
            if (!selected && !room.loop.some((id) => moving?.has(id))) continue;
            g.poly(roomPath(graph, room).flatMap((v) => [v.x, v.y]))
                .fill({ color, alpha: selected ? 0.17 : 0.08 })
                .stroke({ color, width: (selected ? 2 : 1) / zoom, alpha: selected ? 1 : 0.6 });
        }
        const openings = graph.openings ?? [];
        for (const edge of graph.edges) {
            const selected = walls.has(edge.id);
            const affected = moving && (moving.has(edge.a) || moving.has(edge.b));
            if (!selected && !affected) continue;
            if (distance(vertices.get(edge.a)!, vertices.get(edge.b)!) < 1) continue;
            const runs = wallRuns(edge, vertices, openings);
            let path: Point[] = [];
            const flush = () => {
                if (path.length > 1)
                    g.poly(
                        path.flatMap((p) => [p.x, p.y]),
                        false,
                    ).stroke({
                        color,
                        width: Math.max(3 / zoom, edge.thickness),
                        alpha: selected ? 0.8 : 0.48,
                        cap: 'round',
                        join: 'round',
                    });
                path = [];
            };
            for (const run of runs) {
                if (run.opening) {
                    flush();
                    continue;
                }
                if (!path.length) path.push(run.a);
                path.push(run.b);
            }
            flush();
            if (affected)
                for (const opening of openings.filter((opening) => opening.edgeId === edge.id))
                    this.aperture(graph, opening, zoom, !!result?.error);
        }
        if (selection?.kind === 'opening') {
            const opening = openings.find((opening) => opening.id === selection.id);
            if (opening) this.aperture(graph, opening, zoom, !!result?.error);
        }
        const curvedVertices = new Set(
            graph.edges.filter((e) => e.curve).flatMap((e) => [e.a, e.b]),
        );
        for (const vertex of graph.vertices) {
            if (curvedVertices.has(vertex.id)) continue;
            const active =
                (selection?.kind === 'vertex' && vertex.id === selection.id) ||
                moving?.has(vertex.id);
            g.circle(vertex.x, vertex.y, (active ? 5 : 2.5) / zoom)
                .fill(active ? color : 0x61988a)
                .stroke({ color: 0x17332f, width: 1 / zoom });
        }
        const curve = this.selectedCurve(graph);
        if (!curve && selection) {
            for (const anchor of selectionAnchors(graph, selection)) {
                const { x, y } = anchor.point;
                const r = (anchor.kind === 'center' ? 6 : 4) / zoom;
                if (anchor.kind === 'center') {
                    g.circle(x, y, r)
                        .fill(0x17332f)
                        .stroke({ color, width: 2 / zoom });
                    g.moveTo(x - 9 / zoom, y)
                        .lineTo(x + 9 / zoom, y)
                        .moveTo(x, y - 9 / zoom)
                        .lineTo(x, y + 9 / zoom)
                        .stroke({ color, width: 1 / zoom });
                } else {
                    g.rect(x - r, y - r, 2 * r, 2 * r)
                        .fill(0x17332f)
                        .stroke({ color, width: 1.5 / zoom });
                }
                if (!result && point && distance(anchor.point, point) * zoom < 9)
                    this.label(point, zoom, anchor.label, color);
            }
        }
        if (curve) {
            const names = {
                center: 'Центр',
                rx: 'Радиус X',
                ry: 'Радиус Y',
                rotation: 'Поворот · Shift шаг 15°',
                start: 'Начало дуги',
                end: 'Конец дуги',
            };
            for (const h of curveHandles(curve.value, curve.open, zoom)) {
                g.moveTo(curve.value.cx, curve.value.cy)
                    .lineTo(h.point.x, h.point.y)
                    .stroke({ color, width: 1 / zoom, alpha: 0.3 });
                g.circle(h.point.x, h.point.y, 5 / zoom)
                    .fill(0x17332f)
                    .stroke({ color, width: 2 / zoom });
                if (!result && point && distance(h.point, point) * zoom < 9)
                    this.label(point, zoom, names[h.key], color);
            }
        }
        if (result && point) {
            const { marker, guide } = result;
            if (marker) {
                if (guide)
                    g.moveTo(marker.x, marker.y)
                        .lineTo(guide.x, guide.y)
                        .stroke({ color: 0xc5e0ff, width: 1 / zoom, alpha: 0.7 });
                g.circle(marker.x, marker.y, 5 / zoom).stroke({ color, width: 2 / zoom });
            }
            this.label(
                point,
                zoom,
                result.error ? `${result.text}\n${result.error}` : result.text,
                color,
            );
        }
    }

    cancel() {
        this.drag = undefined;
    }
}
