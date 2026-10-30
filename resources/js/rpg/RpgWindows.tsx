import { ItemOperations } from './ItemOperations';
import { useState } from 'react';
import { ArrowDownWideNarrow, Search } from 'lucide-react';
import type { Ability } from '../gameplay/model';
import type { Character, Token } from '../tabletop/types/scene';
import { RpgWindow, type RpgWindowKind } from './RpgWindow';
import { InventoryGridView, ItemDetails } from './InventoryView';
import { CharacterView, HeroEquipment } from './CharacterView';
import { SpellbookView } from './SpellbookView';
import type { InventoryHook } from './useInventory';
import type { InventoryItem } from './model';
export function RpgWindows({
    kind,
    onChange,
    onClose,
    character,
    actor,
    inventory,
    onChoose,
    onUse,
    onBindAbility,
    onBindItem,
    campaign,
    onResourceChange,
}: {
    kind: RpgWindowKind;
    onChange: (v: RpgWindowKind) => void;
    onClose: () => void;
    character: Character;
    actor?: Token;
    inventory: InventoryHook;
    onChoose: (a: Ability) => void;
    onUse: (i: InventoryItem) => void;
    onBindAbility: (a: Ability) => void;
    onBindItem: (i: InventoryItem) => void;
    campaign: string;
    onResourceChange: () => void;
}) {
    const [inspected, setInspected] = useState<string | null>(null),
        [search, setSearch] = useState('');
    const { data, error, busy, send } = inventory;
    const item = data?.items.find((i) => i.id === inspected);
    return (
        <RpgWindow
            kind={kind}
            name={character.name}
            onChange={(next) => {
                setInspected(null);
                onChange(next);
            }}
            onClose={onClose}
        >
            {error && (
                <div className="rpg-window-error" role="alert">
                    {error}
                    <button disabled={busy} onClick={inventory.retry}>
                        Повторить
                    </button>
                </div>
            )}
            {kind === 'spellbook' ? (
                <SpellbookView
                    abilities={character.abilities ?? []}
                    resources={character.resources ?? []}
                    onChoose={onChoose}
                    onBind={onBindAbility}
                />
            ) : !data ? (
                <p role="status" className="rpg-empty">
                    Открываем вещи героя…
                </p>
            ) : kind === 'character' ? (
                <>
                    <CharacterView
                        campaign={campaign}
                        onResourceChange={onResourceChange}
                        state={data}
                        actor={actor}
                        busy={busy}
                        send={send}
                        onInspect={(i) => setInspected(i.id)}
                    />
                    {item && (
                        <div className="equipment-details-popover">
                            <button
                                className="rpg-quiet-button"
                                aria-label="Закрыть сведения о предмете"
                                onClick={() => setInspected(null)}
                            >
                                × Закрыть
                            </button>
                            <ItemOperations item={item} state={data} send={send} busy={busy} />
                            <ItemDetails
                                item={item}
                                onUse={onUse}
                                onBind={onBindItem}
                                onEquip={(i) => {
                                    void send({
                                        action: i.equipped_slot ? 'unequip' : 'equip',
                                        itemId: i.id,
                                        ...(i.equipped_slot
                                            ? {}
                                            : { slot: i.definition.equipment_slots[0] }),
                                    });
                                    setInspected(null);
                                }}
                            />
                        </div>
                    )}
                </>
            ) : (
                <div className="inventory-layout">
                    <HeroEquipment
                        state={data}
                        send={send}
                        busy={busy}
                        onInspect={(i) => setInspected(i.id)}
                    />
                    <section className="inventory-pack">
                        <header className="inventory-title">
                            <div>
                                <span className="rpg-kicker">ЛИЧНЫЕ ВЕЩИ</span>
                                <h2>Походный рюкзак</h2>
                            </div>
                            <button
                                className="rpg-quiet-button"
                                disabled={busy}
                                onClick={() => void send({ action: 'arrange' })}
                            >
                                <ArrowDownWideNarrow size={16} /> Упорядочить
                            </button>
                        </header>
                        <label className="inventory-search">
                            <Search size={15} />
                            <input
                                aria-label="Поиск предмета"
                                value={search}
                                placeholder="Найти среди вещей…"
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </label>
                        <InventoryGridView
                            state={data}
                            send={send}
                            busy={busy}
                            selectedId={inspected}
                            search={search}
                            onInspect={(i) => setInspected(i.id)}
                        />
                        <div className="inventory-capacity">
                            <span>МЕСТО В РЮКЗАКЕ</span>
                            <strong>
                                {
                                    data.items.filter((i) => i.quantity > 0 && !i.equipped_slot)
                                        .length
                                }
                                <small> / 60</small>
                            </strong>
                            <meter
                                min={0}
                                max={60}
                                value={
                                    data.items.filter((i) => i.quantity > 0 && !i.equipped_slot)
                                        .length
                                }
                            />
                        </div>
                        <p className="inventory-help">
                            Двойной щелчок — надеть или использовать · Правая кнопка — действия
                        </p>
                    </section>
                    <div className="item-details-column">
                        <ItemDetails
                            item={item}
                            onUse={onUse}
                            onBind={onBindItem}
                            onEquip={(i) =>
                                void send({
                                    action: i.equipped_slot ? 'unequip' : 'equip',
                                    itemId: i.id,
                                    slot: i.definition.equipment_slots[0],
                                })
                            }
                        />
                        {item && (
                            <ItemOperations item={item} state={data} send={send} busy={busy} />
                        )}
                    </div>
                </div>
            )}
        </RpgWindow>
    );
}
