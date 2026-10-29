import { distance, measured } from '../utils/spatialGeometry';
import { Container, Graphics, Text } from 'pixi.js';
import type { Scene, Point } from '../types/scene';
import type { Ability, AbilityTarget } from '../../gameplay/model';
import { abilityPreview, pixels } from '../../gameplay/geometry';
import { drawSpatialShape } from '../utils/drawSpatialShape';
import type { GameplayFeedback } from '../../gameplay/model';

/** Transient targeting and short combat responses; never part of the scene DTO. */
export class GameplayLayer extends Container {
    private rings = new Graphics();
    private floating: { label: Text; tokenId: string; start: number }[] = [];
    ability?: Ability;
    actorId?: string;
    targetKind?: 'token' | 'prop' | 'point';
    hover?: { kind: string; id?: string; point?: Point };
    constructor() {
        super();
        this.addChild(this.rings);
    }
    feedback(event: GameplayFeedback) {
        // Coalesce a repeated receipt/live echo and replace older text on this token.
        const previous = this.floating.find(
            (f) => f.tokenId === event.tokenId && performance.now() - f.start < 650,
        );
        if (previous?.label.text === event.text) return;
        for (const f of this.floating.filter((f) => f.tokenId === event.tokenId)) f.label.destroy();
        this.floating = this.floating.filter((f) => f.tokenId !== event.tokenId);
        const label = new Text({
            text: event.text,
            style: {
                fontFamily: 'Georgia, serif',
                fontSize: 25,
                fontWeight: '600',
                fill:
                    event.tone === 'damage'
                        ? 0xe9aa94
                        : event.tone === 'heal'
                          ? 0xc3d2a1
                          : 0xd7cab1,
                stroke: { color: 0x21160f, width: 4 },
            },
        });
        label.anchor.set(0.5);
        this.addChild(label);
        this.floating.push({ label, tokenId: event.tokenId, start: performance.now() });
        if (this.floating.length > 12) this.floating.shift()!.label.destroy();
    }
    tick(scene: Scene, zoom: number, now: number, reduced: boolean) {
        this.rings.clear();
        const actor = scene.tokens.find((t) => t.id === this.actorId);
        const target: AbilityTarget | null = this.hover?.point
            ? { kind: 'point', ...this.hover.point }
            : this.hover?.id && (this.hover.kind === 'token' || this.hover.kind === 'prop')
              ? { kind: this.hover.kind, id: this.hover.id }
              : null;
        const preview = this.ability ? abilityPreview(this.ability, scene, actor, target) : null;
        if (this.ability?.range && actor) {
            this.rings
                .circle(actor.x, actor.y, pixels(this.ability.range.normal, scene))
                .stroke({ color: 0xc6ad7f, width: 1.3 / zoom, alpha: 0.42 });
            if (this.ability.range.long)
                this.rings
                    .circle(actor.x, actor.y, pixels(this.ability.range.long, scene))
                    .stroke({ color: 0xa8886a, width: 1 / zoom, alpha: 0.24 });
        }
        const color = preview?.valid ? 0xc9ad79 : 0xb57064;
        if (actor && preview?.point && this.ability) {
            drawSpatialShape(this.rings, 'ruler', actor, preview.point, color, zoom);
            const area = this.ability.area,
                p = preview.point;
            if (area && area.shape !== 'none') {
                const length = pixels(area.size, scene),
                    width = pixels(area.width, scene);
                if (area.shape === 'circle')
                    drawSpatialShape(
                        this.rings,
                        'circle',
                        p,
                        { x: p.x + length, y: p.y },
                        color,
                        zoom,
                    );
                else if (area.shape === 'rectangle')
                    drawSpatialShape(
                        this.rings,
                        'rectangle',
                        { x: p.x - length / 2, y: p.y - width / 2 },
                        { x: p.x + length / 2, y: p.y + width / 2 },
                        color,
                        zoom,
                    );
                else {
                    const angle = Math.atan2(p.y - actor.y, p.x - actor.x);
                    drawSpatialShape(
                        this.rings,
                        area.shape,
                        actor,
                        {
                            x: actor.x + Math.cos(angle) * length,
                            y: actor.y + Math.sin(angle) * length,
                        },
                        color,
                        zoom,
                        width,
                    );
                }
            }
        }
        const targets =
            this.targetKind === 'token' || this.ability?.area
                ? scene.tokens
                : this.targetKind === 'prop'
                  ? (scene.props ?? [])
                  : [];
        for (const t of targets) {
            const affected = preview?.affected.includes(t.id);
            const hover = this.hover?.id === t.id && this.hover.kind === this.targetKind;
            const limit = this.ability?.range?.long ?? this.ability?.range?.normal;
            const available =
                limit == null ||
                (actor != null && measured(distance(actor, t), scene.grid) <= limit + 0.00001);
            const radius =
                'size' in t
                    ? (t.size * t.scale) / 2
                    : Math.max(t.image.width * t.scaleX, t.image.height * t.scaleY) / 2;
            const friendly = 'disposition' in t && t.disposition === 'friendly';
            this.rings.circle(t.x, t.y, radius + (hover || affected ? 8 : 4) / zoom).stroke({
                color: affected
                    ? friendly
                        ? 0xd99670
                        : 0xf0dec0
                    : available
                      ? 0xb7bc91
                      : 0xa66d63,
                width: (hover || affected ? 3 : 1.3) / zoom,
                alpha: hover || affected ? 1 : 0.45,
            });
            if (affected)
                this.rings
                    .circle(t.x, t.y, radius)
                    .fill({ color: friendly ? 0xc57e56 : 0xdeaa60, alpha: 0.16 });
            if (hover) {
                this.rings
                    .circle(t.x, t.y, radius + 13 / zoom)
                    .stroke({
                        color: available ? 0xf2d39a : 0xc08070,
                        width: 1 / zoom,
                        alpha: 0.65,
                    });
            }
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
