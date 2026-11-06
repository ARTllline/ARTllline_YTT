import { Graphics, Matrix, type FillInput, type Texture } from 'pixi.js';
import type { Point } from '../types/scene';
import type { Structure, Surface } from './model';
import { distance, vertexIndex, wallRuns } from './model';

export class StructureLayer {
    readonly floors = new Graphics();
    readonly walls = new Graphics();
    /** Public static masonry, excluding every door/window and its current state. */
    readonly baseWalls = new Graphics();
    private current?: Structure | null;
    private images: (Texture | undefined)[] = [];

    sync(structure: Structure | null | undefined, textures: Map<string, Texture>) {
        const images = structure?.materials.map((m) => textures.get(m.asset.id)) ?? [];
        if (structure === this.current && images.every((image, i) => image === this.images[i]))
            return;
        this.current = structure;
        this.images = images;
        this.floors.clear();
        this.walls.clear();
        this.baseWalls.clear();
        if (!structure) return;
        const { graph, materials } = structure;
        const vertices = vertexIndex(graph);
        const surfaces = new Map(
            materials.map((material, i) => [material.versionId, { material, texture: images[i] }]),
        );
        const fill = (id: string | null, color: number): FillInput => {
            const surface = id ? surfaces.get(id) : undefined;
            return surface?.texture ? textureFill(surface.material, surface.texture) : color;
        };
        for (const room of graph.rooms) {
            if (!room.materialVersionId) continue;
            this.floors
                .poly(
                    room.loop.flatMap((id) => {
                        const point = vertices.get(id)!;
                        return [point.x, point.y];
                    }),
                )
                .fill(fill(room.materialVersionId, 0x55544d));
        }
        const edges = graph.edges.map((edge) => ({
            edge,
            runs: wallRuns(edge, vertices, graph.openings ?? []),
        }));
        // Rim first across every edge, so joined walls share a continuous face.
        for (const rim of [true, false]) {
            for (const { edge, runs } of edges) {
                const radius = edge.thickness / 2 - (rim ? 0 : Math.min(1.5, edge.thickness * 0.2));
                const material = rim ? 0x161c1d : fill(edge.materialVersionId, 0x858478);
                for (const { a, b, roundA, roundB, opening } of runs) {
                    if (opening) continue;
                    band(this.walls, a, b, radius, material);
                    if (roundA) this.walls.circle(a.x, a.y, radius).fill(material);
                    if (roundB) this.walls.circle(b.x, b.y, radius).fill(material);
                    band(this.baseWalls, a, b, radius, material);
                    if (roundA) this.baseWalls.circle(a.x, a.y, radius).fill(material);
                    if (roundB) this.baseWalls.circle(b.x, b.y, radius).fill(material);
                }
            }
        }
        for (const { edge, runs } of edges) {
            for (const { a, b, opening } of runs) {
                if (!opening) continue;
                const radius = Math.min(4, edge.thickness / 2);
                if (opening.type === 'window') {
                    const iron = opening.frame === 'iron';
                    band(this.walls, a, b, radius, iron ? 0x566975 : 0x69523c);
                    band(this.walls, a, b, radius * 0.55, 0x83bdcc);
                } else {
                    const hinge = opening.hinge === 'a' ? a : b;
                    const latch = hinge === a ? b : a;
                    let tip = latch;
                    if (opening.open) {
                        const angle =
                            ((opening.angle * Math.PI) / 180) *
                            (opening.direction === 'left' ? 1 : -1) *
                            (hinge === a ? 1 : -1);
                        const dx = latch.x - hinge.x;
                        const dy = latch.y - hinge.y;
                        tip = {
                            x: hinge.x + dx * Math.cos(angle) - dy * Math.sin(angle),
                            y: hinge.y + dx * Math.sin(angle) + dy * Math.cos(angle),
                        };
                    }
                    band(this.walls, hinge, tip, radius, 0x3d251a);
                    band(this.walls, hinge, tip, radius * 0.65, 0xbd8656);
                    this.walls.circle(hinge.x, hinge.y, radius * 0.7).fill(0xe2bc7e);
                }
            }
        }
    }
}

function band(g: Graphics, a: Point, b: Point, radius: number, fill: FillInput) {
    const length = distance(a, b);
    const x = ((a.y - b.y) * radius) / length;
    const y = ((b.x - a.x) * radius) / length;
    g.poly([a.x + x, a.y + y, b.x + x, b.y + y, b.x - x, b.y - y, a.x - x, a.y - y]).fill(fill);
}

function textureFill(material: Surface, texture: Texture): FillInput {
    const scale = material.repeatSize / texture.width;
    return {
        texture,
        textureSpace: 'global',
        matrix: new Matrix().scale(scale, scale).rotate((material.rotation * Math.PI) / 180),
    };
}
