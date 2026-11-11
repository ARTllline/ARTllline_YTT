import { expect, it, vi } from 'vitest';
import type { Token } from '../types/scene';
import { createDemoScene } from '../state/demoScene';
import { TokenLayer } from './TokenLayer';

vi.hoisted(() => vi.stubGlobal('navigator', { userAgent: '' }));
vi.mock('../objects/TokenView', async () => {
    const { Container } = await import('pixi.js');
    return {
        TokenView: class extends Container {
            constructor(public model: Token) {
                super();
                this.update(model);
            }
            update(model: Token) {
                this.model = model;
                this.position.set(model.x, model.y);
            }
            setActiveTurn() {}
            contains(x: number, y: number, padding = 5) {
                return (
                    Math.hypot(x - this.x, y - this.y) <=
                    (this.model.size * this.model.scale) / 2 + padding
                );
            }
        },
    };
});

it('instant Drag supersedes an active walk without starting another animation', () => {
    const layer = new TokenLayer(),
        start = createDemoScene().tokens[0];
    const first = { ...start, x: start.x + 300 },
        end = { ...first, y: first.y + 100 };
    layer.sync([start]);
    layer.sync([first], false, undefined, [{ tokenId: start.id, path: [start, first] }]);
    layer.tickMovement(start.id, 100, false);
    layer.sync([end], false, undefined, [{ tokenId: start.id, path: [first, end], instant: true }]);
    expect(layer.isMoving(start.id)).toBe(false);
    expect(layer.views.get(start.id)!.x).toBe(end.x);
    expect(layer.views.get(start.id)!.y).toBe(end.y);
    layer.destroy({ children: true });
});

it('continues accepted corners without jumping on re-command and discards paths on correction/deletion', () => {
    const layer = new TokenLayer();
    const start = createDemoScene().tokens[0];
    const first = { ...start, x: start.x + 200 };
    const second = { ...first, y: first.y + 200 };
    layer.sync([start]);
    layer.sync([first], false, undefined, [{ tokenId: start.id, path: [start, first] }]);
    const view = layer.views.get(start.id)!;
    layer.tickMovement(start.id, 100, false);
    expect(view.x).toBeGreaterThan(start.x);
    expect(view.x).toBeLessThan(first.x);
    expect(view.model).toBe(first);

    const renderedX = view.x;
    layer.sync([second], false, undefined, [{ tokenId: start.id, path: [first, second] }]);
    expect(view.x).toBe(renderedX);
    expect(view.y).toBe(first.y);
    layer.tickMovement(start.id, 100, false);
    expect(view.x).toBeGreaterThan(renderedX);
    expect(view.y).toBe(first.y);
    layer.tickMovement(start.id, 2000, false);
    expect(view.y).toBeGreaterThan(first.y);
    const correction = { ...second, x: second.x + 100 };
    layer.sync([correction]);
    expect(layer.tickMovement(start.id, 100, false)).toBe(false);
    expect(view.x).toBe(correction.x);

    layer.sync([second], false, undefined, [{ tokenId: start.id, path: [correction, second] }]);
    layer.tickMovement(start.id, 10, true);
    expect(view.x).toBe(second.x);
    expect(layer.isMoving(start.id)).toBe(false);
    layer.sync([correction], false, undefined, [{ tokenId: start.id, path: [second, correction] }]);
    layer.sync([]);
    expect(view.destroyed).toBe(true);
    expect(layer.isMoving(start.id)).toBe(false);
    layer.destroy({ children: true });
});

it('bridges a late continuous step with accepted movement and preserves corners', () => {
    const layer = new TokenLayer();
    const origin = { ...createDemoScene().tokens[0], x: 100, y: 100 };
    const first = { ...origin, x: 136 };
    const second = { ...first, y: 136 };
    layer.sync([origin]);
    layer.sync([first], false, undefined, [
        { tokenId: origin.id, path: [origin, first], continuous: true, duration: 200 },
    ]);
    layer.tickMovement(origin.id, 225, false);
    const view = layer.views.get(origin.id)!;
    expect(view.x).toBeCloseTo(132.4);
    const renderedX = view.x;
    layer.sync([second], false, undefined, [
        { tokenId: origin.id, path: [first, second], continuous: true, duration: 200 },
    ]);
    expect(view.x).toBe(renderedX);
    expect(view.y).toBe(100);
    layer.tickMovement(origin.id, 10, false);
    expect(view.x).toBeGreaterThan(renderedX);
    expect(view.x).toBeLessThan(136);
    expect(view.y).toBe(100);
    layer.tickMovement(origin.id, 100, false);
    expect(view.x).toBe(136);
    expect(view.y).toBeGreaterThan(100);
    layer.tickMovement(origin.id, 115, false);
    expect(view.y).toBe(136);
    expect(layer.isMoving(origin.id)).toBe(false);
    layer.destroy({ children: true });
});

it('bounds playback when a background spectator receives many steps without ticker frames', () => {
    const layer = new TokenLayer();
    let previous = { ...createDemoScene().tokens[0], x: 100, y: 100 };
    layer.sync([previous]);
    for (let i = 0; i < 100; i++) {
        const next = { ...previous, x: previous.x + 36 };
        layer.sync([next], false, undefined, [
            { tokenId: next.id, path: [previous, next], continuous: true, duration: 200 },
        ]);
        previous = next;
    }
    expect(layer.views.size).toBe(1);
    expect(layer.views.get(previous.id)!.x).toBeGreaterThanOrEqual(previous.x - 108);
    layer.tickMovement(previous.id, 1000, false);
    expect(layer.views.get(previous.id)!.x).toBe(previous.x);
    expect(layer.isMoving(previous.id)).toBe(false);
    layer.destroy({ children: true });
});

it('prioritizes actual overlapping footprints and retains a forgiving target for tiny tokens', () => {
    const layer = new TokenLayer(),
        base = createDemoScene().tokens[0];
    const big = { ...base, id: 'big', x: 0, y: 0, size: 40, scale: 1 },
        small = { ...base, id: 'small', x: 27, y: 0, size: 2, scale: 1 };
    layer.sync([big, small]);
    expect(layer.hit({ x: 20, y: 0 }, 30)).toBe('big');
    expect(layer.hit({ x: 28.5, y: 0 }, 4)).toBe('small');
    layer.sync([big, { ...small, x: 0 }]);
    expect(layer.hit({ x: 0, y: 0 }, 4)).toBe('small');
    layer.destroy({ children: true });
});
