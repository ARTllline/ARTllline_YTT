import { selectionBounds, translationIssue } from '../../utils/selectionTransform';
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
        authoring: boolean;
        collapse: boolean;
        blocked: boolean;
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
        const count = state.selectedIds.length + (state.selectedPropIds?.length ?? 0);
        const authoring = !!state.entityAuthoring && !state.mapEditor;
        const resize =
            authoring && count > 1
                ? null
                : this.props.resizeHit(point, state.selectedPropIds ?? [], zoom);
        const tokenId =
                resize || state.mapEditor
                    ? null
                    : this.tokens.hit(point, authoring ? Math.max(5, 6 / zoom) : 5),
            propId = resize ?? (!tokenId ? this.props.hit(point) : null);
        if (!tokenId && !propId) return false;
        const kind = tokenId ? 'token' : 'prop',
            id = (tokenId ?? propId)!;
        const selection = this.store.selection();
        if (
            tokenId &&
            !authoring &&
            !shift &&
            selection.tokenIds.length + selection.propIds.length <= 1
        )
            return false;
        const already = (kind === 'token' ? selection.tokenIds : selection.propIds).includes(id);
        if (shift || !already) this.store.selectObject(kind, id, shift);
        if (shift || !this.store.objectEditingEnabled) return true;
        const selected = this.store.selection();
        const tokens = state.scene.tokens.filter((t) => selected.tokenIds.includes(t.id));
        const props = (state.scene.props ?? []).filter((p) => selected.propIds.includes(p.id));
        const issue = translationIssue([...tokens, ...props]);
        if (issue) {
            if (authoring) this.store.editorNotice(issue);
            if (!authoring) return true;
        }
        const anchor = (kind === 'token' ? tokens : props).find((o) => o.id === id)!;
        tokens.forEach((token) => this.tokens.finishMovement(token.id));
        this.drag = {
            authoring,
            blocked: !!issue,
            collapse: authoring && already && count > 1,
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
        if (d.blocked) {
            d.moved ||= Math.hypot(point.x - d.start.x, point.y - d.start.y) > 3 / zoom;
            return;
        }
        if (point.x === d.point.x && point.y === d.point.y && zoom === d.zoom) {
            this.preview();
            return;
        }
        d.point = point;
        d.zoom = zoom;
        d.moved ||= Math.hypot(point.x - d.start.x, point.y - d.start.y) > 3 / zoom;
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
        if (
            d.authoring &&
            d.frame?.scene !== scene &&
            (d.tokens.some((o) => {
                const current = scene.tokens.find((v) => v.id === o.id);
                return !current || current.isLocked || current.x !== o.x || current.y !== o.y;
            }) ||
                d.props.some((o) => {
                    const current = scene.props?.find((v) => v.id === o.id);
                    return !current || current.isLocked || current.x !== o.x || current.y !== o.y;
                }))
        ) {
            this.cancel();
            this.overlay.clear();
            this.store.editorNotice('Группа изменилась во время перемещения. Повторите жест.');
            return;
        }
        d.frame = { scene, point: d.point };
        const target = snapPoint(
            { x: d.anchor.x + d.point.x - d.start.x, y: d.anchor.y + d.point.y - d.start.y },
            scene.grid,
        );
        const dx = target.x - d.anchor.x,
            dy = target.y - d.anchor.y;
        const moved = (p: Point) => ({ x: p.x + dx, y: p.y + dy });
        if (d.authoring) {
            const members = [...d.tokens, ...d.props];
            const issue = translationIssue(members, dx, dy);
            d.tokens.forEach((t) => this.tokens.preview(t.id, moved(t)));
            d.props.forEach((p) => this.props.preview(p.id, moved(p)));
            this.overlay.showSelectionTransform(
                selectionBounds(members, { x: dx, y: dy }),
                d.zoom,
                members.length,
                issue,
            );
            return;
        }
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
        if (this.drag !== d) return;
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
                if (d.authoring) {
                    this.overlay.clear();
                    if (target.x === d.anchor.x && target.y === d.anchor.y) return;
                    const issue = translationIssue(
                        [...d.tokens, ...d.props],
                        target.x - d.anchor.x,
                        target.y - d.anchor.y,
                    );
                    if (issue) {
                        this.store.editorNotice(issue);
                        return;
                    }
                }
                this.store.objectCommand({
                    endpoint: 'selection',
                    data: {
                        ...(d.authoring
                            ? {
                                  action: 'translate' as const,
                                  expected: [
                                      ...d.tokens.map((o) => ({
                                          kind: 'token' as const,
                                          id: o.id,
                                          x: o.x,
                                          y: o.y,
                                      })),
                                      ...d.props.map((o) => ({
                                          kind: 'prop' as const,
                                          id: o.id,
                                          x: o.x,
                                          y: o.y,
                                      })),
                                  ],
                              }
                            : { action: 'move' as const }),
                        tokenIds: d.tokens.map((t) => t.id),
                        propIds: d.props.map((p) => p.id),
                        anchorKind: d.kind,
                        anchorId: d.anchor.id,
                        ...target,
                    },
                });
            }
        }
        if (!d.moved && d.collapse) this.store.selectObject(d.kind, d.anchor.id);
        this.drag = undefined;
    }
    cancel() {
        const d = this.drag;
        this.drag = undefined;
        if (!d) return;
        if (d.authoring) {
            const scene = this.store.getSnapshot().scene;
            d.tokens.forEach((t) =>
                this.tokens.preview(t.id, scene.tokens.find((o) => o.id === t.id) ?? t),
            );
            this.overlay.clear();
        }
        d.props.forEach((p) => {
            const current = this.store.getSnapshot().scene.props?.find((o) => o.id === p.id) ?? p;
            this.props.preview(p.id, current);
            this.props.resize(p.id, current.scaleX, current.scaleY);
        });
    }
    get tokenIds() {
        return this.drag?.tokens.map((t) => t.id) ?? [];
    }
}
