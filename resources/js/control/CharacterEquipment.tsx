import { useEffect, useState } from 'react';
import { Backpack, Library } from 'lucide-react';
import type { Character } from '../tabletop/types/scene';
import { charactersApi } from '../api/characters';
import { RpgIcon } from '../gameplay/RpgIcon';
import { HeroEquipment } from '../rpg/CharacterView';
import { InventoryGridView } from '../rpg/InventoryView';
import { RpgDragProvider, useRpgDrag } from '../rpg/RpgDrag';
import { useInventory } from '../rpg/useInventory';
import { itemBinding, type InventoryItem, type ItemDefinition } from '../rpg/model';
import { equipmentDropReason, ItemFacts } from '../rpg/itemGameplay';
import { ItemCard, libraryItemsApi } from './ItemLibrary';

export function CharacterEquipment({
    character,
    locked,
    onChange,
}: {
    character: Character;
    locked: boolean;
    onChange: (c: Character) => void;
}) {
    const [definitions, setDefinitions] = useState<ItemDefinition[]>([]),
        [loading, setLoading] = useState(true),
        [error, setError] = useState(''),
        [retry, setRetry] = useState(0);
    const [selected, setSelected] = useState<string | null>(null),
        [search, setSearch] = useState(''),
        [quantity, setQuantity] = useState(1);
    const inventory = useInventory('library', character, () => {
        void charactersApi
            .library()
            .then((r) => {
                const c = r.characters.find((c) => c.id === character.id);
                if (c) onChange(c);
            })
            .catch((e) => setError(e.message));
    });
    useEffect(() => {
        const abort = new AbortController();
        void libraryItemsApi
            .list(abort.signal)
            .then((r) => {
                setDefinitions(r.definitions);
                setError('');
            })
            .catch((e) => {
                if (!abort.signal.aborted) setError(e.message);
            })
            .finally(() => {
                if (!abort.signal.aborted) setLoading(false);
            });
        return () => abort.abort();
    }, [retry]);
    const external: InventoryItem[] = definitions.map((d) => ({
        id: `library:${d.id}`,
        character_id: Number(character.id),
        quantity: 1,
        x: null,
        y: null,
        equipped_slot: null,
        definition: d,
    }));
    const held = inventory.data?.items.filter((i) => i.quantity > 0) ?? [];
    const inspected = [...held, ...external].find((i) => i.id === selected);
    const busy = locked || inventory.busy;
    const give = (i: InventoryItem, slot?: string, x?: number, y?: number) =>
        inventory.send({
            action: 'give',
            libraryItemId: i.definition.id,
            quantity: slot ? 1 : quantity,
            ...(slot ? { slot } : {}),
            ...(x != null ? { x, y } : {}),
        });
    return (
        <div className="character-equipment">
            <div className="equipment-intro">
                <div>
                    <span className="eyebrow">АРСЕНАЛ / {character.name}</span>
                    <h2>Готов к приключениям</h2>
                </div>
                <span className="hint" role="status">
                    {locked
                        ? 'Сохраните изменения персонажа перед выдачей предметов.'
                        : inventory.busy
                          ? 'Сохранение снаряжения…'
                          : 'Снаряжение сохраняется сразу'}
                </span>
            </div>
            {(error || inventory.error) && (
                <p className="form-error" role="alert">
                    {error || inventory.error}
                    <button
                        onClick={() => {
                            inventory.retry();
                            setRetry((v) => v + 1);
                        }}
                    >
                        Повторить
                    </button>
                </p>
            )}
            {!inventory.data ? (
                <p role="status">Загрузка снаряжения…</p>
            ) : (
                <RpgDragProvider
                    icon={(b) =>
                        [...held, ...external].find((i) => i.id === b.sourceId)?.definition.icon ??
                        'item_scroll'
                    }
                >
                    <fieldset disabled={busy}>
                        <div className="equipment-workbench">
                            <div className="equipment-hero">
                                <HeroEquipment
                                    state={inventory.data}
                                    send={inventory.send}
                                    busy={busy}
                                    onInspect={(i) => setSelected(i.id)}
                                    externalItems={external}
                                    onExternalDrop={(i, s) => void give(i, s)}
                                />
                            </div>
                            <section className="equipment-backpack">
                                <header>
                                    <h3>
                                        <Backpack size={18} />
                                        Рюкзак
                                    </h3>
                                    <small>
                                        {held.filter((i) => !i.equipped_slot).length} / 60
                                    </small>
                                    <button
                                        className="quiet-button"
                                        onClick={() => void inventory.send({ action: 'arrange' })}
                                    >
                                        Упорядочить
                                    </button>
                                </header>
                                <InventoryGridView
                                    state={inventory.data}
                                    send={inventory.send}
                                    busy={busy}
                                    onInspect={(i) => setSelected(i.id)}
                                    selectedId={selected}
                                    externalItems={external}
                                    onExternalDrop={(i, x, y) => void give(i, undefined, x, y)}
                                />
                                {!held.length && (
                                    <p className="hint">
                                        Перетащите предмет из библиотеки в рюкзак или сразу на
                                        силуэт героя.
                                    </p>
                                )}
                                <aside className="equipment-inspector">
                                    {inspected ? (
                                        <>
                                            <ItemCard definition={inspected.definition} />
                                            {inspected.id.startsWith('library:') ? (
                                                <button
                                                    className="primary-button"
                                                    onClick={() => void give(inspected)}
                                                >
                                                    В рюкзак ×{quantity}
                                                </button>
                                            ) : (
                                                <>
                                                    <p>
                                                        {inspected.quantity} шт.{' '}
                                                        {inspected.charges != null
                                                            ? `· Заряды: ${inspected.charges} `
                                                            : ''}{' '}
                                                        ·{' '}
                                                        {inspected.equipped_slot
                                                            ? inventory.data.slots[
                                                                  inspected.equipped_slot
                                                              ]
                                                            : 'В рюкзаке'}
                                                    </p>
                                                    <div className="button-row">
                                                        {inspected.equipped_slot ? (
                                                            <button
                                                                onClick={() =>
                                                                    void inventory.send({
                                                                        action: 'unequip',
                                                                        itemId: inspected.id,
                                                                    })
                                                                }
                                                            >
                                                                Снять
                                                            </button>
                                                        ) : (
                                                            inspected.definition.equipment_slots.map(
                                                                (s) => (
                                                                    <button
                                                                        key={s}
                                                                        disabled={
                                                                            busy ||
                                                                            !!equipmentDropReason(
                                                                                inspected,
                                                                                s,
                                                                                held,
                                                                            )
                                                                        }
                                                                        title={equipmentDropReason(
                                                                            inspected,
                                                                            s,
                                                                            held,
                                                                        )}
                                                                        onClick={() =>
                                                                            void inventory.send({
                                                                                action: 'equip',
                                                                                itemId: inspected.id,
                                                                                slot: s,
                                                                            })
                                                                        }
                                                                    >
                                                                        Надеть:{' '}
                                                                        {inventory.data!.slots[s]}
                                                                    </button>
                                                                ),
                                                            )
                                                        )}
                                                    </div>
                                                    <details>
                                                        <summary>Управление экземпляром</summary>
                                                        {inspected.definition.max_stack === 1 && (
                                                            <label className="field">
                                                                Заряды · учёт GM
                                                                <input
                                                                    key={`${inspected.id}:${inspected.charges}`}
                                                                    aria-label="Заряды экземпляра"
                                                                    type="number"
                                                                    min={0}
                                                                    max={999}
                                                                    defaultValue={
                                                                        inspected.charges ?? ''
                                                                    }
                                                                    placeholder="Не учитываются"
                                                                    onBlur={(e) => {
                                                                        const charges =
                                                                            e.target.value === ''
                                                                                ? null
                                                                                : Number(
                                                                                      e.target
                                                                                          .value,
                                                                                  );
                                                                        if (
                                                                            charges !==
                                                                            (inspected.charges ??
                                                                                null)
                                                                        )
                                                                            void inventory.send({
                                                                                action: 'configure',
                                                                                itemId: inspected.id,
                                                                                charges,
                                                                            });
                                                                    }}
                                                                />
                                                            </label>
                                                        )}
                                                        <p className="hint">
                                                            Ручной счётчик этого экземпляра.
                                                            Использование предмета не списывает
                                                            заряды автоматически.
                                                        </p>
                                                        {inspected.definition.gameplay?.weapon && (
                                                            <>
                                                                <label>
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={
                                                                            inspected.weapon_proficient ??
                                                                            false
                                                                        }
                                                                        onChange={(e) =>
                                                                            void inventory.send({
                                                                                action: 'configure',
                                                                                itemId: inspected.id,
                                                                                weapon_proficient:
                                                                                    e.target
                                                                                        .checked,
                                                                            })
                                                                        }
                                                                    />
                                                                    Владение оружием подтверждено
                                                                </label>
                                                                <label className="field">
                                                                    Хват
                                                                    <select
                                                                        value={
                                                                            inspected.grip ?? 'one'
                                                                        }
                                                                        onChange={(e) =>
                                                                            void inventory.send({
                                                                                action: 'configure',
                                                                                itemId: inspected.id,
                                                                                grip: e.target
                                                                                    .value,
                                                                            })
                                                                        }
                                                                    >
                                                                        <option value="one">
                                                                            Одна рука
                                                                        </option>
                                                                        <option value="two">
                                                                            Две руки
                                                                        </option>
                                                                    </select>
                                                                </label>
                                                            </>
                                                        )}
                                                        {inspected.quantity > 1 && (
                                                            <button
                                                                onClick={() =>
                                                                    void inventory.send({
                                                                        action: 'split',
                                                                        itemId: inspected.id,
                                                                        quantity: 1,
                                                                    })
                                                                }
                                                            >
                                                                Отделить один
                                                            </button>
                                                        )}
                                                        <button
                                                            className="quiet-button"
                                                            onClick={() => {
                                                                if (
                                                                    confirm(
                                                                        `Убрать ${inspected.definition.name} ×${inspected.quantity}?`,
                                                                    )
                                                                )
                                                                    void inventory.send({
                                                                        action: 'remove',
                                                                        itemId: inspected.id,
                                                                    });
                                                            }}
                                                        >
                                                            Убрать из инвентаря
                                                        </button>
                                                    </details>
                                                </>
                                            )}
                                        </>
                                    ) : (
                                        <p className="hint">
                                            Наведите на предмет для подсказки или выберите его для
                                            подробностей. Двойной щелчок — надеть / снять.
                                        </p>
                                    )}
                                </aside>
                            </section>
                            <section className="equipment-library">
                                <h3>
                                    <Library size={18} />
                                    Item Library
                                </h3>
                                <a href="/control/items">Открыть коллекцию →</a>
                                <input
                                    aria-label="Поиск предметов библиотеки"
                                    placeholder="Найти предмет…"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                                <label className="field">
                                    Количество в рюкзак
                                    <input
                                        aria-label="Количество выдаваемых предметов"
                                        type="number"
                                        min={1}
                                        max={99}
                                        value={quantity}
                                        onChange={(e) =>
                                            setQuantity(
                                                Math.max(1, Math.min(99, Number(e.target.value))),
                                            )
                                        }
                                    />
                                </label>
                                {loading ? (
                                    <p role="status">Загрузка библиотеки…</p>
                                ) : !external.length ? (
                                    <p className="hint">
                                        Коллекция пуста. Создайте первый предмет в разделе
                                        «Предметы».
                                    </p>
                                ) : (
                                    <div className="equipment-library-list">
                                        {external
                                            .filter((i) =>
                                                i.definition.name
                                                    .toLocaleLowerCase()
                                                    .includes(search.toLocaleLowerCase()),
                                            )
                                            .map((i) => (
                                                <LibrarySource
                                                    key={i.id}
                                                    item={i}
                                                    busy={busy}
                                                    selected={selected === i.id}
                                                    inspect={() => setSelected(i.id)}
                                                    give={() => void give(i)}
                                                />
                                            ))}
                                    </div>
                                )}
                                <p className="hint">
                                    Перетаскивание или двойной щелчок — выдать независимый
                                    экземпляр. В слот выдаётся один предмет.
                                </p>
                            </section>
                        </div>
                    </fieldset>
                </RpgDragProvider>
            )}
        </div>
    );
}
function LibrarySource({
    item: i,
    busy,
    selected,
    inspect,
    give,
}: {
    item: InventoryItem;
    busy: boolean;
    selected: boolean;
    inspect: () => void;
    give: () => void;
}) {
    const drag = useRpgDrag();
    return (
        <button
            className={`library-source rarity-${i.definition.rarity}`}
            aria-pressed={selected}
            aria-label={`Библиотека: ${i.definition.name}`}
            {...drag.source(itemBinding(i.id), !busy)}
            onClick={() => {
                if (!drag.consumeClick()) inspect();
            }}
            onDoubleClick={give}
        >
            <RpgIcon icon={i.definition.icon} size={44} />
            <strong>{i.definition.name}</strong>
            <span className="rpg-tooltip">
                <strong>{i.definition.name}</strong>
                <ItemFacts definition={i.definition} />
                <span>{i.definition.description}</span>
                <small>Перетащите или дважды щёлкните, чтобы выдать</small>
            </span>
        </button>
    );
}
