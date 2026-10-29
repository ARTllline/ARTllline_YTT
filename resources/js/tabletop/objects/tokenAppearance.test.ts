import { describe, expect, it } from 'vitest';
import { tokenAppearance, tokenLabelVisible } from './tokenAppearance';
import type { Token } from '../types/scene';
const token: Token = {
    id: '1',
    name: 'Керн Северный',
    kind: 'hero',
    x: 0,
    y: 0,
    size: 64,
    scale: 1,
    rotation: 0,
    color: 0xe79a97,
};
describe('token presentation', () => {
    it('keeps configured color without inventing allegiance', () => {
        expect(tokenAppearance(token).color).toBe(token.color);
        expect(tokenAppearance(token).initials).toBe('КС');
        expect(tokenAppearance({ ...token, ownerUserId: '9' }).color).toBe(0x9de2c4);
        expect(tokenAppearance({ ...token, color: 0x94cbb8 }).color).toBe(0x95bce8);
        expect(tokenAppearance({ ...token, ownerUserId: '9', isHidden: true }).marker).toBe('GM');
    });
    it('keeps important labels readable while reducing distant clutter', () => {
        expect(tokenLabelVisible(0.3, false)).toBe(false);
        expect(tokenLabelVisible(0.3, true)).toBe(true);
        expect(tokenLabelVisible(0.8, false)).toBe(true);
    });
});
