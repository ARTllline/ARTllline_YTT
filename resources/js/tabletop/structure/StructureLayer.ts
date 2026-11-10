import { floorSurfaces } from './floorFill';
import {
    Container,
    Graphics,
    Matrix,
    Mesh,
    type FillInput,
    type MeshGeometry,
    type Texture,
} from 'pixi.js';
import type { Point } from '../types/scene';
import type { Structure, Surface } from './model';
import { distance, openingIsOpen, vertexIndex, wallRuns } from './model';
import { OpeningArt, doorLeaf } from './openingArt';
import { WallStrip } from './wallStrip';

export class StructureLayer {
    readonly floors = new Graphics();
    readonly walls = new Container();
    /** Public static masonry, excluding every door/window and its current state. */
    readonly baseWalls = new Container();
    private readonly masonry = new Graphics();
    private readonly publicMasonry = new Graphics();
    private readonly currentStrips = new Container();
    private readonly publicStrips = new Container();
    private readonly apertures = new Graphics();
    private readonly sprites = new Container();
    private readonly openingArt = new OpeningArt();
    private geometries: MeshGeometry[] = [];
    private current?: Structure | null;
    private images: (Texture | undefined)[] = [];

    constructor() {
        this.walls.addChild(this.masonry, this.currentStrips, this.apertures, this.sprites);
        this.baseWalls.addChild(this.publicMasonry, this.publicStrips);
    }

    releaseArt() {
        for (const layer of [this.currentStrips, this.publicStrips, this.sprites])
            for (const child of layer.removeChildren()) child.destroy();
        for (const geometry of this.geometries) geometry.destroy(true);
        this.geometries = [];
        this.openingArt.clear();
    }

    sync(structure: Structure | null | undefined, textures: Map<string, Texture>) {
        const images = structure?.materials.map((m) => textures.get(m.asset.id)) ?? [];
        if (structure === this.current && images.every((image, i) => image === this.images[i]))
            return;
        this.current = structure;
        this.images = images;
        this.floors.clear();
        this.masonry.clear();
        this.publicMasonry.clear();
        this.apertures.clear();
        this.releaseArt();
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
        for (const { room, points } of floorSurfaces(graph)) {
            this.floors
                .poly(points.flatMap((point) => [point.x, point.y]))
                .fill(fill(room.materialVersionId, 0x55544d));
        }
        const edges = graph.edges.map((edge) => ({
            edge,
            runs: wallRuns(edge, vertices, graph.openings ?? []),
        }));
        const continuations = new Map<string, number>();
        for (const edge of graph.edges) {
            if (!edge.curve) continue;
            for (const vertex of [edge.a, edge.b]) {
                const key = edge.curve.group + ':' + vertex;
                continuations.set(key, (continuations.get(key) ?? 0) + 1);
            }
        }
        const strips = new Map<Texture, WallStrip>();
        // Rim first across every edge, so joined walls share a continuous face.
        for (const rim of [true, false]) {
            for (const { edge, runs } of edges) {
                const radius = edge.thickness / 2 - (rim ? 0 : Math.min(1.5, edge.thickness * 0.2));
                const surface = edge.materialVersionId
                    ? surfaces.get(edge.materialVersionId)
                    : undefined;
                if (!rim && surface?.texture && surface.material.layout === 'wall-strip') {
                    const texture = surface.texture;
                    const strip = strips.get(texture) ?? new WallStrip();
                    strips.set(texture, strip);
                    const cap = (id: string) =>
                        !edge.curve || continuations.get(edge.curve.group + ':' + id) === 1;
                    strip.add(
                        edge,
                        runs,
                        radius,
                        surface.material.repeatSize,
                        cap(edge.a),
                        cap(edge.b),
                    );
                    continue;
                }
                const material = rim ? 0x161c1d : fill(edge.materialVersionId, 0x858478);
                for (const { a, b, roundA, roundB, opening } of runs) {
                    if (opening) continue;
                    for (const layer of [this.masonry, this.publicMasonry]) {
                        band(layer, a, b, radius, material);
                        if (roundA) layer.circle(a.x, a.y, radius).fill(material);
                        if (roundB) layer.circle(b.x, b.y, radius).fill(material);
                    }
                }
            }
        }
        for (const [texture, strip] of strips) {
            if (texture.source.style.addressModeU !== 'repeat') {
                texture.source.style.addressModeU = 'repeat';
                texture.source.style.update();
            }
            texture.source.autoGenerateMipmaps = true;
            const geometry = strip.geometry();
            this.geometries.push(geometry);
            this.currentStrips.addChild(new Mesh({ geometry, texture }));
            this.publicStrips.addChild(new Mesh({ geometry, texture }));
        }
        for (const { edge, runs } of edges) {
            for (const { a, b, opening } of runs) {
                if (!opening) continue;
                const surface = opening.materialVersionId
                    ? surfaces.get(opening.materialVersionId)
                    : undefined;
                if (surface?.texture) {
                    this.openingArt.draw(
                        this.sprites,
                        a,
                        b,
                        edge.thickness,
                        opening,
                        surface.material,
                        surface.texture,
                    );
                    continue;
                }
                const radius = Math.min(4, edge.thickness / 2);
                if (opening.type === 'window') {
                    const iron = opening.frame === 'iron';
                    const frame = iron ? 0x566975 : 0x69523c;
                    band(this.apertures, a, b, radius, frame);
                    band(this.apertures, a, b, radius * 0.55, openingIsOpen(opening) ? 0x83bdcc : 0x293241);
                } else {
                    const { hinge, angle } = doorLeaf(a, b, opening);
                    const length = distance(a, b);
                    const tip = {
                        x: hinge.x + length * Math.cos(angle),
                        y: hinge.y + length * Math.sin(angle),
                    };
                    band(this.apertures, hinge, tip, radius, 0x3d251a);
                    band(this.apertures, hinge, tip, radius * 0.65, 0xbd8656);
                    this.apertures.circle(hinge.x, hinge.y, radius * 0.7).fill(0xe2bc7e);
                }
            }
        }
    }
}

function band(g: Graphics, a: Point, b: Point, radius: number, fill: FillInput) {
    const length = distance(a, b);
    if (length < 0.0001) return;
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
