import { expect, it } from 'vitest';
import { visibilityPlayback, visibilityPlaybackProgress } from './playback';

it('keeps reveals on the token playback clock across accepted corners and overlapping receipts', () => {
    const paths = visibilityPlayback([
        {
            tokenId: 'a',
            path: [
                { x: 0, y: 0 },
                { x: 100, y: 0 },
                { x: 100, y: 100 },
            ],
        },
    ]);
    const progress = (x: number, y: number) =>
        visibilityPlaybackProgress(paths, new Map([['a', { x, y }]]));
    expect(progress(-20, 0)).toBe(0);
    expect(progress(50, 0)).toBeCloseTo(0.25);
    expect(progress(100, 50)).toBeCloseTo(0.75);
    expect(progress(100, 100)).toBe(1);
    expect(
        visibilityPlaybackProgress(
            visibilityPlayback([
                {
                    tokenId: 'a',
                    instant: true,
                    path: [
                        { x: 0, y: 0 },
                        { x: 1, y: 1 },
                    ],
                },
            ]),
        ),
    ).toBe(1);
});
