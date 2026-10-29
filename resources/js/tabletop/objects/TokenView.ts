import { conditionLabel } from '../../i18n';
import { Container, Graphics, Text, Sprite, type Texture } from 'pixi.js';
import type { Token } from '../types/scene';
import { tokenAppearance, tokenLabelVisible } from './tokenAppearance';
import { motionDuration } from '../../workspace/ui/motion';

export class TokenView extends Container {
    private body = new Graphics();
    private ring = new Graphics();
    private turnRing = new Graphics();
    private portraitImage = new Sprite();
    private imageMask = new Graphics();
    private initials = new Text({
        text: '',
        style: { fontFamily: 'Segoe UI, Arial', fontSize: 21, fontWeight: '600', fill: 0xeceef4 },
    });
    private captionGroup = new Container();
    private captionGroupBackground = new Graphics();
    private nameplate = new Text({
        text: '',
        style: { fontFamily: 'Segoe UI, Arial', fontSize: 12, fontWeight: '500', fill: 0xeceef4 },
    });
    private badges = new Text({
        text: '',
        style: { fontFamily: 'Segoe UI, Arial', fontSize: 10, fontWeight: '600', fill: 0xdacaf8 },
    });
    private health = new Graphics();
    private facing = new Graphics();
    private activeTurn = false;
    private selected = false;
    private hovered = false;
    private radius = 26;
    private turnAge = 1000;
    private stateAge = 1000;
    private dragging = false;
    private lastLabelScale = 0;
    private turnDuration = Math.max(1, motionDuration('cinematic'));
    private stateDuration = Math.max(1, motionDuration('normal'));
    constructor(
        public model: Token,
        private player = false,
    ) {
        super();
        this.captionGroup.addChild(this.captionGroupBackground, this.nameplate);
        this.addChild(
            this.turnRing,
            this.body,
            this.initials,
            this.portraitImage,
            this.imageMask,
            this.facing,
            this.health,
            this.ring,
            this.captionGroup,
            this.badges,
        );
        this.portraitImage.anchor.set(0.5);
        this.portraitImage.mask = this.imageMask;
        this.portraitImage.visible = false;
        this.initials.anchor.set(0.5);
        this.nameplate.anchor.set(0.5, 0);
        this.badges.anchor.set(0.5, 1);
        this.update(model);
    }
    update(token: Token) {
        this.model = token;
        this.position.set(token.x, token.y);
        this.radius = (token.size * token.scale) / 2;
        this.alpha = token.isHidden ? 0.66 : 1;
        const r = this.radius,
            appearance = tokenAppearance(token),
            c = appearance.color;
        this.body
            .clear()
            .circle(0, 4, r + 5)
            .fill({ color: 0x05070c, alpha: 0.38 })
            .circle(0, 0, r)
            .fill(0x171c26)
            .stroke({ color: c, width: 1.7 })
            .circle(0, 0, r - 4)
            .fill({ color: c, alpha: 0.12 });
        this.body
            .moveTo(-r * 0.56, r * 0.28)
            .lineTo(0, r * 0.67)
            .lineTo(r * 0.56, r * 0.28)
            .stroke({ color: c, width: 1, alpha: 0.32 });
        this.initials.text = appearance.initials;
        this.initials.style.fontSize = Math.max(10, r * 0.67);
        this.initials.y = -r * 0.08;
        this.imageMask
            .clear()
            .circle(0, 0, Math.max(2, r - 3))
            .fill(0xffffff);
        this.portraitImage.rotation = (token.rotation * Math.PI) / 180;
        this.facing
            .clear()
            .poly([-3, -r + 6, 0, -r + 1, 3, -r + 6])
            .fill({ color: c, alpha: 0.85 });
        this.facing.rotation = this.portraitImage.rotation;
        this.nameplate.text = token.name.length > 26 ? `${token.name.slice(0, 24)}…` : token.name;
        this.captionGroupBackground
            .clear()
            .roundRect(-this.nameplate.width / 2 - 7, -3, this.nameplate.width + 14, 22, 5)
            .fill({ color: 0x11151e, alpha: 0.94 });
        this.health.clear();
        if (token.hp !== undefined && token.maxHp) {
            const w = Math.max(4, r * 1.35),
                ratio = Math.min(1, Math.max(0, token.hp / token.maxHp));
            this.health.roundRect(-w / 2 - 2, r - 3, w + 4, 6, 3).fill(0x10151c);
            if (ratio > 0)
                this.health
                    .roundRect(-w / 2, r - 1, Math.max(2, w * ratio), 2, 1)
                    .fill(ratio <= 0.25 ? 0xe79a97 : c);
        }
        this.badges.text =
            [appearance.marker, ...(token.conditions ?? []).slice(0, 2).map(conditionLabel)]
                .filter(Boolean)
                .join(' · ') + ((token.conditions?.length ?? 0) > 2 ? ' +' : '');
        this.badges.position.set(0, -r - 10);
        this.drawRing();
        this.drawTurn();
    }
    setActiveTurn(active: boolean) {
        if (this.activeTurn === active) return;
        this.activeTurn = active;
        this.turnAge = 0;
        this.drawTurn();
    }
    private drawTurn() {
        this.turnRing.clear();
        if (this.activeTurn)
            this.turnRing
                .circle(0, 0, this.radius + 10)
                .stroke({ color: 0xe7bd75, width: 2, alpha: 0.9 })
                .circle(0, 0, this.radius + 12)
                .stroke({ color: 0xe7bd75, width: 7, alpha: 0.09 });
    }
    setImage(texture?: Texture) {
        this.portraitImage.visible = !!texture;
        this.initials.visible = !texture;
        if (texture) {
            this.portraitImage.texture = texture;
            const size = Math.max(4, (this.radius - 3) * 2);
            this.portraitImage.scale.set(Math.max(size / texture.width, size / texture.height));
        }
    }
    setState(selected: boolean, hovered: boolean) {
        if (this.selected === selected && this.hovered === hovered) return;
        this.selected = selected;
        this.hovered = hovered;
        this.stateAge = 0;
        this.drawRing();
    }
    // The renderer's single ticker: no timers, React updates or graphics rebuilds per frame.
    tick(delta: number, zoom: number, reduced: boolean, dragging: boolean) {
        this.turnAge = Math.min(this.turnDuration, this.turnAge + delta);
        if (this.dragging && !dragging) this.stateAge = 0;
        this.dragging = dragging;
        this.stateAge = Math.min(this.stateDuration, this.stateAge + delta);
        const pulse = reduced
            ? 0
            : Math.sin((Math.PI * this.turnAge) / this.turnDuration) *
              (1 - this.turnAge / this.turnDuration);
        this.turnRing.scale.set(1 + pulse * 0.16);
        this.turnRing.alpha = 0.85 + pulse * 0.15;
        this.ring.scale.set(
            reduced ? 1 : dragging ? 1.05 : 1 + 0.05 * (1 - this.stateAge / this.stateDuration),
        );
        this.captionGroup.visible = tokenLabelVisible(
            zoom,
            this.selected || this.hovered || this.activeTurn || dragging,
        );
        this.badges.visible = this.captionGroup.visible;
        const scale = Math.min(12, Math.max(0.65, 1 / zoom));
        if (scale !== this.lastLabelScale) {
            this.lastLabelScale = scale;
            this.captionGroup.scale.set(scale);
            this.badges.scale.set(scale);
        }
        this.captionGroup.y = this.radius + 12 * scale;
        this.badges.y = -this.radius - 9 * scale;
    }
    private drawRing() {
        this.ring.clear();
        const r = this.radius;
        if (this.player && this.model.canMove)
            this.ring
                .circle(r * 0.72, -r * 0.72, 3)
                .fill(0x9de2c4)
                .stroke({ color: 0x17231f, width: 1.5 });
        if (this.selected)
            this.ring
                .circle(0, 0, r + 5)
                .stroke({ color: 0xbcecd5, width: 2 })
                .poly([-4, -r - 13, 4, -r - 13, 0, -r - 8])
                .fill(0xbcecd5);
        else if (this.hovered)
            this.ring.circle(0, 0, r + 4).stroke({ color: 0xe0e7ed, width: 1.5, alpha: 0.8 });
    }
    contains(x: number, y: number) {
        return Math.hypot(x - this.x, y - this.y) <= this.radius + 5;
    }
}
