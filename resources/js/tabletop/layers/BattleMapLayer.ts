import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { Scene } from '../types/scene';
export class BattleMapLayer extends Container {
    private surface = new Graphics();
    private image = new Sprite();
    private cropMask = new Graphics();
    private boundsOutline = new Graphics();
    constructor() {
        super();
        this.addChild(this.surface, this.image, this.cropMask, this.boundsOutline);
    }
    update(scene: Scene, texture?: Texture, editing = false) {
        this.boundsOutline.clear();
        if (scene.mapWorld || editing)
            this.boundsOutline
                .rect(0, 0, scene.width, scene.height)
                .stroke({ color: 0xaccdbd, width: 2, alpha: 0.65 });
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
            this.cropMask.clear();
            if (map.crop) {
                const c = map.crop;
                this.cropMask
                    .rect(
                        map.x + c.x * map.width,
                        map.y + c.y * map.height,
                        c.width * map.width,
                        c.height * map.height,
                    )
                    .fill(0xffffff);
                this.image.mask = this.cropMask;
            } else this.image.mask = null;
        }
    }
}
