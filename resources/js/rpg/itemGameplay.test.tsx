import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentProps } from 'react';
import { ItemFacts, equipmentDropReason } from './itemGameplay';
import { itemBinding, type InventoryItem, type InventoryState } from './model';
import { DeckSlot } from '../gameplay/DeckSlot';
import { normalizeSlots, placeBinding, defaultSlots } from '../gameplay/hotbarModel';
import { LootContents, lootApi, type LootState } from './loot';
import { RpgDragProvider } from './RpgDrag';
import { createDemoScene } from '../tabletop/state/demoScene';
import { reduceEvent } from '../realtime/protocol';
import type { InventoryHook } from './useInventory';
const sword: InventoryItem = {
    id: 'instance',
    character_id: 1,
    quantity: 1,
    x: 0,
    y: 0,
    equipped_slot: 'main_hand',
    grip: 'one',
    weapon_proficient: true,
    definition: {
        id: 'def',
        name: 'Longsword',
        icon: 'item_sword',
        description: 'A sword',
        category: 'weapon',
        rarity: 'common',
        width: 1,
        height: 1,
        max_stack: 1,
        equipment_slots: ['main_hand'],
        modifiers: {},
        use_ability_id: null,
        gameplay: {
            source_key: 'longsword',
            weapon: {
                dice: '1d8',
                damage_type: 'slashing',
                kind: 'melee',
                category: 'martial',
                properties: ['versatile'],
                versatile_dice: '1d10',
                mastery: 'sap',
                range: { normal: 5, long: null },
            },
        },
    },
};
describe('item gameplay presentation', () => {
    it('shows weapon dice, versatile, properties and informational mastery without raw JSON', () => {
        const html = renderToStaticMarkup(<ItemFacts definition={sword.definition} item={sword} />);
        expect(html).toContain('1d8');
        expect(html).toContain('slashing');
        expect(html).toContain('1d10');
        expect(html).toContain('Универсальное');
        expect(html).toContain('sap');
        expect(html).toContain('справочно');
        expect(html).not.toContain('weapon_properties');
    });
    it('shows armor formula and penalties as server-authored metadata', () => {
        const armor = {
            ...sword.definition,
            gameplay: {
                armor: {
                    category: 'medium_armor' as const,
                    base_ac: 14,
                    add_dex: true,
                    max_dex_bonus: 2,
                    strength_minimum: 13,
                    stealth_disadvantage: true,
                },
            },
        };
        const html = renderToStaticMarkup(<ItemFacts definition={armor} />);
        expect(html).toContain('AC 14 + ЛОВ (макс. 2)');
        expect(html).toContain('Сила 13');
        expect(html).toContain('Помеха Скрытности');
    });
    it('explains incompatible hand drops in both directions and allows one-handed sword with shield', () => {
        const shield = {
            ...sword,
            id: 'shield',
            equipped_slot: 'off_hand',
            definition: { ...sword.definition, equipment_slots: ['off_hand'] },
        };
        expect(equipmentDropReason({ ...sword, grip: 'two' }, 'main_hand', [shield])).toBe(
            'Освободите вторую руку',
        );
        expect(equipmentDropReason(shield, 'off_hand', [{ ...sword, grip: 'two' }])).toContain(
            'две руки',
        );
        expect(equipmentDropReason(sword, 'main_hand', [shield])).toBe('');
        expect(equipmentDropReason(sword, 'head', [])).toBe('Предмет не подходит слоту');
    });
    it('retains stable inventory bindings while unavailable and shows ammunition reason', () => {
        const slots = placeBinding(defaultSlots([]), itemBinding(sword.id), 20);
        expect(normalizeSlots(slots, [])[20]).toEqual(itemBinding(sword.id));
        const ability = {
            id: 'action',
            name: 'Longbow',
            icon: 'bow',
            description: '',
            category: 'attack' as const,
            target: 'token' as const,
            check: null,
            costs: [],
            sort_order: 0,
            enabled: true,
        };
        const item = {
            ...sword,
            action: {
                ability,
                available: false,
                reason: 'Нет боеприпасов: arrows.',
                ammunition: 0,
            },
        };
        const drag = {
            source: () => ({}),
            destination: () => ({}),
            consumeClick: () => false,
        } as unknown as ComponentProps<typeof DeckSlot>['drag'];
        const html = renderToStaticMarkup(
            <DeckSlot
                item={item}
                itemAbility={ability}
                binding={itemBinding(item.id)}
                index={20}
                resources={[]}
                drag={drag}
                edit={false}
                disabled={false}
                worldAvailable
                shortcutActive={false}
                onClear={() => {}}
                onPick={() => {}}
                onChoose={() => {}}
            />,
        );
        expect(html).toContain('aria-disabled="true"');
        expect(html).toContain('Нет боеприпасов: arrows.');
    });
    it('renders loot identity, quantities, Take and matching one-cell recipient inventory', () => {
        const character = { id: '1', name: 'Hero' } as InventoryState['character'];
        const state: InventoryState = {
            items: [],
            width: 10,
            height: 6,
            slots: {},
            character,
            base: { ac: 10, speed: 30 },
            useAbilities: [],
        };
        const inventory = { data: state, send: vi.fn(), busy: false } as unknown as InventoryHook;
        const loot: LootState = {
            id: '1',
            name: 'Chest',
            open: true,
            version: 1,
            kind: 'container',
            items: [{ ...sword, quantity: 3 }],
        };
        const html = renderToStaticMarkup(
            <RpgDragProvider icon={() => 'item_sword'}>
                <LootContents
                    loot={loot}
                    inventory={inventory}
                    character={character}
                    busy={false}
                    take={() => {}}
                    gm={false}
                    remove={() => {}}
                />
            </RpgDragProvider>,
        );
        expect(html).toContain('Longsword');
        expect(html).toContain('3 шт.');
        expect(html).toContain('Взять');
        expect(html).toContain('Сетка инвентаря 10 на 6');
        expect(html.match(/class="inventory-cell/g)?.length).toBe(60);
    });
    it('posts Take All intent with stable UUID and no client-supplied container contents', async () => {
        const calls: { url: string; body: Record<string, unknown> }[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string, options: RequestInit) => {
                calls.push({ url, body: JSON.parse(String(options.body)) });
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ loot: { id: '1', items: [] } }),
                };
            }),
        );
        try {
            await lootApi.command(
                '5',
                { action: 'take-all', containerId: '1', characterId: 5 },
                'same-uuid',
            );
            expect(calls[0].url).toBe('/api/campaigns/5/loot');
            expect(calls[0].body).toEqual({
                action: 'take-all',
                containerId: '1',
                characterId: 5,
                clientMutationId: 'same-uuid',
            });
        } finally {
            vi.unstubAllGlobals();
        }
    });
    it('reconciles the shared chest version from realtime without item contents in the scene', () => {
        const initial = {
            ...createDemoScene(),
            id: '5',
            revision: 1,
            props: [
                {
                    id: 'chest',
                    name: 'Chest',
                    x: 1,
                    y: 1,
                    rotation: 0,
                    scaleX: 1,
                    scaleY: 1,
                    zIndex: 0,
                    image: {
                        id: 'loot',
                        url: '/assets/player/utility/loot.svg',
                        width: 96,
                        height: 96,
                    },
                    loot: {
                        id: '1',
                        name: 'Chest',
                        version: 1,
                        open: true,
                        kind: 'container',
                        empty: false,
                    },
                },
            ],
        };
        const next = reduceEvent(initial, {
            type: 'objects.changed',
            sceneId: '5',
            revision: 2,
            mutationId: 'x',
            payload: {
                props: [
                    {
                        ...initial.props[0],
                        loot: { ...initial.props[0].loot, version: 2, empty: true },
                    },
                ],
            },
        });
        expect(next).not.toBe('gap');
        if (next === 'gap') return;
        expect(next.props?.[0].loot?.version).toBe(2);
        expect(next.props?.[0].loot?.empty).toBe(true);
        expect(next.props?.[0].loot).not.toHaveProperty('items');
    });
});
