import { useEffect, useState } from 'react';
import { Copy, Pencil, Search, Trash2 } from 'lucide-react';
import { compositions, type CompositionPreset } from '../../api/compositions';
import type { Placement } from './model';
import type { CatalogQuery } from './EntityPicker';
import { ENTITY_MIME } from './EntityPicker';
import './compositions.css';
import type { LiveEcho } from '../../realtime/useCampaignLive';

export function CompositionCatalog({
    query,
    onQuery,
    selectedPlacement,
    onPlace,
    onDragStart,
    onDragEnd,
    echo,
    userId,
}: {
    query: CatalogQuery;
    onQuery: (q: CatalogQuery) => void;
    selectedPlacement?: Placement | null;
    onPlace: (p: Placement) => void;
    onDragStart: (p: Placement) => void;
    onDragEnd: () => void;
    echo?: LiveEcho | null;
    userId?: string;
}) {
    const [result, setResult] = useState<{ presets: CompositionPreset[]; pages: number }>({
        presets: [],
        pages: 1,
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);
    const [busy, setBusy] = useState(false);
    const [editing, setEditing] = useState<CompositionPreset | null>(null);
    const [deleting, setDeleting] = useState<CompositionPreset | null>(null);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    useEffect(() => {
        if (!echo || !userId) return;
        const channel = `library.${userId}.compositions`;
        const refresh = () => setRetry((n) => n + 1);
        echo.private(channel)
            .listen('.tabletop', (event: { type: string }) => {
                if (event.type === 'composition-library.changed') refresh();
            })
            .subscribed(refresh);
        window.addEventListener('online', refresh);
        return () => {
            window.removeEventListener('online', refresh);
            echo.leave(channel);
        };
    }, [echo, userId]);
    useEffect(() => {
        const abort = new AbortController();
        const timer = setTimeout(() => {
            setLoading(true);
            setError('');
            void compositions
                .list(query.search, query.page, abort.signal)
                .then((r) => {
                    if (!abort.signal.aborted) setResult(r);
                })
                .catch((e) => {
                    if (!abort.signal.aborted) setError(e.message);
                })
                .finally(() => {
                    if (!abort.signal.aborted) setLoading(false);
                });
        }, 150);
        return () => {
            clearTimeout(timer);
            abort.abort();
        };
    }, [query.search, query.page, retry]);
    const command = (preset: CompositionPreset, action: 'rename' | 'duplicate' | 'delete') => {
        onDragEnd();
        setBusy(true);
        setError('');
        void compositions
            .command(
                preset,
                action,
                action === 'rename' ? name.trim() : undefined,
                description.trim(),
            )
            .then(() => {
                setEditing(null);
                setDeleting(null);
                setRetry((n) => n + 1);
            })
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
    };
    return (
        <>
            <label className="runtime-add-search">
                <Search size={15} />
                <input
                    autoFocus
                    type="search"
                    aria-label="Поиск пресетов"
                    placeholder="Поиск пресетов…"
                    maxLength={160}
                    value={query.search}
                    onChange={(e) => {
                        setLoading(true);
                        onQuery({ ...query, search: e.target.value, page: 1 });
                    }}
                />
            </label>
            <p className="hint composition-intro">Ваши композиции · доступны во всех кампаниях</p>
            {error && (
                <div role="alert">
                    <p>{error}</p>
                    <button className="text-button" onClick={() => setRetry((n) => n + 1)}>
                        Обновить каталог
                    </button>
                </div>
            )}
            <div className="runtime-add-results composition-catalog" aria-busy={loading}>
                {loading ? (
                    <p role="status">Загружаем…</p>
                ) : (
                    result.presets.map((preset) => {
                        const item: Placement = { type: 'composition', preset, name: preset.name };
                        const active =
                            selectedPlacement?.type === 'composition' &&
                            selectedPlacement.preset.id === preset.id;
                        return (
                            <article className="composition-card" key={preset.id}>
                                <button
                                    className="composition-place"
                                    aria-pressed={active}
                                    disabled={busy}
                                    draggable={!busy}
                                    onClick={() => onPlace(item)}
                                    onDragStart={(e) => {
                                        e.dataTransfer.setData(ENTITY_MIME, preset.id);
                                        e.dataTransfer.effectAllowed = 'copy';
                                        onDragStart(item);
                                    }}
                                    onDragEnd={onDragEnd}
                                >
                                    <div className="composition-thumbnails">
                                        {preset.members
                                            .slice(0, 5)
                                            .map((m, i) =>
                                                m.image ? (
                                                    <img
                                                        key={i}
                                                        src={m.image.url}
                                                        alt=""
                                                        draggable={false}
                                                    />
                                                ) : (
                                                    <span key={i}>
                                                        {m.kind === 'token' ? 'NPC' : '□'}
                                                    </span>
                                                ),
                                            )}
                                    </div>
                                    <strong>{preset.name}</strong>
                                    <small>
                                        {preset.count} элементов · NPC:{' '}
                                        {preset.members.filter((m) => m.kind === 'token').length} ·
                                        Контейнеры:{' '}
                                        {preset.members.filter((m) => m.container).length}
                                    </small>
                                    {preset.description && <p>{preset.description}</p>}
                                </button>
                                <details>
                                    <summary>Состав и содержимое</summary>
                                    <div className="composition-members">
                                        {preset.members.map((m, i) => (
                                            <span key={i}>
                                                {m.name}
                                                {m.container ? ` · предметов: ${m.items}` : ''}
                                                {m.interactions
                                                    ? ` · действий: ${m.interactions}`
                                                    : ''}
                                            </span>
                                        ))}
                                    </div>
                                </details>
                                <div className="composition-actions">
                                    <button
                                        className="icon-button"
                                        disabled={busy}
                                        aria-label={`Переименовать ${preset.name}`}
                                        onClick={() => {
                                            onDragEnd();
                                            setEditing(preset);
                                            setDeleting(null);
                                            setName(preset.name);
                                            setDescription(preset.description || '');
                                        }}
                                    >
                                        <Pencil size={14} />
                                    </button>
                                    <button
                                        className="icon-button"
                                        disabled={busy}
                                        aria-label={`Копировать ${preset.name}`}
                                        onClick={() => command(preset, 'duplicate')}
                                    >
                                        <Copy size={14} />
                                    </button>
                                    <button
                                        className="icon-button"
                                        disabled={busy}
                                        aria-label={`Удалить ${preset.name}`}
                                        onClick={() => {
                                            onDragEnd();
                                            setDeleting(preset);
                                            setEditing(null);
                                        }}
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                                {editing?.id === preset.id && (
                                    <form
                                        className="composition-form"
                                        onSubmit={(e) => {
                                            e.preventDefault();
                                            command(preset, 'rename');
                                        }}
                                    >
                                        <label>
                                            Название
                                            <input
                                                autoFocus
                                                required
                                                maxLength={160}
                                                value={name}
                                                onChange={(e) => setName(e.target.value)}
                                                disabled={busy}
                                            />
                                        </label>
                                        <label>
                                            Описание
                                            <textarea
                                                maxLength={2000}
                                                value={description}
                                                onChange={(e) => setDescription(e.target.value)}
                                                disabled={busy}
                                            />
                                        </label>
                                        <button
                                            className="secondary-button"
                                            disabled={busy || !name.trim()}
                                        >
                                            Сохранить
                                        </button>
                                        <button
                                            className="text-button"
                                            type="button"
                                            disabled={busy}
                                            onClick={() => setEditing(null)}
                                        >
                                            Отмена
                                        </button>
                                    </form>
                                )}
                                {deleting?.id === preset.id && (
                                    <div role="alert">
                                        <p>
                                            Удалить «{preset.name}»? Размещённые экземпляры
                                            сохранятся.
                                        </p>
                                        <button
                                            className="secondary-button"
                                            disabled={busy}
                                            onClick={() => command(preset, 'delete')}
                                        >
                                            Удалить пресет
                                        </button>
                                        <button
                                            className="text-button"
                                            disabled={busy}
                                            onClick={() => setDeleting(null)}
                                        >
                                            Отмена
                                        </button>
                                    </div>
                                )}
                            </article>
                        );
                    })
                )}
                {!loading && !result.presets.length && (
                    <p className="hint">
                        {query.search
                            ? 'Ничего не найдено'
                            : 'Выделите группу на сцене и сохраните её как пресет.'}
                    </p>
                )}
            </div>
            {result.pages > 1 && (
                <nav className="runtime-add-pages" aria-label="Страницы пресетов">
                    <button
                        disabled={loading || query.page <= 1}
                        onClick={() => onQuery({ ...query, page: query.page - 1 })}
                    >
                        ←
                    </button>
                    <small>
                        {query.page} / {result.pages}
                    </small>
                    <button
                        disabled={loading || query.page >= result.pages}
                        onClick={() => onQuery({ ...query, page: query.page + 1 })}
                    >
                        →
                    </button>
                </nav>
            )}
            <footer>
                Клик или перетаскивание → место на карте · <kbd>Esc</kbd>
            </footer>
        </>
    );
}
