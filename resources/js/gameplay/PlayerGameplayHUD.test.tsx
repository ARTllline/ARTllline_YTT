import { Children, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { PlayerGameplayHUD } from './PlayerGameplayHUD';
import { SceneStore } from '../tabletop/state/SceneStore';
import { createDemoScene } from '../tabletop/state/demoScene';
import type { Character } from '../tabletop/types/scene';

// Exercise CharacterHUD's real conditional child list. Server rendering alone
// doesn't warn about duplicate sibling keys (production React doesn't either).
const probe = vi.hoisted(() => ({ groups: [] as string[][] }));
vi.mock('react', async (original) => ({
    ...(await original<typeof import('react')>()),
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('./useHotbar', () => ({ useHotbar: () => ({ slots: [], loaded: true }) }));
vi.mock('../rpg/useInventory', () => ({ useInventory: () => ({ data: null }) }));
vi.mock('../rpg/RpgDrag', () => ({
    RpgDragProvider: ({ children }: { children: ReactNode }) => {
        const keys: string[] = [];
        Children.forEach(children, (child) => {
            if (isValidElement(child) && child.key !== null) keys.push(String(child.key));
        });
        probe.groups.push(keys);
        return null;
    },
}));
afterEach(() => {
    probe.groups.length = 0;
});

it('keeps HUD sibling identities unique across combat, rest and Character boundaries', () => {
    const scene = createDemoScene();
    scene.id = scene.campaignId = '5';
    const character: Character = {
        id: '5',
        name: 'Kern',
        portrait: null,
        ownerUserId: '2',
        kind: 'player_character',
        disposition: 'friendly',
        hp: 30,
        maxHp: 30,
        checkStats: [],
        lifecycle: {
            status: 'alive',
            successes: 0,
            failures: 0,
            requiredTurn: null,
            resolvedTurn: null,
            cause: null,
        },
    };
    const store = new SceneStore(scene, 'player');
    for (const id of ['5', '6']) {
        for (const restId of [undefined, id, 'other-rest']) {
            const current = {
                ...character,
                id,
                ...(restId
                    ? {
                          rest: {
                              id: restId,
                              kind: 'short-rest' as const,
                              status: 'spending' as const,
                              changes: [],
                              rolls: [],
                          },
                      }
                    : {}),
            };
            for (let round = 1; round <= 3; round++) {
                store.reconcile({
                    ...scene,
                    characters: [current],
                    activeCharacterId: id,
                    combat: {
                        id: 'combat',
                        status: 'active',
                        round,
                        combatants: [],
                        currentTurn: null,
                    },
                });
                renderToStaticMarkup(
                    <PlayerGameplayHUD
                        store={store}
                        renderer={{ current: null }}
                        actors={[]}
                        userId="2"
                        disabled={round === 2}
                        actorError=""
                    />,
                );
                const keys = probe.groups.at(-1)!;
                expect(keys.length).toBeGreaterThanOrEqual(2);
                expect(new Set(keys).size, `duplicate HUD sibling keys: ${keys.join(', ')}`).toBe(
                    keys.length,
                );
            }
        }
    }
});
