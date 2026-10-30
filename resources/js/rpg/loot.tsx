import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SceneStore } from '../tabletop/state/SceneStore';
import { request, ApiError } from '../api/client';
import { commandId, type Mutation } from '../api/workspace';
import { inventoryApi, type InventoryItem, type ItemDefinition } from './model';
import { RpgWindow } from './RpgWindow';
import { RpgDragProvider, useRpgDrag } from './RpgDrag';
import { RpgIcon } from '../gameplay/RpgIcon';
import { ItemFacts } from './itemGameplay';
import { useInventory } from './useInventory';
import { InventoryGridView } from './InventoryView';
import type { Character } from '../tabletop/types/scene';
export interface LootSummary {
    id: string;
    name: string;
    kind: string;
    open: boolean;
    version: number;
    empty?: boolean;
}
export interface LootState extends LootSummary {
    items: InventoryItem[];
}
export const lootApi = {
    read: (campaign: string, id: string) =>
        request<{ loot: LootState }>(`/campaigns/${campaign}/loot?containerId=${id}`),
    command: (campaign: string, data: Record<string, unknown>, id: string = commandId()) =>
        request<{
            loot: LootState;
            transferred?: { itemId: string; quantity: number }[];
            mutation?: Mutation;
        }>(`/campaigns/${campaign}/loot`, 'POST', { ...data, clientMutationId: id }),
};
export function openLoot(id: string) {
    window.dispatchEvent(new CustomEvent('ytt:loot-open', { detail: id }));
}
export function LootOverlay({ store }: { store: SceneStore }) {
    const [id, setId] = useState<string | null>(null);
    const { scene } = useSyncExternalStore(store.subscribe, store.getSnapshot);
    useEffect(() => {
        const open = (e: Event) => setId(String((e as CustomEvent).detail));
        window.addEventListener('ytt:loot-open', open);
        return () => window.removeEventListener('ytt:loot-open', open);
    }, []);
    const meta = [...scene.tokens, ...(scene.props ?? [])].find((o) => o.loot?.id === id)?.loot;
    if (!id || !scene.campaignId) return null;
    return (
        <LootWindow
            key={`${scene.id}:${id}`}
            id={id}
            store={store}
            meta={meta}
            onClose={() => setId(null)}
        />
    );
}
function LootWindow({
    id,
    store,
    meta,
    onClose,
}: {
    id: string;
    store: SceneStore;
    meta?: LootSummary;
    onClose: () => void;
}) {
    const { scene } = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const [characterId, setCharacterId] = useState(
        scene.activeCharacterId ?? scene.characters?.[0]?.id ?? '',
    );
    const character = scene.characters?.find((c) => c.id === characterId) ?? null;
    const [loot, setLoot] = useState<LootState | null>(null),
        [error, setError] = useState(''),
        [busy, setBusy] = useState(false),
        [definitions, setDefinitions] = useState<ItemDefinition[]>([]),
        [def, setDef] = useState(''),
        [qty, setQty] = useState(1);
    const pending = useRef<{ data: Record<string, unknown>; id: string } | null>(null),
        locked = useRef(false),
        alive = useRef(true);
    const inv = useInventory(scene.campaignId!, character, () => {});
    const refresh = () =>
        lootApi
            .read(scene.campaignId!, id)
            .then((r) => {
                if (alive.current)
                    setLoot((previous) =>
                        previous && previous.version > r.loot.version ? previous : r.loot,
                    );
            })
            .catch((e) => {
                if (alive.current) setError(e.message);
            });
    const send = async (data: Record<string, unknown>) => {
        if (locked.current) return;
        locked.current = true;
        setBusy(true);
        setError('');
        pending.current ??= { data: { ...data, containerId: id }, id: commandId() };
        try {
            const r = await lootApi.command(
                scene.campaignId!,
                pending.current.data,
                pending.current.id,
            );
            pending.current = null;
            if (r.mutation) store.accept(r.mutation, true);
            if (alive.current) {
                setLoot((previous) =>
                    previous && previous.version > r.loot.version ? previous : r.loot,
                );
                void inv.refresh();
            }
        } catch (e) {
            if (e instanceof ApiError && e.status > 0 && e.status < 500) pending.current = null;
            if (alive.current) setError((e as Error).message);
        } finally {
            locked.current = false;
            if (alive.current) setBusy(false);
        }
    };
    const sendRef = useRef(send);
    useEffect(() => {
        sendRef.current = send;
    });
    useEffect(() => {
        alive.current = true;
        void sendRef.current({ action: 'open' });
        return () => {
            alive.current = false;
        };
    }, []);
    const version = meta?.version;
    const refreshRef = useRef(refresh);
    useEffect(() => {
        refreshRef.current = refresh;
    });
    useEffect(() => {
        if (version !== undefined) void refreshRef.current();
    }, [version]); // authoritative container version, independent of map movements
    useEffect(() => {
        if (store.role !== 'gm') return;
        let alive = true;
        void inventoryApi
            .definitions(scene.campaignId!)
            .then((r) => {
                if (alive) setDefinitions(r.definitions);
            })
            .catch((e) => {
                if (alive) setError(e.message);
            });
        return () => {
            alive = false;
        };
    }, [store.role, scene.campaignId]);
    const take = (item?: InventoryItem) =>
        void send({
            action: item ? 'take' : 'take-all',
            ...(item ? { itemId: item.id, quantity: item.quantity } : {}),
            characterId: Number(characterId),
        });
    return (
        <RpgDragProvider
            icon={(b) =>
                loot?.items.find((i) => i.id === b.sourceId)?.definition.icon ??
                inv.data?.items.find((i) => i.id === b.sourceId)?.definition.icon ??
                'item_potion'
            }
        >
            <RpgWindow
                kind="inventory"
                name={loot?.name ?? 'Добыча'}
                title="Добыча"
                hideTabs
                onChange={() => {}}
                onClose={onClose}
            >
                {error && (
                    <div className="rpg-window-error" role="alert">
                        {error}
                        <button
                            disabled={busy}
                            onClick={() =>
                                pending.current
                                    ? void sendRef.current(pending.current.data)
                                    : void refresh()
                            }
                        >
                            Повторить
                        </button>
                    </div>
                )}
                <div className="loot-toolbar">
                    <label>
                        Получатель
                        <select
                            value={characterId}
                            onChange={(e) => setCharacterId(e.target.value)}
                            disabled={busy}
                        >
                            {scene.characters?.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <button
                        className="rpg-gold-button"
                        disabled={busy || !characterId || !loot?.items.length || !loot.open}
                        onClick={() => take()}
                    >
                        Взять всё
                    </button>
                    {store.role === 'gm' && (
                        <button
                            disabled={busy}
                            onClick={() => void send({ action: loot?.open ? 'close' : 'open' })}
                        >
                            {loot?.open ? 'Закрыть контейнер' : 'Открыть контейнер'}
                        </button>
                    )}
                </div>
                {!loot ? (
                    <p role="status">Открываем добычу…</p>
                ) : (
                    <LootContents
                        loot={loot}
                        inventory={inv}
                        character={character}
                        busy={busy}
                        take={take}
                        gm={store.role === 'gm'}
                        remove={(i) => void send({ action: 'remove', itemId: i.id })}
                    />
                )}
                {store.role === 'gm' && (
                    <details className="loot-authoring">
                        <summary>Подготовить содержимое</summary>
                        <select
                            aria-label="Предмет в контейнер"
                            value={def}
                            onChange={(e) => setDef(e.target.value)}
                        >
                            <option value="">Предмет кампании</option>
                            {definitions.map((d) => (
                                <option key={d.id} value={d.id}>
                                    {d.name}
                                </option>
                            ))}
                        </select>
                        <input
                            aria-label="Количество в контейнер"
                            type="number"
                            min={1}
                            max={999}
                            value={qty}
                            onChange={(e) =>
                                setQty(Math.max(1, Math.min(999, Number(e.target.value))))
                            }
                        />
                        <button
                            disabled={busy || !def}
                            onClick={() =>
                                void send({ action: 'give', definitionId: def, quantity: qty })
                            }
                        >
                            Положить в контейнер
                        </button>
                        <p className="hint">
                            Новые определения копируются через «Добавить → Compendium». Снаряжение
                            NPC не копируется автоматически.
                        </p>
                    </details>
                )}
            </RpgWindow>
        </RpgDragProvider>
    );
}
export function LootContents({
    loot,
    inventory,
    character,
    busy,
    take,
    gm,
    remove,
}: {
    loot: LootState;
    inventory: ReturnType<typeof useInventory>;
    character: Character | null;
    busy: boolean;
    take: (i?: InventoryItem) => void;
    gm: boolean;
    remove: (i: InventoryItem) => void;
}) {
    const drag = useRpgDrag();
    const [quantities, setQuantities] = useState<Record<string, number>>({}),
        [inspected, setInspected] = useState<string | null>(null);
    const inspectedItem = loot.items.find((i) => i.id === inspected);
    return (
        <div className="loot-layout">
            <section className="loot-source">
                <div className="loot-status">
                    {loot.open ? 'Открыто' : 'Закрыто'} · {loot.items.length ? 'Предметы' : 'Пусто'}
                </div>
                <div className="loot-item-grid">
                    {loot.items.map((i) => (
                        <article key={i.id} className="loot-item">
                            <button
                                aria-label={`${i.definition.name}, ${i.quantity} шт.`}
                                {...drag.source(
                                    { sourceType: 'inventory_item', sourceId: i.id },
                                    !busy,
                                )}
                                onClick={() => {
                                    if (!drag.consumeClick()) setInspected(i.id);
                                }}
                            >
                                <RpgIcon icon={i.definition.icon} size={64} />
                                <b>{i.quantity}</b>
                                <span className="rpg-tooltip">
                                    <strong>{i.definition.name}</strong>
                                    <ItemFacts definition={i.definition} />
                                </span>
                            </button>
                            <strong>{i.definition.name}</strong>
                            <input
                                aria-label={`Количество ${i.definition.name}`}
                                type="number"
                                min={1}
                                max={i.quantity}
                                value={Math.min(i.quantity, quantities[i.id] ?? 1)}
                                onChange={(e) =>
                                    setQuantities({
                                        ...quantities,
                                        [i.id]: Math.max(
                                            1,
                                            Math.min(i.quantity, Number(e.target.value)),
                                        ),
                                    })
                                }
                            />
                            <button
                                disabled={busy || !character || !loot.open}
                                onClick={() =>
                                    take({
                                        ...i,
                                        quantity: Math.min(i.quantity, quantities[i.id] ?? 1),
                                    })
                                }
                            >
                                Взять
                            </button>
                            {gm && (
                                <button
                                    disabled={busy}
                                    className="rpg-quiet-button"
                                    onClick={() => remove(i)}
                                >
                                    Убрать
                                </button>
                            )}
                        </article>
                    ))}
                </div>
                {inspectedItem && (
                    <div className="loot-item-detail">
                        <h4>{inspectedItem.definition.name}</h4>
                        <ItemFacts definition={inspectedItem.definition} />
                        <p>{inspectedItem.definition.description}</p>
                    </div>
                )}
                {!loot.items.length && <p className="rpg-empty">Здесь больше ничего нет</p>}
            </section>
            <section
                className={`loot-destination ${drag.over?.key === 'loot:bag' ? 'drop-valid' : ''}`}
                {...drag.destination(
                    'loot:bag',
                    (b) =>
                        !busy &&
                        !!character &&
                        loot.open &&
                        loot.items.some((i) => i.id === b.sourceId),
                    (b) => {
                        const i = loot.items.find((i) => i.id === b.sourceId);
                        if (i) take(i);
                    },
                )}
            >
                <h3>{character?.name ?? 'Выберите персонажа'} · Рюкзак</h3>
                {inventory.data && (
                    <InventoryGridView
                        state={inventory.data}
                        send={inventory.send}
                        busy={busy || inventory.busy}
                        compact
                        externalItems={loot.items}
                        onExternalDrop={take}
                        onInspect={() => {}}
                    />
                )}
                <p className="hint">
                    Перетащите добычу сюда или нажмите «Взять». Полные стопки сначала объединяются,
                    затем заполняются свободные ячейки.
                </p>
            </section>
        </div>
    );
}
export function LootSetup({
    store,
    kind,
    id,
    loot,
}: {
    store: SceneStore;
    kind: 'token' | 'prop';
    id: string;
    loot?: LootSummary;
}) {
    const [busy, setBusy] = useState(false),
        [error, setError] = useState('');
    return (
        <div className="inspector-section">
            <button
                disabled={busy}
                onClick={async () => {
                    if (loot) {
                        openLoot(loot.id);
                        return;
                    }
                    setBusy(true);
                    try {
                        const scene = store.getSnapshot().scene;
                        const r = await lootApi.command(scene.campaignId!, {
                            action: 'configure',
                            sceneId: scene.id,
                            kind,
                            objectId: id,
                        });
                        if (r.mutation) store.accept(r.mutation, true);
                        openLoot(r.loot.id);
                    } catch (e) {
                        setError((e as Error).message);
                    } finally {
                        setBusy(false);
                    }
                }}
            >
                {loot
                    ? 'Открыть содержимое добычи'
                    : kind === 'token'
                      ? 'Подготовить добычу NPC'
                      : 'Сделать контейнером'}
            </button>
            {error && <p role="alert">{error}</p>}
        </div>
    );
}
