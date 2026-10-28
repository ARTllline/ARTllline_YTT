import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Point, SceneProp } from '../types/scene';

class PropView extends Container {
    readonly sprite = new Sprite(Texture.EMPTY);
    readonly outline = new Graphics();
    private state = '';
    private selected = false;
    private hovered = false;
    constructor(public model: SceneProp) {
        super();
        this.sprite.anchor.set(0.5);
        this.addChild(this.sprite, this.outline);
        this.update(model);
    }
    update(model: SceneProp) {
        this.model = model;
        this.position.set(model.x, model.y);
        this.angle = model.rotation;
        this.zIndex = model.zIndex;
        this.alpha = model.isHidden ? 0.35 : 1;
        this.resize(model.scaleX, model.scaleY);
    }
    resize(x: number, y: number) {
        this.sprite.width = this.model.image.width * x;
        this.sprite.height = this.model.image.height * y;
        this.state = '';
        this.highlight(this.selected, this.hovered);
    }
    highlight(selected: boolean, hovered: boolean) {
        this.selected = selected;
        this.hovered = hovered;
        const state = `${selected}:${hovered}:${this.model.isLocked}`;
        if (state === this.state) return;
        this.state = state;
        const w = this.sprite.width,
            h = this.sprite.height;
        const color = selected ? 0xb7e1ce : 0x8aafa3;
        this.outline.clear();
        if (selected || hovered)
            this.outline
                .rect(-w / 2, -h / 2, w, h)
                .stroke({ color, width: selected ? 2 : 1, alpha: 0.95 });
        if (selected && !this.model.isLocked)
            this.outline
                .rect(w / 2 - 5, h / 2 - 5, 10, 10)
                .fill(color)
                .stroke({ color: 0x182320, width: 1 });
        if (this.model.isLocked)
            this.outline
                .roundRect(-w / 2 + 4, -h / 2 + 8, 10, 9, 2)
                .fill(0xcab783)
                .arc(-w / 2 + 9, -h / 2 + 8, 4, Math.PI, 0)
                .stroke({ color: 0xcab783, width: 2 });
    }
    local(point: Point) {
        const r = -this.rotation,
            dx = point.x - this.x,
            dy = point.y - this.y;
        return { x: dx * Math.cos(r) - dy * Math.sin(r), y: dx * Math.sin(r) + dy * Math.cos(r) };
    }
    contains(point: Point) {
        const p = this.local(point);
        return Math.abs(p.x) <= this.sprite.width / 2 && Math.abs(p.y) <= this.sprite.height / 2;
    }
}

export class ScenePropLayer extends Container {
    readonly views = new Map<string, PropView>();
    constructor() {
        super();
        this.sortableChildren = true;
    }
    sync(props: readonly SceneProp[], textures: Map<string, Texture>) {
        const ids = new Set(props.map((p) => p.id));
        for (const [id, view] of this.views)
            if (!ids.has(id)) {
                view.destroy({ children: true });
                this.views.delete(id);
            }
        for (const prop of props) {
            let view = this.views.get(prop.id);
            if (!view) {
                view = new PropView(prop);
                this.views.set(prop.id, view);
                this.addChild(view);
            } else if (view.model !== prop) view.update(prop);
            const texture = textures.get(prop.image.id);
            if (texture && view.sprite.texture !== texture) {
                view.sprite.texture = texture;
                view.resize(prop.scaleX, prop.scaleY);
            }
        }
        this.sortChildren();
    }
    selection(ids: readonly string[], hover: string | null) {
        this.views.forEach((v, id) => v.highlight(ids.includes(id), id === hover));
    }
    hit(point: Point) {
        return (
            (
                [...this.children].reverse().find((v) => (v as PropView).contains(point)) as
                    PropView | undefined
            )?.model.id ?? null
        );
    }
    resizeHit(point: Point, ids: readonly string[], zoom: number) {
        if (ids.length !== 1) return null;
        const v = this.views.get(ids[0]);
        if (!v || v.model.isLocked) return null;
        const p = v.local(point);
        return Math.hypot(p.x - v.sprite.width / 2, p.y - v.sprite.height / 2) < 10 / zoom
            ? v.model.id
            : null;
    }
    preview(id: string, point: Point) {
        this.views.get(id)?.position.set(point.x, point.y);
    }
    resize(id: string, x: number, y: number) {
        this.views.get(id)?.resize(x, y);
    }
}
