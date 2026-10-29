import type { Token } from '../../tabletop/types/scene';

export function eligibleActors(tokens: readonly Token[], role: 'gm' | 'player') {
    return tokens.filter((token) => !token.isHidden && (role === 'gm' || token.isOwner === true));
}

export function actingToken(tokens: readonly Token[], id?: string) {
    return tokens.find((token) => token.id === id) ?? (tokens.length === 1 ? tokens[0] : undefined);
}

export const rollModes = {
    normal: 'Обычный',
    advantage: 'С преимуществом',
    disadvantage: 'С помехой',
} as const;
export type RollMode = keyof typeof rollModes;

export const signedModifier = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value)}`;
