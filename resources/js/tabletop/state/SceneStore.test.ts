import { describe, expect, it, vi } from 'vitest';
import { SceneStore } from './SceneStore';
import { createDemoScene } from './demoScene';
describe('local scene operations', () => {
    it('publishes immutable snapshots and preserves unrelated tokens', () => {
        const store = new SceneStore(createDemoScene());
        const before = store.getSnapshot();
        const listener = vi.fn();
        const unsubscribe = store.subscribe(listener);
        store.updateToken('kern', { x: 12.34, rotation: -90 });
        const after = store.getSnapshot();
        expect(before.scene.tokens[0].x).toBe(630);
        expect(after.scene.tokens[0]).toMatchObject({ x: 12.34, rotation: 270 });
        expect(after.scene.tokens[1]).toBe(before.scene.tokens[1]);
        expect(listener).toHaveBeenCalledTimes(1);
        unsubscribe();
        store.select('mira');
        expect(listener).toHaveBeenCalledTimes(1);
    });
    it('keeps drag previews out of domain data and clears them on commit/cancel', () => {
        const store = new SceneStore(createDemoScene());
        store.select('kern');
        store.previewMove('kern', { x: 100, y: 200 });
        expect(store.getSnapshot().scene.tokens[0].x).toBe(630);
        store.clearPreview();
        expect(store.getSnapshot().preview).toBeNull();
        store.previewMove('kern', { x: 100, y: 200 });
        store.updateToken('kern', { x: 90, y: 210 });
        expect(store.getSnapshot().preview).toBeNull();
        expect(store.getSnapshot().scene.tokens[0]).toMatchObject({ x: 90, y: 210 });
    });
    it('validates numeric edits and clamps dependent HP values', () => {
        const store = new SceneStore(createDemoScene());
        store.updateToken('kern', {
            x: NaN,
            y: Infinity,
            scale: -10,
            maxHp: 10,
            hp: 200,
            name: '   ',
        });
        expect(store.getSnapshot().scene.tokens[0]).toMatchObject({
            x: 630,
            y: 750,
            scale: 0.4,
            maxHp: 10,
            hp: 10,
            name: 'Kern',
        });
        store.updateToken('kern', { hp: -2 });
        expect(store.getSnapshot().scene.tokens[0].hp).toBe(0);
    });
    it('rejects nonexistent selection and supports deselection', () => {
        const store = new SceneStore(createDemoScene());
        store.select('missing');
        expect(store.getSnapshot().selectedIds).toEqual([]);
        store.select('kern');
        expect(store.getSnapshot().selectedIds).toEqual(['kern']);
        store.select(null);
        expect(store.getSnapshot().selectedIds).toEqual([]);
    });
    it('grid calibration never relocates existing objects', () => {
        const store = new SceneStore(createDemoScene());
        const tokens = store.getSnapshot().scene.tokens;
        store.updateGrid({ size: 80, offset: { x: 12, y: -20 } });
        expect(store.getSnapshot().scene.tokens).toBe(tokens);
        store.updateGrid({ size: 0 });
        expect(store.getSnapshot().scene.grid.size).toBe(20);
        store.updateGrid({ size: NaN });
        expect(store.getSnapshot().scene.grid.size).toBe(20);
    });
});
