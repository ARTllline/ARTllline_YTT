import { Graphics } from 'pixi.js';
import { blockingColor } from '../objects/collider';
import { distance, vertexIndex, wallRuns, type Structure } from './model';

export class StructureCollisionOverlay extends Graphics {
    private structure?: Structure | null;

    sync(structure: Structure | null | undefined) {
        if (structure === this.structure) return;
        this.structure = structure;
        this.clear();
        if (!structure) return;
        const { graph } = structure;
        const vertices = vertexIndex(graph);
        for (const edge of graph.edges) {
            for (const { a, b, roundA, roundB, opening } of wallRuns(
                edge,
                vertices,
                graph.openings ?? [],
            )) {
                if (opening?.type === 'door' && opening.open) continue;
                const radius = opening ? Math.min(4, edge.thickness / 2) : edge.thickness / 2;
                const length = distance(a, b);
                if (!length) continue;
                const angle = Math.atan2(b.y - a.y, b.x - a.x);
                const outline = [];
                for (const [point, round, start] of [
                    [a, roundA, angle + Math.PI / 2],
                    [b, roundB, angle - Math.PI / 2],
                ] as const) {
                    const steps = round ? 12 : 1;
                    for (let i = 0; i <= steps; i++) {
                        const theta = start + (i * Math.PI) / steps;
                        outline.push(
                            point.x + radius * Math.cos(theta),
                            point.y + radius * Math.sin(theta),
                        );
                    }
                }
                const color = blockingColor(
                    opening?.type === 'door'
                        ? {
                              blocksMovement: true,
                              blocksVision: true,
                              blocksLight: true,
                          }
                        : (opening ?? edge),
                );
                this.poly(outline).fill({ color, alpha: 0.2 }).stroke({ color, width: 1.5 });
            }
        }
    }
}
