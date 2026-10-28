import { Container, Graphics, Text } from 'pixi.js';
import type { Region } from '../../automation/model';
import type { Point } from '../types/scene';
import { regionHandle, regionHit } from '../../automation/geometry';

/** Private GM graphics. Nothing here evaluates or executes triggers. */
export class RegionLayer extends Container {
    private ink = new Graphics();
    private caption = new Text({
        text: '',
        style: { fontFamily: 'sans-serif', fontSize: 12, fill: 0xc0ded6 },
    });
    private regions: readonly Region[] = [];
    private selected?: string;
    private hovered?: string;
    private factor = 1;
    private draft?: Region;
    constructor() {
        super();
        this.eventMode = 'none';
        this.addChild(this.ink, this.caption);
    }
    sync(regions: readonly Region[], selected: string | undefined, show: boolean) {
        if (this.regions === regions && this.selected === selected && this.visible === show) return;
        this.regions = regions;
        this.selected = selected;
        this.visible = show;
        this.paint();
    }
    zoom(value: number) {
        if (value !== this.factor) {
            this.factor = value;
            this.paint();
        }
    }
    hover(id: string | undefined) {
        if (id !== this.hovered) {
            this.hovered = id;
            this.paint();
        }
    }
    preview(region?: Region) {
        this.draft = region;
        this.paint();
    }
    hit(point: Point) {
        if (!this.visible) return;
        return [...this.regions].reverse().find((r) => regionHit(r, point))?.id;
    }
    resizeHit(point: Point) {
        const r = this.regions.find((r) => r.id === this.selected);
        if (!this.visible || !r) return;
        const p = regionHandle(r);
        return Math.hypot(point.x - p.x, point.y - p.y) < 10 / this.factor ? r.id : undefined;
    }
    private paint() {
        this.ink.clear();
        this.caption.visible = false;
        const regions = this.draft
            ? [...this.regions.filter((r) => r.id !== this.draft!.id), this.draft]
            : this.regions;
        for (const r of regions) {
            const g = r.geometry,
                selected = r.id === this.selected || r.id === 'draft',
                hovered = r.id === this.hovered;
            const color = r.enabled ? 0x91beb2 : 0x798481;
            if (r.shape === 'circle') this.ink.circle(g.x, g.y, g.radius!);
            else this.ink.rect(g.x, g.y, g.width!, g.height!);
            this.ink
                .fill({ color, alpha: r.enabled ? (selected ? 0.15 : 0.06) : 0.025 })
                .stroke({
                    color,
                    width: (selected ? 2 : 1) / this.factor,
                    alpha: r.enabled ? 0.85 : 0.4,
                });
            if (selected) {
                const p = regionHandle(r),
                    s = 8 / this.factor;
                this.ink.rect(p.x - s / 2, p.y - s / 2, s, s).fill(color);
            }
            if (selected || hovered) {
                this.caption.text = r.name + (r.enabled ? '' : ' · выключена');
                this.caption.visible = true;
                this.caption.scale.set(1 / this.factor);
                this.caption.position.set(
                    g.x + 7 / this.factor,
                    g.y - (r.shape === 'circle' ? g.radius! : 0) - 20 / this.factor,
                );
            }
        }
    }
}
