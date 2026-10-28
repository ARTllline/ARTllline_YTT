import type { Point, SceneProp, Token } from '../../types/scene';
import type { SceneStore } from '../../state/SceneStore';
import type { TokenLayer } from '../../layers/TokenLayer';
import type { ScenePropLayer } from '../../layers/ScenePropLayer';
import { snapPoint } from '../../utils/coordinates';

/** GM selection gestures use the same PointerController capture and DOM listeners. */
export class ObjectGesture {
    private drag?: {
        start: Point;
        anchor: Token | SceneProp;
        kind: 'token' | 'prop';
        tokens: Token[];
        props: SceneProp[];
        resize: boolean;
        moved: boolean;
        point: Point;
    };
    constructor(
        private store: SceneStore,
        private tokens: TokenLayer,
        private props: ScenePropLayer,
    ) {}
    down(point: Point, shift: boolean, zoom: number) {
        if (this.store.role !== 'gm') return false;
        const state = this.store.getSnapshot();
        const resize = this.props.resizeHit(point, state.selectedPropIds ?? [], zoom);
        const tokenId = resize ? null : this.tokens.hit(point),
            propId = resize ?? (!tokenId ? this.props.hit(point) : null);
        if (!tokenId && !propId) return false;
        const kind = tokenId ? 'token' : 'prop',
            id = (tokenId ?? propId)!;
        const selection = this.store.selection();
        if (tokenId && !shift && selection.tokenIds.length + selection.propIds.length <= 1)
            return false;
        const already = (kind === 'token' ? selection.tokenIds : selection.propIds).includes(id);
        if (shift || !already) this.store.selectObject(kind, id, shift);
        if (shift || !this.store.objectEditingEnabled) return true;
        const selected = this.store.selection();
        const tokens = state.scene.tokens.filter((t) => selected.tokenIds.includes(t.id));
        const props = (state.scene.props ?? []).filter((p) => selected.propIds.includes(p.id));
        if ([...tokens, ...props].some((o) => o.isLocked)) return true;
        const anchor = (kind === 'token' ? tokens : props).find((o) => o.id === id)!;
        this.drag = {
            start: point,
            anchor,
            kind,
            tokens,
            props,
            resize: !!resize,
            moved: false,
            point,
        };
        return true;
    }
    move(point: Point) {
        const d = this.drag;
        if (!d) return;
        d.point = point;
        d.moved ||= Math.hypot(point.x - d.start.x, point.y - d.start.y) > 2;
        this.preview();
    }
    private scales() {
        const d = this.drag!,
            p = d.anchor as SceneProp,
            r = (-p.rotation * Math.PI) / 180,
            dx = d.point.x - d.start.x,
            dy = d.point.y - d.start.y;
        return {
            x: Math.max(
                0.001,
                Math.min(
                    100,
                    p.scaleX + (2 * (dx * Math.cos(r) - dy * Math.sin(r))) / p.image.width,
                ),
            ),
            y: Math.max(
                0.001,
                Math.min(
                    100,
                    p.scaleY + (2 * (dx * Math.sin(r) + dy * Math.cos(r))) / p.image.height,
                ),
            ),
        };
    }
    preview() {
        const d = this.drag;
        if (!d?.moved) return;
        if (d.resize) {
            const s = this.scales();
            this.props.resize(d.anchor.id, s.x, s.y);
            return;
        }
        const dx = d.point.x - d.start.x,
            dy = d.point.y - d.start.y;
        d.tokens.forEach((t) => this.tokens.preview(t.id, { x: t.x + dx, y: t.y + dy }));
        d.props.forEach((p) => this.props.preview(p.id, { x: p.x + dx, y: p.y + dy }));
    }
    up(point: Point) {
        const d = this.drag;
        if (!d) return;
        this.move(point);
        if (d.moved) {
            if (d.resize) {
                const s = this.scales();
                this.drag = undefined;
                this.store.objectCommand({
                    endpoint: 'props',
                    data: {
                        action: 'update',
                        id: d.anchor.id,
                        patch: { scale_x: s.x, scale_y: s.y },
                    },
                });
            } else {
                const target = snapPoint(
                    { x: d.anchor.x + point.x - d.start.x, y: d.anchor.y + point.y - d.start.y },
                    this.store.getSnapshot().scene.grid,
                );
                this.drag = undefined;
                this.store.objectCommand({
                    endpoint: 'selection',
                    data: {
                        action: 'move',
                        tokenIds: d.tokens.map((t) => t.id),
                        propIds: d.props.map((p) => p.id),
                        anchorKind: d.kind,
                        anchorId: d.anchor.id,
                        ...target,
                    },
                });
            }
        }
        this.drag = undefined;
    }
    cancel() {
        const d = this.drag;
        this.drag = undefined;
        if (!d) return;
        d.tokens.forEach((t) => this.tokens.preview(t.id, t));
        d.props.forEach((p) => {
            this.props.preview(p.id, p);
            this.props.resize(p.id, p.scaleX, p.scaleY);
        });
    }
    get tokenIds() {
        return this.drag?.tokens.map((t) => t.id) ?? [];
    }
}
