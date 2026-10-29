import type { Token } from '../types/scene';
// Presentation only: a creature kind is not an allegiance.
export function tokenAppearance(token: Token) {
    return {
        color: token.isHidden
            ? 0xbda6ef
            : token.ownerUserId || token.isOwner
              ? 0x9de2c4
              : token.color === 0x94cbb8
                ? 0x95bce8
                : token.color,
        initials: token.name
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => Array.from(part)[0])
            .join('')
            .toLocaleUpperCase(),
        marker: token.isHidden
            ? 'GM'
            : token.isLocked
              ? '◆'
              : token.ownerUserId || token.isOwner
                ? '●'
                : '',
    };
}
export function tokenLabelVisible(zoom: number, emphasized: boolean) {
    return emphasized || zoom >= 0.62;
}
