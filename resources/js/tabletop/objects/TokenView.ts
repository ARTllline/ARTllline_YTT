import { Container, Graphics, Text, Sprite, type Texture } from 'pixi.js';
import type { Token } from '../types/scene';
export class TokenView extends Container {
    private body = new Graphics();
    private art = new Graphics();
    private ring = new Graphics();
    private portraitImage = new Sprite();
    private imageMask = new Graphics();
    private nameplate = new Text({
        text: '',
        style: { fontFamily: 'Arial', fontSize: 17, fontWeight: '500', fill: 0xecf0e7 },
    });
    private selected = false;
    private hovered = false;
    private radius = 26;
    constructor(
        public model: Token,
        private player = false,
    ) {
        super();
        this.addChild(
            this.body,
            this.art,
            this.portraitImage,
            this.imageMask,
            this.ring,
            this.nameplate,
        );
        this.portraitImage.anchor.set(0.5);
        this.portraitImage.mask = this.imageMask;
        this.portraitImage.visible = false;
        this.nameplate.anchor.set(0.5, 0);
        this.update(model);
    }
    update(token: Token) {
        this.model = token;
        this.position.set(token.x, token.y);
        this.radius = (token.size * token.scale) / 2;
        this.alpha = token.isHidden ? 0.5 : 1;
        const r = this.radius,
            c = token.color;
        this.body
            .clear()
            .circle(3, 5, r + 3)
            .fill({ color: 0x000000, alpha: 0.4 })
            .circle(0, 0, r)
            .fill(0x162526)
            .stroke({ color: c, width: 2.5 });
        this.body
            .circle(0, 0, Math.max(1, r - 5))
            .fill({ color: c, alpha: 0.16 })
            .stroke({ color: c, width: 1, alpha: 0.25 });
        this.art.clear();
        if (token.kind === 'hero') {
            this.art.poly([-10, -11, 10, -11, 10, 3, 0, 14, -10, 3]).fill({ color: c, alpha: 0.8 });
            this.art
                .moveTo(0, -8)
                .lineTo(0, 8)
                .moveTo(-5, -1)
                .lineTo(5, -1)
                .stroke({ color: 0x213a36, width: 2 });
        } else if (token.kind === 'scout') {
            this.art
                .poly([-15, -10, -7, -7, 0, -12, 7, -7, 15, -10, 10, 2, 6, 10, -6, 10, -10, 2])
                .fill({ color: c, alpha: 0.85 });
            this.art
                .moveTo(-7, -1)
                .lineTo(-3, 1)
                .moveTo(3, 1)
                .lineTo(7, -1)
                .stroke({ color: 0x23332b, width: 3 });
        } else {
            this.art
                .moveTo(-6, -14)
                .quadraticCurveTo(18, 0, -6, 14)
                .lineTo(-6, -14)
                .moveTo(-12, 0)
                .lineTo(13, 0)
                .moveTo(7, -5)
                .lineTo(13, 0)
                .lineTo(7, 5)
                .stroke({ color: c, width: 2.5 });
        }
        this.art.scale.set(token.scale);
        this.art.rotation = (token.rotation * Math.PI) / 180;
        this.imageMask
            .clear()
            .circle(0, 0, Math.max(2, this.radius - 4))
            .fill(0xffffff);
        this.portraitImage.rotation = this.art.rotation;
        this.nameplate.text = token.name.length > 24 ? `${token.name.slice(0, 21)}…` : token.name;
        this.nameplate.position.set(0, r + 11);
        this.body
            .roundRect(-this.nameplate.width / 2 - 7, r + 8, this.nameplate.width + 14, 27, 4)
            .fill({ color: 0x142120, alpha: 0.9 });
        const healthWidth = Math.max(2, (r - 5) * 2);
        if (token.hp !== undefined)
            this.body.roundRect(-healthWidth / 2, r - 4, healthWidth, 3, 1).fill(0x182723);
        if (token.hp !== undefined && token.hp > 0 && token.maxHp)
            this.body
                .roundRect(-healthWidth / 2, r - 4, (healthWidth * token.hp) / token.maxHp, 3, 1)
                .fill(c);
        this.drawRing();
    }
    setImage(texture?: Texture) {
        this.portraitImage.visible = !!texture;
        if (texture) {
            this.portraitImage.texture = texture;
            const size = Math.max(4, (this.radius - 4) * 2);
            const scale = Math.max(size / texture.width, size / texture.height);
            this.portraitImage.scale.set(scale);
        }
    }
    setState(selected: boolean, hovered: boolean) {
        if (this.selected === selected && this.hovered === hovered) return;
        this.selected = selected;
        this.hovered = hovered;
        this.drawRing();
    }
    private drawRing() {
        this.ring.clear();
        const r = this.radius;
        if (this.player && this.model.canMove) {
            this.ring.circle(0, 0, r + 3).stroke({ color: 0xa7d8c1, width: 1, alpha: 0.5 });
            this.ring
                .circle(r * 0.72, -r * 0.72, 4)
                .fill(0xb9e4cd)
                .stroke({ color: 0x172d23, width: 1.5 });
        }
        if (this.selected) {
            this.ring.circle(0, 0, r + 6).stroke({ color: 0xc3f0da, width: 2 });
            this.ring.poly([-4, -r - 13, 4, -r - 13, 0, -r - 8]).fill(0xc3f0da);
        } else if (this.hovered)
            this.ring.circle(0, 0, r + 5).stroke({ color: 0xdce7db, width: 1.5, alpha: 0.7 });
    }
    contains(x: number, y: number) {
        return Math.hypot(x - this.x, y - this.y) <= this.radius + 5;
    }
}
