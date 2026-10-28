import { Container, Graphics } from 'pixi.js';
export class PropLayer extends Container {
    constructor() {
        super();
        const g = new Graphics();
        this.addChild(g);
        for (const [x, y, r] of [
            [230, 200, 58],
            [270, 870, 75],
            [160, 800, 50],
            [1250, 350, 62],
            [1270, 480, 83],
            [200, 350, 69],
            [960, 960, 44],
        ]) {
            g.ellipse(x + 10, y + 14, r, r * 0.8).fill({ color: 0x122722, alpha: 0.5 });
            for (let j = 0; j < 5; j++) {
                const a = j * 1.25;
                g.circle(x + Math.cos(a) * r * 0.35, y + Math.sin(a) * r * 0.3, r * 0.6)
                    .fill(j % 2 ? 0x354c3d : 0x3d5542)
                    .stroke({ color: 0x60755a, width: 1, alpha: 0.35 });
            }
        }
        for (const [x, y] of [
            [535, 272],
            [600, 285],
            [380, 520],
            [925, 600],
            [820, 780],
        ]) {
            g.poly([x, y, x + 22, y - 7, x + 36, y + 12, x + 12, y + 28, x - 8, y + 13])
                .fill(0x7d8271)
                .stroke({ color: 0x34453a, width: 3 });
        }
        for (const [x, y] of [
            [470, 685],
            [850, 380],
        ]) {
            g.circle(x, y, 35).fill({ color: 0xe5b66c, alpha: 0.07 });
            g.circle(x, y, 23).fill({ color: 0xe5b66c, alpha: 0.1 });
            g.circle(x, y, 10).fill(0x4b4a3c).stroke({ color: 0x9a8b65, width: 3 });
            g.poly([x - 5, y + 4, x - 3, y - 8, x + 2, y - 3, x + 5, y + 4]).fill(0xe6c485);
        }
    }
}
