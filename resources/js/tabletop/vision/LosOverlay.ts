import { Graphics } from 'pixi.js';
import { debugRays, type LosDebug } from './model';

export class LosOverlay extends Graphics {
    private current?: LosDebug;
    sync(debug?: LosDebug) {
        if (debug === this.current) return;
        this.current = debug;
        this.clear();
        if (!debug) return;
        if (debug.polygon && debug.polygon.length >= 3)
            this.poly(debug.polygon.flatMap((p) => [p.x, p.y]))
                .fill({ color: 0x86e3b0, alpha: 0.12 })
                .stroke({ color: 0x86e3b0, width: 1, alpha: 0.7 });
        const origin = debug.observer;
        if (debug.range !== null)
            this.circle(origin.x, origin.y, debug.range).stroke({
                color: 0xb6c8e0,
                width: 1,
                alpha: 0.35,
            });
        for (const ray of debugRays(debug)) {
            const color = ray.visible
                ? 0x86e3b0
                : ray.reason === 'out_of_range'
                  ? 0xe5bb77
                  : 0xf18e8e;
            const end = ray.blocker?.point ?? ray.target;
            this.moveTo(origin.x, origin.y)
                .lineTo(end.x, end.y)
                .stroke({ color, width: 1.5, alpha: 0.7 });
            if (ray.blocker) {
                this.circle(end.x, end.y, 3).fill(color);
                this.moveTo(end.x, end.y)
                    .lineTo(ray.target.x, ray.target.y)
                    .stroke({ color, width: 1, alpha: 0.18 });
            }
            this.circle(ray.target.x, ray.target.y, 2.5).fill(color);
        }
        this.circle(origin.x, origin.y, 6).stroke({ color: 0xe4fff0, width: 2 });
    }
}
