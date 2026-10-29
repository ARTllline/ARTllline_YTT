import { describe, expect, it } from 'vitest';
import { canAfford, newAbility, type CharacterResource } from './model';
import { readPendingAbility, retainAbility, clearAbility } from './pendingAbility';

describe('player ability state', () => {
    it('requires every resource and leaves exhausted actions visible', () => {
        const a = newAbility('attack', 0);
        a.costs = [
            { key: 'mana', amount: 2 },
            { key: 'focus', amount: 1 },
        ];
        const resources = [
            { key: 'mana', current: 6 },
            { key: 'focus', current: 1 },
        ] as CharacterResource[];
        expect(canAfford(a, resources)).toBe(true);
        expect(canAfford(a, resources.slice(0, 1))).toBe(false);
        expect(canAfford(a, [{ key: 'mana', current: 0 }] as CharacterResource[])).toBe(false);
    });
    it('retains immutable target, scene, mode and UUID across reload', () => {
        const values = new Map<string, string>();
        Object.defineProperty(globalThis, 'sessionStorage', {
            configurable: true,
            value: {
                getItem: (k: string) => values.get(k) ?? null,
                setItem: (k: string, v: string) => values.set(k, v),
                removeItem: (k: string) => values.delete(k),
            },
        });
        const value = {
            sceneId: '3',
            name: 'Attack',
            command: {
                characterId: '1',
                abilityId: 'a',
                epoch: 4,
                target: { kind: 'token' as const, id: '12' },
                rollMode: 'advantage' as const,
                clientMutationId: 'fixed',
            },
        };
        retainAbility('user:campaign:character', value);
        expect(readPendingAbility('user:campaign:character')).toEqual(value);
        expect(readPendingAbility('other:campaign:character')).toBeNull();
        clearAbility('user:campaign:character');
        expect(readPendingAbility('user:campaign:character')).toBeNull();
    });
    it('offers useful attack and check presets without rules-specific criticals', () => {
        const attack = newAbility('attack', 0),
            check = newAbility('check', 1);
        expect(attack.target).toBe('token');
        expect(attack.check?.defense).toBe('ac');
        expect(check.target).toBe('self');
        expect(check.damage).toBeNull();
    });
});
