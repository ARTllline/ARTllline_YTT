import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { eligibleActors, actingToken } from './actingToken';
import { SceneStore } from '../../tabletop/state/SceneStore';
import type { Token } from '../../tabletop/types/scene';
import { CheckDialog } from './CheckDialog';
import { checkRequest } from './checkRequest';

const token = (id: string, modifier: number, extra: Partial<Token> = {}): Token => ({
    id,
    name: id === 'kern' ? 'Керн' : 'Мира',
    kind: 'player_character',
    x: 0,
    y: 0,
    size: 60,
    scale: 1,
    rotation: 0,
    color: 0,
    isOwner: true,
    canMove: false,
    checkStats: [{ key: 'perception', label: 'Внимательность', modifier }],
    ...extra,
});

describe('acting character', () => {
    it('follows Character through scene tokens and never falls back to someone else when absent', () => {
        const first = token('first', 3, { characterId: 'character-kern' });
        const second = token('second', 3, { characterId: 'character-kern' });
        const other = token('other', 7, { characterId: 'character-mira' });
        expect(actingToken([first], undefined, 'character-kern')).toBe(first);
        expect(actingToken([second, other], 'first', 'character-kern')).toBe(second);
        expect(actingToken([other], 'first', 'character-kern')).toBeUndefined();
        expect(
            actingToken(
                eligibleActors([{ ...second, isOwner: false }], 'player'),
                undefined,
                'character-kern',
            ),
        ).toBeUndefined();
        expect(
            actingToken(
                eligibleActors([{ ...second, isHidden: true }], 'player'),
                undefined,
                'character-kern',
            ),
        ).toBeUndefined();
    });
    it('selects a linked character separately from transient scene selection and rejects unassigned characters', () => {
        const kern = token('instance', 3, { characterId: 'character-kern' });
        const store = new SceneStore(
            {
                tokens: [kern],
                characters: [
                    {
                        id: 'character-kern',
                        name: 'Керн',
                        portrait: null,
                        ownerUserId: 'player',
                        kind: 'player_character',
                        disposition: 'friendly',
                        checkStats: [],
                        hp: 10,
                        maxHp: 10,
                    },
                ],
                width: 1000,
                height: 1000,
                grid: { size: 50, snap: true, visible: true, offset: { x: 0, y: 0 } },
            },
            'player',
        );
        const persist = vi.fn();
        store.onActiveCharacterChange = persist;
        store.setActingToken(kern.id);
        expect(store.getSnapshot().scene.activeCharacterId).toBe('character-kern');
        expect(store.getSnapshot().selectedIds).toEqual([kern.id]);
        expect(persist).toHaveBeenCalledWith('character-kern');
        store.select(null);
        expect(store.getSnapshot().scene.activeCharacterId).toBe('character-kern');
        store.setActiveCharacter('unassigned');
        expect(store.getSnapshot().scene.activeCharacterId).toBe('character-kern');
        const next = {
            ...store.getSnapshot().scene,
            tokens: [token('new-instance', 3, { characterId: 'character-kern' })],
        };
        store.reconcile(next);
        expect(
            actingToken(
                eligibleActors(next.tokens, 'player'),
                undefined,
                store.getSnapshot().scene.activeCharacterId,
            )?.id,
        ).toBe('new-instance');
    });
    it('automatically uses one owned visible token, including a movement-locked token; requires a choice for two', () => {
        const one = token('kern', 3);
        const eligible = eligibleActors(
            [one, token('hidden', 5, { isHidden: true }), token('foreign', 9, { isOwner: false })],
            'player',
        );
        expect(actingToken(eligible)?.id).toBe('kern');
        const two = [...eligible, token('mira', 7)];
        expect(actingToken(two)).toBeUndefined();
        expect(actingToken(two, 'mira')?.id).toBe('mira');
        expect(actingToken(two, 'foreign')).toBeUndefined();
        expect(actingToken([], 'kern')).toBeUndefined();
    });
    it('keeps actor independent of object selection and revokes an ineligible actor', () => {
        const tokens = [token('kern', 3), token('mira', 7)];
        const store = new SceneStore(
            {
                tokens,
                width: 1000,
                height: 1000,
                grid: { size: 50, snap: true, visible: true, offset: { x: 0, y: 0 } },
            },
            'player',
        );
        store.setActingToken('mira');
        store.select('kern');
        expect(store.getSnapshot().actingTokenId).toBe('mira');
        expect(
            actingToken(
                eligibleActors(
                    [token('kern', 3, { isOwner: false }), token('mira', 7, { isOwner: false })],
                    'player',
                ),
                store.getSnapshot().actingTokenId,
            ),
        ).toBeUndefined();
    });
    it('presents the acting character and its actual modifier before rolling', () => {
        const kern = token('kern', 3),
            mira = token('mira', 7);
        const props = {
            invocation: {
                action: {
                    id: 'a',
                    label: 'Осмотреть алтарь',
                    icon: 'search' as const,
                    check: { enabled: true, label: 'Внимательность', stat_key: 'perception' },
                },
                sceneId: 's',
                kind: 'prop' as const,
                objectId: 'p',
                epoch: 0,
                userId: 'u',
            },
            actors: [kern, mira],
            actor: kern,
            onActorChange: vi.fn(),
            onClose: vi.fn(),
            onHandout: vi.fn(),
        };
        const html = renderToStaticMarkup(createElement(CheckDialog, props));
        expect(html).toContain('Керн · Внимательность');
        expect(html).toContain('+3');
        expect(html).toContain('Действующий персонаж');
        expect(html).toContain('С преимуществом');
        expect(html).toContain('С помехой');
        const switched = renderToStaticMarkup(
            createElement(CheckDialog, { ...props, actor: mira }),
        );
        expect(switched).toContain('Мира · Внимательность');
        expect(switched).toContain('+7');
        const unselected = renderToStaticMarkup(
            createElement(CheckDialog, { ...props, actor: undefined, actorRequired: true }),
        );
        expect(unselected).toContain('Выберите действующего персонажа.');
        expect(unselected).toMatch(/class="primary-button check-roll" disabled=""/);
    });
    it('retains the original actor and roll mode with the UUID after a lost response or reload', () => {
        const values = new Map<string, string>();
        const storage = {
            getItem: (k: string) => values.get(k) ?? null,
            setItem: (k: string, v: string) => {
                values.set(k, v);
            },
            removeItem: (k: string) => {
                values.delete(k);
            },
        };
        const first = checkRequest('u:s:a', storage, {
            actorTokenId: 'kern',
            rollMode: 'advantage',
        });
        const retried = checkRequest('u:s:a', storage, {
            actorTokenId: 'mira',
            rollMode: 'disadvantage',
        });
        expect(retried.id).toBe(first.id);
        expect(retried.context).toEqual({ actorTokenId: 'kern', rollMode: 'advantage' });
        first.complete();
        expect(
            checkRequest('u:s:a', storage, { actorTokenId: 'mira', rollMode: 'normal' }).context
                ?.actorTokenId,
        ).toBe('mira');
    });
});
