import type { Camera } from '../tabletop/renderer/camera/Camera';
import type { CameraState } from '../tabletop/types/scene';
import type { DirectorEvent } from './DirectorState';

/** Driven by the existing Pixi ticker, with no React updates per animation frame. */
export class DirectorCamera {
    private transition?: { from: CameraState; to: CameraState; elapsed: number; duration: number };
    private shake?: { elapsed: number; duration: number; amplitude: number };
    offset = { x: 0, y: 0 };
    constructor(private camera: Camera) {}
    apply(event: DirectorEvent, width: number, height: number, reduced: boolean) {
        this.camera.directed = true;
        this.camera.stop();
        const c = event.config,
            from = { ...this.camera.state };
        const duration = reduced ? 0 : (c.duration ?? 500);
        if (event.action === 'camera.shake') {
            this.shake = {
                elapsed: 0,
                duration,
                amplitude: reduced
                    ? 0
                    : ({ light: 2, medium: 5, strong: 9 }[c.strength ?? 'light'] ?? 2),
            };
            return;
        }
        const zoom = c.zoom ?? from.zoom;
        const x = c.x ?? (width / 2 - from.x) / from.zoom;
        const y = c.y ?? (height / 2 - from.y) / from.zoom;
        const to = { x: width / 2 - x * zoom, y: height / 2 - y * zoom, zoom };
        this.transition = { from, to, elapsed: 0, duration };
        this.tick(0);
    }
    tick(delta: number) {
        if (this.transition) {
            const t = this.transition;
            t.elapsed += delta;
            const progress = t.duration ? Math.min(1, t.elapsed / t.duration) : 1;
            const ease = progress * progress * (3 - 2 * progress);
            this.camera.state = {
                x: t.from.x + (t.to.x - t.from.x) * ease,
                y: t.from.y + (t.to.y - t.from.y) * ease,
                zoom: t.from.zoom + (t.to.zoom - t.from.zoom) * ease,
            };
            this.camera.stop();
            if (progress === 1) this.transition = undefined;
        }
        this.offset = { x: 0, y: 0 };
        if (this.shake) {
            const s = this.shake;
            s.elapsed += delta;
            const strength = s.duration ? s.amplitude * Math.max(0, 1 - s.elapsed / s.duration) : 0;
            this.offset = {
                x: Math.sin(s.elapsed * 0.073) * strength,
                y: Math.cos(s.elapsed * 0.091) * strength * 0.7,
            };
            if (s.elapsed >= s.duration) this.shake = undefined;
        }
    }
    release() {
        this.transition = this.shake = undefined;
        this.offset = { x: 0, y: 0 };
        this.camera.directed = false;
        this.camera.stop();
    }
}
