import type { SceneStore } from '../../state/SceneStore';
import type { Point, Tool } from '../../types/scene';
import type { FogStroke, SpatialEvent, SpatialKind } from '../../types/spatial';
import { distance, spatialSnap } from '../../utils/spatialGeometry';

export class SpatialGesture {
    private stroke: FogStroke | null = null;
    private event: SpatialEvent | null = null;
    private lastSent = 0;
    constructor(private store: SceneStore) {}
    down(tool: Tool, point: Point) {
        const spatial = this.store.spatial;
        if (tool === 'fog') {
            if (this.store.role !== 'gm') return;
            this.stroke = {
                operation: spatial.settings.operation,
                shape: spatial.settings.shape,
                geometry: {
                    points: [point],
                    ...(spatial.settings.shape === 'brush'
                        ? { radius: spatial.settings.radius }
                        : {}),
                },
            };
            spatial.draft = this.stroke;
        } else {
            const start = tool === 'ping' ? point : this.snap(point);
            this.event = {
                type: 'spatial',
                sceneId: this.store.getSnapshot().scene.id!,
                epoch: spatial.epoch,
                participant: spatial.identity,
                kind: tool as SpatialKind,
                sessionId: crypto.randomUUID(),
                startedAt: spatial.nextSessionTime(),
                sequence: 0,
                phase: 'update',
                start,
                end: start,
            };
            this.publish(tool === 'ping' ? 'end' : 'update');
            if (tool === 'ping') this.event = null;
        }
    }
    private snap(point: Point) {
        return spatialSnap(
            point,
            this.store.getSnapshot().scene.grid,
            this.store.spatial.settings.snap,
        );
    }
    move(point: Point) {
        if (this.stroke) {
            const points = [...this.stroke.geometry.points];
            if (this.stroke.shape === 'rectangle') points[1] = point;
            else if (
                distance(points[points.length - 1], point) >=
                Math.max(3, (this.stroke.geometry.radius ?? 90) / 8)
            ) {
                // Bound each logical stroke without ever splitting it into database writes.
                if (points.length >= 511)
                    points.splice(
                        1,
                        points.length - 2,
                        ...points.slice(1, -1).filter((_, i) => i % 2 === 0),
                    );
                points.push(point);
            }
            this.stroke = { ...this.stroke, geometry: { ...this.stroke.geometry, points } };
            this.store.spatial.draft = this.stroke;
        }
        if (this.event) {
            this.event = { ...this.event, end: this.snap(point) };
            // Local geometry is immediate; network sampling is capped independently.
            this.store.spatial.overlays.set(this.event.participant.id, {
                event: this.event,
                born: performance.now(),
                expires: performance.now() + 1800,
            });
            if (performance.now() - this.lastSent >= 80) this.publish('update');
        }
    }
    up(point: Point) {
        this.move(point);
        if (this.stroke) {
            if (this.stroke.shape === 'rectangle' && this.stroke.geometry.points.length === 1)
                this.stroke.geometry.points.push(point);
            this.store.applyFog(this.stroke);
        }
        if (this.event) this.publish('end');
        this.stroke = null;
        this.event = null;
        this.store.spatial.draft = null;
    }
    cancel() {
        if (this.event) this.publish('cancel');
        this.stroke = null;
        this.event = null;
        this.store.spatial.draft = null;
    }
    clearFinished() {
        const state = this.store.spatial;
        const prior = state.overlays.get(state.identity.id)?.event;
        if (prior) state.send({ ...prior, phase: 'cancel', sequence: prior.sequence + 1 });
    }
    tick() {
        if (!this.event) return;
        const local = this.store.spatial.overlays.get(this.event.participant.id);
        if (local) local.expires = performance.now() + 1800;
        // Holding a ruler still is intentional; renew it without pointer/React churn.
        if (performance.now() - this.lastSent >= 1000) this.publish('update');
    }
    private publish(phase: SpatialEvent['phase']) {
        if (!this.event) return;
        this.event = { ...this.event, sequence: this.event.sequence + 1, phase };
        this.store.spatial.send(this.event);
        this.lastSent = performance.now();
    }
}
