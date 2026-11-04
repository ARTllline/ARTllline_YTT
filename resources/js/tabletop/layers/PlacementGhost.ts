import { Container, Graphics, Sprite, Texture, Text } from 'pixi.js';

/** Transient world-space preview; never enters the scene store or realtime. */
export class PlacementGhost extends Container {
    private outline = new Graphics();
    private initials = new Text({
        text: '',
        style: { fontFamily: 'sans-serif', fontSize: 22, fill: 0xc8eddf },
    });
    private clip = new Graphics();
    private sprite?: Sprite;
    private texture?: Texture;
    private pending?: HTMLImageElement;
    constructor() {
        super();
        this.eventMode = 'none';
        this.visible = false;
        this.alpha = 0.65;
        this.addChild(this.outline);
        this.initials.anchor.set(0.5);
        this.addChild(this.initials, this.clip);
    }
    configure(
        url: string | undefined,
        width: number,
        height: number,
        round: boolean,
        name: string,
        pivotX = 0.5,
        pivotY = 0.5,
    ) {
        this.clear();
        this.outline.clear();
        this.clip.clear();
        this.initials.text = name.trim().slice(0, 1).toLocaleUpperCase();
        this.initials.style.fontSize = Math.max(12, width * 0.4);
        this.initials.visible = true;
        this.initials.position.set((0.5 - pivotX) * width, (0.5 - pivotY) * height);
        if (round) this.outline.circle(0, 0, width / 2);
        else this.outline.rect(-width * pivotX, -height * pivotY, width, height);
        this.outline.fill({ color: 0x84d9bc, alpha: 0.15 }).stroke({ color: 0xa9e8cc, width: 2 });
        if (!url) return;
        const image = new Image();
        this.pending = image;
        image.onload = () => {
            if (this.pending !== image || this.destroyed) return;
            this.texture = Texture.from(image);
            this.sprite = new Sprite(this.texture);
            this.sprite.anchor.set(pivotX, pivotY);
            this.sprite.width = width;
            this.sprite.height = height;
            this.initials.visible = false;
            if (round) {
                this.clip.circle(0, 0, width / 2).fill(0xffffff);
                this.sprite.mask = this.clip;
            }
            this.addChildAt(this.sprite, 0);
        };
        image.src = url;
    }
    clear() {
        this.visible = false;
        if (this.pending) this.pending.onload = null;
        this.pending = undefined;
        this.sprite?.destroy();
        this.sprite = undefined;
        this.texture?.destroy(true);
        this.texture = undefined;
    }
    override destroy() {
        this.clear();
        super.destroy({ children: true });
    }
}
