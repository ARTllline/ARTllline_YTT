import { defaultTerrainBrush } from '../../tabletop/mapEditor';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Eraser, Palette, Paintbrush, RefreshCw, Search } from 'lucide-react';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import { MaterialPreview } from './MaterialLibrary';
import { EditorOptions } from './EditorOptions';
import { materials, type Material } from './materials';

export function TerrainPanel({
    store,
    onTool,
    onMaterials,
    onSettings,
}: {
    store: SceneStore;
    onTool: () => void;
    onMaterials: () => void;
    onSettings: () => void;
}) {
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const settings = state.mapEditor?.terrain ?? defaultTerrainBrush;
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [type, setType] = useState<'terrain' | 'floor'>(() =>
        settings.material?.type === 'floor' ? 'floor' : 'terrain',
    );
    const [refresh, setRefresh] = useState(0);
    const query = JSON.stringify([search, type, page, refresh]);
    const [loaded, setLoaded] = useState<{
        query: string;
        result?: { materials: Material[]; pages: number };
        error?: string;
    }>();
    const current = loaded?.query === query ? loaded : undefined;
    const canPaint = !!state.scene.mapWorld;
    const update = (patch: Partial<typeof settings>) => {
        if (state.mapEditor)
            store.setMapEditor({ ...state.mapEditor, terrain: { ...settings, ...patch } });
        onTool();
    };
    useEffect(() => {
        if (!canPaint) return;
        const abort = new AbortController();
        const timer = setTimeout(() => {
            void materials
                .list(search, type, page, abort.signal)
                .then((result) => {
                    if (!abort.signal.aborted) setLoaded({ query, result });
                })
                .catch((e: Error) => {
                    if (!abort.signal.aborted) setLoaded({ query, error: e.message });
                });
        }, 120);
        return () => {
            clearTimeout(timer);
            abort.abort();
        };
    }, [canPaint, search, page, type, query]);

    const slider = (
        key: 'size' | 'softness' | 'strength',
        label: string,
        min: number,
        max: number,
    ) => (
        <label className="terrain-slider">
            <span>
                {label}
                <output>
                    {key === 'size'
                        ? settings[key] + ' wu'
                        : Math.round((settings[key] / 255) * 100) + '%'}
                </output>
            </span>
            <input
                aria-label={label}
                type="range"
                min={min}
                max={max}
                value={settings[key]}
                onChange={(event) => update({ [key]: Number(event.target.value) })}
            />
        </label>
    );
    if (!canPaint)
        return (
            <div className="map-editor-context surface">
                <button className="primary-button" onClick={onSettings}>
                    Создать MapWorld
                </button>
                <small>Создайте основу карты, чтобы рисовать покрытия</small>
            </div>
        );
    const items = current?.result?.materials;
    const pages = current?.result?.pages ?? 1;
    return (
        <>
            <div className="map-editor-context surface" aria-label="Кисть Terrain">
                <div className="terrain-tools" role="group" aria-label="Действие кисти">
                    <button
                        title="Рисовать · E"
                        aria-pressed={settings.operation === 'paint'}
                        onClick={() => update({ operation: 'paint' })}
                    >
                        <Paintbrush size={15} /> Paint
                    </button>
                    <button
                        title="Стирать · E"
                        aria-pressed={settings.operation === 'erase'}
                        onClick={() => update({ operation: 'erase' })}
                    >
                        <Eraser size={15} /> Erase
                    </button>
                </div>
                {slider('size', 'Размер кисти', 4, 1024)}
                <EditorOptions label="Параметры кисти" summary="Кисть">
                    {slider('softness', 'Мягкость', 0, 255)}
                    {slider('strength', 'Непрозрачность', 1, 255)}
                </EditorOptions>
                <small className="terrain-current">
                    {settings.operation === 'erase'
                        ? 'Стирание всех покрытий'
                        : (settings.material?.displayName ??
                          settings.material?.name ??
                          'Выберите покрытие')}
                </small>
            </div>
            <aside className="map-editor-panel panel terrain-panel" aria-label="Terrain Painter">
                <div className="panel-heading">
                    <Paintbrush size={16} />
                    <strong>Покрытия</strong>
                    <button
                        className="icon-button"
                        aria-label="Открыть библиотеку материалов"
                        title="Библиотека материалов"
                        onClick={onMaterials}
                    >
                        <Palette size={16} />
                    </button>
                </div>
                <div className="map-editor-panel-body">
                    <div className="map-editor-filters">
                        <div className="map-editor-search">
                            <Search size={15} />
                            <input
                                type="search"
                                aria-label="Поиск материала кисти"
                                placeholder="Найти покрытие…"
                                value={search}
                                onChange={(e) => {
                                    setSearch(e.target.value);
                                    setPage(1);
                                }}
                            />
                        </div>
                        <select
                            aria-label="Surface type"
                            value={type}
                            onChange={(e) => {
                                setType(e.target.value === 'floor' ? 'floor' : 'terrain');
                                setPage(1);
                            }}
                        >
                            <option value="terrain">Грунт</option>
                            <option value="floor">Пол</option>
                        </select>
                    </div>
                    <div className="map-editor-results" aria-busy={!current}>
                        {current?.error && (
                            <p role="alert">
                                {current.error}{' '}
                                <button
                                    className="text-button"
                                    onClick={() => setRefresh((v) => v + 1)}
                                >
                                    <RefreshCw size={14} /> Повторить
                                </button>
                            </p>
                        )}
                        {!current && <p role="status">Загружаем покрытия…</p>}
                        <div className="terrain-materials">
                            {items?.map((m) => (
                                <button
                                    key={m.versionId}
                                    className="terrain-material"
                                    title={m.name}
                                    aria-label={`Рисовать: ${m.name}`}
                                    aria-pressed={settings.material?.versionId === m.versionId}
                                    onClick={() => update({ material: m, operation: 'paint' })}
                                >
                                    <MaterialPreview material={m} />
                                    <strong>{m.displayName ?? m.name}</strong>
                                </button>
                            ))}
                        </div>
                        {items?.length === 0 && (
                            <p>Покрытия не найдены. Проверьте поиск или тип.</p>
                        )}
                    </div>
                    {pages > 1 && (
                        <div className="map-editor-pagination">
                            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                                Назад
                            </button>
                            <span>
                                {page} / {pages}
                            </span>
                            <button disabled={page >= pages} onClick={() => setPage(page + 1)}>
                                Далее
                            </button>
                        </div>
                    )}
                    <p className="hint">
                        <kbd>[</kbd> <kbd>]</kbd> размер · <kbd>E</kbd> Paint / Erase ·{' '}
                        <kbd>Esc</kbd> отмена
                    </p>
                </div>
            </aside>
        </>
    );
}
