import type { Point, SceneProp, Token } from '../../types/scene';
import type { SceneStore } from '../../state/SceneStore';
import type { TokenLayer } from '../../layers/TokenLayer';
import type { ScenePropLayer } from '../../layers/ScenePropLayer';
import { snapPoint } from '../../utils/coordinates';
import { editorInteractionScene } from '../../mapEditor';
import type { InteractionLayer } from '../../layers/InteractionLayer';
import { movementBlocked, movementObstacles, movementRange } from '../../utils/movement';
import type { Scene } from '../../types/scene';

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
        zoom: number;
        frame?: { scene: Scene; point: Point };
        geometry?: {
            scene: Scene;
            fixed: ReturnType<typeof movementObstacles>;
            relative: ReturnType<typeof movementObstacles>;
        };
    };
    constructor(
        private store: SceneStore,
        private tokens: TokenLayer,
        private props: ScenePropLayer,
        private overlay: InteractionLayer,
    ) {}
    down(point: Point, shift: boolean, zoom: number) {
        if (this.store.role !== 'gm') return false;
        const state = this.store.getSnapshot();
        const editable = editorInteractionScene(state.scene, state.mapEditor);
        if (state.mapEditor && !editable.props?.length) return false;
        const resize = this.props.resizeHit(point, state.selectedPropIds ?? [], zoom);
        const tokenId = resize || state.mapEditor ? null : this.tokens.hit(point),
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
        tokens.forEach((token) => this.tokens.finishMovement(token.id));
        this.drag = {
            start: point,
            anchor,
            kind,
            tokens,
            props,
            resize: !!resize,
            moved: false,
            point,
            zoom,
        };
        return true;
    }
    move(point: Point, zoom: number) {
        const d = this.drag;
        if (!d) return;
        if (point.x === d.point.x && point.y === d.point.y && zoom === d.zoom) {
            this.preview();
            return;
        }
        d.point = point;
        d.zoom = zoom;
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
                    p.scaleX +
                        (dx * Math.cos(r) - dy * Math.sin(r)) /
                            (p.image.width * (p.pivotX === 1 ? -1 : 1 - (p.pivotX ?? 0.5))),
                ),
            ),
            y: Math.max(
                0.001,
                Math.min(
                    100,
                    p.scaleY +
                        (dx * Math.sin(r) + dy * Math.cos(r)) /
                            (p.image.height * (p.pivotY === 1 ? -1 : 1 - (p.pivotY ?? 0.5))),
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
        const { scene } = this.store.getSnapshot();
        if (d.frame?.scene === scene && d.frame.point === d.point) return;
        d.frame = { scene, point: d.point };
        const target = snapPoint(
            { x: d.anchor.x + d.point.x - d.start.x, y: d.anchor.y + d.point.y - d.start.y },
            scene.grid,
        );
        const dx = target.x - d.anchor.x,
            dy = target.y - d.anchor.y;
        const moved = (p: Point) => ({ x: p.x + dx, y: p.y + dy });
        if (d.geometry?.scene !== scene) {
            const props = new Set(d.props.map((p) => p.id));
            const obstacles = d.tokens.length ? movementObstacles(scene) : [];
            d.geometry = {
                scene,
                fixed: obstacles.filter((shape) => !shape.propId || !props.has(shape.propId)),
                relative: obstacles.filter((shape) => shape.propId && props.has(shape.propId)),
            };
        }
        const { fixed, relative } = d.geometry;
        const length = Math.hypot(dx, dy);
        const blocked =
            length > 0 &&
            d.tokens.some((t) => {
                const radius = (t.size * t.scale) / 2;
                return (
                    length > (movementRange(scene, t) ?? Infinity) + 0.001 ||
                    movementBlocked(t, moved(t), radius, fixed) ||
                    movementBlocked(t, t, radius, relative)
                );
            });
        d.props.forEach((p) => this.props.preview(p.id, blocked ? p : moved(p)));
        if (d.tokens.length) {
            const token = d.tokens[0];
            this.overlay.showMovement(
                token,
                moved(token),
                (token.size * token.scale) / 2,
                d.zoom,
                blocked,
                scene.grid,
                movementRange(scene, token),
                true,
                d.tokens.slice(1).map((member) => ({
                    point: moved(member),
                    radius: (member.size * member.scale) / 2,
                })),
            );
        }
    }
    up(point: Point) {
        const d = this.drag;
        if (!d) return;
        this.move(point, d.zoom);
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
                this.cancel();
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
        d.props.forEach((p) => {
            this.props.preview(p.id, p);
            this.props.resize(p.id, p.scaleX, p.scaleY);
        });
    }
    get tokenIds() {
        return this.drag?.tokens.map((t) => t.id) ?? [];
    }
}
