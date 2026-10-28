import { Graphics } from 'pixi.js';
import type { GridSettings, Point } from '../types/scene';
export class InteractionLayer extends Graphics {
    showMarquee(a: Point, b: Point, zoom: number) {
        this.clear()
            .rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y))
            .fill({ color: 0xa6d9c3, alpha: 0.12 })
            .stroke({ color: 0xc0ecd4, width: 1 / zoom });
    }
    showBrush(point: Point, radius: number, zoom: number, cover: boolean) {
        this.clear()
            .circle(point.x, point.y, radius)
            .stroke({ color: cover ? 0xd9ac97 : 0xb6e3cf, width: 1.5 / zoom, alpha: 0.9 });
    }
    showSnap(point: Point | null, grid: GridSettings) {
        this.clear();
        if (!point || !grid.snap) return;
        this.rect(point.x - grid.size / 2, point.y - grid.size / 2, grid.size, grid.size)
            .fill({ color: 0xa6d9c3, alpha: 0.08 })
            .stroke({ color: 0xc0ecd4, width: 1.5, alpha: 0.7 });
    }
}
