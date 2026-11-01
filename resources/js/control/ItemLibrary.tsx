import { AssetIconPicker } from './AssetLibrary';
import { useEffect, useState } from 'react';
import { Plus, Package } from 'lucide-react';
import { request } from '../api/client';
import { commandId } from '../api/workspace';
import { RpgIcon } from '../gameplay/RpgIcon';
import { ItemFacts, itemCategories } from '../rpg/itemGameplay';
import { ItemGameplayEditor } from '../rpg/ItemGameplayEditor';
import type { ItemDefinition } from '../rpg/model';

export const libraryItemsApi = {
    list: (signal?: AbortSignal) =>
        request<{ definitions: ItemDefinition[] }>('/library/items', 'GET', undefined, signal),
    save: (definition: Partial<ItemDefinition>, id: string) =>
        request<{ definition: ItemDefinition }>('/library/items', 'POST', {
            ...definition,
            clientMutationId: id,
        }),
};
export const equipmentSlots: Record<string, string> = {
    head: 'Голова',
    armor: 'Доспех',
    cloak: 'Плащ',
    gloves: 'Перчатки',
    boots: 'Сапоги',
    amulet: 'Амулет',
    ring_1: 'Кольцо I',
    ring_2: 'Кольцо II',
    main_hand: 'Основная рука',
    off_hand: 'Вторая рука',
    ranged: 'Дальний бой',
};
export function ItemCard({ definition: d }: { definition: ItemDefinition }) {
    return (
        <>
            <RpgIcon icon={d.icon} size={72} />
            <h3>{d.name}</h3>
            <p className="muted">
                {itemCategories[d.category]} · {rarities[d.rarity] ?? d.rarity}
            </p>
            <ItemFacts definition={d} />
            <p>{d.description || 'Описание пока не добавлено.'}</p>
            {d.modifiers.ac ? (
                <p>
                    Защита {d.modifiers.ac >= 0 ? '+' : ''}
                    {d.modifiers.ac} AC
                </p>
            ) : null}
            {d.modifiers.speed ? (
                <p>
                    Скорость {d.modifiers.speed >= 0 ? '+' : ''}
                    {d.modifiers.speed} ft
                </p>
            ) : null}
            {!!d.modifiers.checks && (
                <p>
                    {Object.entries(d.modifiers.checks)
                        .map(([key, value]) => `${key}: ${value >= 0 ? '+' : ''}${value}`)
                        .join(' · ')}
                </p>
            )}
            <p className="hint">
                {d.equipment_slots.map((s) => equipmentSlots[s] ?? s).join(' · ') ||
                    'Хранится в рюкзаке'}
                {d.max_stack > 1 ? ` · Стопка до ${d.max_stack}` : ''}
            </p>
        </>
    );
}
const rarities: Record<string, string> = {
    common: 'Обычный',
    uncommon: 'Необычный',
    rare: 'Редкий',
    epic: 'Эпический',
    legendary: 'Легендарный',
};
const icons = [
    'item_sword',
    'item_shield',
    'item_armor',
    'item_potion',
    'item_scroll',
    'item_boots',
    'item_helmet',
    'item_ring',
    'item_amulet',
    'item_cloak',
    'item_gloves',
    'sword',
    'shield',
    'potion',
    'book',
    'flame',
    'focus',
];
const empty = (): ItemDefinition => ({
    id: '',
    name: '',
    description: '',
    icon: 'item_sword',
    category: 'weapon',
    rarity: 'common',
    width: 1,
    height: 1,
    max_stack: 1,
    equipment_slots: ['main_hand'],
    modifiers: {},
    use_ability_id: null,
});

export function ItemLibrary() {
    const [items, setItems] = useState<ItemDefinition[] | null>(null),
        [error, setError] = useState(''),
        [search, setSearch] = useState('');
    const [selected, setSelected] = useState<ItemDefinition | null>(null),
        [draft, setDraft] = useState<ItemDefinition | null>(null),
        [busy, setBusy] = useState(false);
    const [mutation, setMutation] = useState(commandId());
    const load = () => {
        setError('');
        void libraryItemsApi
            .list()
            .then((r) => setItems(r.definitions))
            .catch((e) => setError(e.message));
    };
    useEffect(() => {
        const abort = new AbortController();
        void libraryItemsApi
            .list(abort.signal)
            .then((r) => setItems(r.definitions))
            .catch((e) => {
                if (!abort.signal.aborted) setError(e.message);
            });
        return () => abort.abort();
    }, []);
    useEffect(() => {
        if (!draft) return;
        const guard = (e: BeforeUnloadEvent) => e.preventDefault();
        window.addEventListener('beforeunload', guard);
        return () => window.removeEventListener('beforeunload', guard);
    }, [draft]);
    const patch = (p: Partial<ItemDefinition>) => {
        setDraft((d) => (d ? { ...d, ...p } : d));
        setMutation(commandId());
    };
    const edit = (d: ItemDefinition, duplicate = false) => {
        if (busy) return;
        if (draft && !confirm('Отменить несохранённые изменения предмета?')) return;
        setDraft({
            ...structuredClone(d),
            ...(duplicate ? { id: '', name: `${d.name.slice(0, 71)} · копия` } : {}),
        });
        setMutation(commandId());
    };
    const save = async () => {
        if (!draft || busy) return;
        setBusy(true);
        setError('');
        try {
            const r = await libraryItemsApi.save(
                draft.id ? draft : { ...draft, id: undefined },
                mutation,
            );
            setItems((all) => [
                r.definition,
                ...(all ?? []).filter((i) => i.id !== r.definition.id),
            ]);
            setSelected(r.definition);
            setDraft(null);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    return (
        <section className="item-library">
            <header className="control-heading">
                <div>
                    <span className="eyebrow">GM HUB / ITEM LIBRARY</span>
                    <h1>Предметы</h1>
                    <p className="muted">Одна коллекция для ваших героев и кампаний.</p>
                </div>
                <button className="primary-button" disabled={busy} onClick={() => edit(empty())}>
                    <Plus size={17} />
                    Создать предмет
                </button>
            </header>
            {error && (
                <p role="alert" className="form-error">
                    {error} <button onClick={load}>Повторить загрузку</button>
                </p>
            )}
            <div className="item-library-layout">
                <div>
                    <input
                        aria-label="Найти предмет"
                        placeholder="Поиск в коллекции…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                    {items === null ? (
                        <p role="status">Загрузка предметов…</p>
                    ) : !items.length ? (
                        <div className="control-empty">
                            <Package size={40} />
                            <h2>Соберите арсенал для ваших историй</h2>
                            <p>
                                Начните с оружия, доспеха или памятной вещи. Выдавайте их любому
                                своему персонажу.
                            </p>
                        </div>
                    ) : (
                        <div className="library-item-grid">
                            {items
                                .filter((d) =>
                                    d.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
                                )
                                .map((d) => (
                                    <button
                                        key={d.id}
                                        className={`library-item rarity-${d.rarity}`}
                                        aria-pressed={selected?.id === d.id}
                                        onClick={() => setSelected(d)}
                                        onDoubleClick={() => edit(d)}
                                    >
                                        <RpgIcon icon={d.icon} size={64} />
                                        <strong>{d.name}</strong>
                                        <small>{itemCategories[d.category]}</small>
                                        <span className="rpg-tooltip">
                                            <strong>{d.name}</strong>
                                            <ItemFacts definition={d} />
                                            <span>{d.description}</span>
                                        </span>
                                    </button>
                                ))}
                        </div>
                    )}
                    {items?.length &&
                    !items.some((d) =>
                        d.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
                    ) ? (
                        <p className="hint">Предметов по этому запросу нет.</p>
                    ) : null}
                </div>
                <aside className="library-inspector">
                    {draft ? (
                        <>
                            <h2>{draft.id ? 'Редактировать предмет' : 'Новый предмет'}</h2>
                            <p className="hint">Выданные экземпляры сохраняют свои свойства.</p>
                            <fieldset disabled={busy}>
                                <label className="field">
                                    Название
                                    <input
                                        aria-label="Название предмета"
                                        maxLength={80}
                                        value={draft.name}
                                        onChange={(e) => patch({ name: e.target.value })}
                                    />
                                </label>
                                <label className="field">
                                    Категория
                                    <select
                                        value={draft.category}
                                        onChange={(e) =>
                                            patch({
                                                category: e.target.value,
                                                gameplay: null,
                                                equipment_slots:
                                                    e.target.value === 'weapon'
                                                        ? ['main_hand']
                                                        : e.target.value === 'armor'
                                                          ? ['armor']
                                                          : e.target.value === 'shield'
                                                            ? ['off_hand']
                                                            : [],
                                                icon:
                                                    e.target.value === 'armor'
                                                        ? 'item_armor'
                                                        : e.target.value === 'shield'
                                                          ? 'item_shield'
                                                          : e.target.value === 'consumable'
                                                            ? 'item_potion'
                                                            : draft.icon,
                                            })
                                        }
                                    >
                                        {Object.entries(itemCategories).map(([k, v]) => (
                                            <option key={k} value={k}>
                                                {v}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label className="field">
                                    Описание
                                    <textarea
                                        maxLength={1000}
                                        value={draft.description ?? ''}
                                        onChange={(e) => patch({ description: e.target.value })}
                                    />
                                </label>
                                <AssetIconPicker
                                    icon={draft.icon ?? 'spark'}
                                    onChange={(icon) => patch({ icon })}
                                />
                                <div className="library-icon-picker" aria-label="Иконка предмета">
                                    {icons.map((icon) => (
                                        <button
                                            key={icon}
                                            title={icon}
                                            aria-label={icon}
                                            aria-pressed={draft.icon === icon}
                                            onClick={() => patch({ icon })}
                                        >
                                            <RpgIcon icon={icon} size={32} />
                                        </button>
                                    ))}
                                </div>
                                <details open>
                                    <summary>Боевой профиль и правила</summary>
                                    <ItemGameplayEditor draft={draft} patch={patch} campaignId="" />
                                </details>
                                <p className="hint">
                                    Заряды задаются отдельно каждому экземпляру в Equipment
                                    персонажа.
                                </p>
                                <details>
                                    <summary>Advanced · редкость, стопки, слоты и бонусы</summary>
                                    <label className="field">
                                        Редкость
                                        <select
                                            value={draft.rarity}
                                            onChange={(e) => patch({ rarity: e.target.value })}
                                        >
                                            {Object.entries(rarities).map(([k, v]) => (
                                                <option key={k} value={k}>
                                                    {v}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="field">
                                        Размер стопки
                                        <input
                                            type="number"
                                            min={1}
                                            max={99}
                                            value={draft.max_stack}
                                            onChange={(e) =>
                                                patch({ max_stack: Number(e.target.value) })
                                            }
                                        />
                                    </label>
                                    <p className="hint">Совместимые слоты</p>
                                    <div className="library-slots">
                                        {Object.entries(equipmentSlots).map(([s, label]) => (
                                            <label key={s}>
                                                <input
                                                    type="checkbox"
                                                    checked={draft.equipment_slots.includes(s)}
                                                    onChange={(e) =>
                                                        patch({
                                                            equipment_slots: e.target.checked
                                                                ? [...draft.equipment_slots, s]
                                                                : draft.equipment_slots.filter(
                                                                      (v) => v !== s,
                                                                  ),
                                                        })
                                                    }
                                                />
                                                {label}
                                            </label>
                                        ))}
                                    </div>
                                    <div className="gameplay-form-row">
                                        {(['ac', 'speed'] as const).map((k) => (
                                            <label key={k}>
                                                {k === 'ac' ? 'Бонус AC' : 'Бонус скорости'}
                                                <input
                                                    type="number"
                                                    min={k === 'ac' ? -20 : -100}
                                                    max={k === 'ac' ? 20 : 100}
                                                    value={draft.modifiers[k] ?? 0}
                                                    onChange={(e) =>
                                                        patch({
                                                            modifiers: {
                                                                ...draft.modifiers,
                                                                [k]: Number(e.target.value),
                                                            },
                                                        })
                                                    }
                                                />
                                            </label>
                                        ))}
                                    </div>
                                </details>
                                <div
                                    className="library-draft-preview"
                                    aria-label="Предпросмотр предмета"
                                >
                                    <span className="eyebrow">ПРЕДПРОСМОТР</span>
                                    <ItemCard definition={draft} />
                                </div>
                                <div className="button-row">
                                    <button
                                        className="primary-button"
                                        disabled={!draft.name.trim()}
                                        onClick={() => void save()}
                                    >
                                        {busy ? 'Сохранение…' : 'Сохранить предмет'}
                                    </button>
                                    <button
                                        onClick={() => {
                                            if (confirm('Отменить изменения предмета?'))
                                                setDraft(null);
                                        }}
                                    >
                                        Отмена
                                    </button>
                                </div>
                            </fieldset>
                        </>
                    ) : selected ? (
                        <>
                            <ItemCard definition={selected} />
                            <button className="secondary-button" onClick={() => edit(selected)}>
                                Редактировать
                            </button>
                            <button className="primary-button" onClick={() => edit(selected, true)}>
                                Duplicate · создать вариант
                            </button>
                        </>
                    ) : (
                        <div className="control-empty">
                            <Package size={32} />
                            <p>Выберите предмет, чтобы рассмотреть его свойства.</p>
                        </div>
                    )}
                </aside>
            </div>
        </section>
    );
}
