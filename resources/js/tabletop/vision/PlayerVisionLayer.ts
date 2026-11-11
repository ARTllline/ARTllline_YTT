import {
    BufferImageSource,
    Container,
    Graphics,
    Matrix,
    Rectangle,
    RenderTexture,
    Sprite,
    Texture,
    type Renderer,
} from 'pixi.js';
import type { TokenMovement } from '../../api/workspace';
import { visibilityPlayback, visibilityPlaybackProgress } from './playback';
import type { Point, Scene } from '../types/scene';
import { explorationPixels } from './explorationPixels';
import { visionComposite } from './composite';
import { VISION_FEATHER_CELLS } from './coverage';
import { maskPixels } from '../lighting/model';

interface VisionMask {
    texture: Texture;
    pixels?: Uint8Array;
    cellSize?: number;
}

/** Two reusable masks feed exact entity clipping and bounded presentation easing. */
export class PlayerVisionLayer extends Container {
    private currentSurface?: VisionMask;
    private previousSurface?: VisionMask;
    readonly currentMask = new Sprite();
    private current = new Graphics();
    private composite?: ReturnType<typeof visionComposite>;
    private display?: ReturnType<typeof visionComposite>['display'];
    private memoryTexture?: Texture;
    private memoryPixels = new Uint8Array(0);
    private memory?: NonNullable<Scene['vision']>['explored'];
    private polygonKey = '';
    private prior?: Scene['vision'];
    private worldWidth = 0;
    private worldHeight = 0;
    private elapsed = 120;
    private transitionMs = 120;
    private playback = visibilityPlayback();
    private waitingForReceipt = false;
    private manual?: Texture;
    constructor() {
        super();
        this.addChild(this.currentMask);
        this.eventMode = 'none';
    }
    sync(
        renderer: Renderer,
        vision: Scene['vision'],
        width: number,
        height: number,
        movements?: readonly TokenMovement[],
        pendingMovement = false,
        reset = false,
    ) {
        if (reset) this.finishPresentation();
        this.visible = !!vision?.enabled;
        if (!this.visible) {
            this.prior = undefined;
            return;
        }
        if (movements?.length && this.waitingForReceipt) {
            this.playback = visibilityPlayback(movements);
            this.waitingForReceipt = false;
        }
        if (vision === this.prior && width === this.worldWidth && height === this.worldHeight)
            return;
        if (!this.composite) {
            this.composite = visionComposite();
            this.display = this.composite.display;
            this.addChildAt(this.display, 0);
        }
        const first = !this.prior;
        this.prior = vision;
        const resized = width !== this.worldWidth || height !== this.worldHeight;
        if (resized) {
            this.worldWidth = width;
            this.worldHeight = height;
            this.display!.scale.set(width, height);
            this.composite.uniforms.uniforms.uWorldSize.set([width, height]);
        }
        const raster = vision?.raster;
        const feather = VISION_FEATHER_CELLS * (raster?.cellSize ?? 0);
        const key = raster
            ? `${raster.width}:${raster.height}:${raster.cellSize}:${raster.bits}:${raster.darkvision ?? ''}`
            : JSON.stringify(vision?.polygons ?? []);
        if (resized || first || key !== this.polygonKey) {
            this.polygonKey = key;
            this.playback = visibilityPlayback(movements);
            this.transitionMs = Math.min(
                700,
                Math.max(120, ...(movements ?? []).map((m) => m.duration ?? 120)),
            );
            this.waitingForReceipt = !first && !resized && pendingMovement && !movements?.length;
            const reusable = this.previousSurface;
            this.composite.shader.resources.uPrevious = Texture.EMPTY.source;
            this.previousSurface = this.currentSurface;
            this.currentSurface = this.maskSurface(reusable, width, height, raster);
            const { texture, pixels } = this.currentSurface;
            if (raster) {
                maskPixels(raster.bits, pixels!, raster.darkvision);
                texture.source.update();
            } else {
                this.current.clear();
                for (const polygon of vision?.polygons ?? []) {
                    if (polygon.length >= 3)
                        this.current.poly(polygon.flatMap((p) => [p.x, p.y])).fill(0xffffff);
                }
                renderer.render({
                    container: this.current,
                    target: texture as RenderTexture,
                    clear: true,
                    transform: new Matrix().scale(texture.width / width, texture.height / height),
                });
            }
            this.currentMask.texture = texture;
            this.currentMask.width = width;
            this.currentMask.height = height;
            const previous = first || resized ? texture : this.previousSurface!.texture;
            this.composite.shader.resources.uCurrent = texture.source;
            this.composite.shader.resources.uPrevious = previous.source;
            const { uCurrentScale, uPreviousScale, uVisionFeather } = this.composite.uniforms.uniforms;
            uCurrentScale[0] = texture.frame.width / texture.source.width;
            uCurrentScale[1] = texture.frame.height / texture.source.height;
            uPreviousScale[0] = previous.frame.width / previous.source.width;
            uPreviousScale[1] = previous.frame.height / previous.source.height;
            uVisionFeather[0] = feather * uCurrentScale[0] / width;
            uVisionFeather[1] = feather * uCurrentScale[1] / height;
            this.elapsed = first || resized || reset ? this.transitionMs : 0;
        }
        const memory = vision?.explored;
        if (
            resized ||
            memory?.bits !== this.memory?.bits ||
            memory?.width !== this.memory?.width ||
            memory?.height !== this.memory?.height ||
            memory?.cellSize !== this.memory?.cellSize
        ) {
            this.memory = memory;
            const w = memory?.width ?? 1,
                h = memory?.height ?? 1;
            if (
                !this.memoryTexture ||
                this.memoryTexture.width !== w ||
                this.memoryTexture.height !== h
            ) {
                this.composite.shader.resources.uMemory = Texture.EMPTY.source;
                this.memoryTexture?.destroy(true);
                this.memoryPixels = new Uint8Array(w * h * 4);
                this.memoryTexture = new Texture({
                    source: new BufferImageSource({
                        resource: this.memoryPixels,
                        width: w,
                        height: h,
                        format: 'rgba8unorm',
                        scaleMode: 'linear',
                        alphaMode: 'premultiplied-alpha',
                    }),
                });
            }
            explorationPixels(memory, this.memoryPixels);
            this.memoryTexture.source.update();
            this.composite.shader.resources.uMemory = this.memoryTexture.source;
            this.composite.uniforms.uniforms.uMemoryScale.set([
                width / (w * (memory?.cellSize ?? width)),
                height / (h * (memory?.cellSize ?? height)),
            ]);
        }
        this.composite.uniforms.uniforms.uBase = memory ? 0.94 : 1;
        this.tick(0, false, undefined, pendingMovement);
    }
    private maskSurface(
        reusable: VisionMask | undefined,
        width: number,
        height: number,
        raster: NonNullable<Scene['vision']>['raster'],
    ): VisionMask {
        if (!raster) {
            const scale = Math.min(1, 4096 / Math.max(width, height));
            const w = Math.ceil(width * scale);
            const h = Math.ceil(height * scale);
            if (
                reusable && !reusable.pixels &&
                reusable.texture.width === w && reusable.texture.height === h
            )
                return reusable;
            reusable?.texture.destroy(true);
            return { texture: RenderTexture.create({ width: w, height: h, antialias: true }) };
        }
        const { width: w, height: h, cellSize } = raster;
        const frame = new Rectangle(0, 0, width / cellSize, height / cellSize);
        if (
            reusable?.cellSize === cellSize &&
            reusable.texture.source.width === w &&
            reusable.texture.source.height === h &&
            reusable.texture.frame.width === frame.width &&
            reusable.texture.frame.height === frame.height
        )
            return reusable;
        reusable?.texture.destroy(true);
        const pixels = new Uint8Array(w * h * 4);
        const texture = new Texture({
            source: new BufferImageSource({
                resource: pixels,
                width: w,
                height: h,
                format: 'rgba8unorm',
                scaleMode: 'linear',
            }),
            frame,
        });
        // The last server cell can extend past the world. Clip at the scene edge.
        texture.textureMatrix.clampMargin = 0;
        texture.textureMatrix.update();
        return { texture, pixels, cellSize };
    }
    setFogPresentation(texture: Texture | undefined, gm: boolean) {
        if (!this.composite || !this.visible) return;
        // Player masking consumes this sprite. The GM only samples its texture.
        if (gm) this.currentMask.renderable = false;
        if (texture !== this.manual) {
            this.manual = texture;
            this.composite.shader.resources.uManual = (texture ?? Texture.EMPTY).source;
        }
        const uniforms = this.composite.uniforms.uniforms;
        uniforms.uManualEnabled = texture ? 1 : 0;
        uniforms.uExplored = gm ? 0.28 : 0.63;
        uniforms.uBase = gm ? 0.58 : this.prior?.explored ? 0.94 : 1;
    }
    tick(
        deltaMs: number,
        reducedMotion: boolean,
        positions?: ReadonlyMap<string, Point>,
        pendingMovement = false,
    ) {
        if (!this.visible) return;
        const waiting = this.waitingForReceipt && pendingMovement;
        if (!waiting) {
            this.waitingForReceipt = false;
            this.elapsed = Math.min(this.transitionMs, this.elapsed + deltaMs);
        }
        const t = waiting
            ? 0
            : reducedMotion
              ? 1
              : Math.min(this.elapsed / this.transitionMs, visibilityPlaybackProgress(this.playback, positions));
        this.composite!.uniforms.uniforms.uProgress = t * t * (3 - 2 * t);
    }
    /** Discard presentation clocks on reset/disconnect; keep the last authority texture. */
    finishPresentation() {
        this.playback = [];
        this.waitingForReceipt = false;
        this.elapsed = this.transitionMs;
        if (this.composite) this.composite.uniforms.uniforms.uProgress = 1;
        this.focus();
    }
    /** A radius indicator clipped by current authority; it never computes visibility. */
    focus(position?: Point, radius = 0, zoom = 1) {
        const focus = this.composite?.uniforms.uniforms.uFocus;
        if (!focus) return;
        focus[0] = position?.x ?? 0;
        focus[1] = position?.y ?? 0;
        focus[2] = this.visible && position ? radius : 0;
        focus[3] = 2 / zoom;
    }
    override destroy() {
        this.currentMask.texture = Texture.EMPTY;
        this.current.destroy();
        this.composite?.shader.destroy();
        this.composite?.geometry.destroy();
        this.memoryTexture?.destroy(true);
        this.currentSurface?.texture.destroy(true);
        this.previousSurface?.texture.destroy(true);
        super.destroy({ children: true });
    }
}
