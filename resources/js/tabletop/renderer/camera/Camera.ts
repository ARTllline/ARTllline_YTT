import type { CameraState, Point } from '../../types/scene';
import { clamp, MAX_ZOOM, MIN_ZOOM, zoomAt } from '../../utils/coordinates';
export class Camera {
    state: CameraState = { x: 0, y: 0, zoom: 1 };
    private target = 1;
    private anchor: Point = { x: 0, y: 0 };
    private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    fit(width: number, height: number, sceneWidth: number, sceneHeight: number) {
        const zoom = clamp(
            Math.min((width - 80) / sceneWidth, (height - 150) / sceneHeight),
            MIN_ZOOM,
            1.2,
        );
        this.state = {
            x: (width - sceneWidth * zoom) / 2,
            y: (height - sceneHeight * zoom) / 2 + 12,
            zoom,
        };
        this.target = zoom;
    }
    pan(dx: number, dy: number) {
        this.target = this.state.zoom;
        this.state = { ...this.state, x: this.state.x + dx, y: this.state.y + dy };
    }
    zoomBy(factor: number, anchor: Point) {
        this.target = clamp(this.target * factor, MIN_ZOOM, MAX_ZOOM);
        this.anchor = anchor;
    }
    stop() {
        this.target = this.state.zoom;
    }
    tick(deltaMs: number) {
        if (Math.abs(this.target - this.state.zoom) < 0.00001) return false;
        const t = this.reducedMotion.matches ? 1 : 1 - Math.exp(-deltaMs / 55);
        const zoom =
            Math.abs(this.target - this.state.zoom) < 0.0001
                ? this.target
                : this.state.zoom + (this.target - this.state.zoom) * t;
        this.state = zoomAt(this.state, this.anchor, zoom);
        return true;
    }
}
