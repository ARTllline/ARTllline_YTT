import { afterEach, expect, it, vi } from 'vitest';
import { Camera } from './Camera';
afterEach(() => vi.unstubAllGlobals());
it('fits a large map inside a narrow player viewport and keeps zoom anchored', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    const camera = new Camera();
    camera.fit(390, 700, 4096, 4096);
    expect(camera.state.zoom).toBeLessThan(0.2);
    expect(camera.state.x).toBeGreaterThanOrEqual(0);
    expect(camera.state.x + 4096 * camera.state.zoom).toBeLessThanOrEqual(390);
    expect(camera.state.y + 4096 * camera.state.zoom).toBeLessThanOrEqual(700);
    const anchor = { x: 195, y: 350 };
    const before = (anchor.x - camera.state.x) / camera.state.zoom;
    camera.zoomBy(1.5, anchor);
    camera.tick(16);
    expect((anchor.x - camera.state.x) / camera.state.zoom).toBeCloseTo(before);
});
