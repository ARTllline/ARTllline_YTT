import { useEffect, useState } from 'react';
import { CircleUserRound, Search } from 'lucide-react';
import { request } from '../../api/client';
import { preparation, type LibraryAsset } from '../../api/preparation';
import type { Character } from '../../tabletop/types/scene';
import type { ObjectPreset } from '../../tabletop/objects/collider';
import { placementIdentity, type Placement } from './model';
import '../session/session-add.css';

export type EntityKind = 'characters' | 'npcs' | 'prop' | 'container' | 'interaction';
export type CatalogQuery = { search: string; page: number; source: 'assets' | 'presets' };
export const initialCatalogQuery: CatalogQuery = { search: '', page: 1, source: 'assets' };
export const ENTITY_MIME = 'application/x-ytt-entity';
type Entry = {
    id: string;
    name: string;
    image?: string;
    detail: string;
    campaignActor?: boolean;
    placement: Placement;
};

export function EntityPicker({
    kind,
    campaignId,
    placedCharacterIds,
    onPlace,
    selectedPlacement,
    query,
    onQuery,
    onDragStart,
    onDragEnd,
}: {
    kind: EntityKind;
    campaignId: string;
    placedCharacterIds: string[];
    onPlace: (item: Placement) => void;
    selectedPlacement?: Placement | null;
    query: CatalogQuery;
    onQuery: (query: CatalogQuery) => void;
    onDragStart?: (item: Placement) => void;
    onDragEnd?: () => void;
}) {
    const { search, page, source } = query;
    const [entries, setEntries] = useState<Entry[]>([]);
    const [pages, setPages] = useState(1);
    const [pending, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);
    const actor = kind === 'characters' || kind === 'npcs';
    const assetSearch = actor ? '' : search;
    const requestKey = JSON.stringify([kind, campaignId, assetSearch, page, source, retry]);
    const [loadedKey, setLoadedKey] = useState('');
    const loading = pending || loadedKey !== requestKey;
    useEffect(() => {
        const abort = new AbortController();
        const load = async () => {
            if (actor) {
                const paths =
                    kind === 'npcs'
                        ? ['/library/npcs']
                        : ['/library/characters', `/campaigns/${campaignId}/characters`];
                const results = await Promise.all(
                    paths.map((path) =>
                        request<{ characters: Character[] }>(path, 'GET', undefined, abort.signal),
                    ),
                );
                return [
                    ...new Map(
                        results
                            .flatMap((r) => r.characters)
                            .filter((c) => kind === 'npcs' || c.kind === 'player_character')
                            .map((c) => [c.id, c]),
                    ).values(),
                ].map((c) => ({
                    id: c.id,
                    name: c.name,
                    image: c.portrait?.url,
                    detail: `${c.hp}/${c.maxHp} HP · ${kind === 'characters' && c.campaignId === campaignId ? 'Герой кампании' : 'Копия из библиотеки'}`,
                    campaignActor: kind === 'characters' && c.campaignId === campaignId,
                    placement: {
                        type: 'libraryActor',
                        actorId: c.id,
                        library: kind,
                        name: c.name,
                        previewUrl: c.portrait?.url,
                    } as Placement,
                }));
            }
            if (kind === 'prop' && source === 'presets') {
                const result = await request<{ presets: ObjectPreset[]; pages: number }>(
                    `/library/object-presets?${new URLSearchParams({ search: assetSearch, page: String(page) })}`,
                    'GET',
                    undefined,
                    abort.signal,
                );
                if (!abort.signal.aborted) setPages(result.pages);
                return result.presets.map((preset) => ({
                    id: preset.id,
                    name: preset.name,
                    image: preset.asset.url,
                    detail: preset.category,
                    placement: {
                        type: 'objectPreset',
                        preset,
                        name: preset.name,
                        rotation: preset.settings.rotation,
                        scaleFactor: 1,
                    } as Placement,
                }));
            }
            const result = await preparation.assets(
                campaignId,
                {
                    kind: 'prop',
                    search: assetSearch,
                    page,
                    sort: 'newest',
                    tag: '',
                    collection: '',
                },
                abort.signal,
            );
            if (!abort.signal.aborted) setPages(result.pages);
            return result.assets.map((asset: LibraryAsset) => ({
                id: asset.id,
                name: asset.name,
                image: asset.thumbnailUrl,
                detail:
                    kind === 'container'
                        ? 'Пустой контейнер · наполнение в контексте'
                        : kind === 'interaction'
                          ? 'Осмотреть · без проверки и эффектов'
                          : 'Клик — разместить копию',
                placement: {
                    type: 'prop',
                    asset,
                    name: asset.name,
                    ...(kind !== 'prop' ? { purpose: kind } : {}),
                } as Placement,
            }));
        };
        const timer = setTimeout(
            () => {
                setLoading(true);
                setError('');
                void load()
                    .then((rows) => {
                        if (!abort.signal.aborted) {
                            setEntries(rows);
                            setLoadedKey(requestKey);
                        }
                    })
                    .catch((e) => {
                        if (!abort.signal.aborted) {
                            setError(e.message);
                            setLoadedKey(requestKey);
                        }
                    })
                    .finally(() => {
                        if (!abort.signal.aborted) setLoading(false);
                    });
            },
            actor ? 0 : 150,
        );
        return () => {
            clearTimeout(timer);
            abort.abort();
        };
    }, [actor, kind, campaignId, assetSearch, page, source, retry, requestKey]);
    const visible = actor
        ? entries.filter((e) =>
              e.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
          )
        : entries;
    return (
        <>
            {kind === 'prop' && (
                <div className="entity-sources" role="group" aria-label="Источник объектов">
                    <button
                        aria-pressed={source === 'assets'}
                        onClick={() => onQuery({ ...query, source: 'assets', page: 1 })}
                    >
                        Изображения
                    </button>
                    <button
                        aria-pressed={source === 'presets'}
                        onClick={() => onQuery({ ...query, source: 'presets', page: 1 })}
                    >
                        Object Presets
                    </button>
                </div>
            )}
            <label className="runtime-add-search">
                <Search size={15} />
                <input
                    autoFocus
                    type="search"
                    maxLength={100}
                    placeholder="Поиск по имени…"
                    aria-label="Поиск сущности"
                    value={search}
                    onChange={(e) => {
                        onQuery({ ...query, search: e.target.value, page: 1 });
                        if (!actor) setLoading(true);
                    }}
                />
            </label>
            <div className="runtime-add-results" aria-busy={loading}>
                {error && loadedKey === requestKey ? (
                    <div role="alert">
                        <p>{error}</p>
                        <button className="text-button" onClick={() => setRetry((n) => n + 1)}>
                            Повторить
                        </button>
                    </div>
                ) : loading ? (
                    <p role="status">Загружаем…</p>
                ) : visible.length ? (
                    visible.map((entry) => (
                        <button
                            className="runtime-add-entity"
                            key={entry.id}
                            aria-pressed={
                                onDragStart
                                    ? !!selectedPlacement &&
                                      placementIdentity(selectedPlacement) ===
                                          placementIdentity(entry.placement)
                                    : undefined
                            }
                            disabled={entry.campaignActor && placedCharacterIds.includes(entry.id)}
                            onClick={() => onPlace(entry.placement)}
                            draggable={
                                !!onDragStart &&
                                !(entry.campaignActor && placedCharacterIds.includes(entry.id))
                            }
                            onDragStart={(event) => {
                                event.dataTransfer.setData(ENTITY_MIME, entry.id);
                                event.dataTransfer.effectAllowed = 'copy';
                                onDragStart?.(entry.placement);
                            }}
                            onDragEnd={onDragEnd}
                        >
                            {entry.image ? (
                                <img src={entry.image} alt="" draggable={false} loading="lazy" />
                            ) : (
                                <CircleUserRound size={34} />
                            )}
                            <span>
                                <strong>{entry.name}</strong>
                                <small>
                                    {entry.campaignActor && placedCharacterIds.includes(entry.id)
                                        ? 'Уже на этой сцене'
                                        : entry.detail}
                                </small>
                            </span>
                        </button>
                    ))
                ) : (
                    <p className="hint">{search ? 'Ничего не найдено' : 'Библиотека пока пуста'}</p>
                )}
            </div>
            {!actor && pages > 1 && (
                <nav className="runtime-add-pages" aria-label="Страницы объектов">
                    <button
                        disabled={page === 1 || loading}
                        onClick={() => onQuery({ ...query, page: page - 1 })}
                    >
                        ←
                    </button>
                    <small>
                        {page} / {pages}
                    </small>
                    <button
                        disabled={page >= pages || loading}
                        onClick={() => onQuery({ ...query, page: page + 1 })}
                    >
                        →
                    </button>
                </nav>
            )}
            <footer>
                {onDragStart
                    ? 'Клик или перетаскивание → место на карте'
                    : 'Выберите сущность → укажите место на карте'}{' '}
                <kbd>Esc</kbd>
            </footer>
        </>
    );
}
