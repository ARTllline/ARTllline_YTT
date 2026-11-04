import type { SceneStore } from '../state/SceneStore';
import type { Point } from '../types/scene';
import type { TerrainLayer } from './TerrainLayer';
import { paintMasks, type Layers, type TerrainMaterial, type TerrainStroke } from './model';
import {
    MAX_STROKE_POINTS,
    type RasterReply,
    type RasterRequest,
    type RasterSettings,
} from './StrokeRaster';

type Draft = {
    stroke: TerrainStroke;
    material?: TerrainMaterial;
    worker: Worker;
    settings?: RasterSettings;
    hashes: Map<string, string | null>;
    width: number;
    height: number;
    before: Map<string, Layers>;
    dirty: Map<string, Uint8Array>;
    loading: Set<string>;

    cursor: number;
    busy: boolean;
    released: boolean;
    limit?: string;
    frame?: number;
};

export class TerrainGesture {
    private draft?: Draft;
    constructor(
        private store: SceneStore,
        private layer: TerrainLayer,
    ) {}
    get active() {
        return !!this.draft;
    }
    get brush() {
        return this.draft?.stroke;
    }
    down(point: Point) {
        if (this.draft) return false;
        const state = this.store.getSnapshot();
        const settings = state.mapEditor?.terrain;
        if (
            !settings?.active ||
            !state.scene.mapWorld ||
            !this.store.objectEditingEnabled ||
            this.store.role !== 'gm'
        )
            return false;
        if (settings.operation === 'paint' && !settings.material) {
            this.store.editorNotice('Выберите материал.');
            return false;
        }
        const { scene } = state;
        const stroke: TerrainStroke = {
            operation: settings.operation,
            materialVersionId: settings.material?.versionId,
            size: settings.size,
            softness: settings.softness,
            strength: settings.strength,
            points: [],
            expected: {},
        };
        const hashes = new Map(scene.terrain?.chunks.map(({ key, hash }) => [key, hash]));
        const worker = new Worker(new URL('./stroke.worker.ts', import.meta.url), {
            type: 'module',
        });
        const draft: Draft = {
            stroke,
            worker,
            material: settings.material,
            settings: {
                stroke,
                width: scene.width,
                height: scene.height,
                occupied: [...hashes.keys()],
            },
            hashes,
            width: scene.width,
            height: scene.height,
            before: new Map(),
            dirty: new Map(),
            loading: new Set(),

            cursor: 0,
            busy: false,
            released: false,
        };
        this.draft = draft;
        worker.onerror = () => {
            if (this.draft === draft) this.fail('Не удалось рассчитать покрытие. Повторите мазок.');
        };
        worker.onmessage = ({ data }: MessageEvent<RasterReply>) => {
            if (this.draft !== draft) return;
            draft.busy = false;
            draft.cursor += data.consumed;
            for (const [key, mask] of data.dirty) {
                draft.stroke.expected[key] = draft.hashes.get(key) ?? null;
                draft.dirty.set(key, mask);
            }
            if (data.limit) {
                draft.limit = data.limit;
                draft.stroke.points.length = draft.cursor;
                this.store.editorNotice(
                    data.limit + ' Отпустите кисть, чтобы сохранить нарисованную часть.',
                );
            }
            this.send(draft);
            this.schedule(draft);
        };
        this.move(point);
        return true;
    }
    move(point: Point, final = false) {
        const d = this.draft;
        if (!d || d.released || d.limit) return;

        const b = {
            x: Math.round(Math.max(0, Math.min(d.width, point.x)) * 4) / 4,
            y: Math.round(Math.max(0, Math.min(d.height, point.y)) * 4) / 4,
        };
        const a = d.stroke.points.at(-1);
        if (a && a.x === b.x && a.y === b.y) return;
        if (a && !final && Math.hypot(b.x - a.x, b.y - a.y) < Math.max(2, d.stroke.size / 12))
            return;
        if (d.stroke.points.length >= MAX_STROKE_POINTS) {
            d.limit = 'Достигнут предел точек мазка.';
            this.store.editorNotice(
                d.limit + ' Отпустите кисть, чтобы сохранить нарисованную часть.',
            );
            return;
        }
        d.stroke.points.push(b);
        this.send(d);
    }
    private send(d: Draft) {
        if (d.busy || d.cursor === d.stroke.points.length) return;
        const points = d.stroke.points.slice(d.cursor, d.cursor + 32);
        const message: RasterRequest = { points, settings: d.settings };
        d.worker.postMessage(message);
        d.settings = undefined;
        d.busy = true;
    }
    private schedule(d: Draft) {
        if (d.frame !== undefined) return;
        d.frame = requestAnimationFrame(() => {
            d.frame = undefined;
            if (this.draft !== d) return;
            if (d.released && !d.busy && d.cursor === d.stroke.points.length) {
                this.commit(d);
                return;
            }
            let painted = 0;
            for (const [key, mask] of d.dirty) {
                const before = d.before.get(key);
                if (before) {
                    d.dirty.delete(key);
                    this.layer.setPreview(key, paintMasks(before, mask, d.stroke), d.material);
                    if (++painted === 2) break;
                } else if (!d.stroke.expected[key]) {
                    d.before.set(key, {});
                } else if (!d.loading.has(key) && d.loading.size < 4) {
                    d.loading.add(key);
                    void this.layer
                        .ensure(key)
                        .then((layers) => {
                            if (this.draft !== d) return;
                            d.loading.delete(key);
                            d.before.set(key, layers);
                            this.schedule(d);
                        })
                        .catch((error: Error) => {
                            if (this.draft === d) this.fail(error.message);
                        });
                }
            }
            if ([...d.dirty.keys()].some((key) => d.before.has(key))) this.schedule(d);
        });
    }
    up(point: Point) {
        this.move(point, true);
        const d = this.draft;
        if (!d) return;
        d.released = true;
        this.schedule(d);
    }
    private commit(d: Draft) {
        const { scene, mapEditor } = this.store.getSnapshot();
        if (!this.store.objectEditingEnabled || !mapEditor) {
            this.fail('Дождитесь сохранения предыдущей правки и повторите мазок.');
            return;
        }
        if (scene.width !== d.width || scene.height !== d.height || !scene.mapWorld) {
            this.fail('Границы карты изменились во время мазка. Повторите его.');
            return;
        }
        const hashes = new Map(scene.terrain?.chunks.map(({ key, hash }) => [key, hash]));
        if (
            Object.entries(d.stroke.expected).some(
                ([key, hash]) => (hashes.get(key) ?? null) !== hash,
            )
        ) {
            this.fail('Покрытие изменилось во время мазка. Повторите его.');
            return;
        }
        this.stop();
        if (Object.keys(d.stroke.expected).length)
            this.store.terrainStroke(d.stroke, () => this.layer.cancelPreview());
        else this.layer.cancelPreview();
    }
    private fail(message: string) {
        this.cancel();
        this.store.editorNotice(message);
    }
    private stop() {
        this.draft?.worker.terminate();
        if (this.draft?.frame !== undefined) cancelAnimationFrame(this.draft.frame);
        this.draft = undefined;
    }
    cancel() {
        this.stop();
        this.layer.cancelPreview();
    }
}
