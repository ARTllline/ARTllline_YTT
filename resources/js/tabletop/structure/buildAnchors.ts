import { wallPoint } from './curves';
import { moveVertices, selectedWalls } from './buildSelection';
import { distance, vertexIndex, type Graph, type Selection } from './model';
import type { Point } from '../types/scene';

export type BuildAnchor = {
    point: Point;
    kind: 'center' | 'corner' | 'side' | 'contour';
    label: string;
};

export function selectionAnchors(graph: Graph, selection?: Selection): BuildAnchor[] {
    if (!selection || selection.kind === 'opening') return [];
    const ids = moveVertices(graph, selection);
    const points = graph.vertices.filter((v) => ids.has(v.id));
    if (!points.length) return [];
    const left = Math.min(...points.map((v) => v.x)),
        right = Math.max(...points.map((v) => v.x));
    const top = Math.min(...points.map((v) => v.y)),
        bottom = Math.max(...points.map((v) => v.y));
    const cx = (left + right) / 2,
        cy = (top + bottom) / 2;
    const anchors: BuildAnchor[] = [
        { point: { x: cx, y: cy }, kind: 'center', label: 'Перенести за центр' },
    ];
    if (right > left && bottom > top) {
        for (const [x, y] of [
            [left, top],
            [right, top],
            [right, bottom],
            [left, bottom],
        ])
            anchors.push({ point: { x, y }, kind: 'corner', label: 'Перенести за угол' });
        for (const [x, y] of [
            [cx, top],
            [right, cy],
            [cx, bottom],
            [left, cy],
        ])
            anchors.push({ point: { x, y }, kind: 'side', label: 'Перенести за середину стороны' });
    }
    const vertices = vertexIndex(graph);
    for (const p of points)
        anchors.push({ point: p, kind: 'contour', label: 'Перенести за точку контура' });
    for (const wall of selectedWalls(graph, selection))
        anchors.push({
            point: wallPoint(wall, vertices, 0.5),
            kind: 'side',
            label: 'Перенести за середину стены',
        });
    return anchors.filter(
        (a, i) => !anchors.slice(0, i).some((b) => distance(a.point, b.point) < 0.001),
    );
}
