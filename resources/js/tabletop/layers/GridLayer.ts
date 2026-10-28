import { Graphics } from 'pixi.js';
import type { GridSettings } from '../types/scene';
export class GridLayer extends Graphics {
    update(grid: GridSettings, width: number, height: number) {
        this.clear();
        this.visible = grid.visible;
        const start = (v: number) => ((v % grid.size) + grid.size) % grid.size;
        for (let x = start(grid.offset.x); x <= width; x += grid.size)
            this.moveTo(x, 0).lineTo(x, height);
        for (let y = start(grid.offset.y); y <= height; y += grid.size)
            this.moveTo(0, y).lineTo(width, y);
        this.stroke({ color: 0xc0d1bb, width: 1, alpha: 0.13 });
    }
}
