import { Container, Graphics, Text } from 'pixi.js';
import type { SceneNote, Point } from '../types/scene';
export class GMLayer extends Container {
    private views = new Map<
        string,
        { root: Container; icon: Graphics; label: Text; note: SceneNote }
    >();
    sync(notes: readonly SceneNote[], selected?: string, visible = true) {
        this.visible = visible;
        for (const [id, view] of this.views)
            if (!notes.some((n) => n.id === id)) {
                view.root.destroy({ children: true });
                this.views.delete(id);
            }
        for (const note of notes) {
            let view = this.views.get(note.id);
            if (!view) {
                const root = new Container(),
                    icon = new Graphics(),
                    label = new Text({
                        text: '',
                        style: { fontFamily: 'Inter, sans-serif', fontSize: 12, fill: 0xe5dbb8 },
                    });
                label.anchor.set(0.5, 0);
                label.y = 23;
                root.addChild(icon, label);
                this.addChild(root);
                view = { root, icon, label, note };
                this.views.set(note.id, view);
            }
            view.note = note;
            view.root.position.set(note.x, note.y);
            view.label.text = note.title.length > 28 ? note.title.slice(0, 27) + '…' : note.title;
            const g = view.icon;
            const color =
                note.icon === 'warning' || note.icon === 'encounter' ? 0xe1a173 : 0xcab783;
            g.clear()
                .circle(0, 0, 18)
                .fill({ color: 0x1b2425, alpha: 0.95 })
                .stroke({
                    color: selected === note.id ? 0xffecc4 : color,
                    width: selected === note.id ? 3 : 1.5,
                });
            if (note.icon === 'warning' || note.icon === 'encounter')
                g.moveTo(0, -8)
                    .lineTo(0, 3)
                    .stroke({ color, width: 2 })
                    .circle(0, 8, 1.5)
                    .fill(color);
            else if (note.icon === 'secret')
                g.roundRect(-7, -2, 14, 11, 2)
                    .stroke({ color, width: 1.5 })
                    .arc(0, -2, 5, Math.PI, 0)
                    .stroke({ color, width: 1.5 });
            else if (note.icon === 'clue')
                g.circle(-2, -2, 6)
                    .stroke({ color, width: 1.5 })
                    .moveTo(3, 3)
                    .lineTo(9, 9)
                    .stroke({ color, width: 2 });
            else
                g.roundRect(-7, -9, 14, 18, 2)
                    .stroke({ color, width: 1.5 })
                    .moveTo(-4, -3)
                    .lineTo(4, -3)
                    .moveTo(-4, 2)
                    .lineTo(4, 2)
                    .stroke({ color, width: 1.5 });
        }
    }
    hit(point: Point, zoom: number) {
        if (!this.visible) return null;
        return (
            [...this.views.values()]
                .reverse()
                .find((v) => Math.hypot(point.x - v.root.x, point.y - v.root.y) <= 20 / zoom)?.note
                .id ?? null
        );
    }
    preview(id: string, point: Point) {
        this.views.get(id)?.root.position.set(point.x, point.y);
    }
    zoom(zoom: number) {
        for (const view of this.views.values()) view.root.scale.set(1 / zoom);
    }
}
