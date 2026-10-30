import { ExhaustionBadge, LifeSummary } from '../gameplay/adventuring';
import { equipmentDropReason } from './itemGameplay';
import { Shield, Footprints, Heart, UserRound } from 'lucide-react';
import { RpgIcon } from '../gameplay/RpgIcon';
import { ResourceControls } from './ResourceControls';
import type { Token } from '../tabletop/types/scene';
import { useRpgDrag } from './RpgDrag';
import { itemBinding, type InventoryItem, type InventoryState } from './model';
import type { InventoryHook } from './useInventory';
import { InventoryGridView } from './InventoryView';
import { RulesSummary } from './RulesSummary';
const positions: Record<string, [number, number]> = {
    head: [1, 1],
    amulet: [4, 1],
    cloak: [1, 2],
    armor: [4, 2],
    gloves: [1, 3],
    ring_1: [4, 3],
    boots: [1, 4],
    ring_2: [4, 4],
    main_hand: [1, 5],
    off_hand: [2, 5],
    ranged: [4, 5],
};
const slotIcons: Record<string, string> = {
    head: 'item_helmet',
    armor: 'item_armor',
    cloak: 'item_cloak',
    gloves: 'item_gloves',
    boots: 'item_boots',
    amulet: 'item_amulet',
    ring_1: 'item_ring',
    ring_2: 'item_ring',
    main_hand: 'item_sword',
    off_hand: 'item_shield',
    ranged: 'bow',
};
export function CharacterView({
    state,
    send,
    busy,
    actor,
    onInspect,
    campaign,
    onResourceChange,
}: {
    state: InventoryState;
    send: InventoryHook['send'];
    busy: boolean;
    actor?: Token;
    onInspect: (i: InventoryItem) => void;
    campaign: string;
    onResourceChange: () => void;
}) {
    const c = state.character;
    return (
        <div className="character-equipment-layout">
            <div>
                <LifeSummary state={c.lifecycle} />
                <ExhaustionBadge level={c.exhaustion} />
            </div>
            <HeroEquipment state={state} send={send} busy={busy} onInspect={onInspect} />
            <section className="character-satchel">
                <header>
                    <span className="rpg-kicker">СНАРЯЖЕНИЕ И ПРИПАСЫ</span>
                    <h2>Рюкзак героя</h2>
                </header>
                <InventoryGridView
                    compact
                    state={state}
                    send={send}
                    busy={busy}
                    onInspect={onInspect}
                />
            </section>
            <section className="rpg-character-vitals">
                <span className="rpg-kicker">СОСТОЯНИЕ ГЕРОЯ</span>
                <ResourceControls campaign={campaign} character={c} onChanged={onResourceChange} />
                <h2>Характеристики</h2>
                <RulesSummary character={c} />
                <h3>Состояния</h3>
                <div className="character-conditions">
                    {actor?.conditions?.length ? (
                        actor.conditions.map((s) => <span key={s.id}>{s.label}</span>)
                    ) : (
                        <span>Нет активных состояний</span>
                    )}
                </div>
            </section>
        </div>
    );
}

export function HeroEquipment({
    state,
    send,
    busy,
    onInspect,
}: {
    state: InventoryState;
    send: InventoryHook['send'];
    busy: boolean;
    onInspect: (i: InventoryItem) => void;
}) {
    const drag = useRpgDrag(),
        c = state.character;
    return (
        <section className="hero-paperdoll">
            <div className="paperdoll-grid">
                <div className="paperdoll-portrait">
                    {c.portrait ? (
                        <img src={c.portrait.url} alt={c.name} />
                    ) : (
                        <UserRound size={140} />
                    )}
                    <strong>{c.name}</strong>
                    <span>ГЕРОЙ КАМПАНИИ</span>
                </div>
                {Object.entries(state.slots).map(([key, label], index) => {
                    const equipped = state.items.find(
                            (i) => i.quantity > 0 && i.equipped_slot === key,
                        ),
                        pos = positions[key] ?? [(index % 4) + 1, Math.floor(index / 4) + 6],
                        target = `equipment:${key}`,
                        over = drag.over?.key === target;
                    const lifted = state.items.find((i) => i.id === drag.active?.sourceId);
                    const dropReason = lifted ? equipmentDropReason(lifted, key, state.items) : '';
                    return (
                        <div
                            key={key}
                            title={dropReason || label}
                            className={`equipment-slot ${equipped ? `has-item rarity-${equipped.definition.rarity}` : ''} ${drag.active?.sourceType === 'inventory_item' && state.items.some((i) => i.id === drag.active?.sourceId && i.quantity === 1 && i.definition.equipment_slots.includes(key)) ? 'is-compatible' : ''} ${over ? (drag.over!.valid ? 'drop-valid' : 'drop-invalid') : ''}`}
                            style={{ gridColumn: pos[0], gridRow: pos[1] }}
                            {...drag.destination(
                                target,
                                (b) =>
                                    !busy &&
                                    b.sourceType === 'inventory_item' &&
                                    !!state.items.find(
                                        (i) =>
                                            i.id === b.sourceId &&
                                            i.quantity === 1 &&
                                            !equipmentDropReason(i, key, state.items),
                                    ),
                                (b) =>
                                    void send({
                                        action: 'equip',
                                        itemId: b.sourceId,
                                        slot: key,
                                    }),
                            )}
                        >
                            <button
                                className={
                                    drag.active?.sourceId === equipped?.id ? 'is-lifted' : ''
                                }
                                aria-label={`${label}: ${equipped?.definition.name ?? 'пусто'}`}
                                {...(equipped ? drag.source(itemBinding(equipped.id), !busy) : {})}
                                onClick={() => {
                                    if (equipped && !drag.consumeClick()) onInspect(equipped);
                                }}
                                onDoubleClick={() => {
                                    if (equipped)
                                        void send({ action: 'unequip', itemId: equipped.id });
                                }}
                            >
                                <RpgIcon
                                    icon={
                                        equipped?.definition.icon ?? slotIcons[key] ?? 'item_ring'
                                    }
                                    size={52}
                                />
                                <span>{label}</span>
                                <span className="rpg-tooltip">
                                    <strong>{equipped?.definition.name ?? label}</strong>
                                    <small>
                                        {equipped
                                            ? 'Перетащите в рюкзак · Двойной щелчок — снять'
                                            : 'Перетащите совместимый предмет'}
                                    </small>
                                </span>
                            </button>
                        </div>
                    );
                })}
            </div>
            <div className="hero-stat-tiles">
                <span>
                    <Heart size={18} />
                    <strong>
                        {c.hp}
                        <small> / {c.maxHp}</small>
                    </strong>
                    <label>Здоровье</label>
                </span>
                <span>
                    <Shield size={18} />
                    <strong>{c.ac ?? '—'}</strong>
                    <label>
                        Защита{' '}
                        {c.ac != null && state.base.ac != null && c.ac !== state.base.ac
                            ? `(${c.ac - state.base.ac >= 0 ? '+' : ''}${c.ac - state.base.ac})`
                            : ''}
                    </label>
                </span>
                <span>
                    <Footprints size={18} />
                    <strong>{c.speed ?? '—'}</strong>
                    <label>Скорость</label>
                </span>
            </div>
        </section>
    );
}
