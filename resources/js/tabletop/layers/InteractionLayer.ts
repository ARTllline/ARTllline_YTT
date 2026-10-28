import { Graphics } from 'pixi.js';
import type { GridSettings, Point } from '../types/scene';
export class InteractionLayer extends Graphics {
    showSnap(point: Point | null, grid: GridSettings) {
        this.clear();
        if (!point || !grid.snap) return;
        this.rect(point.x - grid.size / 2, point.y - grid.size / 2, grid.size, grid.size)
            .fill({ color: 0xa6d9c3, alpha: 0.08 })
            .stroke({ color: 0xc0ecd4, width: 1.5, alpha: 0.7 });
    }
}
