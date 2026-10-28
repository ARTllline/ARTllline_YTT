import { describe, expect, it } from 'vitest';
import { moveItem, nextScene, type SessionItem } from './model';
const item = (id: string, type: SessionItem['type'] = 'scene'): SessionItem => ({
    id,
    type,
    referenceId: id,
    name: id,
    title: '',
    notes: '',
    sceneId: null,
    missing: false,
});
describe('session plan navigation', () => {
    it('moves stable references without copying or mutating the original plan', () => {
        const source = [item('a'), item('b', 'cue'), item('c')];
        expect(moveItem(source, 'a', 2).map((i) => i.id)).toEqual(['b', 'c', 'a']);
        expect(source.map((i) => i.id)).toEqual(['a', 'b', 'c']);
        expect(moveItem(source, 'b', -1)[0]).toBe(source[1]);
    });
    it('chooses only the nearest future valid scene, not a cue or missing reference', () => {
        const items = [
            item('a'),
            item('cue', 'cue'),
            { ...item('deleted'), missing: true },
            item('b'),
            item('c'),
        ];
        expect(nextScene({ items, currentItemId: 'a' })?.id).toBe('b');
        expect(nextScene({ items, currentItemId: 'b' })?.id).toBe('c');
        expect(nextScene({ items, currentItemId: 'c' })).toBeUndefined();
    });
});
