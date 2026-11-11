import { useEffect, useRef, useState } from 'react';
import { Package, Plus, Search, Trash2, X } from 'lucide-react';
import { ApiError } from '../../api/client';
import { commandId } from '../../api/workspace';
import { libraryItemsApi } from '../../control/ItemLibrary';
import { RpgIcon } from '../../gameplay/RpgIcon';
import { ItemFacts, itemCategories } from '../../rpg/itemGameplay';
import { inventoryApi, type InventoryItem, type ItemDefinition } from '../../rpg/model';
import { lootApi, openLoot, type LootState, type LootSummary } from '../../rpg/loot';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import './container-editor.css';

export const ITEM_TEMPLATE_MIME = 'application/x-ytt-item-template';
type Source = 'library' | 'campaign';
type Entry = { definition: ItemDefinition; source: Source };

export function ContainerEditor({ store, meta }: { store: SceneStore; meta: LootSummary }) {
    const campaign = store.getSnapshot().scene.campaignId!;
    const [loot, setLoot] = useState<LootState | null>(null);
    const [entries, setEntries] = useState<Entry[]>([]);
    const [source, setSource] = useState<Source>('library');
    const [search, setSearch] = useState('');
    const [catalogOpen, setCatalogOpen] = useState(false);
    const [loadedKey, setLoadedKey] = useState('');
    const [replacing, setReplacing] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [uncertain, setUncertain] = useState(false);
    const [error, setError] = useState('');
    const [catalogFailure, setCatalogFailure] = useState<{ key: string; message: string } | null>(
        null,
    );
    const [reload, setReload] = useState(0);
    const [catalogRetry, setCatalogRetry] = useState(0);
    const [over, setOver] = useState(false);
    const pending = useRef<{ data: Record<string, unknown>; id: string } | null>(null);
    const locked = useRef(false);
    const alive = useRef(true);
    const catalogKey = `${source}:${catalogRetry}`;
    const catalogLoaded = loadedKey === catalogKey;
    const catalogError = catalogFailure?.key === catalogKey ? catalogFailure.message : '';
    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);
    useEffect(() => {
        const abort = new AbortController();
        void lootApi
            .read(campaign, meta.id, abort.signal)
            .then(({ loot: next }) => {
                setLoot((old) => (old && old.version > next.version ? old : next));
            })
            .catch((e) => {
                if (!abort.signal.aborted) setError(e.message);
            });
        return () => abort.abort();
    }, [campaign, meta.id, meta.version, reload]);
    useEffect(() => {
        if (!catalogOpen) return;
        const abort = new AbortController();
        const load =
            source === 'library'
                ? libraryItemsApi.list(abort.signal)
                : inventoryApi.definitions(campaign);
        void load
            .then(({ definitions }) => {
                if (!abort.signal.aborted) {
                    setEntries(definitions.map((definition) => ({ definition, source })));
                    setLoadedKey(catalogKey);
                    setCatalogFailure(null);
                }
            })
            .catch((e) => {
                if (!abort.signal.aborted)
                    setCatalogFailure({ key: catalogKey, message: e.message });
            });
        return () => abort.abort();
    }, [campaign, catalogOpen, source, catalogKey]);

    const send = async (data?: Record<string, unknown>) => {
        if (locked.current || (!pending.current && (!data || !loot))) return;
        locked.current = true;
        pending.current ??= {
            id: commandId(),
            data: { ...data, containerId: meta.id, expectedVersion: loot!.version },
        };
        setBusy(true);
        setError('');
        try {
            const command = pending.current;
            const run = () => lootApi.command(campaign, command.data, command.id);
            const result = await (store.history ? store.history.prepare(command.id, run) : run());
            pending.current = null;
            if (result.mutation) store.accept(result.mutation, true);
            if (result.preparationEdit) store.history?.recordPreparation(result.preparationEdit);
            if (alive.current) {
                setLoot((old) => (old && old.version > result.loot.version ? old : result.loot));
                setUncertain(false);
                setReplacing(null);
            }
        } catch (e) {
            const terminal = e instanceof ApiError && e.status > 0 && e.status < 500;
            if (terminal) pending.current = null;
            if (alive.current) {
                setUncertain(!terminal);
                setError((e as Error).message);
                if (terminal) setReload((n) => n + 1);
            }
        } finally {
            locked.current = false;
            if (alive.current) setBusy(false);
        }
    };
    const disabled = busy || uncertain || !loot || loot.version < meta.version;
    const add = ({ definition, source }: Entry) => {
        if (disabled) return;
        const old = loot?.items.find((i) => i.id === replacing);
        void send({
            action: old ? 'replace' : 'give',
            ...(old ? { itemId: old.id } : {}),
            [source === 'library' ? 'libraryItemId' : 'definitionId']: definition.id,
            quantity: old?.quantity ?? 1,
        });
    };
    const visible = entries.filter(({ definition }) =>
        definition.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
    );
    return (
        <section className="inspector-section container-editor" aria-label="Содержимое контейнера">
            <h3>
                <Package size={15} /> Содержимое <small>{loot?.items.length ?? '…'}</small>
            </h3>
            <p className="hint">
                Подготовка видна только GM. Игрок получает предметы через меню контейнера.
            </p>
            <div className="container-access">
                <span>{loot?.open ? 'Открыт' : 'Закрыт'}</span>
                <button
                    disabled={disabled}
                    onClick={() => void send({ action: loot?.open ? 'close' : 'open' })}
                >
                    {loot?.open ? 'Закрыть для игроков' : 'Открыть для игроков'}
                </button>
                <button
                    disabled={disabled}
                    title="Открывает контейнер и окно получения добычи"
                    onClick={() => openLoot(meta.id)}
                >
                    Получить лут…
                </button>
            </div>
            <div
                className={`container-drop ${over ? 'is-over' : ''}`}
                data-testid="container-drop"
                onDragOver={(e) => {
                    if (!disabled && e.dataTransfer.types.includes(ITEM_TEMPLATE_MIME)) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = 'copy';
                        setOver(true);
                    }
                }}
                onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
                }}
                onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setOver(false);
                    if (disabled) return;
                    try {
                        const payload = JSON.parse(e.dataTransfer.getData(ITEM_TEMPLATE_MIME));
                        const entry = entries.find(
                            (e) => e.definition.id === payload.id && e.source === payload.source,
                        );
                        if (entry) add(entry);
                    } catch {
                        /* Ignore foreign or cancelled drags. */
                    }
                }}
            >
                {!loot ? (
                    <p role="status">Загружаем содержимое…</p>
                ) : loot.items.length ? (
                    loot.items.map((item) => (
                        <ContainerItem
                            key={`${item.id}:${item.quantity}`}
                            item={item}
                            disabled={disabled}
                            onQuantity={(quantity) =>
                                void send({ action: 'quantity', itemId: item.id, quantity })
                            }
                            onRemove={() => void send({ action: 'remove', itemId: item.id })}
                            onReplace={() => {
                                setReplacing(item.id);
                                setCatalogOpen(true);
                            }}
                        />
                    ))
                ) : (
                    <p className="container-empty">Пока пусто. Добавьте предметы из библиотеки.</p>
                )}
                <p className="container-drop-hint">Перетащите карточку из библиотеки сюда</p>
            </div>
            {error && (
                <div role="alert" className="error">
                    <p>{error}</p>
                    <button
                        disabled={busy}
                        onClick={() => (pending.current ? void send() : setReload((n) => n + 1))}
                    >
                        Повторить
                    </button>
                </div>
            )}
            <button
                className="secondary-button container-add"
                aria-expanded={catalogOpen}
                disabled={disabled}
                onClick={() => {
                    setCatalogOpen(!catalogOpen);
                    setReplacing(null);
                }}
            >
                <Plus size={14} /> Добавить предметы
            </button>
            {catalogOpen && (
                <div className="container-catalog">
                    {replacing && (
                        <p role="status" className="container-replacing">
                            Замена: {loot?.items.find((i) => i.id === replacing)?.definition.name}
                            <button
                                className="icon-button"
                                aria-label="Отменить замену"
                                onClick={() => setReplacing(null)}
                            >
                                <X size={14} />
                            </button>
                        </p>
                    )}
                    <div className="container-sources" role="group" aria-label="Источник предметов">
                        <button
                            aria-pressed={source === 'library'}
                            onClick={() => setSource('library')}
                        >
                            Item Library
                        </button>
                        <button
                            aria-pressed={source === 'campaign'}
                            onClick={() => setSource('campaign')}
                        >
                            Кампания
                        </button>
                    </div>
                    <label className="container-search">
                        <Search size={14} />
                        <input
                            type="search"
                            aria-label="Поиск предметов"
                            placeholder="Поиск предметов…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </label>
                    <div className="container-library" aria-busy={!catalogLoaded}>
                        {catalogError ? (
                            <div role="alert">
                                {catalogError}
                                <button onClick={() => setCatalogRetry((n) => n + 1)}>
                                    Повторить
                                </button>
                            </div>
                        ) : !catalogLoaded ? (
                            <p role="status">Загружаем библиотеку…</p>
                        ) : visible.length ? (
                            visible.map((entry) => (
                                <button
                                    className="container-template"
                                    key={entry.definition.id}
                                    disabled={disabled}
                                    draggable={!disabled}
                                    onDragStart={(e) => {
                                        e.stopPropagation();
                                        e.dataTransfer.setData(
                                            ITEM_TEMPLATE_MIME,
                                            JSON.stringify({
                                                id: entry.definition.id,
                                                source: entry.source,
                                            }),
                                        );
                                        e.dataTransfer.effectAllowed = 'copy';
                                    }}
                                    onClick={() => add(entry)}
                                    title={
                                        replacing
                                            ? 'Заменить выбранный предмет'
                                            : 'Добавить в контейнер'
                                    }
                                >
                                    <RpgIcon icon={entry.definition.icon} size={38} />
                                    <span>
                                        <strong>{entry.definition.name}</strong>
                                        <small>
                                            {itemCategories[entry.definition.category] ??
                                                entry.definition.category}
                                        </small>
                                        <ItemFacts definition={entry.definition} />
                                    </span>
                                    <Plus size={14} />
                                </button>
                            ))
                        ) : (
                            <p className="hint">
                                {search ? 'Ничего не найдено.' : 'Здесь пока нет предметов.'}
                            </p>
                        )}
                    </div>
                    <p className="hint">
                        Клик или перетаскивание добавляет копию. Шаблон библиотеки сохраняется.
                    </p>
                </div>
            )}
        </section>
    );
}

function ContainerItem({
    item,
    disabled,
    onQuantity,
    onRemove,
    onReplace,
}: {
    item: InventoryItem;
    disabled: boolean;
    onQuantity: (n: number) => void;
    onRemove: () => void;
    onReplace: () => void;
}) {
    const [quantity, setQuantity] = useState(String(item.quantity));
    const commit = () => {
        const next = Number(quantity);
        if (
            Number.isInteger(next) &&
            next > 0 &&
            next <= item.definition.max_stack &&
            next !== item.quantity
        )
            onQuantity(next);
        else setQuantity(String(item.quantity));
    };
    return (
        <article className="container-item">
            <RpgIcon icon={item.definition.icon} size={44} />
            <div className="container-item-info">
                <strong>{item.definition.name}</strong>
                <small>
                    {itemCategories[item.definition.category] ?? item.definition.category}
                </small>
                <ItemFacts definition={item.definition} />
                <div className="container-item-tools">
                    <label>
                        Кол-во{' '}
                        <input
                            aria-label={`Количество: ${item.definition.name}`}
                            type="number"
                            min={1}
                            max={item.definition.max_stack}
                            value={quantity}
                            disabled={disabled}
                            onChange={(e) => setQuantity(e.target.value)}
                            onBlur={commit}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur();
                            }}
                        />
                    </label>
                    <button disabled={disabled} onClick={onReplace}>
                        Заменить
                    </button>
                    <button
                        className="icon-button"
                        aria-label={`Удалить: ${item.definition.name}`}
                        disabled={disabled}
                        onClick={onRemove}
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            </div>
        </article>
    );
}
