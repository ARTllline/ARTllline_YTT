import { Container, Graphics } from 'pixi.js';
import { PlacementGhost } from './PlacementGhost';
import { compositionIssue, type CompositionMember } from '../../api/compositions';
import type { Point } from '../types/scene';

/** Shared click/native-drag composition preview, with one snapped world anchor. */
export class CompositionGhost extends Container {
    private members: CompositionMember[] = [];
    private frame = new Graphics();
    constructor() {
        super();
        this.visible = false;
        this.eventMode = 'none';
    }
    configure(members: CompositionMember[]) {
        this.clear();
        this.members = members;
        for (const m of [...members].sort(
            (a, b) => Number(a.kind === 'token') - Number(b.kind === 'token'),
        )) {
            const ghost = new PlacementGhost();
            ghost.configure(
                m.image?.url,
                m.width,
                m.height,
                m.kind === 'token',
                m.name,
                m.pivotX,
                m.pivotY,
            );
            ghost.position.set(m.x, m.y);
            ghost.angle = m.rotation;
            ghost.visible = true;
            this.addChild(ghost);
        }
        this.frame = new Graphics();
        this.addChild(this.frame);
    }
    move(point: Point, zoom: number) {
        this.position.copyFrom(point);
        this.visible = true;
        const points = this.members.flatMap((m) => {
            const angle = (m.rotation * Math.PI) / 180,
                c = Math.cos(angle),
                s = Math.sin(angle);
            return [
                [-m.width * m.pivotX, -m.height * m.pivotY],
                [m.width * (1 - m.pivotX), -m.height * m.pivotY],
                [m.width * (1 - m.pivotX), m.height * (1 - m.pivotY)],
                [-m.width * m.pivotX, m.height * (1 - m.pivotY)],
            ].map(([x, y]) => ({ x: m.x + x * c - y * s, y: m.y + x * s + y * c }));
        });
        const x = Math.min(...points.map((p) => p.x)),
            y = Math.min(...points.map((p) => p.y));
        this.frame
            .clear()
            .rect(
                x - 5 / zoom,
                y - 5 / zoom,
                Math.max(...points.map((p) => p.x)) - x + 10 / zoom,
                Math.max(...points.map((p) => p.y)) - y + 10 / zoom,
            )
            .stroke({
                color: compositionIssue(this.members, point.x, point.y) ? 0xf2aa84 : 0xb7e1ce,
                width: 1.5 / zoom,
            });
    }
    clear() {
        this.removeChildren().forEach((child) => child.destroy({ children: true }));
        this.members = [];
        this.visible = false;
    }
}
