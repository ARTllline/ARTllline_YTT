import {
    BufferImageSource,
    Container,
    Graphics,
    Matrix,
    RenderTexture,
    Texture,
    Sprite,
    type Renderer,
} from 'pixi.js';
import type { Point, Scene } from '../types/scene';
import { LightingReader } from './LightingReader';
import { spillPixels } from './spill';
import { darkvisionComposite, lightShader, lightingComposite } from './shaders';
import {
    maskPixels,
    maskBytes,
    pointInPolygons,
    rgb,
    type LightingProjection,
    type LightingSettings,
    type LightingFrame,
    type RenderLight,
} from './model';

interface Emitter {
    active: boolean;
    model: RenderLight;
    draw: ReturnType<typeof lightShader>;
    texture: Texture;
    pixels: Uint8Array;
}
/** One persistent bounded lightmap, one mask/source. Idle/camera frames do no offscreen work. */
export class LightingLayer extends Container {
    readonly guides = new Graphics();
    private field = new Container();
    private ambient = new Graphics();
    private composite?: ReturnType<typeof lightingComposite>;
    private darkvision?: ReturnType<typeof darkvisionComposite>;
    private emitters = new Map<string, Emitter>();
    private target?: RenderTexture;
    private scene?: Scene;
    private dirty = true;
    private dimensions = '';
    private ambientKey = '';
    private maskSize = '';
    private fieldKey = '';
    private lastFrame?: LightingFrame;
    private spillSprite = new Sprite();
    private spillTexture?: Texture;
    private spillBuffer = new Uint8Array(0);
    private spillGeneration = 0;
    private spillKey = '';
    private reader = new LightingReader(
        (v) => this.accept(v),
        () => this.clearEmitters(),
    );
    // Safe opt-in diagnostics can wrap these counters; no GPU readback on the hot path.
    readonly metrics = { passes: 0, allocations: 0, maskUploads: 0 };

    constructor(private player: boolean) {
        super();
        this.eventMode = 'none';
        this.field.addChild(this.ambient);
        this.spillSprite.blendMode = 'add';
        this.field.addChild(this.spillSprite);
    }
    sync(scene: Scene, current?: Texture, preview?: LightingSettings) {
        if (scene.id !== this.scene?.id) {
            this.clearEmitters();
            this.lastFrame = undefined;
        }
        this.scene = scene;
        this.visible = !!(preview ?? scene.lighting)?.enabled;
        this.guides.clear();
        if (!this.player && preview) {
            for (const source of preview.sources ?? []) {
                const token = scene.tokens.find((t) => t.id === source.tokenId);
                const position = token ?? source;
                this.guides
                    .circle(position.x, position.y, source.radius)
                    .stroke({ color: source.color, alpha: 0.24, width: 2 });
                this.guides
                    .circle(position.x, position.y, 7)
                    .fill(source.color)
                    .stroke({ color: 0x111720, width: 2 });
            }
        }
        this.reader.sync(scene);
        if (!this.visible) return;
        if (!this.composite) {
            this.composite = lightingComposite();
            this.addChild(this.composite.mesh);
        }
        this.composite.uniforms.uniforms.uClipped = this.player && scene.vision?.enabled ? 1 : 0;
        this.composite.shader.resources.uCurrent = current?.source ?? Texture.EMPTY.source;
        const darkvision = this.player && !!scene.vision?.raster?.darkvision;
        if (darkvision && !this.darkvision) {
            this.darkvision = darkvisionComposite();
            this.addChild(this.darkvision.mesh);
        }
        if (this.darkvision) {
            this.darkvision.mesh.visible = darkvision;
            this.darkvision.mesh.scale.set(scene.width, scene.height);
            this.darkvision.shader.resources.uCurrent = current?.source ?? Texture.EMPTY.source;
        }
        const dimensions = `${scene.id}:${scene.width}:${scene.height}`;
        if (dimensions !== this.dimensions) {
            this.dimensions = dimensions;
            this.composite.shader.resources.uLightmap = Texture.EMPTY.source;
            this.target?.destroy(true);
            const scale = Math.min(1, 1024 / Math.max(scene.width, scene.height));
            this.target = RenderTexture.create({
                width: Math.ceil(scene.width * scale),
                height: Math.ceil(scene.height * scale),
            });
            this.metrics.allocations++;
            this.composite.shader.resources.uLightmap = this.target.source;
            this.composite.mesh.scale.set(scene.width, scene.height);
            this.dirty = true;
        }
        const lighting = (preview ?? scene.lighting)!;
        let lightFloor = 0;
        if (!this.player) {
            // Keep unlit terrain legible for the GM even when gameplay ambient is zero.
            lightFloor = Math.max(0, 0.24 - lighting.brightness);
        } else if (scene.vision?.enabled && scene.vision.raster) {
            // The darkness raster admits only lit or Darkvision cells. Keep
            // the edge of a torch readable next to explored Fog.
            lightFloor = 0.46;
        }
        this.composite.uniforms.uniforms.uLightFloor = lightFloor;
        const ambientKey = `${lighting.brightness}:${lighting.color}:${dimensions}`;
        if (ambientKey !== this.ambientKey) {
            this.ambientKey = ambientKey;
            const [r, g, b] = rgb(lighting.color).map((v) =>
                Math.round(v * lighting.brightness * 255),
            );
            this.ambient
                .clear()
                .rect(0, 0, scene.width, scene.height)
                .fill((r << 16) | (g << 8) | b);
            this.dirty = true;
        }
        // Immediate revocation while the independent request is in flight.
        const raster = scene.vision?.raster;
        const currentBits = raster ? maskBytes(raster.bits) : '';
        for (const emitter of this.emitters.values()) {
            const model = emitter.model;
            const token = model.tokenId
                ? scene.tokens.find((t) => t.id === model.tokenId)
                : undefined;
            const visible =
                emitter.active &&
                (!this.player ||
                    (model.tokenId
                        ? !!token && !token.isHidden
                        : !scene.vision?.enabled || (raster
                            ? this.rasterContains(model, raster, currentBits)
                            : pointInPolygons(model, scene.vision.polygons))));
            if (emitter.draw.mesh.visible !== visible) {
                emitter.draw.mesh.visible = visible;
                this.dirty = true;
            }
        }
    }
    private rasterContains(point: Point, raster: NonNullable<NonNullable<Scene['vision']>['raster']>, bits: string) {
        const x = Math.floor(point.x / raster.cellSize);
        const y = Math.floor(point.y / raster.cellSize);
        if (x < 0 || x >= raster.width || y < 0 || y >= raster.height) return false;
        const index = y * raster.width + x;
        return !!(bits.charCodeAt(index >> 3) & (1 << (index & 7)));
    }
    frame(frame: LightingFrame) {
        if (frame.sceneId !== this.scene?.id || frame === this.lastFrame) return;
        this.lastFrame = frame;
        if (frame.render) {
            this.reader.streamedFrame();
            this.accept(frame.render);
        } else {
            this.reader.refresh();
        }
    }
    reset() {
        this.lastFrame = undefined;
        this.reader.reset();
    }
    private accept(projection: LightingProjection) {
        const scene = this.scene;
        if (!scene || projection.sceneId !== scene.id) return;
        const fieldKey = JSON.stringify([
            scene.id,
            projection.width,
            projection.height,
            projection.sources,
            projection.spill,
        ]);
        if (fieldKey === this.fieldKey) return;
        const size = `${projection.width}:${projection.height}`;
        if (size !== this.maskSize) {
            this.clearEmitters();
            this.maskSize = size;
        }
        this.fieldKey = fieldKey;
        void this.updateSpill(projection);
        const ids = new Set(projection.sources.map((v) => v.id));
        for (const [id, emitter] of this.emitters) {
            emitter.active = ids.has(id);
            emitter.draw.mesh.visible = emitter.active;
        }
        for (const model of projection.sources) {
            let emitter = this.emitters.get(model.id);
            if (!emitter) {
                if (this.emitters.size >= 16) {
                    const unused = [...this.emitters].find(([, e]) => !e.active);
                    if (unused) this.removeEmitter(...unused);
                }
                const pixels = new Uint8Array(projection.width * projection.height * 4);
                const texture = new Texture({
                    source: new BufferImageSource({
                        resource: pixels,
                        width: projection.width,
                        height: projection.height,
                        format: 'rgba8unorm',
                        scaleMode: 'linear',
                        alphaMode: 'premultiplied-alpha',
                    }),
                });
                const draw = lightShader();
                draw.shader.resources.uMask = texture.source;
                emitter = { active: true, model: { ...model, mask: '' }, pixels, texture, draw };
                this.field.addChild(draw.mesh);
                this.emitters.set(model.id, emitter);
                this.metrics.allocations++;
            }
            if (emitter.model.mask !== model.mask) {
                maskPixels(model.mask, emitter.pixels);
                emitter.texture.source.update();
                this.metrics.maskUploads++;
            }
            emitter.model = model;
            const u = emitter.draw.uniforms.uniforms;
            u.uWorld.set([scene.width, scene.height]);
            u.uOrigin.set([model.x, model.y]);
            u.uMaskScale.set([
                scene.width / (projection.width * projection.cellSize),
                scene.height / (projection.height * projection.cellSize),
            ]);
            u.uTint.set(rgb(model.color));
            u.uRadius = model.radius;
            u.uIntensity = model.intensity;
            u.uFalloff = model.falloff;
            // Shade only the emitter's footprint; the lightmap viewport clips map edges.
            emitter.draw.mesh.scale.set(model.radius * 2);
            emitter.draw.mesh.position.set(model.x - model.radius, model.y - model.radius);
        }
        this.dirty = true;
    }
    private async updateSpill(projection: LightingProjection) {
        const key = `${projection.width}:${projection.height}:${projection.spill ?? ''}`;
        if (key === this.spillKey) return;
        this.spillKey = key;
        const generation = ++this.spillGeneration;
        if (!projection.spill) {
            if (this.spillSprite.visible) this.dirty = true;
            this.spillSprite.visible = false;
            return;
        }
        try {
            const pixels = await spillPixels(
                projection.spill,
                projection.width * projection.height * 4,
            );
            if (generation !== this.spillGeneration || this.destroyed) return;
            if (
                !this.spillTexture ||
                this.spillTexture.width !== projection.width ||
                this.spillTexture.height !== projection.height
            ) {
                this.spillSprite.texture = Texture.EMPTY;
                this.spillTexture?.destroy(true);
                this.spillBuffer = new Uint8Array(pixels.length);
                this.spillTexture = new Texture({
                    source: new BufferImageSource({
                        resource: this.spillBuffer,
                        width: projection.width,
                        height: projection.height,
                        format: 'rgba8unorm',
                        scaleMode: 'linear',
                        alphaMode: 'premultiplied-alpha',
                    }),
                });
                this.spillSprite.texture = this.spillTexture;
                this.metrics.allocations++;
            }
            this.spillBuffer.set(pixels);
            this.spillTexture.source.update();
            this.spillSprite.width = projection.width * projection.cellSize;
            this.spillSprite.height = projection.height * projection.cellSize;
            this.spillSprite.visible = true;
            this.metrics.maskUploads++;
            this.dirty = true;
        } catch {
            if (generation === this.spillGeneration) {
                this.spillSprite.visible = false;
                this.dirty = true;
            }
        }
    }
    tick(renderer: Renderer, positions: ReadonlyMap<string, Point>) {
        if (!this.visible || !this.target || !this.scene) return;
        for (const emitter of this.emitters.values()) {
            if (!emitter.draw.mesh.visible || !emitter.model.tokenId) continue;
            const position = positions.get(emitter.model.tokenId);
            const u = emitter.draw.uniforms.uniforms;
            if (
                position &&
                (u.uOrigin[0] !== Math.fround(position.x) ||
                    u.uOrigin[1] !== Math.fround(position.y))
            ) {
                u.uOrigin.set([position.x, position.y]);
                emitter.draw.mesh.position.set(
                    position.x - emitter.model.radius,
                    position.y - emitter.model.radius,
                );
                this.dirty = true;
            }
        }
        if (!this.dirty) return;
        renderer.render({
            container: this.field,
            target: this.target,
            clear: true,
            transform: new Matrix().scale(
                this.target.width / this.scene.width,
                this.target.height / this.scene.height,
            ),
        });
        this.metrics.passes++;
        this.dirty = false;
    }
    private removeEmitter(id: string, emitter: Emitter) {
        emitter.draw.shader.resources.uMask = Texture.EMPTY.source;
        emitter.draw.mesh.removeFromParent();
        emitter.draw.mesh.destroy();
        emitter.draw.shader.destroy();
        emitter.draw.geometry.destroy();
        emitter.texture.destroy(true);
        this.emitters.delete(id);
        this.dirty = true;
    }
    private clearEmitters() {
        this.fieldKey = '';
        this.spillKey = '';
        this.spillGeneration++;
        this.spillSprite.visible = false;
        this.dirty = true;
        for (const [id, emitter] of this.emitters) this.removeEmitter(id, emitter);
    }
    override destroy() {
        this.darkvision?.shader.destroy();
        this.darkvision?.geometry.destroy();
        this.spillGeneration++;
        this.reader.destroy();
        this.clearEmitters();
        if (this.composite) {
            this.composite.shader.resources.uCurrent = Texture.EMPTY.source;
            this.composite.shader.resources.uLightmap = Texture.EMPTY.source;
            this.composite.shader.destroy();
            this.composite.geometry.destroy();
        }
        this.target?.destroy(true);
        this.spillSprite.texture = Texture.EMPTY;
        this.spillTexture?.destroy(true);
        this.field.destroy({ children: true });
        super.destroy({ children: true });
    }
}
