import { AssetIconPicker } from './AssetLibrary';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Plus, Package } from 'lucide-react';
import { request } from '../api/client';
import { commandId } from '../api/workspace';
import { RpgIcon } from '../gameplay/RpgIcon';
import { itemCategories } from '../rpg/itemGameplay';
import { ItemGameplayEditor } from '../rpg/ItemGameplayEditor';
import type { ItemDefinition } from '../rpg/model';
import { ItemMechanics } from '../compendium/EntryFacts';
import { rarityLabels, itemCategoryLabel } from '../compendium/presentation';
import { ContentReference } from '../compendium/ContentReference';
import { ItemCatalog, type SystemItem } from '../compendium/ItemCatalog';
import {
    CatalogBack,
    CatalogCardHeader,
    CoverageBadge,
    focusCatalogInspector,
    OriginBadge,
    rulesLabel,
} from '../compendium/Catalog';

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
export function ItemCard({
    definition: d,
    sourceLabel,
    actions,
}: {
    definition: ItemDefinition;
    sourceLabel?: string;
    actions?: ReactNode;
}) {
    return (
        <>
            <CatalogCardHeader
                name={d.name}
                icon={d.icon}
                kind="item"
                tone={`rarity-${d.rarity}`}
                subtitle={`${itemCategoryLabel(d)} · ${rarityLabels[d.rarity] ?? d.rarity}`}
            >
                <span className="catalog-rules">{rulesLabel(d.content, sourceLabel)}</span>
                {d.content?.gates.execute === false && <CoverageBadge coverage="MANUAL" />}
                {actions}
            </CatalogCardHeader>
            <section className="catalog-sheet-section">
                <h4 className="catalog-section-title">Механики YTT</h4>
                <ItemMechanics definition={d} />
                <p className="catalog-storage">
                    {d.equipment_slots.map((s) => equipmentSlots[s] ?? s).join(' · ') ||
                        'Хранится в рюкзаке'}
                    {d.max_stack > 1 ? ` · Стопка до ${d.max_stack}` : ''}
                </p>
            </section>
            <section className="catalog-sheet-section">
                <h4 className="catalog-section-title">Описание</h4>
                <p className="spell-reference">
                    {d.content?.reference || d.description || 'Описание пока не добавлено.'}
                </p>
            </section>
            {d.content && (
                <details className="catalog-source">
                    <summary>Сведения источника и примечания</summary>
                    <ContentReference content={d.content} showText={false} />
                </details>
            )}
        </>
    );
}
const rarities = Object.fromEntries(
    [
        'common',
        'uncommon',
        'rare',
        'very_rare',
        'epic',
        'legendary',
        'artifact',
        'varies',
        'unknown',
    ].map((key) => [key, rarityLabels[key]]),
);
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
    const inspector = useRef<HTMLElement>(null);
    const [items, setItems] = useState<ItemDefinition[] | null>(null),
        [error, setError] = useState(''),
        [system, setSystem] = useState<SystemItem | null>(null);
    const [message, setMessage] = useState('');
    const [itemsLoading, setItemsLoading] = useState(true);
    const [selected, setSelected] = useState<ItemDefinition | null>(null),
        [draft, setDraft] = useState<ItemDefinition | null>(null),
        [busy, setBusy] = useState(false);
    const [mutation, setMutation] = useState(commandId());
    const load = () => {
        setError('');
        setItemsLoading(true);
        void libraryItemsApi
            .list()
            .then((r) => setItems(r.definitions))
            .catch((e) => setError(e.message))
            .finally(() => setItemsLoading(false));
    };
    useEffect(() => {
        const abort = new AbortController();
        void libraryItemsApi
            .list(abort.signal)
            .then((r) => {
                if (!abort.signal.aborted) setItems(r.definitions);
            })
            .catch((e) => {
                if (!abort.signal.aborted) setError(e.message);
            })
            .finally(() => {
                if (!abort.signal.aborted) setItemsLoading(false);
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
            setSystem(null);
            setDraft(null);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    return (
        <section className="item-library visual-compendium">
            <header className="control-heading">
                <div>
                    <span className="eyebrow">КОМПЕНДИУМ / ПРЕДМЕТЫ</span>
                    <h1>Предметы</h1>
                    <p className="muted">Одна коллекция для ваших героев и кампаний.</p>
                </div>
                <button className="primary-button" disabled={busy} onClick={() => edit(empty())}>
                    <Plus size={17} />
                    Создать предмет
                </button>
            </header>
            {message && (
                <p role="status" className="catalog-success">
                    {message}
                </p>
            )}
            {error && (
                <p role="alert" className="form-error">
                    {error} <button onClick={load}>Повторить загрузку</button>
                </p>
            )}
            <div className={`item-library-layout ${selected || draft ? 'has-inspection' : ''}`}>
                <ItemCatalog
                    items={items}
                    itemsLoading={itemsLoading}
                    selectedKey={
                        selected
                            ? `${system ? 'system' : 'custom'}:${system?.id ?? selected.id}`
                            : undefined
                    }
                    onInspect={(definition, entry) => {
                        if (busy) return;
                        if (draft && !confirm('Отменить несохранённые изменения предмета?')) return;
                        setDraft(null);
                        setSelected(definition);
                        setSystem(entry ?? null);
                        setMessage('');
                        focusCatalogInspector(inspector);
                    }}
                />
                <aside
                    ref={inspector}
                    tabIndex={-1}
                    className="library-inspector catalog-inspector"
                    aria-label="Просмотр предмета"
                >
                    {(selected || draft) && <CatalogBack />}
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
                            <OriginBadge custom={!system} />
                            <ItemCard
                                definition={selected}
                                sourceLabel={
                                    system?.source
                                        ? `${system.source.name} ${system.source.version}`
                                        : undefined
                                }
                                actions={
                                    <div className="button-row">
                                        {system ? (
                                            <button
                                                className="primary-button"
                                                disabled={busy || !system.copyable}
                                                onClick={async () => {
                                                    setBusy(true);
                                                    setError('');
                                                    try {
                                                        const result = await request<{
                                                            definition: ItemDefinition;
                                                        }>('/library/items/compendium', 'POST', {
                                                            entryId: system.id,
                                                            clientMutationId: commandId(),
                                                        });
                                                        setItems((all) => [
                                                            result.definition,
                                                            ...(all ?? []).filter(
                                                                (d) =>
                                                                    d.id !== result.definition.id,
                                                            ),
                                                        ]);
                                                        setSelected(result.definition);
                                                        setSystem(null);
                                                        setMessage(
                                                            'Независимая копия добавлена в мою коллекцию. Теперь её можно редактировать.',
                                                        );
                                                    } catch (e) {
                                                        setError((e as Error).message);
                                                    } finally {
                                                        setBusy(false);
                                                    }
                                                }}
                                            >
                                                {busy
                                                    ? 'Создание копии…'
                                                    : 'Копировать в мою коллекцию'}
                                            </button>
                                        ) : (
                                            <>
                                                <button
                                                    className="secondary-button"
                                                    onClick={() => edit(selected)}
                                                >
                                                    Редактировать
                                                </button>
                                                <button
                                                    className="primary-button"
                                                    onClick={() => edit(selected, true)}
                                                >
                                                    Создать вариант
                                                </button>
                                            </>
                                        )}
                                    </div>
                                }
                            />
                            {system && (
                                <>
                                    <p className="hint">
                                        Системная запись доступна для чтения. Копия в вашей
                                        коллекции независима от каталога.
                                    </p>
                                    {system.source && (
                                        <details>
                                            <summary>
                                                Источник · {system.source.name}{' '}
                                                {system.source.version}
                                            </summary>
                                            <p>{system.source.attribution}</p>
                                            <p>{system.source.license}</p>
                                        </details>
                                    )}
                                    {!system.copyable && (
                                        <p className="hint">
                                            Источник разрешает просмотр; копирование пока
                                            недоступно.
                                        </p>
                                    )}
                                </>
                            )}
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
