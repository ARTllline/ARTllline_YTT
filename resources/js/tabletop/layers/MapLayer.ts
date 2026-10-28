import { Container, Graphics, Text } from 'pixi.js';

/** Original, fixed vector demo artwork. No asset downloads or map-generation subsystem. */
export class MapLayer extends Container {
    constructor() {
        super();
        const g = new Graphics();
        this.addChild(g);
        const mask = new Graphics().rect(0, 0, 1440, 1080).fill(0xffffff);
        this.addChild(mask);
        g.mask = mask;
        g.roundRect(8, 12, 1440, 1080, 8).fill({ color: 0x000000, alpha: 0.35 });
        g.rect(0, 0, 1440, 1080).fill(0x283635).stroke({ color: 0x57635a, width: 2 });
        // Contour lines and quiet terrain grain, deterministic and drawn only once.
        for (let i = 0; i < 17; i++) {
            g.ellipse(160, 610, 150 + i * 23, 280 + i * 20).stroke({
                color: 0x637368,
                width: 1,
                alpha: 0.1,
            });
            g.ellipse(1390, 230, 100 + i * 19, 210 + i * 19).stroke({
                color: 0x637368,
                width: 1,
                alpha: 0.1,
            });
        }
        for (let i = 0; i < 850; i++) {
            const x = (i * 137.51) % 1440,
                y = (i * 79.37) % 1080;
            g.circle(x, y, i % 3 === 0 ? 1.4 : 0.7).fill({ color: 0xb0b4a0, alpha: 0.12 });
        }
        // Watercourse, bank and a broken crossing.
        const river = () =>
            g
                .moveTo(1050, 0)
                .bezierCurveTo(870, 220, 1170, 450, 1110, 650)
                .bezierCurveTo(1050, 900, 1260, 940, 1290, 1080);
        river().stroke({ color: 0x1d292a, width: 145 });
        river().stroke({ color: 0x315051, width: 112 });
        river().stroke({ color: 0x3b5f5e, width: 65, alpha: 0.5 });
        for (let i = 0; i < 15; i++)
            g.moveTo(1200 + (i % 3) * 12, 780 + i * 15)
                .lineTo(1230 + (i % 3) * 12, 776 + i * 15)
                .stroke({ color: 0x87b0a5, width: 1, alpha: 0.2 });
        g.poly([
            520, 1080, 520, 850, 420, 720, 440, 450, 760, 300, 900, 430, 920, 720, 790, 850, 790,
            1080,
        ]).fill(0x3c4540);
        // Observatory platform with concentric stone steps.
        for (let i = 0; i < 4; i++)
            g.roundRect(360 + i * 14, 260 + i * 14, 600 - i * 28, 540 - i * 28, 15)
                .fill(i % 2 ? 0x667067 : 0x49564f)
                .stroke({ color: 0x283430, width: 2 });
        g.rect(416, 316, 488, 428).fill(0x566158);
        for (let x = 420; x < 900; x += 60)
            for (let y = 320; y < 740; y += 60) {
                g.rect(x + 3, y + 3, 54, 54).fill({
                    color: (x + y) % 120 ? 0x687167 : 0x47584e,
                    alpha: 0.45,
                });
            }
        // Central astronomical seal.
        g.circle(660, 530, 147).fill(0x354b47).stroke({ color: 0x869887, width: 3 });
        g.circle(660, 530, 128).stroke({ color: 0x728c7e, width: 1 });
        g.circle(660, 530, 73).stroke({ color: 0x9caa8f, width: 2, alpha: 0.65 });
        for (let i = 0; i < 12; i++) {
            const a = (i * Math.PI) / 6;
            g.moveTo(660 + Math.cos(a) * 133, 530 + Math.sin(a) * 133)
                .lineTo(660 + Math.cos(a) * 142, 530 + Math.sin(a) * 142)
                .stroke({ color: 0xb9bea0, width: 3, alpha: 0.6 });
        }
        g.poly([660, 424, 685, 505, 766, 530, 685, 555, 660, 636, 635, 555, 554, 530, 635, 505])
            .fill({ color: 0x91ad99, alpha: 0.25 })
            .stroke({ color: 0xa2b29b, width: 2, alpha: 0.65 });
        g.circle(660, 530, 19).fill(0x9bb9a4).circle(660, 530, 9).fill(0x36544b);
        // Walls and column foundations.
        for (const [x, y, w, h] of [
            [360, 260, 195, 27],
            [650, 260, 310, 27],
            [360, 260, 27, 180],
            [360, 600, 27, 200],
            [933, 260, 27, 300],
            [810, 773, 150, 27],
            [360, 773, 170, 27],
        ]) {
            g.rect(x + 5, y + 8, w, h).fill({ color: 0x101b19, alpha: 0.55 });
            g.rect(x, y, w, h).fill(0x929080).stroke({ color: 0x333d36, width: 3 });
            g.rect(x + 5, y + 4, w - 10, h - 8).fill(0x777d6d);
        }
        for (const [x, y] of [
            [420, 320],
            [900, 320],
            [420, 740],
            [900, 740],
        ]) {
            g.circle(x + 6, y + 9, 27).fill({ color: 0x101b19, alpha: 0.55 });
            g.rect(x - 24, y - 24, 48, 48)
                .fill(0x7a8170)
                .stroke({ color: 0x333e36, width: 3 });
            g.circle(x, y, 18).fill(0x989b85).stroke({ color: 0x48554a, width: 3 });
            g.circle(x, y, 11).stroke({ color: 0x66735f, width: 2 });
        }
        for (let i = 0; i < 6; i++)
            g.rect(542, 800 + i * 13, 235, 10)
                .fill(i % 2 ? 0x64705f : 0x78816d)
                .stroke({ color: 0x344338, width: 1 });
        const title = new Text({
            text: 'THE SUNKEN OBSERVATORY',
            style: { fontFamily: 'Georgia', fontSize: 23, letterSpacing: 5, fill: 0xadb6a2 },
        });
        title.position.set(52, 52);
        title.alpha = 0.8;
        this.addChild(title);
        const subtitle = new Text({
            text: 'LOWER COURT  /  24 × 18',
            style: { fontFamily: 'Arial', fontSize: 12, letterSpacing: 3, fill: 0x9cae9f },
        });
        subtitle.position.set(54, 89);
        this.addChild(subtitle);
        g.moveTo(1330, 940)
            .lineTo(1330, 1000)
            .moveTo(1300, 970)
            .lineTo(1360, 970)
            .stroke({ color: 0xa5b19d, width: 1, alpha: 0.6 });
        g.poly([1330, 927, 1325, 940, 1335, 940]).fill(0xa5b19d);
    }
}
