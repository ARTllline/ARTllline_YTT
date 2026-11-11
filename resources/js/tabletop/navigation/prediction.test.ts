import { expect, it } from 'vitest';
import { predictionRemainder } from './prediction';

it('retains an unaccepted prefix remainder and every corner/reversal without moving the preview endpoint', () => {
    const sent = [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 40 },
        { x: 0, y: 40 },
    ];
    const tail = [
        { x: 0, y: 40 },
        { x: 0, y: 0 },
    ];
    expect(predictionRemainder(sent, 50, { x: 30, y: 20 }, tail)).toEqual([
        { x: 30, y: 20 },
        { x: 30, y: 40 },
        { x: 0, y: 40 },
        { x: 0, y: 0 },
    ]);
    expect(predictionRemainder(sent, 100, { x: 0, y: 40 }, tail)).toEqual(tail);
    expect(predictionRemainder(sent, 0, sent[0], tail)).toEqual([...sent, ...tail.slice(1)]);
    expect(() => predictionRemainder(sent, 50, { x: 0, y: 20 }, tail)).toThrow();
    expect(() => predictionRemainder(sent, 120, { x: 0, y: 40 }, tail)).toThrow();
});
