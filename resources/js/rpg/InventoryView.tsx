import { useState } from 'react';
import { RpgIcon } from '../gameplay/RpgIcon';
import type { InventoryItem, InventoryState } from './model';
import { fits, itemBinding } from './model';
import { useRpgDrag } from './RpgDrag';
import type { InventoryHook } from './useInventory';
export function InventoryGridView({
    state,
    send,
    busy,
    compact = false,
    onInspect,
    selectedId,
    search = '',
}: {
    selectedId?: string | null;
    search?: string;
    state: InventoryState;
    send: InventoryHook['send'];
    busy: boolean;
    compact?: boolean;
    onInspect: (i: InventoryItem) => void;
}) {
    const drag = useRpgDrag();
    const [menu, setMenu] = useState<InventoryItem | null>(null);
    const bag = state.items.filter((i) => i.quantity > 0 && !i.equipped_slot);
    const accepted = (id: string, x: number, y: number) => {
        const item = state.items.find((i) => i.id === id && i.quantity > 0);
        if (!item || busy) return false;
        const target = bag.find((i) => i.id !== id && i.x === x && i.y === y);
        if (!target) return fits(state.items, x, y, [id]);
        if (item.equipped_slot) return false;
        if (target.definition.id === item.definition.id && item.definition.max_stack > 1)
            return target.quantity < item.definition.max_stack;
        return true;
    };
    return (
        <div className={`inventory-board-wrap ${compact ? 'is-compact' : ''}`}>
            <div className="inventory-board" aria-label="Сетка инвентаря 10 на 6">
                {Array.from({ length: 60 }, (_, i) => {
                    const x = i % 10,
                        y = Math.floor(i / 10),
                        key = `bag:${x}:${y}`,
                        over = drag.over?.key === key;
                    return (
                        <div
                            key={key}
                            className={`inventory-cell ${over ? (drag.over!.valid ? 'drop-valid' : 'drop-invalid') : ''}`}
                            style={{ gridColumn: x + 1, gridRow: y + 1 }}
                            {...drag.destination(
                                key,
                                (b) =>
                                    b.sourceType === 'inventory_item' && accepted(b.sourceId, x, y),
                                (b) => void send({ action: 'move', itemId: b.sourceId, x, y }),
                            )}
                        />
                    );
                })}
                {bag.map((item) => (
                    <button
                        key={item.id}
                        aria-pressed={selectedId === item.id}
                        className={`inventory-object ${selectedId === item.id ? 'is-selected' : ''} ${search && !item.definition.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) ? 'is-filtered' : ''} rarity-${item.definition.rarity} ${drag.active?.sourceId === item.id ? 'is-lifted' : ''} ${drag.over?.key === `object:${item.id}` ? (drag.over.valid ? 'drop-valid' : 'drop-invalid') : ''}`}
                        style={{
                            gridColumn: item.x! + 1,
                            gridRow: item.y! + 1,
                        }}
                        aria-label={`${item.definition.name}, ${item.quantity} шт.`}
                        data-item-icon={item.definition.icon}
                        {...drag.source(itemBinding(item.id), !busy)}
                        {...drag.destination(
                            `object:${item.id}`,
                            (b) =>
                                b.sourceType === 'inventory_item' &&
                                accepted(b.sourceId, item.x!, item.y!),
                            (b) =>
                                void send({
                                    action: 'move',
                                    itemId: b.sourceId,
                                    x: item.x,
                                    y: item.y,
                                }),
                        )}
                        onClick={() => {
                            if (!drag.consumeClick()) onInspect(item);
                        }}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            onInspect(item);
                            setMenu(menu?.id === item.id ? null : item);
                        }}
                        onDoubleClick={() => {
                            if (item.definition.equipment_slots.length)
                                void send({
                                    action: 'equip',
                                    itemId: item.id,
                                    slot: item.definition.equipment_slots[0],
                                });
                            else
                                window.dispatchEvent(
                                    new CustomEvent('ytt:inventory-use', { detail: item.id }),
                                );
                        }}
                    >
                        <RpgIcon icon={item.definition.icon} size={96} />
                        {item.quantity > 1 && <b className="inventory-quantity">{item.quantity}</b>}
                        <span className="rpg-tooltip">
                            <strong>{item.definition.name}</strong>
                            <span>{item.definition.description}</span>
                            <small>1 × 1 · {item.quantity} шт.</small>
                        </span>
                    </button>
                ))}
            </div>
            {menu && (
                <div
                    className="item-context-actions"
                    role="menu"
                    aria-label={`Действия: ${menu.definition.name}`}
                >
                    {menu.definition.equipment_slots.length > 0 && (
                        <button
                            role="menuitem"
                            onClick={() => {
                                void send({
                                    action: 'equip',
                                    itemId: menu.id,
                                    slot: menu.definition.equipment_slots[0],
                                });
                                setMenu(null);
                            }}
                        >
                            Надеть
                        </button>
                    )}
                    {menu.definition.use_ability_id && (
                        <button
                            role="menuitem"
                            onClick={() => {
                                window.dispatchEvent(
                                    new CustomEvent('ytt:inventory-use', { detail: menu.id }),
                                );
                                setMenu(null);
                            }}
                        >
                            Использовать
                        </button>
                    )}
                    {menu.quantity > 1 && (
                        <button
                            role="menuitem"
                            onClick={() => {
                                void send({
                                    action: 'split',
                                    itemId: menu.id,
                                    quantity: Math.floor(menu.quantity / 2),
                                });
                                setMenu(null);
                            }}
                        >
                            Разделить пополам
                        </button>
                    )}
                    <button role="menuitem" onClick={() => setMenu(null)}>
                        Закрыть
                    </button>
                </div>
            )}
        </div>
    );
}
export function ItemDetails({
    item,
    onUse,
    onBind,
    onEquip,
}: {
    item?: InventoryItem;
    onUse: (i: InventoryItem) => void;
    onBind: (i: InventoryItem) => void;
    onEquip: (i: InventoryItem) => void;
}) {
    if (!item)
        return (
            <aside className="item-inspection is-empty">
                <RpgIcon icon="item_scroll" size={60} />
                <h3>Предметы в ваших руках</h3>
                <p>
                    Выберите предмет для подробностей. Перетащите его в свободные клетки или на
                    подходящий слот экипировки.
                </p>
            </aside>
        );
    const d = item.definition;
    const rarity =
        (
            {
                common: 'Обычный',
                uncommon: 'Необычный',
                rare: 'Редкий',
                epic: 'Эпический',
                legendary: 'Легендарный',
            } as Record<string, string>
        )[d.rarity] ?? d.rarity;
    const category =
        (
            {
                weapon: 'Оружие',
                armor: 'Броня',
                consumable: 'Расходник',
                scroll: 'Свиток',
                trinket: 'Артефакт',
            } as Record<string, string>
        )[d.category] ?? d.category;
    return (
        <aside className={`item-inspection rarity-${d.rarity}`}>
            <div className="inspection-art">
                <RpgIcon icon={d.icon} size={110} />
                <span aria-hidden="true">✦</span>
            </div>
            <span className="rpg-kicker">
                {rarity} · {category}
            </span>
            <h2>{d.name}</h2>
            <p>{d.description}</p>
            <dl>
                <div>
                    <dt>Ячейка</dt>
                    <dd>1 × 1</dd>
                </div>
                <div>
                    <dt>Количество</dt>
                    <dd>
                        {item.quantity} / {d.max_stack}
                    </dd>
                </div>
                {d.modifiers.ac !== undefined && (
                    <div>
                        <dt>Защита</dt>
                        <dd>
                            {d.modifiers.ac >= 0 ? '+' : ''}
                            {d.modifiers.ac} AC
                        </dd>
                    </div>
                )}
                {d.modifiers.speed !== undefined && (
                    <div>
                        <dt>Скорость</dt>
                        <dd>
                            {d.modifiers.speed >= 0 ? '+' : ''}
                            {d.modifiers.speed}
                        </dd>
                    </div>
                )}
                {Object.entries(d.modifiers.checks ?? {}).map(([k, v]) => (
                    <div key={k}>
                        <dt>{k}</dt>
                        <dd>
                            {v >= 0 ? '+' : ''}
                            {v}
                        </dd>
                    </div>
                ))}
            </dl>
            {d.equipment_slots.length > 0 && (
                <button className="rpg-gold-button" onClick={() => onEquip(item)}>
                    {item.equipped_slot ? 'Снять' : 'Надеть'}
                </button>
            )}
            {d.use_ability_id && (
                <>
                    <button
                        className="rpg-gold-button"
                        disabled={item.quantity < 1}
                        onClick={() => onUse(item)}
                    >
                        Использовать
                    </button>
                    <button className="rpg-quiet-button" onClick={() => onBind(item)}>
                        В панель действий
                    </button>
                </>
            )}
        </aside>
    );
}
