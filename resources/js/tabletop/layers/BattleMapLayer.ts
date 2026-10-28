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
            .rect(0, 0, scene.width, scene.height)
            .fill(0x24302e)
            .stroke({ color: 0x43584c, width: 2 });
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
