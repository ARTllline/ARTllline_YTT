import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { Scene } from '../types/scene';
export class BattleMapLayer extends Container {
    private surface = new Graphics();
    private image = new Sprite();
    constructor() {
        super();
        this.addChild(this.surface, this.image);
    }
    update(scene: Scene, texture?: Texture) {
        this.surface
            .clear()
            .roundRect(-8, -8, scene.width + 16, scene.height + 16, 4)
            .fill({ color: 0x000000, alpha: 0.18 })
            .rect(0, 0, scene.width, scene.height)
            .fill(0x232b2e)
            .stroke({ color: 0x66777c, width: 1, alpha: 0.25 });
        const map = scene.map;
        this.image.visible = !!map && !!texture;
        if (map && texture) {
            this.image.texture = texture;
            this.image.position.set(map.x, map.y);
            this.image.width = map.width;
            this.image.height = map.height;
        }
    }
}
