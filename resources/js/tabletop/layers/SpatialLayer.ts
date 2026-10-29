import { drawSpatialShape } from '../utils/drawSpatialShape';
import { Container, Graphics, Text } from 'pixi.js';
import type { SpatialState } from '../state/SpatialState';
import type { GridSettings } from '../types/scene';
import { distance, measureLabel, rectangle } from '../utils/spatialGeometry';

export class SpatialLayer extends Container {
    private views = new Map<
        string,
        { root: Container; ink: Graphics; label: Text; badge: Graphics; signature: string }
    >();
    update(state: SpatialState, grid: GridSettings, zoom: number, reduced: boolean) {
        const now = performance.now();
        state.expire(now);
        for (const [id, v] of this.views)
            if (!state.overlays.has(id)) {
                v.root.destroy({ children: true });
                this.views.delete(id);
            }
        for (const [id, { event: e, born, expires }] of state.overlays) {
            let view = this.views.get(id);
            if (!view) {
                const root = new Container(),
                    ink = new Graphics(),
                    badge = new Graphics(),
                    label = new Text({
                        text: '',
                        style: {
                            fontFamily: 'Inter, system-ui, sans-serif',
                            fontSize: 12,
                            fill: '#f3f8fb',
                        },
                    });
                root.addChild(ink, badge, label);
                this.addChild(root);
                view = { root, ink, badge, label, signature: '' };
                this.views.set(id, view);
            }
            const { ink, label, badge, root } = view;
            const color = id === state.identity.id ? 0xa1e2cf : 0x9bc4ff;
            root.alpha = Math.min(1, (expires - now) / 500);
            const signature = `${e.sessionId}:${e.sequence}:${e.end.x}:${e.end.y}:${zoom}:${grid.size}:${grid.distancePerCell}:${grid.distanceUnit}`;
            if (signature === view.signature && e.kind !== 'ping') continue;
            view.signature = signature;
            ink.clear();
            badge.clear();
            const length = distance(e.start, e.end);
            let text = '';
            if (e.kind === 'ping') {
                const pulse = reduced ? 0.4 : ((now - born) % 900) / 900;
                ink.circle(e.start.x, e.start.y, (12 + pulse * 25) / zoom).stroke({
                    color,
                    width: 2 / zoom,
                    alpha: 1 - pulse * 0.7,
                });
                ink.circle(e.start.x, e.start.y, 4 / zoom).fill(color);
            } else {
                drawSpatialShape(ink, e.kind, e.start, e.end, color, zoom);
                if (e.kind === 'ruler') text = measureLabel(length, grid);
                else if (e.kind === 'circle') text = `Radius ${measureLabel(length, grid)}`;
                else if (e.kind === 'rectangle') {
                    const r = rectangle(e.start, e.end);
                    text = `${measureLabel(r.width, grid)} × ${measureLabel(r.height, grid)}`;
                } else text = `${measureLabel(length, grid)} · 60°`;
            }
            if (e.kind !== 'ping') {
                ink.circle(e.start.x, e.start.y, 3 / zoom).fill(color);
                ink.circle(e.end.x, e.end.y, 3 / zoom).fill(color);
            }
            label.text = `${text}${text ? ' · ' : ''}${e.participant.name}`;
            label.scale.set(1 / zoom);
            label.position.set(e.end.x + 12 / zoom, e.end.y - 28 / zoom);
            badge
                .roundRect(
                    label.x - 6 / zoom,
                    label.y - 4 / zoom,
                    label.width + 12 / zoom,
                    label.height + 8 / zoom,
                    5 / zoom,
                )
                .fill({ color: 0x101820, alpha: 0.95 });
        }
        // Keep concurrent participants' distance badges legible without moving geometry.
        const occupied: { x: number; y: number; width: number; height: number }[] = [];
        for (const [id, view] of this.views) {
            const event = state.overlays.get(id)?.event;
            if (!event) continue;
            const baseY = event.end.y - 28 / zoom;
            const box = {
                x: view.label.x - 6 / zoom,
                y: baseY - 4 / zoom,
                width: view.label.width + 12 / zoom,
                height: view.label.height + 8 / zoom,
            };
            let steps = 0;
            while (
                steps++ < 12 &&
                occupied.some(
                    (other) =>
                        box.x < other.x + other.width &&
                        box.x + box.width > other.x &&
                        box.y < other.y + other.height &&
                        box.y + box.height > other.y,
                )
            )
                box.y -= box.height + 3 / zoom;
            view.label.y = box.y + 4 / zoom;
            view.badge.y = view.label.y - baseY;
            occupied.push(box);
        }
    }
    override destroy() {
        this.views.clear();
        super.destroy({ children: true });
    }
}
