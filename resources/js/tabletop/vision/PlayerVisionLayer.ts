import {
    BufferImageSource,
    Container,
    Graphics,
    Matrix,
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
import { maskPixels } from '../lighting/model';

/** Exact authority is rasterized only on changes; a quad handles bounded reveal easing. */
export class PlayerVisionLayer extends Container {
    private currentTexture?: RenderTexture;
    private previousTexture?: RenderTexture;
    readonly currentMask = new Sprite();
    private current = new Graphics();
    private rasterLayer = new Container();
    private rasterSprite = new Sprite();
    private rasterTexture?: Texture;
    private rasterPixels = new Uint8Array(0);
    private composite?: ReturnType<typeof visionComposite>;
    private display?: ReturnType<typeof visionComposite>['display'];
    private memoryTexture?: Texture;
    private memoryPixels = new Uint8Array(0);
    private memoryKey = '';
    private polygonKey = '';
    private prior?: Scene['vision'];
    private worldWidth = 0;
    private worldHeight = 0;
    private elapsed = 120;
    private playback = visibilityPlayback();
    private waitingForReceipt = false;
    constructor() {
        super();
        this.addChild(this.currentMask);
        this.rasterLayer.addChild(this.rasterSprite);
        this.eventMode = 'none';
    }
    sync(
        renderer: Renderer,
        vision: Scene['vision'],
        width: number,
        height: number,
        movements?: readonly TokenMovement[],
        pendingMovement = false,
    ) {
        this.visible = !!vision?.enabled;
        if (!this.visible) {
            this.prior = undefined;
            return;
        }
        if (movements?.length) {
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
        const resized =
            !this.currentTexture || width !== this.worldWidth || height !== this.worldHeight;
        if (resized) {
            // Unbind readers before disposing resources. No instruction may retain a dead source.
            this.currentMask.texture = Texture.EMPTY;
            this.composite.shader.resources.uCurrent = Texture.EMPTY.source;
            this.composite.shader.resources.uPrevious = Texture.EMPTY.source;
            this.currentTexture?.destroy(true);
            this.previousTexture?.destroy(true);
            const scale = Math.min(1, 4096 / Math.max(width, height));
            const options = {
                width: Math.ceil(width * scale),
                height: Math.ceil(height * scale),
                antialias: true,
            };
            this.currentTexture = RenderTexture.create(options);
            this.previousTexture = RenderTexture.create(options);
            this.worldWidth = width;
            this.worldHeight = height;
            this.display!.scale.set(width, height);
        }
        const raster = vision?.raster;
        const key = JSON.stringify(raster ?? vision?.polygons ?? []);
        if (resized || first || key !== this.polygonKey) {
            this.polygonKey = key;
            this.playback = visibilityPlayback(movements);
            this.waitingForReceipt = !first && !resized && pendingMovement && !movements?.length;
            // Ping-pong two fixed surfaces; never allocate one per movement receipt.
            [this.previousTexture, this.currentTexture] = [
                this.currentTexture,
                this.previousTexture,
            ];
            if (raster) {
                this.syncRaster(raster);
            } else {
                this.current.clear();
                for (const polygon of vision?.polygons ?? []) {
                    if (polygon.length >= 3)
                        this.current.poly(polygon.flatMap((p) => [p.x, p.y])).fill(0xffffff);
                }
            }
            renderer.render({
                container: raster ? this.rasterLayer : this.current,
                target: this.currentTexture,
                clear: true,
                transform: new Matrix().scale(
                    this.currentTexture!.width / width,
                    this.currentTexture!.height / height,
                ),
            });
            this.currentMask.texture = this.currentTexture!;
            this.currentMask.width = width;
            this.currentMask.height = height;
            this.composite.shader.resources.uCurrent = this.currentTexture!.source;
            this.composite.shader.resources.uPrevious = (
                first || resized ? this.currentTexture! : this.previousTexture!
            ).source;
            this.elapsed = first || resized ? 120 : 0;
        }
        const memory = vision?.explored;
        const memoryKey = JSON.stringify(memory);
        if (resized || memoryKey !== this.memoryKey) {
            this.memoryKey = memoryKey;
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
    private syncRaster(raster: NonNullable<NonNullable<Scene['vision']>['raster']>) {
        const { width, height, cellSize } = raster;
        if (this.rasterTexture?.width !== width || this.rasterTexture.height !== height) {
            this.rasterSprite.texture = Texture.EMPTY;
            this.rasterTexture?.destroy(true);
            this.rasterPixels = new Uint8Array(width * height * 4);
            this.rasterTexture = new Texture({
                source: new BufferImageSource({
                    resource: this.rasterPixels,
                    width,
                    height,
                    format: 'rgba8unorm',
                    scaleMode: 'linear',
                }),
            });
            this.rasterSprite.texture = this.rasterTexture;
        }
        maskPixels(raster.bits, this.rasterPixels, raster.darkvision);
        this.rasterTexture.source.update();
        this.rasterSprite.scale.set(cellSize);
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
            this.elapsed = Math.min(120, this.elapsed + deltaMs);
        }
        const t = waiting
            ? 0
            : reducedMotion
              ? 1
              : Math.min(this.elapsed / 120, visibilityPlaybackProgress(this.playback, positions));
        this.composite!.uniforms.uniforms.uProgress = t * t * (3 - 2 * t);
    }
    override destroy() {
        this.currentMask.texture = Texture.EMPTY;
        this.current.destroy();
        this.rasterLayer.destroy({ children: true });
        this.rasterTexture?.destroy(true);
        this.composite?.shader.destroy();
        this.composite?.geometry.destroy();
        this.memoryTexture?.destroy(true);
        this.currentTexture?.destroy(true);
        this.previousTexture?.destroy(true);
        super.destroy({ children: true });
    }
}
