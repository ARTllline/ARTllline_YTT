import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Point, SceneProp } from '../types/scene';
import { blockingColor, colliderPoints, propLocalPoint } from '../objects/collider';

class PropView extends Container {
    readonly sprite = new Sprite(Texture.EMPTY);
    readonly outline = new Graphics();
    readonly collider = new Graphics();
    private debug = false;
    private state = '';
    private selected = false;
    private hovered = false;
    private editable = true;
    constructor(public model: SceneProp) {
        super();
        this.addChild(this.sprite, this.outline, this.collider);
        this.update(model);
    }
    update(model: SceneProp) {
        this.model = model;
        this.position.set(model.x, model.y);
        this.angle = model.rotation;
        this.zIndex = model.zIndex;
        this.alpha = model.isHidden ? 0.35 : 1;
        this.sprite.anchor.set(model.pivotX ?? 0.5, model.pivotY ?? 0.5);
        this.resize(model.scaleX, model.scaleY);
    }
    resize(x: number, y: number) {
        this.sprite.width = this.model.image.width * x;
        this.sprite.height = this.model.image.height * y;
        this.state = '';
        this.highlight(this.selected, this.hovered, this.editable);
    }
    collisionDebug(enabled: boolean) {
        if (this.debug === enabled) return;
        this.debug = enabled;
        this.highlight(this.selected, this.hovered, this.editable);
    }
    highlight(selected: boolean, hovered: boolean, editable = true) {
        this.selected = selected;
        this.hovered = hovered;
        this.editable = editable;
        const state = `${selected}:${hovered}:${this.model.isLocked}:${editable}:${this.debug}`;
        if (state === this.state) return;
        this.state = state;
        const w = this.sprite.width,
            h = this.sprite.height;
        const left = -w * this.sprite.anchor.x;
        const top = -h * this.sprite.anchor.y;
        const color = selected ? 0xb7e1ce : 0x8aafa3;
        this.outline.clear();
        if (selected || hovered)
            this.outline
                .rect(left, top, w, h)
                .stroke({ color, width: selected ? 2 : 1, alpha: 0.95 });
        if (selected && editable && !this.model.isLocked)
            this.outline
                .rect(
                    (this.sprite.anchor.x === 1 ? left : left + w) - 5,
                    (this.sprite.anchor.y === 1 ? top : top + h) - 5,
                    10,
                    10,
                )
                .fill(color)
                .stroke({ color: 0x182320, width: 1 });
        if (this.model.isLocked)
            this.outline
                .roundRect(left + 4, top + 8, 10, 9, 2)
                .fill(0xcab783)
                .arc(left + 9, top + 8, 4, Math.PI, 0)
                .stroke({ color: 0xcab783, width: 2 });
        this.collider.clear();
        const shape = this.model.collider;
        if (!this.debug || !shape || shape.type === 'none') return;
        const points = colliderPoints(shape).flatMap((point) => {
            const local = propLocalPoint(
                this.model,
                point,
                w / this.model.image.width,
                h / this.model.image.height,
            );
            return [local.x, local.y];
        });
        const tint = blockingColor(shape);
        this.collider
            .poly(points)
            .fill({ color: tint, alpha: selected ? 0.24 : 0.1 })
            .stroke({ color: tint, width: selected ? 3 : 1.5 });
    }
    local(point: Point) {
        const r = -this.rotation,
            dx = point.x - this.x,
            dy = point.y - this.y;
        return { x: dx * Math.cos(r) - dy * Math.sin(r), y: dx * Math.sin(r) + dy * Math.cos(r) };
    }
    contains(point: Point) {
        const p = this.local(point);
        const x = p.x + this.sprite.width * this.sprite.anchor.x;
        const y = p.y + this.sprite.height * this.sprite.anchor.y;
        return x >= 0 && x <= this.sprite.width && y >= 0 && y <= this.sprite.height;
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
    selection(ids: readonly string[], hover: string | null, editable = true) {
        this.views.forEach((v, id) => v.highlight(ids.includes(id), id === hover, editable));
    }
    collisionDebug(enabled: boolean) {
        this.views.forEach((view) => view.collisionDebug(enabled));
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
        const x = v.sprite.anchor.x === 1 ? -1 : 1 - v.sprite.anchor.x;
        const y = v.sprite.anchor.y === 1 ? -1 : 1 - v.sprite.anchor.y;
        return Math.hypot(p.x - v.sprite.width * x, p.y - v.sprite.height * y) < 10 / zoom
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
