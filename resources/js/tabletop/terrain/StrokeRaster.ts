import type { Point } from '../types/scene';
import { MAX_TERRAIN_CHUNKS, StrokeCoverage, StrokeLimit, type TerrainStroke } from './model';

export const MAX_STROKE_POINTS = 8192;

export type RasterSettings = {
    stroke: Pick<TerrainStroke, 'operation' | 'size' | 'softness' | 'strength'>;
    width: number;
    height: number;
    occupied: string[];
};

export class StrokeRaster {
    private coverage = new StrokeCoverage();
    private last?: Point;
    private occupied: Set<string>;
    private count = 0;
    private added = 0;

    constructor(private settings: RasterSettings) {
        this.occupied = new Set(settings.occupied);
    }

    batch(points: Point[]) {
        const dirty = new Map<string, Uint8Array>();
        let limit: string | undefined;
        const { stroke, width, height } = this.settings;
        const include =
            stroke.operation === 'erase' ? (key: string) => this.occupied.has(key) : undefined;
        const start = performance.now();
        let consumed = 0;
        for (const point of points) {
            if (this.count >= MAX_STROKE_POINTS) {
                limit = 'Достигнут предел точек мазка.';
                break;
            }
            let changed: Set<string>;
            try {
                changed = this.coverage.add(
                    this.last ?? point,
                    point,
                    stroke,
                    width,
                    height,
                    include,
                );
            } catch (error) {
                if (!(error instanceof StrokeLimit)) throw error;
                limit = error.message;
                break;
            }
            if (stroke.operation === 'paint') {
                let added = 0;
                for (const key of changed) if (!this.occupied.has(key)) added++;
                if (this.added + added + this.settings.occupied.length > MAX_TERRAIN_CHUNKS) {
                    limit = 'Достигнут предел 256 участков покрытия.';
                    break;
                }
                this.added += added;
                changed.forEach((key) => this.occupied.add(key));
            }
            // Copy only on the way out. A rejected segment may have modified these blocks.
            for (const key of changed) dirty.set(key, this.coverage.chunks.get(key)!.slice());
            this.last = point;
            this.count++;
            consumed++;
            if (performance.now() - start >= 8) break;
        }
        return { consumed, limit, dirty: [...dirty] };
    }
}

export type RasterReply = ReturnType<StrokeRaster['batch']>;
export type RasterRequest = { points: Point[]; settings?: RasterSettings };
