import { Rectangle, Sprite, Texture, type Container } from 'pixi.js';
import type { Point } from '../types/scene';
import { distance, openingIsOpen, type Opening, type Surface } from './model';

export function doorLeaf(a: Point, b: Point, door: Extract<Opening, { type: 'door' }>) {
    const hinge = door.hinge === 'a' ? a : b;
    const latch = hinge === a ? b : a;
    const angle =
        Math.atan2(latch.y - hinge.y, latch.x - hinge.x) +
        (door.open
            ? ((door.angle * Math.PI) / 180) *
              (door.direction === 'left' ? 1 : -1) *
              (hinge === a ? 1 : -1)
            : 0);
    return { hinge, latch, angle };
}

export class OpeningArt {
    private readonly atlases = new Map<
        Texture,
        { closed: Texture; open: Texture; leaf: Texture }
    >();

    draw(
        layer: Container,
        a: Point,
        b: Point,
        thickness: number,
        opening: Opening,
        surface: Surface,
        texture: Texture,
    ) {
        const length = distance(a, b);
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const span = length + Math.min(6, thickness * 0.35);
        if (opening.type === 'window') {
            this.sprite(layer, texture, center, span, thickness * 1.1, angle, 0.5).tint =
                openingIsOpen(opening) ? 0xffffff : 0x535d6c;
            return;
        }
        const atlas = this.atlas(texture);
        this.sprite(
            layer,
            opening.open ? atlas.open : atlas.closed,
            center,
            span,
            thickness * 1.15,
            angle,
            0.5,
        );
        if (opening.open && surface.layout !== 'gate-atlas') {
            const { hinge, latch, angle: swing } = doorLeaf(a, b, opening);
            const pivot = {
                x: hinge.x + (latch.x - hinge.x) * 0.065,
                y: hinge.y + (latch.y - hinge.y) * 0.065,
            };
            this.sprite(layer, atlas.leaf, pivot, length * 0.84, thickness * 0.92, swing, 0);
        }
    }

    private sprite(
        layer: Container,
        texture: Texture,
        p: Point,
        width: number,
        height: number,
        angle: number,
        anchor: number,
    ) {
        const sprite = new Sprite(texture);
        sprite.anchor.set(anchor, 0.5);
        sprite.position.set(p.x, p.y);
        sprite.width = width;
        sprite.height = height;
        sprite.rotation = angle;
        layer.addChild(sprite);
        return sprite;
    }

    private atlas(texture: Texture) {
        const cached = this.atlases.get(texture);
        if (cached) return cached;
        const width = texture.width,
            height = texture.height / 2;
        const frame = (x: number, y: number, w: number) =>
            new Texture({ source: texture.source, frame: new Rectangle(x, y, w, height) });
        const inset = Math.round(width * 0.12);
        const result = {
            closed: frame(0, 0, width),
            open: frame(0, height, width),
            leaf: frame(inset, 0, width - 2 * inset),
        };
        this.atlases.set(texture, result);
        return result;
    }

    clear() {
        for (const atlas of this.atlases.values())
            for (const frame of Object.values(atlas)) frame.destroy();
        this.atlases.clear();
    }
}
