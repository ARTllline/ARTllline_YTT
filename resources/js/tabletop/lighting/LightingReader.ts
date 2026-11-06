import { request } from '../../api/client';
import type { Scene } from '../types/scene';
import type { LightingProjection } from './model';

/** Coalesced independent reads. Never touches SaveQueue, route context or revisions. */
export class LightingReader {
    private key = '';
    private scene?: Scene;
    private pending = false;
    private abort?: AbortController;
    private timer?: ReturnType<typeof setTimeout>;
    private destroyed = false;
    private streamed = false;
    reset() {
        this.streamed = false;
        this.key = '';
        this.scene = undefined;
        this.abort?.abort();
        clearTimeout(this.timer);
    }
    streamedFrame() {
        this.streamed = true;
        this.abort?.abort();
        clearTimeout(this.timer);
    }
    constructor(
        private deliver: (value: LightingProjection) => void,
        private failed: () => void,
    ) {}

    sync(scene: Scene) {
        if (scene === this.scene) return;
        if (scene.id !== this.scene?.id) this.streamed = false;
        this.scene = scene;
        const key = scene.lighting?.enabled
            ? JSON.stringify([scene.id, scene.width, scene.height, scene.lighting])
            : '';
        if (this.streamed && scene.id === this.scene?.id) {
            this.key = key;
            this.abort?.abort();
            clearTimeout(this.timer);
            return;
        }
        if (key === this.key) return;
        this.key = key;
        if (!key) {
            this.abort?.abort();
            clearTimeout(this.timer);
            return;
        }
        this.schedule();
    }
    refresh() {
        this.streamed = false;
        this.key += ':refresh';
        this.schedule();
    }
    private schedule(delay = 35) {
        clearTimeout(this.timer);
        if (!this.pending && !this.destroyed && this.key)
            this.timer = setTimeout(() => void this.read(), delay);
    }
    private async read() {
        const key = this.key,
            scene = this.scene;
        if (!key || !scene?.id || this.destroyed) return;
        this.pending = true;
        this.abort = new AbortController();
        let retry = false;
        try {
            const result = await request<LightingProjection>(
                `/scenes/${scene.id}/lighting`,
                'GET',
                undefined,
                this.abort.signal,
            );
            // A late result cannot restore light emitters/masks revoked by a newer view.
            if (
                !this.destroyed &&
                key === this.key &&
                result.sceneId === this.scene?.id &&
                result.revision >= (scene.revision ?? 0) &&
                result.revision <= (this.scene.revision ?? 0)
            )
                this.deliver(result);
            else retry = true;
        } catch {
            if (!this.destroyed && !this.abort.signal.aborted) {
                this.failed();
                retry = true;
            }
        } finally {
            this.pending = false;
            if (retry || key !== this.key) this.schedule(retry && key === this.key ? 500 : 35);
        }
    }
    destroy() {
        this.destroyed = true;
        clearTimeout(this.timer);
        this.abort?.abort();
    }
}
