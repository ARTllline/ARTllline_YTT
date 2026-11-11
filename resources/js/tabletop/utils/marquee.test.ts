import { describe, it, expect } from 'vitest';
import { marqueeSelection } from './marquee';
import type { Scene } from '../types/scene';
const scene = {
    tokens: [{ id: 't', x: 100, y: 100, size: 40, scale: 1 }],
    props: [
        {
            id: 'p',
            x: 200,
            y: 100,
            rotation: 45,
            scaleX: 1,
            scaleY: 1,
            image: { width: 100, height: 20 },
        },
    ],
} as unknown as Scene;
describe('marquee world geometry', () => {
    it('selects mixed footprints with reversed corners and boundary contact', () => {
        expect(marqueeSelection(scene, { x: 250, y: 150 }, { x: 80, y: 80 })).toEqual({
            tokenIds: ['t'],
            propIds: ['p'],
        });
    });
    it('uses rotated geometry rather than the unrotated bounding box', () => {
        expect(marqueeSelection(scene, { x: 164, y: 64 }, { x: 174, y: 74 }).propIds).toEqual([
            'p',
        ]);
        expect(marqueeSelection(scene, { x: 150, y: 95 }, { x: 155, y: 105 }).propIds).toEqual([]);
    });
    it('shift toggles intersections and preserves untouched selection', () => {
        expect(
            marqueeSelection(
                scene,
                { x: 50, y: 50 },
                { x: 130, y: 130 },
                { tokenIds: ['t'], propIds: ['p'] },
            ),
        ).toEqual({ tokenIds: [], propIds: ['p'] });
    });
});

it('Preparation Shift marquee adds intersections without toggling existing members off', () => {
    expect(
        marqueeSelection(
            scene,
            { x: 50, y: 50 },
            { x: 130, y: 130 },
            { tokenIds: ['t'], propIds: ['p'] },
            true,
        ),
    ).toEqual({ tokenIds: ['t'], propIds: ['p'] });
});
it('marquee respects a rotated prop with an off-center pivot', () => {
    const shifted = {
        ...scene,
        tokens: [],
        props: [{ ...scene.props![0], x: 200, y: 100, rotation: 0, pivotX: 0, pivotY: 0 }],
    };
    expect(marqueeSelection(shifted, { x: 275, y: 105 }, { x: 280, y: 110 }).propIds).toEqual([
        'p',
    ]);
    expect(marqueeSelection(shifted, { x: 165, y: 90 }, { x: 175, y: 99 }).propIds).toEqual([]);
});
