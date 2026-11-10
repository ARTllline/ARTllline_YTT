import { GUTTER, MASK_PIXELS, TILE_PIXELS, renderMask } from './renderMask';
import { alternateSurface, BLEND_SAMPLE, fillSurface, surfaceBlend } from './surfaceVariation';
import { CanvasSource, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import { ApiError, request } from '../../api/client';
import type { CameraState, Scene } from '../types/scene';
import { CHUNK, decodeMask, MASK, type Layers, type Terrain, type TerrainMaterial } from './model';

const canvas = (size: number) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    return c;
};
type Tile = { sprite: Sprite; canvas: HTMLCanvasElement; texture: Texture };

/** Derived RGB tiles are disposable. The editable source is always the separate alpha masks. */
export class TerrainLayer extends Container {
    private scene?: Scene;
    private bounds = new Graphics();
    private manifest?: Terrain;
    private hashes = new Map<string, string>();
    private data = new Map<string, { hash: string | null; layers: Layers }>();
    private requests = new Map<string, Promise<Layers>>();
    private images = new Map<string, ImageBitmap>();
    private imageRequests = new Set<string>();
    private tiles = new Map<string, Tile>();
    private dirty = new Set<string>();
    private preview = new Map<string, Layers>();
    private material?: TerrainMaterial;
    private abort = new AbortController();
    private maskCanvas?: HTMLCanvasElement;
    private maskPixels?: ImageData;
    private maskSamples = new Uint8Array(MASK_PIXELS * MASK_PIXELS);
    private scratch?: HTMLCanvasElement;
    private detailCanvas?: HTMLCanvasElement;
    private blendCanvas?: HTMLCanvasElement;
    private blendPixels?: ImageData;
    private failed = false;
    private stale = false;
    constructor(
        private onError: (message: string) => void,
        private onGap: () => void,
    ) {
        super();
        this.eventMode = 'none';
        this.addChild(this.bounds);
        this.mask = this.bounds;
    }
    sync(scene: Scene) {
        if (scene.width !== this.scene?.width || scene.height !== this.scene?.height)
            this.bounds.clear().rect(0, 0, scene.width, scene.height).fill(0xffffff);
        this.scene = scene;
        if (scene.terrain === this.manifest) return;
        if (this.stale) {
            this.failed = false;
            this.stale = false;
        }
        this.manifest = scene.terrain;
        const next = new Map(
            scene.terrain?.chunks.filter((c) => c.hash).map((c) => [c.key, c.hash!]) ?? [],
        );
        for (const key of new Set([...next.keys(), ...this.hashes.keys()])) {
            if (next.get(key) === this.hashes.get(key)) continue;
            this.preview.delete(key);
            this.data.delete(key);
            this.invalidate(key);
        }
        this.hashes = next;
        for (const key of this.data.keys()) if (!next.has(key)) this.data.delete(key);
        this.pruneImages();
    }
    private pruneImages() {
        const used = new Set(this.manifest?.materials.map((m) => m.versionId));
        if (this.material) used.add(this.material.versionId);
        for (const [id, image] of this.images)
            if (!used.has(id)) {
                image.close();
                this.images.delete(id);
            }
    }
    private invalidate(key: string) {
        const [x, y] = key.split(':').map(Number);
        for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) this.dirty.add(`${x + dx}:${y + dy}`);
    }
    async ensure(key: string): Promise<Layers> {
        const hash = this.hashes.get(key) ?? null;
        if (!hash) return {};
        const cached = this.data.get(key);
        if (cached?.hash === hash) return cached.layers;
        const pendingKey = `${key}/${hash}`;
        const pending = this.requests.get(pendingKey);
        if (pending) return pending;
        const [x, y] = key.split(':');
        const promise = request<{ layers: Record<string, string> }>(
            `/scenes/${this.scene!.id}/terrain/${x}/${y}?hash=${hash}`,
            'GET',
            undefined,
            this.abort.signal,
        )
            .then(({ layers }) => {
                const decoded = Object.fromEntries(
                    Object.entries(layers).map(([id, hex]) => [id, decodeMask(hex)]),
                );
                if (!this.abort.signal.aborted && this.hashes.get(key) === hash) {
                    this.data.set(key, { hash, layers: decoded });
                    this.invalidate(key);
                    this.failed = false;
                }
                return decoded;
            })
            .finally(() => this.requests.delete(pendingKey));
        this.requests.set(pendingKey, promise);
        return promise;
    }
    setPreview(key: string, layers: Layers, material?: TerrainMaterial) {
        this.material = material;
        this.pruneImages();
        this.preview.set(key, layers);
        this.invalidate(key);
    }
    cancelPreview() {
        this.preview.forEach((_, key) => this.invalidate(key));
        this.preview.clear();
        this.material = undefined;
        this.pruneImages();
    }
    private loadImage(material: TerrainMaterial) {
        if (this.images.has(material.versionId) || this.imageRequests.has(material.versionId))
            return;
        this.imageRequests.add(material.versionId);
        const scale = Math.min(1, 1024 / Math.max(material.asset.width, material.asset.height));
        void fetch(material.asset.url, { signal: this.abort.signal, credentials: 'same-origin' })
            .then((r) => {
                if (!r.ok) throw Error('Текстура покрытия недоступна.');
                return r.blob();
            })
            .then((blob) =>
                createImageBitmap(blob, {
                    resizeWidth: Math.max(1, Math.round(material.asset.width * scale)),
                    resizeHeight: Math.max(1, Math.round(material.asset.height * scale)),
                }),
            )
            .then((image) => {
                if (
                    this.abort.signal.aborted ||
                    (this.material?.versionId !== material.versionId &&
                        !this.manifest?.materials.some((m) => m.versionId === material.versionId))
                ) {
                    image.close();
                    return;
                }
                this.images.set(material.versionId, image);
                for (const key of new Set([...this.hashes.keys(), ...this.preview.keys()]))
                    this.dirty.add(key);
            })
            .catch((e: Error) => this.error(e))
            .finally(() => this.imageRequests.delete(material.versionId));
    }
    private error(error: Error) {
        if (this.abort.signal.aborted || this.failed) return;
        this.failed = true;
        if (error instanceof ApiError && error.status === 409) {
            this.stale = true;
            this.onGap();
            return;
        }
        this.onError(`${error.message} Покрытие не готово; обновите страницу для повтора.`);
        this.onGap();
    }
    private layers(key: string): Layers | undefined {
        return (
            this.preview.get(key) ??
            (this.hashes.has(key)
                ? this.data.get(key)?.hash === this.hashes.get(key)
                    ? this.data.get(key)?.layers
                    : undefined
                : {})
        );
    }
    tick(camera: CameraState, width: number, height: number) {
        if (!this.scene) return;
        const left = -camera.x / camera.zoom - CHUNK,
            top = -camera.y / camera.zoom - CHUNK;
        const right = left + width / camera.zoom + CHUNK * 2,
            bottom = top + height / camera.zoom + CHUNK * 2;
        const visible = new Set<string>();
        for (const key of new Set([...this.preview.keys(), ...this.hashes.keys()])) {
            const [x, y] = key.split(':').map(Number);
            if (
                (x + 1) * CHUNK < left ||
                x * CHUNK > right ||
                (y + 1) * CHUNK < top ||
                y * CHUNK > bottom
            )
                continue;
            visible.add(key);
            if (!this.layers(key) && this.requests.size < 4 && !this.failed)
                void this.ensure(key).catch((e: Error) => this.error(e));
        }
        for (const [key, tile] of this.tiles)
            if (!visible.has(key)) {
                tile.sprite.destroy();
                tile.texture.destroy(true);
                this.tiles.delete(key);
            }
        // Four derived uploads per frame; unchanged tiles never redraw on pointermove.
        let budget = 4;
        const deadline = performance.now() + 6;
        for (const key of visible) {
            if (!budget || (budget < 4 && performance.now() >= deadline)) break;
            if (this.tiles.has(key) && !this.dirty.has(key)) continue;
            if (this.draw(key)) {
                this.dirty.delete(key);
                budget--;
            }
        }
        // Drop invalidations for non-resident / empty neighbours; load invalidates them again.
        for (const key of this.dirty) if (!visible.has(key)) this.dirty.delete(key);
    }
    private draw(key: string): boolean {
        const [cx, cy] = key.split(':').map(Number);
        const sources = new Map<string, Layers>();
        for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
                const k = `${cx + dx}:${cy + dy}`;
                const layers = this.layers(k);
                if (!layers) {
                    if (this.requests.size < 4 && !this.failed)
                        void this.ensure(k).catch((e: Error) => this.error(e));
                    return false;
                }
                sources.set(k, layers);
            }
        const ids = new Set([...sources.values()].flatMap((l) => Object.keys(l)));
        const definitions = new Map(this.manifest?.materials.map((m) => [m.versionId, m]));
        if (this.material) definitions.set(this.material.versionId, this.material);
        for (const id of ids) {
            const material = definitions.get(id);
            if (!material) return false;
            if (!this.images.has(id)) {
                if (!this.failed) this.loadImage(material);
                return false;
            }
        }
        let tile = this.tiles.get(key);
        if (!tile) {
            const c = canvas(TILE_PIXELS),
                source = new CanvasSource({ resource: c, autoGenerateMipmaps: false });
            const texture = new Texture({
                source,
                frame: new Rectangle(GUTTER, GUTTER, CHUNK, CHUNK),
            });
            const sprite = new Sprite(texture);
            sprite.position.set(cx * CHUNK, cy * CHUNK);
            this.addChild(sprite);
            tile = { sprite, canvas: c, texture };
            this.tiles.set(key, tile);
        }
        const ctx = tile.canvas.getContext('2d')!;
        ctx.clearRect(0, 0, TILE_PIXELS, TILE_PIXELS);
        ctx.globalCompositeOperation = 'lighter';
        this.maskCanvas ??= canvas(TILE_PIXELS);
        this.scratch ??= canvas(TILE_PIXELS);
        const maskCtx = this.maskCanvas.getContext('2d')!,
            scratch = this.scratch.getContext('2d')!;
        const worldX = cx * CHUNK - GUTTER;
        const worldY = cy * CHUNK - GUTTER;
        let blend: HTMLCanvasElement | undefined;
        for (const id of ids) {
            const image = this.images.get(id)!,
                material = definitions.get(id)!;
            const pixels = (this.maskPixels ??= maskCtx.createImageData(TILE_PIXELS, TILE_PIXELS));
            const pad = GUTTER / 2;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const layer = sources.get(`${cx + dx}:${cy + dy}`)?.[id];
                    const left = dx === -1 ? 0 : dx === 0 ? pad : MASK + pad;
                    const top = dy === -1 ? 0 : dy === 0 ? pad : MASK + pad;
                    const width = dx === 0 ? MASK : pad;
                    const height = dy === 0 ? MASK : pad;
                    for (let row = top; row < top + height; row++) {
                        const target = row * MASK_PIXELS + left;
                        const source = (row - pad - dy * MASK) * MASK + left - pad - dx * MASK;
                        if (layer)
                            this.maskSamples.set(layer.subarray(source, source + width), target);
                        else this.maskSamples.fill(0, target, target + width);
                    }
                }
            }
            if (!this.maskSamples.some((alpha) => alpha !== 0)) continue;
            renderMask(this.maskSamples, pixels.data, worldX, worldY);
            maskCtx.putImageData(pixels, 0, 0);
            scratch.globalCompositeOperation = 'source-over';
            scratch.clearRect(0, 0, TILE_PIXELS, TILE_PIXELS);
            const pattern = scratch.createPattern(image, 'repeat')!;
            const resized = {
                ...material,
                asset: { ...material.asset, width: image.width, height: image.height },
            };
            fillSurface(scratch, pattern, resized, worldX, worldY, TILE_PIXELS);
            const alternate = alternateSurface(resized);
            if (alternate) {
                blend ??= this.prepareBlend(worldX, worldY);
                this.detailCanvas ??= canvas(TILE_PIXELS);
                const detail = this.detailCanvas.getContext('2d')!;
                detail.globalCompositeOperation = 'source-over';
                detail.clearRect(0, 0, TILE_PIXELS, TILE_PIXELS);
                fillSurface(detail, pattern, alternate, worldX, worldY, TILE_PIXELS);
                detail.globalCompositeOperation = 'destination-in';
                detail.drawImage(blend, 0, 0, TILE_PIXELS, TILE_PIXELS);
                scratch.globalCompositeOperation = 'source-atop';
                scratch.drawImage(this.detailCanvas, 0, 0);
            }
            scratch.globalCompositeOperation = 'destination-in';
            scratch.drawImage(this.maskCanvas, 0, 0, TILE_PIXELS, TILE_PIXELS);
            ctx.drawImage(this.scratch, 0, 0);
        }
        tile.texture.source.update();
        return true;
    }
    private prepareBlend(worldX: number, worldY: number) {
        const size = TILE_PIXELS / BLEND_SAMPLE;
        const surface = (this.blendCanvas ??= canvas(size));
        const ctx = surface.getContext('2d')!;
        const pixels = (this.blendPixels ??= ctx.createImageData(size, size));
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                pixels.data[(y * size + x) * 4 + 3] =
                    255 *
                    surfaceBlend(
                        worldX + (x + 0.5) * BLEND_SAMPLE,
                        worldY + (y + 0.5) * BLEND_SAMPLE,
                    );
            }
        }
        ctx.putImageData(pixels, 0, 0);
        return surface;
    }
    override destroy() {
        this.abort.abort();
        for (const image of this.images.values()) image.close();
        for (const tile of this.tiles.values()) {
            tile.sprite.destroy();
            tile.texture.destroy(true);
        }
        this.tiles.clear();
        this.data.clear();
        this.images.clear();
        this.preview.clear();
        this.mask = null;
        this.bounds.destroy();
        super.destroy();
    }
}
