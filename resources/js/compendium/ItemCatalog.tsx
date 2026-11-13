import { useEffect, useState } from 'react';
import { request } from '../api/client';
import type { ItemDefinition } from '../rpg/model';
import { itemSummary, rarityLabels, itemCategoryLabel } from './presentation';
import {
    CatalogEmpty,
    CatalogIcon,
    CatalogLoading,
    CatalogOrigins,
    CatalogSearch,
    OriginBadge,
    rulesLabel,
    focusCatalogSearch,
} from './Catalog';

export interface SystemItem {
    id: number;
    definition: ItemDefinition;
    copyable: boolean;
    source?: { name: string; version: string; attribution: string; license: string };
}
const typeFor = (d: ItemDefinition) =>
    d.content?.catalog_type ??
    (d.category === 'weapon'
        ? 'weapons'
        : ['armor', 'shield'].includes(d.category)
          ? 'armor'
          : 'items');

export function ItemCatalog({
    items,
    itemsLoading = items === null,
    selectedKey,
    onInspect,
    revision = 0,
}: {
    items: ItemDefinition[] | null;
    itemsLoading?: boolean;
    selectedKey?: string;
    onInspect: (definition: ItemDefinition, system?: SystemItem) => void;
    revision?: number;
}) {
    const [search, setSearch] = useState(''),
        [origin, setOrigin] = useState(''),
        [type, setType] = useState('');
    const [page, setPage] = useState(1),
        [retry, setRetry] = useState(0);
    const [data, setData] = useState<{
        entries: SystemItem[];
        pages: number;
        total: number;
    } | null>(null);
    const [loading, setLoading] = useState(true),
        [error, setError] = useState('');
    useEffect(() => {
        if (origin === 'custom') return;
        const abort = new AbortController();
        const timer = setTimeout(() => {
            setError('');
            const params = new URLSearchParams({ search, page: String(page), type });
            void request<NonNullable<typeof data>>(
                `/library/items/compendium?${params}`,
                'GET',
                undefined,
                abort.signal,
            )
                .then((r) => {
                    if (!abort.signal.aborted) setData(r);
                })
                .catch((e: Error) => {
                    if (!abort.signal.aborted) setError(e.message);
                })
                .finally(() => {
                    if (!abort.signal.aborted) setLoading(false);
                });
        }, 180);
        return () => {
            clearTimeout(timer);
            abort.abort();
        };
    }, [search, origin, type, page, retry, revision]);
    const change = (update: () => void) => {
        update();
        setPage(1);
        setLoading(true);
    };
    const reset = () =>
        change(() => {
            setSearch('');
            setType('');
            setOrigin('');
        });
    const mine =
        origin === 'system'
            ? []
            : (items ?? []).filter(
                  (d) =>
                      (!type || typeFor(d) === type) &&
                      `${d.name} ${d.content?.localized?.name ?? ''}`
                          .toLocaleLowerCase()
                          .includes(search.trim().toLocaleLowerCase()),
              );
    const system = origin === 'custom' || loading || error ? [] : (data?.entries ?? []);
    const rows = [
        ...mine.slice((page - 1) * 24, page * 24).map((definition) => ({
            key: `custom:${definition.id}`,
            definition,
            system: undefined as SystemItem | undefined,
        })),
        ...system.map((s) => ({ key: `system:${s.id}`, definition: s.definition, system: s })),
    ];
    const pages = Math.max(
        1,
        Math.ceil(mine.length / 24),
        origin !== 'custom' ? (data?.pages ?? 1) : 1,
    );
    return (
        <section className="compendium-catalog" aria-label="Каталог предметов">
            <CatalogOrigins value={origin} onChange={(v) => change(() => setOrigin(v))} />
            <CatalogSearch
                label="Найти предмет"
                placeholder="Название предмета…"
                value={search}
                onChange={(v) => change(() => setSearch(v))}
            />
            <div className="catalog-filters">
                <select
                    aria-label="Категория предметов"
                    value={type}
                    onChange={(e) => change(() => setType(e.target.value))}
                >
                    <option value="">Все категории</option>
                    <option value="weapons">Оружие</option>
                    <option value="armor">Доспехи и щиты</option>
                    <option value="items">Снаряжение и прочее</option>
                </select>
                <span className="muted">
                    {origin === 'custom'
                        ? `${mine.length} моих`
                        : `${mine.length} моих · ${!loading && !error ? (data?.total ?? 0) : '…'} системных`}
                </span>
            </div>
            {error && (
                <p role="alert" className="form-error">
                    {error}{' '}
                    <button
                        onClick={() => {
                            setLoading(true);
                            setRetry((v) => v + 1);
                        }}
                    >
                        Повторить
                    </button>
                </p>
            )}
            {((loading && origin !== 'custom') || (itemsLoading && origin !== 'system')) && (
                <CatalogLoading />
            )}
            <div className="catalog-grid">
                {rows.map(({ key, definition: d, system: s }) => (
                    <button
                        className={`catalog-entry catalog-entry-item rarity-${d.rarity} kind-${d.category}`}
                        key={key}
                        aria-pressed={selectedKey === key}
                        aria-label={`Предмет: ${d.name}${s ? ' · системный' : ' · мой'}`}
                        onClick={() => onInspect(d, s)}
                    >
                        <CatalogIcon icon={d.icon} kind="item" />
                        <span className="catalog-entry-copy">
                            <strong title={d.name}>{d.name}</strong>
                            <small>{itemCategoryLabel(d)}</small>
                        </span>
                        <span className="catalog-rarity">{rarityLabels[d.rarity] ?? d.rarity}</span>
                        <span className="catalog-entry-facts">
                            {itemSummary(d).map((fact, i) => (
                                <span key={i} title={fact}>
                                    {fact}
                                </span>
                            ))}
                        </span>
                        <span className="catalog-entry-footer">
                            <OriginBadge custom={!s} />
                            <span
                                className="catalog-edition"
                                title={rulesLabel(
                                    d.content,
                                    s?.source ? `${s.source.name} ${s.source.version}` : undefined,
                                )}
                            >
                                {d.content?.ruleset?.replace('dnd-', 'D&D ') ||
                                    (s?.source?.version ? `SRD ${s.source.version}` : 'Без версии')}
                            </span>
                        </span>
                    </button>
                ))}
            </div>
            {!rows.length &&
                (origin === 'custom' || (!loading && !error)) &&
                (origin === 'system' || items !== null) && (
                    <CatalogEmpty filtered={!!(search || type || origin)} onReset={reset} />
                )}
            {(origin === 'custom' || (!loading && !error)) && pages > 1 && (
                <nav className="button-row spell-pagination" aria-label="Страницы предметов">
                    <button
                        disabled={page <= 1}
                        onClick={(e) => {
                            setLoading(true);
                            setPage((p) => p - 1);
                            focusCatalogSearch(e.currentTarget.closest('.compendium-catalog'));
                        }}
                    >
                        Назад
                    </button>
                    <span>
                        {page} / {pages}
                    </span>
                    <button
                        disabled={page >= pages}
                        onClick={(e) => {
                            setLoading(true);
                            setPage((p) => p + 1);
                            focusCatalogSearch(e.currentTarget.closest('.compendium-catalog'));
                        }}
                    >
                        Далее
                    </button>
                </nav>
            )}
        </section>
    );
}
