import { Container, Graphics, Text } from 'pixi.js';
import type { Scene, Point } from '../types/scene';
import type { GameplayFeedback } from '../../gameplay/model';

/** Transient targeting and short combat responses; never part of the scene DTO. */
export class GameplayLayer extends Container {
    private rings = new Graphics();
    private floating: { label: Text; tokenId: string; start: number }[] = [];
    targetKind?: 'token' | 'prop' | 'point';
    hover?: { kind: string; id?: string; point?: Point };
    constructor() {
        super();
        this.addChild(this.rings);
    }
    feedback(event: GameplayFeedback) {
        const label = new Text({
            text: event.text,
            style: {
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: 26,
                fontWeight: '700',
                fill:
                    event.tone === 'damage'
                        ? 0xf0b0a4
                        : event.tone === 'heal'
                          ? 0xa2e0c7
                          : 0xd4dbe8,
                stroke: { color: 0x12151e, width: 4 },
            },
        });
        label.anchor.set(0.5);
        this.addChild(label);
        this.floating.push({ label, tokenId: event.tokenId, start: performance.now() });
        if (this.floating.length > 12) this.floating.shift()!.label.destroy();
    }
    tick(scene: Scene, zoom: number, now: number, reduced: boolean) {
        this.rings.clear();
        const targets =
            this.targetKind === 'token'
                ? scene.tokens
                : this.targetKind === 'prop'
                  ? (scene.props ?? [])
                  : [];
        for (const t of targets) {
            const hover = this.hover?.id === t.id && this.hover.kind === this.targetKind;
            const radius =
                'size' in t
                    ? (t.size * t.scale) / 2
                    : Math.max(t.image.width * t.scaleX, t.image.height * t.scaleY) / 2;
            this.rings
                .circle(t.x, t.y, radius + (hover ? 9 : 5) / zoom)
                .stroke({
                    color: hover ? 0xe7bd75 : 0xa2e0c7,
                    width: (hover ? 3 : 1.5) / zoom,
                    alpha: hover ? 1 : 0.5,
                });
        }
        if (this.targetKind === 'point' && this.hover?.point) {
            const p = this.hover.point;
            this.rings.circle(p.x, p.y, 18 / zoom).stroke({ color: 0xe7bd75, width: 2 / zoom });
            this.rings
                .moveTo(p.x - 25 / zoom, p.y)
                .lineTo(p.x + 25 / zoom, p.y)
                .moveTo(p.x, p.y - 25 / zoom)
                .lineTo(p.x, p.y + 25 / zoom)
                .stroke({ color: 0xe7bd75, width: 1 / zoom });
        }
        this.floating = this.floating.filter((f) => {
            const token = scene.tokens.find((t) => t.id === f.tokenId);
            const progress = (now - f.start) / 1500;
            if (!token || progress >= 1) {
                f.label.destroy();
                return false;
            }
            f.label.scale.set(1 / zoom);
            f.label.position.set(
                token.x,
                token.y -
                    (token.size * token.scale) / 2 -
                    (22 + (reduced ? 0 : progress * 38)) / zoom,
            );
            f.label.alpha = progress > 0.65 ? (1 - progress) / 0.35 : 1;
            return true;
        });
    }
}
