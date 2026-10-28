import { Container, Graphics } from 'pixi.js';
import type { Effect, Intensity } from '../../media/model';
interface Particle {
    view: Graphics;
    x: number;
    y: number;
    speed: number;
    phase: number;
    effect: Effect;
}
const counts = { rain: 100, snow: 65, embers: 45, haze: 5 };
/** Bounded, screen-space decoration. No filters, scene entities, textures or React ticks. */
export class AtmosphereLayer extends Container {
    private particles: Particle[] = [];
    private key = '';
    private time = 0;
    constructor() {
        super();
        this.eventMode = 'none';
    }
    configure(effects: Partial<Record<Effect, Intensity>>, reduced: boolean) {
        const key = JSON.stringify(effects) + reduced;
        if (key === this.key) return;
        this.key = key;
        this.removeChildren().forEach((child) => child.destroy());
        this.particles = [];
        for (const effect of Object.keys(counts) as Effect[]) {
            const intensity = effects[effect];
            if (!intensity) continue;
            const amount =
                { light: 0.45, medium: 0.75, strong: 1 }[intensity] * (reduced ? 0.2 : 1);
            for (let i = 0; i < Math.ceil(counts[effect] * amount); i++) {
                const view = new Graphics();
                if (effect === 'rain')
                    view.moveTo(0, 0)
                        .lineTo(-4, 17)
                        .stroke({ color: 0xa9c6da, alpha: 0.24, width: 1 });
                if (effect === 'snow')
                    view.circle(0, 0, 1 + Math.random() * 1.5).fill({
                        color: 0xe0edf0,
                        alpha: 0.5,
                    });
                if (effect === 'embers') {
                    view.circle(0, 0, 5).fill({ color: 0xdd632a, alpha: 0.035 });
                    view.circle(0, 0, 1.4).fill({ color: 0xffb96a, alpha: 0.65 });
                }
                if (effect === 'haze') {
                    for (let j = 8; j > 0; j--)
                        view.ellipse(0, 0, 50 + j * 38, 18 + j * 14).fill({
                            color: 0xc0d5d7,
                            alpha: 0.006,
                        });
                }
                this.addChild(view);
                this.particles.push({
                    view,
                    effect,
                    x: Math.random(),
                    y: Math.random(),
                    speed: 0.7 + Math.random() * 0.6,
                    phase: Math.random() * Math.PI * 2,
                });
            }
        }
    }
    tick(ms: number, width: number, height: number, reduced: boolean) {
        const dt = reduced ? 0 : Math.min(ms, 50) / 1000;
        this.time += dt;
        for (const p of this.particles) {
            const speed =
                p.effect === 'rain'
                    ? 560
                    : p.effect === 'snow'
                      ? 30
                      : p.effect === 'embers'
                        ? -45
                        : 3;
            p.y = (p.y + (dt * speed * p.speed) / Math.max(1, height) + 1) % 1;
            p.x = (p.x + (dt * (p.effect === 'rain' ? -80 : 7)) / Math.max(1, width) + 1) % 1;
            p.view.position.set(
                p.x * (width + 40) -
                    20 +
                    (p.effect === 'rain' ? 0 : Math.sin(this.time * 0.5 + p.phase) * 12),
                p.y * (height + 40) - 20,
            );
        }
    }
}
