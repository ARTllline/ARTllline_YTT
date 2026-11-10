import { Container, Graphics, Text } from 'pixi.js';
import type { GridSettings, Point } from '../types/scene';
import { measureLabel } from '../utils/spatialGeometry';
import { routeLength } from '../utils/movement';
import { movementMarker } from './movementMarker';

export class InteractionLayer extends Container {
    private ink = new Graphics();
    revision = 0;
    private movementLabel = new Text({
        style: { fontFamily: 'Inter, system-ui, sans-serif', fontSize: 12, fill: '#f3f8fb' },
    });
    constructor() {
        super();
        this.addChild(this.ink, this.movementLabel);
    }
    clear() {
        this.revision++;
        this.movementLabel.visible = false;
        return this.ink.clear();
    }
    showMovement(
        origin: Point,
        target: Point,
        radius: number,
        zoom: number,
        blocked: boolean,
        grid: GridSettings,
        range?: number,
        verified = false,
        companions: readonly { point: Point; radius: number }[] = [],
        path: readonly Point[] = [origin, target],
    ) {
        const color = blocked ? 0xff907b : verified ? 0x98ecc4 : 0xb1c9ef;
        const ink = this.clear();
        if (range && range * zoom < 8000)
            ink.circle(origin.x, origin.y, range).stroke({
                color: 0xb1c9ef,
                width: 1 / zoom,
                alpha: 0.4,
            });
        ink.moveTo(origin.x, origin.y);
        for (const point of path.slice(1)) ink.lineTo(point.x, point.y);
        ink.stroke({ color, width: 2 / zoom, alpha: 0.65 });
        movementMarker(ink, target, radius, zoom, color, blocked);
        for (const { point, radius } of companions) {
            ink.circle(point.x, point.y, radius).stroke({ color, width: 1.5 / zoom, alpha: 0.7 });
        }
        const length = measureLabel(routeLength(path), grid);
        this.movementLabel.text =
            range === undefined ? length : `${length} / ${measureLabel(range, grid)}`;
        this.movementLabel.scale.set(1 / zoom);
        this.movementLabel.position.set(target.x + radius + 8 / zoom, target.y - 16 / zoom);
        ink.roundRect(
            this.movementLabel.x - 4 / zoom,
            this.movementLabel.y - 2 / zoom,
            this.movementLabel.width + 8 / zoom,
            this.movementLabel.height + 4 / zoom,
            4 / zoom,
        ).fill({ color: 0x101820, alpha: 0.92 });
        this.movementLabel.visible = true;
    }
    showMarquee(a: Point, b: Point, zoom: number) {
        this.clear()
            .rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y))
            .fill({ color: 0xa6d9c3, alpha: 0.12 })
            .stroke({ color: 0xc0ecd4, width: 1 / zoom });
    }
    showDestination(target: Point, radius: number, zoom: number, blocked: boolean) {
        movementMarker(this.clear(), target, radius, zoom, blocked ? 0xff907b : 0xb1c9ef, blocked);
    }
    showBrush(point: Point, radius: number, zoom: number, cover: boolean, core?: number) {
        const color = cover ? 0xf5baa2 : 0xc6f3dc;
        this.clear()
            .circle(point.x, point.y, radius)
            .stroke({ color: 0x11181b, width: 3 / zoom, alpha: 0.8 })
            .circle(point.x, point.y, radius)
            .stroke({ color, width: 1.25 / zoom, alpha: 0.95 });
        if (core !== undefined && core * zoom > 4 && (radius - core) * zoom > 4)
            this.ink.circle(point.x, point.y, core).stroke({ color, width: 1 / zoom, alpha: 0.5 });
    }
}
