import { Container } from 'pixi.js';
import type { Token, Point } from '../types/scene';
import { TokenView } from '../objects/TokenView';
export class TokenLayer extends Container {
    views = new Map<string, TokenView>();
    sync(tokens: readonly Token[]) {
        for (const [id, view] of this.views) {
            if (!tokens.some((token) => token.id === id)) {
                view.destroy({ children: true });
                this.views.delete(id);
            }
        }
        for (const token of tokens) {
            const existing = this.views.get(token.id);
            if (existing) {
                if (existing.model !== token) existing.update(token);
            } else {
                const view = new TokenView(token);
                this.views.set(token.id, view);
                this.addChild(view);
            }
        }
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
