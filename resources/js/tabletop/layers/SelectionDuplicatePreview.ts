import { Container, Graphics } from 'pixi.js';
import { PlacementGhost } from './PlacementGhost';
import type { Point } from '../types/scene';
import type { WorkspaceSnapshot } from '../state/SceneStore';
import { selectionBounds, translationIssue } from '../utils/selectionTransform';

/** One local Pixi composition, separate from canonical objects and their hit targets. */
export class SelectionDuplicatePreview extends Container {
    private draft?: WorkspaceSnapshot['duplicatePlacement'];
    private frame = new Graphics();
    private point?: Point;
    sync(draft: WorkspaceSnapshot['duplicatePlacement'], zoom: number) {
        if (draft !== this.draft) {
            this.removeChildren().forEach((child) => child.destroy({ children: true }));
            this.frame = new Graphics();
            this.draft = draft;
            this.point = draft
                ? { x: draft.members[0].x + 30, y: draft.members[0].y + 30 }
                : undefined;
            for (const o of draft?.members ?? []) {
                const ghost = new PlacementGhost(),
                    token = 'size' in o;
                ghost.configure(
                    o.image?.url,
                    token ? o.size * o.scale : o.image.width * o.scaleX,
                    token ? o.size * o.scale : o.image.height * o.scaleY,
                    token,
                    o.name ?? '',
                    token ? 0.5 : o.pivotX,
                    token ? 0.5 : o.pivotY,
                );
                ghost.position.set(o.x, o.y);
                ghost.angle = o.rotation;
                ghost.visible = true;
                this.addChild(ghost);
            }
            this.addChild(this.frame);
        }
        this.visible = !!draft;
        if (this.point) this.move(this.point, zoom);
    }
    move(point: Point, zoom: number) {
        if (!this.draft) return;
        this.point = point;
        const { members } = this.draft,
            anchor = members[0];
        const dx = point.x - anchor.x,
            dy = point.y - anchor.y;
        this.position.set(dx, dy);
        const bounds = selectionBounds(members);
        this.frame
            .clear()
            .rect(
                bounds.x - 5 / zoom,
                bounds.y - 5 / zoom,
                bounds.width + 10 / zoom,
                bounds.height + 10 / zoom,
            )
            .stroke({
                color: translationIssue(members, dx, dy) ? 0xf2aa84 : 0xb7e1ce,
                width: 1.5 / zoom,
            });
    }
}
