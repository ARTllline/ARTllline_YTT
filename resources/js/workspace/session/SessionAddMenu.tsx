import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Box, CircleUserRound, Hand, PackageOpen, Search, Skull, X } from 'lucide-react';
import { request } from '../../api/client';
import { preparation, type LibraryAsset } from '../../api/preparation';
import type { Character } from '../../tabletop/types/scene';
import type { Placement } from '../creation/model';
import './session-add.css';

const kinds = [
    ['characters', 'Character', 'Герой из библиотеки', CircleUserRound],
    ['npcs', 'NPC', 'Независимая копия существа', Skull],
    ['prop', 'Prop', 'Объект на карте', Box],
    ['container', 'Container', 'Объект с пустым контейнером', PackageOpen],
    ['interaction', 'Interaction', 'Объект с действием «Осмотреть»', Hand],
] as const;
type Kind = (typeof kinds)[number][0];
type Entry = {
    id: string;
    name: string;
    image?: string;
    detail: string;
    campaignActor?: boolean;
    placement: Placement;
};

export function SessionAddMenu({
    campaignId,
    placedCharacterIds,
    onPlace,
    onClose,
}: {
    campaignId: string;
    placedCharacterIds: string[];
    onPlace: (item: Placement) => void;
    onClose: () => void;
}) {
    const [kind, setKind] = useState<Kind | null>(null);
    const root = useRef<HTMLElement>(null);
    const close = useRef(onClose);
    useEffect(() => {
        close.current = onClose;
    }, [onClose]);
    useEffect(() => {
        root.current?.querySelector<HTMLButtonElement>('button')?.focus();
        const outside = (e: PointerEvent) => {
            if (!(e.target as HTMLElement).closest('.runtime-add, .creation-launch'))
                close.current();
        };
        const key = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                close.current();
            }
        };
        document.addEventListener('pointerdown', outside, true);
        window.addEventListener('keydown', key, true);
        return () => {
            document.removeEventListener('pointerdown', outside, true);
            window.removeEventListener('keydown', key, true);
        };
    }, []);
    return (
        <section className="runtime-add" ref={root} aria-label="Добавить на карту">
            <header>
                {kind && (
                    <button
                        className="icon-button"
                        aria-label="Назад к типам"
                        onClick={() => setKind(null)}
                    >
                        <ArrowLeft size={16} />
                    </button>
                )}
                <strong>
                    {kind ? kinds.find((k) => k[0] === kind)?.[1] : 'Добавить на карту'}
                </strong>
                <button className="icon-button" aria-label="Закрыть добавление" onClick={onClose}>
                    <X size={16} />
                </button>
            </header>
            {kind ? (
                <EntityPicker
                    key={kind}
                    kind={kind}
                    campaignId={campaignId}
                    placedCharacterIds={placedCharacterIds}
                    onPlace={onPlace}
                />
            ) : (
                <div className="runtime-add-types">
                    {kinds.map(([key, label, hint, Icon]) => (
                        <button key={key} onClick={() => setKind(key)}>
                            <Icon size={19} />
                            <span>
                                <strong>{label}</strong>
                                <small>{hint}</small>
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </section>
    );
}

function EntityPicker({
    kind,
    campaignId,
    placedCharacterIds,
    onPlace,
}: {
    kind: Kind;
    campaignId: string;
    placedCharacterIds: string[];
    onPlace: (item: Placement) => void;
}) {
    const [search, setSearch] = useState('');
    const [entries, setEntries] = useState<Entry[]>([]);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);
    const actor = kind === 'characters' || kind === 'npcs';
    const assetSearch = actor ? '' : search;
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
                        if (!abort.signal.aborted) setEntries(rows);
                    })
                    .catch((e) => {
                        if (!abort.signal.aborted) setError(e.message);
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
    }, [actor, kind, campaignId, assetSearch, page, retry]);
    const visible = actor
        ? entries.filter((e) =>
              e.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
          )
        : entries;
    return (
        <>
            <label className="runtime-add-search">
                <Search size={15} />
                <input
                    autoFocus
                    type="search"
                    placeholder="Поиск по имени…"
                    aria-label="Поиск сущности"
                    value={search}
                    onChange={(e) => {
                        setSearch(e.target.value);
                        setPage(1);
                        if (!actor) setLoading(true);
                    }}
                />
            </label>
            <div className="runtime-add-results" aria-busy={loading}>
                {error ? (
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
                            disabled={entry.campaignActor && placedCharacterIds.includes(entry.id)}
                            onClick={() => onPlace(entry.placement)}
                        >
                            {entry.image ? (
                                <img src={entry.image} alt="" />
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
                    <button disabled={page === 1 || loading} onClick={() => setPage(page - 1)}>
                        ←
                    </button>
                    <small>
                        {page} / {pages}
                    </small>
                    <button disabled={page >= pages || loading} onClick={() => setPage(page + 1)}>
                        →
                    </button>
                </nav>
            )}
            <footer>
                Выберите сущность → укажите место на карте <kbd>Esc</kbd>
            </footer>
        </>
    );
}
