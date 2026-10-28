import { describe, it, expect } from 'vitest';
import { drawRegion, regionHandle, regionHit, transformRegion } from './geometry';
import { applyRegionPatch, type Region } from './model';
import { SceneStore } from '../tabletop/state/SceneStore';
import type { Scene } from '../tabletop/types/scene';
const rectangle: Region = {
    id: 'r',
    name: 'Test',
    enabled: true,
    shape: 'rectangle',
    geometry: { x: 100, y: 200, width: 300, height: 150 },
};
const scene: Scene = {
    id: '1',
    width: 1000,
    height: 1000,
    grid: { visible: false, snap: false, size: 50, offset: { x: 0, y: 0 } },
    tokens: [],
    regions: [rectangle],
    props: [
        {
            id: 'p',
            name: 'Door',
            x: 50,
            y: 50,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            zIndex: 0,
            image: { id: 'a', url: '/private', width: 40, height: 60 },
        },
    ],
};
describe('private region authoring', () => {
    it('normalizes reverse drags, bounds small shapes and uses circle center/radius', () => {
        expect(drawRegion('rectangle', { x: 400, y: 300 }, { x: 100, y: 100 })).toEqual({
            x: 100,
            y: 100,
            width: 300,
            height: 200,
        });
        expect(drawRegion('circle', { x: 100, y: 100 }, { x: 103, y: 104 })).toEqual({
            x: 100,
            y: 100,
            radius: 5,
        });
        expect(drawRegion('rectangle', { x: 0, y: 0 }, { x: 1, y: 1 })).toEqual({
            x: 0,
            y: 0,
            width: 10,
            height: 10,
        });
    });
    it('moves independently of camera and clamps resize without mutating the saved region', () => {
        expect(
            transformRegion(rectangle, { x: 100, y: 200 }, { x: 125, y: 180 }, false).geometry,
        ).toEqual({ x: 125, y: 180, width: 300, height: 150 });
        expect(
            transformRegion(rectangle, { x: 400, y: 350 }, { x: 0, y: 0 }, true).geometry,
        ).toEqual({ x: 100, y: 200, width: 10, height: 10 });
        expect(rectangle.geometry.width).toBe(300);
        expect(regionHandle(rectangle)).toEqual({ x: 400, y: 350 });
        expect(regionHit(rectangle, { x: 400, y: 350 })).toBe(true);
        expect(regionHit(rectangle, { x: 401, y: 350 })).toBe(false);
    });
    it('reconciles GM regions and keeps presentation visibility separate from enabled state', () => {
        const store = new SceneStore(scene);
        store.selectRegion('r');
        store.regionSettings({ showRegions: false });
        expect(store.getSnapshot().selectedRegionId).toBeUndefined();
        expect(store.getSnapshot().scene.regions![0].enabled).toBe(true);
        expect(applyRegionPatch(scene, { deletedRegionId: 'r' }).regions).toEqual([]);
        store.selectRegion('r');
        store.hydrate({ ...scene, id: '2', regions: [] });
        expect(store.getSnapshot().selectedRegionId).toBeUndefined();
    });
    it('allows a Player to select a visible prop but never edit objects or regions', () => {
        const store = new SceneStore({ ...scene, regions: undefined }, 'player');
        store.selectObject('prop', 'p');
        expect(store.getSnapshot().selectedPropIds).toEqual(['p']);
        store.objectCommand({
            endpoint: 'props',
            data: { action: 'update', id: 'p', patch: { x: 900 } },
        });
        expect(store.getSnapshot().scene.props![0].x).toBe(50);
        store.regionCommand({ ...rectangle, action: 'create' });
        store.selectRegion('r');
        expect(store.getSnapshot().scene.regions).toBeUndefined();
        expect(store.getSnapshot().selectedRegionId).toBeUndefined();
        store.selectObject('prop', 'unknown');
        expect(store.getSnapshot().selectedPropIds).toEqual(['p']);
    });
});
