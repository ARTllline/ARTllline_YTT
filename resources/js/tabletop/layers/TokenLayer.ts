import { Container, Graphics } from 'pixi.js';
import type { Token, Point } from '../types/scene';
import type { TokenMovement } from '../../api/workspace';
import { pathPosition, remainingTokenPath, tokenPath } from './tokenPath';
import { TokenView } from '../objects/TokenView';
import { movementMarker } from './movementMarker';
export class TokenLayer extends Container {
    views = new Map<string, TokenView>();
    private movements = new Map<string, NonNullable<ReturnType<typeof tokenPath>>>();
    private movementInk = this.addChild(new Graphics());
    sync(
        tokens: readonly Token[],
        player = false,
        currentTokenId?: string,
        movements?: readonly TokenMovement[],
    ) {
        const paths =
            movements && new Map(movements.map((movement) => [movement.tokenId, movement]));
        for (const [id, view] of this.views) {
            if (!tokens.some((token) => token.id === id)) {
                this.movements.delete(id);
                view.destroy({ children: true });
                this.views.delete(id);
            }
        }
        for (const token of tokens) {
            const existing = this.views.get(token.id);
            if (existing) {
                const previous = existing.model;
                const movement = paths?.get(token.id);
                const path = movement?.path;
                const start = path?.[0];
                const end = path?.at(-1);
                if (existing.model !== token) existing.update(token);
                if (path && !movement?.instant && samePoint(start, previous) && samePoint(end, token)) {
                    const previousAnimation = this.movements.get(token.id);
                    const append =
                        previousAnimation &&
                        !!movement?.continuous === previousAnimation.continuous;
                    const remaining = append ? remainingTokenPath(previousAnimation) : undefined;
                    let combined = remaining ? [...remaining, ...path.slice(1)] : path;
                    // Linear playback retains velocity across short steps; no per-step easing.
                    let duration =
                        (movement?.duration ?? 200) +
                        (append
                            ? Math.max(0, previousAnimation.duration - previousAnimation.elapsed)
                            : 0);
                    // A throttled/background spectator must not accumulate a playback queue.
                    if (movement?.continuous && (combined.length > 64 || duration > 600)) {
                        combined = path;
                        duration = movement?.duration ?? 200;
                    }
                    // Keep accepted corners on rapid re-command; never interpolate a
                    // shortcut from a presentation position to the new server origin.
                    if (!movement?.continuous && combined.length > 256) combined = path;
                    const animation = tokenPath(combined, !!movement?.continuous, duration);
                    if (animation) {
                        this.movements.set(token.id, animation);
                        existing.position.set(combined[0].x, combined[0].y);
                        existing.setActiveTurn(token.id === currentTokenId);
                        continue;
                    }
                }
                if (!samePoint(previous, token) || path) this.finishMovement(token.id);
                const active = this.movements.get(token.id);
                if (active) this.preview(token.id, pathPosition(active));
            } else {
                const view = new TokenView(token, player);
                this.views.set(token.id, view);
                this.addChild(view);
            }
            this.views.get(token.id)?.setActiveTurn(token.id === currentTokenId);
        }
    }
    isMoving(id: string) {
        return this.movements.has(id);
    }
    drawMovements(zoom: number, selected: readonly string[]) {
        const ink = this.movementInk.clear();
        for (const [id, active] of this.movements) {
            if (active.continuous || !selected.includes(id)) continue;
            const path = remainingTokenPath(active);
            ink.moveTo(path[0].x, path[0].y);
            for (const point of path.slice(1)) ink.lineTo(point.x, point.y);
            ink.stroke({ color: 0x98ecc4, width: 1.5 / zoom, alpha: 0.35 });
            const model = this.views.get(id)!.model;
            movementMarker(ink, model, (model.size * model.scale) / 2, zoom, 0x98ecc4);
        }
    }
    finishMovement(id: string) {
        if (!this.movements.delete(id)) return;
        const view = this.views.get(id);
        if (view) this.preview(id, view.model);
    }
    finishMovements() {
        for (const id of this.movements.keys()) this.finishMovement(id);
    }
    tickMovement(id: string, deltaMs: number, reducedMotion: boolean) {
        const active = this.movements.get(id);
        if (!active) return false;
        active.elapsed += deltaMs;
        if (reducedMotion || active.elapsed >= active.duration) this.finishMovement(id);
        else this.preview(id, pathPosition(active));
        return true;
    }
    hit(point: Point) {
        return (
            [...this.views.values()].reverse().find((view) => view.contains(point.x, point.y))
                ?.model.id ?? null
        );
    }
    preview(id: string, point: Point) {
        this.views.get(id)?.position.set(point.x, point.y);
    }
    selection(ids: readonly string[], hover: string | null) {
        this.views.forEach((view, id) => view.setState(ids.includes(id), hover === id));
    }
}

function samePoint(a: Point | undefined, b: Point) {
    return a?.x === b.x && a.y === b.y;
}
