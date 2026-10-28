import type { RegionLayer } from '../../layers/RegionLayer';
import type { SceneStore } from '../../state/SceneStore';
import type { Point } from '../../types/scene';
import type { Region } from '../../../automation/model';
import { drawRegion, transformRegion } from '../../../automation/geometry';

export class RegionGesture {
    private drag?: {
        start: Point;
        point: Point;
        original?: Region;
        resize: boolean;
        moved: boolean;
    };
    constructor(
        private store: SceneStore,
        private layer: RegionLayer,
    ) {}
    down(point: Point) {
        if (!this.store.objectEditingEnabled) return;
        this.store.regionSettings({ showRegions: true });
        const resize = this.layer.resizeHit(point),
            id = resize ?? this.layer.hit(point);
        this.store.selectRegion(id);
        this.drag = {
            start: point,
            point,
            original: this.store.getSnapshot().scene.regions?.find((r) => r.id === id),
            resize: !!resize,
            moved: false,
        };
    }
    move(point: Point) {
        if (!this.drag) return;
        this.drag.point = point;
        this.drag.moved ||=
            Math.hypot(point.x - this.drag.start.x, point.y - this.drag.start.y) > 2;
        this.preview();
    }
    private draft(): Region {
        const d = this.drag!;
        if (d.original) return transformRegion(d.original, d.start, d.point, d.resize);
        const shape = this.store.getSnapshot().regionShape ?? 'rectangle';
        return {
            id: 'draft',
            name: 'Новая область',
            shape,
            enabled: true,
            geometry: drawRegion(shape, d.start, d.point),
        };
    }
    preview() {
        if (this.drag?.moved) this.layer.preview(this.draft());
    }
    up(point: Point) {
        if (!this.drag) return;
        this.move(point);
        if (this.drag.moved) {
            const r = this.draft();
            this.store.regionCommand({
                ...r,
                id: this.drag.original?.id,
                action: this.drag.original ? 'update' : 'create',
            });
        }
        this.cancel();
    }
    cancel() {
        this.drag = undefined;
        this.layer.preview();
    }
}
