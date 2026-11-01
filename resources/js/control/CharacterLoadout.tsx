import { useEffect, useState } from 'react';
import type { Character } from '../tabletop/types/scene';
import { request } from '../api/client';
import { commandId } from '../api/workspace';
import { charactersApi } from '../api/characters';
import { inventoryApi, type ItemDefinition } from '../rpg/model';
import { useInventory } from '../rpg/useInventory';
import { SpellcastingEditor } from '../rpg/SpellcastingEditor';

export function CharacterLoadout({
    campaignId,
    character,
    mode,
    locked,
    onChange,
    onDraftAbilities,
    onDirtyChange,
    childDirty,
}: {
    campaignId: string;
    character: Character;
    mode: 'inventory' | 'spells';
    locked: boolean;
    onChange: (c: Character) => void;
    onDraftAbilities: (a: NonNullable<Character['abilities']>) => void;
    onDirtyChange: (dirty: boolean) => void;
    childDirty: boolean;
}) {
    const inventory = useInventory(campaignId, mode === 'inventory' ? character : null, () => {});
    const [definitions, setDefinitions] = useState<ItemDefinition[]>([]);
    const [spells, setSpells] = useState<{ id: number; name: string }[]>([]);
    const [search, setSearch] = useState(''),
        [page, setPage] = useState(1),
        [pages, setPages] = useState(1);
    const [selected, setSelected] = useState(''),
        [quantity, setQuantity] = useState(1);
    const [retry, setRetry] = useState(0);
    const [busy, setBusy] = useState(false),
        [error, setError] = useState(''),
        [loading, setLoading] = useState(true);
    useEffect(() => {
        const abort = new AbortController();
        const timer = setTimeout(() => {
            setLoading(true);
            setError('');
            const task =
                mode === 'inventory'
                    ? inventoryApi.definitions(campaignId).then((r) => {
                          if (!abort.signal.aborted) setDefinitions(r.definitions);
                      })
                    : request<{ entries: { id: number; name: string }[]; pages: number }>(
                          `/campaigns/${campaignId}/compendium?type=spells&search=${encodeURIComponent(search)}&page=${page}`,
                          'GET',
                          undefined,
                          abort.signal,
                      ).then((r) => {
                          setSpells(r.entries);
                          setPages(r.pages);
                      });
            void task
                .catch((e) => {
                    if (!abort.signal.aborted) setError(e.message);
                })
                .finally(() => {
                    if (!abort.signal.aborted) setLoading(false);
                });
        }, 200);
        return () => {
            abort.abort();
            clearTimeout(timer);
        };
    }, [campaignId, mode, search, page, retry]);
    // Inventory returns a runtime projection (effective AC and filtered abilities).
    // Editing must retain the GM projection with raw bases and authoring fields.
    const currentInventoryCharacter = inventory.data?.character;
    useEffect(() => {
        if (!currentInventoryCharacter || locked) return;
        const abort = new AbortController();
        void charactersApi
            .list(campaignId, abort.signal)
            .then((roster) => {
                const updated = roster.characters.find(
                    (c) => c.id === currentInventoryCharacter.id,
                );
                if (updated && !abort.signal.aborted) onChange(updated);
            })
            .catch((e) => {
                if (!abort.signal.aborted) setError(e.message);
            });
        return () => abort.abort();
        // Refresh only when inventory changes or local edits have been saved.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentInventoryCharacter, locked, campaignId]);
    const assign = async (id: number) => {
        setBusy(true);
        setError('');
        try {
            await request(`/campaigns/${campaignId}/compendium/copy`, 'POST', {
                entry_id: id,
                character_id: character.id,
                clientMutationId: commandId(),
            });
            const roster = await charactersApi.list(campaignId);
            const updated = roster.characters.find((c) => c.id === character.id);
            if (updated) onChange(updated);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className="control-loadout">
            <p className="hint">
                {locked
                    ? 'Сохраните изменения персонажа, чтобы управлять снаряжением и заклинаниями.'
                    : 'Выдача предметов, экипировка, назначение заклинаний и настройки ячеек сохраняются сразу.'}
            </p>
            {(error || inventory.error) && (
                <p className="form-error" role="alert">
                    {error || inventory.error}
                    <button
                        onClick={() => {
                            inventory.retry();
                            setRetry((r) => r + 1);
                        }}
                    >
                        Повторить
                    </button>
                </p>
            )}
            {mode === 'inventory' ? (
                <>
                    <h2>Снаряжение</h2>
                    {!inventory.data && !inventory.error && (
                        <p role="status">Загрузка инвентаря…</p>
                    )}
                    <fieldset disabled={locked || busy || inventory.busy}>
                        <div className="control-give">
                            <label className="field">
                                <span>Предмет кампании</span>
                                <select
                                    aria-label="Выдать предмет"
                                    value={selected}
                                    onChange={(e) => setSelected(e.target.value)}
                                >
                                    <option value="">Выберите предмет</option>
                                    {definitions.map((d) => (
                                        <option key={d.id} value={d.id}>
                                            {d.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="field">
                                <span>Количество</span>
                                <input
                                    aria-label="Количество предметов"
                                    type="number"
                                    min={1}
                                    max={999}
                                    value={quantity}
                                    onChange={(e) => setQuantity(Number(e.target.value))}
                                />
                            </label>
                            <button
                                className="secondary-button"
                                disabled={!selected}
                                onClick={() =>
                                    void inventory.send({
                                        action: 'give',
                                        definitionId: selected,
                                        quantity,
                                    })
                                }
                            >
                                Выдать
                            </button>
                        </div>
                        {!definitions.length && !loading && (
                            <p className="hint">
                                В кампании пока нет предметов. Их можно скопировать через
                                существующий Compendium на игровом столе.
                            </p>
                        )}
                        <div className="control-held-items">
                            {inventory.data?.items
                                .filter((i) => i.quantity > 0)
                                .map((i) => (
                                    <article key={i.id}>
                                        <div>
                                            <strong>{i.definition.name}</strong>
                                            <small>
                                                ×{i.quantity} ·{' '}
                                                {i.equipped_slot
                                                    ? (inventory.data?.slots[i.equipped_slot] ??
                                                      i.equipped_slot)
                                                    : 'В рюкзаке'}
                                            </small>
                                        </div>
                                        <select
                                            aria-label={`Слот: ${i.definition.name}`}
                                            value={i.equipped_slot ?? ''}
                                            onChange={(e) =>
                                                void inventory.send(
                                                    e.target.value
                                                        ? {
                                                              action: 'equip',
                                                              itemId: i.id,
                                                              slot: e.target.value,
                                                          }
                                                        : { action: 'unequip', itemId: i.id },
                                                )
                                            }
                                        >
                                            <option value="">В рюкзаке</option>
                                            {i.definition.equipment_slots.map((slot) => (
                                                <option key={slot} value={slot}>
                                                    {inventory.data?.slots[slot] ?? slot}
                                                </option>
                                            ))}
                                        </select>
                                        {i.definition.gameplay?.weapon && (
                                            <label>
                                                <input
                                                    type="checkbox"
                                                    checked={i.weapon_proficient ?? false}
                                                    onChange={(e) =>
                                                        void inventory.send({
                                                            action: 'configure',
                                                            itemId: i.id,
                                                            weapon_proficient: e.target.checked,
                                                        })
                                                    }
                                                />
                                                Владение
                                            </label>
                                        )}
                                        <button
                                            className="quiet-button"
                                            onClick={() => {
                                                if (
                                                    confirm(
                                                        `Убрать ${i.definition.name} ×${i.quantity}?`,
                                                    )
                                                )
                                                    void inventory.send({
                                                        action: 'remove',
                                                        itemId: i.id,
                                                    });
                                            }}
                                        >
                                            Убрать
                                        </button>
                                    </article>
                                ))}
                        </div>
                        {inventory.data && !inventory.data.items.some((i) => i.quantity > 0) && (
                            <div className="control-empty">
                                Рюкзак пока пуст. Выдайте предмет из списка выше.
                            </div>
                        )}
                    </fieldset>
                </>
            ) : (
                <>
                    <h2>Заклинания и способности</h2>
                    <div className="control-ability-list">
                        {character.abilities?.map((a) => (
                            <article key={a.id}>
                                <div>
                                    <strong>{a.name}</strong>
                                    <small>
                                        {a.spell
                                            ? `Заклинание · круг ${a.spell.level}`
                                            : 'Способность'}
                                        {a.description ? ` · ${a.description}` : ''}
                                    </small>
                                </div>
                                <button
                                    className="quiet-button"
                                    disabled={busy || childDirty}
                                    onClick={() =>
                                        onDraftAbilities(
                                            (character.abilities ?? []).filter(
                                                (other) => other.id !== a.id,
                                            ),
                                        )
                                    }
                                >
                                    Убрать
                                </button>
                            </article>
                        ))}
                    </div>
                    {!character.abilities?.length && (
                        <p className="hint">Пока нет назначенных заклинаний или способностей.</p>
                    )}
                    <details>
                        <summary>Добавить существующее заклинание</summary>
                        <input
                            aria-label="Найти заклинание"
                            placeholder="Поиск заклинания…"
                            value={search}
                            onChange={(e) => {
                                setSearch(e.target.value);
                                setPage(1);
                            }}
                        />
                        {loading ? (
                            <p role="status">Загрузка заклинаний…</p>
                        ) : (
                            <div className="control-spell-picker">
                                {spells.map((s) => (
                                    <div key={s.id}>
                                        <span>{s.name}</span>
                                        <button
                                            className="secondary-button"
                                            disabled={locked || busy || childDirty}
                                            onClick={() => void assign(s.id)}
                                        >
                                            Назначить
                                        </button>
                                    </div>
                                ))}
                                {!spells.length && <p className="hint">Заклинаний не найдено.</p>}
                            </div>
                        )}
                        <div className="button-row">
                            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                                Назад
                            </button>
                            <span>
                                {page} / {pages}
                            </span>
                            <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                                Далее
                            </button>
                        </div>
                    </details>
                    <fieldset disabled={locked || busy}>
                        <SpellcastingEditor
                            key={character.id}
                            character={character}
                            campaignId={campaignId}
                            onDirtyChange={onDirtyChange}
                            onSaved={onChange}
                        />
                    </fieldset>
                </>
            )}
        </div>
    );
}
