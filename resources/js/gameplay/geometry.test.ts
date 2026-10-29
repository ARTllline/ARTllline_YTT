import { describe, it, expect } from 'vitest';
import { areaContains, abilityPreview, aimPoint } from './geometry';
import { abilityBinding, defaultSlots, placeBinding } from './hotbarModel';
import type { Ability } from './model';
import type { Scene, Token } from '../tabletop/types/scene';
const actor = { id: '1', x: 0, y: 0 } as Token;
const scene = {
    width: 2000,
    height: 2000,
    grid: { size: 60, distancePerCell: 5, snap: false, offset: { x: 0, y: 0 } },
    tokens: [actor, { id: '2', x: 300, y: 0 }],
} as unknown as Scene;
const ability = {
    target: 'token',
    range: { normal: 10, long: 30 },
    costs: [],
} as unknown as Ability;
describe('spatial ability targeting', () => {
    it('uses scene units and exposes long range without adding rules', () => {
        expect(abilityPreview(ability, scene, actor, { kind: 'token', id: '2' })).toMatchObject({
            valid: true,
            long: true,
            distance: 25,
        });
        expect(
            abilityPreview({ ...ability, range: { normal: 5, long: null } }, scene, actor, {
                kind: 'token',
                id: '2',
            }).valid,
        ).toBe(false);
        expect(abilityPreview(ability, scene, actor, { kind: 'token', id: 'hidden' }).valid).toBe(
            false,
        );
    });
    it('matches the server cone/line/circle/rectangle center geometry', () => {
        for (const shape of ['circle', 'cone', 'line', 'rectangle'] as const) {
            const a = { ...ability, area: { shape, size: 15, width: 5 } };
            expect(
                areaContains(a, { x: 0, y: 0 }, { x: 180, y: 0 }, { x: 120, y: 12 }, scene),
            ).toBe(true);
            expect(
                areaContains(a, { x: 0, y: 0 }, { x: 180, y: 0 }, { x: 120, y: 240 }, scene),
            ).toBe(false);
        }
    });
    it('clamps directional aim but leaves distant circle placement invalid', () => {
        const a = {
            ...ability,
            range: { normal: 15, long: null },
            area: { shape: 'cone' as const, size: 15, width: 5 },
        };
        expect(aimPoint(a, actor, { x: 1000, y: 0 }, scene)).toEqual({ x: 180, y: 0 });
        expect(
            abilityPreview({ ...a, area: { shape: 'circle', size: 20, width: 20 } }, scene, actor, {
                kind: 'point',
                x: 1000,
                y: 0,
            }).valid,
        ).toBe(false);
    });
});
describe('hotbar slots', () => {
    it('swaps assigned slots, preserves blanks and restores from browser', () => {
        const initial = defaultSlots(['a', 'b']);
        const moved = placeBinding(initial, abilityBinding('a'), 5);
        expect(moved[0]).toBeNull();
        expect(moved[5]).toEqual(abilityBinding('a'));
        expect(placeBinding(moved, abilityBinding('b'), 5).slice(0, 6)).toEqual([
            null,
            abilityBinding('a'),
            null,
            null,
            null,
            abilityBinding('b'),
        ]);
        expect(placeBinding(moved, abilityBinding('c'), 9)[9]).toEqual(abilityBinding('c'));
        expect(initial[0]).toEqual(abilityBinding('a'));
    });
});
