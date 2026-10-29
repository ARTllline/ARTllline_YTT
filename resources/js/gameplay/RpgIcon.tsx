import type { CSSProperties } from 'react';

export const rpgIconKeys = new Set([
    'sword',
    'bow',
    'flame',
    'spark',
    'heart',
    'shield',
    'bolt',
    'eye',
    'potion',
    'footprints',
    'focus',
    'mana',
]);

/** Painted gameplay art; utility controls continue to use the UI icon system. */
export function RpgIcon({
    icon,
    size = 32,
    style,
}: {
    icon: string;
    size?: number;
    style?: CSSProperties;
}) {
    const utility = icon === 'book' || icon === 'search';
    const key = rpgIconKeys.has(icon) || utility ? icon : 'spark';
    return (
        <img
            className={`rpg-icon ${utility ? 'utility-pack-icon' : ''}`}
            src={utility ? `/assets/player/utility/${key}.svg` : `/assets/player/icons/${key}.png`}
            width={size}
            height={size}
            alt=""
            draggable={false}
            style={style}
        />
    );
}
